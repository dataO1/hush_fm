// Backend API calls
import { state, log } from "./state.js";

export async function loadIceConfig() {
  const res = await fetch("/config");
  const data = await res.json();
  log("Loaded ICE servers", data.iceServers?.length || 0);
  return { iceServers: data.iceServers || [] };
}

export async function identify() {
  const reuse = localStorage.getItem("sd_client_id");
  const payload = reuse ? { client_id: reuse } : {};
  const res = await fetch("/user/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  state.clientId = data.client_id;
  state.name = data.name;
  localStorage.setItem("sd_client_id", state.clientId);
  log("Identified", state.name, state.clientId);
}

export async function listRooms() {
  const res = await fetch("/rooms");
  const data = await res.json();
  if (!data.ok) return [];
  return data.rooms;
}

export async function roomExists(roomId) {
  const rooms = await listRooms();
  return !!rooms.find((r) => r.id === roomId);
}

export async function createRoom(name) {
  const res = await fetch("/room/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: state.clientId, name }),
  });
  const data = await res.json();
  return data;
}

export async function joinRoom(roomId, role) {
  const res = await fetch(`/room/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: state.clientId, role }),
  });
  return await res.json();
}

export async function closeRoom(roomId) {
  const res = await fetch(`/room/${roomId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: state.clientId }),
  });
  return await res.json();
}

export async function fetchLkToken(role, roomId) {
  const res = await fetch("/lk/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: state.clientId, role, room_id: roomId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "token failed");
  return data;
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
    });
  }, 15000);
}
