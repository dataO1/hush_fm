// Backend API calls
import { state, log } from "./state.js";

export async function loadIceConfig() {
  try {
    const res = await fetch("/config");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    log(`Loaded ICE servers: ${data.iceServers?.length || 0}`);
    return { iceServers: data.iceServers || [] };
  } catch (err) {
    log(`Failed to load ICE config: ${err.message}`);
    return { iceServers: [] };
  }
}

export async function identify() {
  try {
    const reuse = localStorage.getItem("sd_client_id");
    const payload = reuse ? { client_id: reuse } : {};

    const res = await fetch("/user/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.clientId = data.client_id;
    state.name = data.name;
    localStorage.setItem("sd_client_id", state.clientId);

    log(`Identified: ${state.name} (${state.clientId})`);
    return data;
  } catch (err) {
    log(`Identification failed: ${err.message}`);
    throw err;
  }
}

export async function listRooms() {
  try {
    const res = await fetch("/rooms");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.ok) return [];

    return data.rooms || [];
  } catch (err) {
    log(`Failed to list rooms: ${err.message}`);
    return [];
  }
}

export async function roomExists(roomId) {
  try {
    const rooms = await listRooms();
    return !!rooms.find((r) => r.id === roomId);
  } catch (err) {
    log(`Failed to check room existence: ${err.message}`);
    return false;
  }
}

export async function createRoom(name) {
  try {
    const res = await fetch("/room/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: state.clientId, name }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    log(`Room created: ${name}`);
    return data;
  } catch (err) {
    log(`Failed to create room: ${err.message}`);
    throw err;
  }
}

export async function joinRoom(roomId, role) {
  try {
    const res = await fetch(`/room/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: state.clientId, role }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    log(`Joined room: ${roomId} as ${role}`);
    return data;
  } catch (err) {
    log(`Failed to join room: ${err.message}`);
    throw err;
  }
}

export async function closeRoom(roomId) {
  try {
    const res = await fetch(`/room/${roomId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: state.clientId }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    log(`Room closed: ${roomId}`);
    return data;
  } catch (err) {
    log(`Failed to close room: ${err.message}`);
    throw err;
  }
}

export async function fetchLkToken(role, roomId) {
  try {
    const res = await fetch("/lk/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        client_id: state.clientId, 
        role, 
        room_id: roomId 
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Token request failed");

    log(`LiveKit token obtained for ${role}`);
    return data;
  } catch (err) {
    log(`Failed to fetch LiveKit token: ${err.message}`);
    throw err;
  }
}

export function startPresenceHeartbeat() {
  setInterval(() => {
    if (!state.clientId || !state.roomId) return;

    fetch("/presence/beat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: state.clientId,
        room_id: state.roomId,
        role: state.role,
      }),
    }).catch(err => {
      // Silently fail heartbeat errors
      console.debug("Heartbeat failed:", err.message);
    });
  }, 15000);

  log("Presence heartbeat started");
}
