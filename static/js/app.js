// Main entry point - OPTIMIZED VERSION
// WebSocket support + AbortController + exponential backoff + error recovery
import { state, log, loadConfig } from "./state.js";
import {
  identify,
  roomExists,
  joinRoom,
  fetchLkToken,
  closeRoom,
} from "./api.js";
import { connectRoom, ensurePublishedPresence } from "./livekit.js";
import { ensureDeviceList } from "./audio.js";
import {
  show,
  updateMuteButton,
  highlightActiveSource,
  setDjRoomMeta,
  setListenerRoomMeta,
  renderRoomsList,
  updateRoomsList,
  initButtons,
} from "./ui.js";
import {
  setupMediaSession,
  updateMediaSession,
  stopMediaSession,
} from "./mediaSession.js";

// AbortController for cancelling ongoing requests
let enterRoomAbortController = null;
let roomUpdatesPingInterval = null;

// WebSocket for real-time room updates
let roomUpdatesWs = null;
let wsReconnectAttempts = 0;
const MAX_WS_RECONNECT_ATTEMPTS = 5;

// Fallback polling with exponential backoff
let pollInterval = null;
let currentPollDelay = 10000; // Start at 10 seconds
const MAX_POLL_DELAY = 60000; // Max 1 minute

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/static/sw.js");
}

function parseRoute() {
  const path = location.pathname.replace(/\/+$/, "");
  const m = path.match(/^\/r\/([a-f0-9]{8})$/i);
  const params = new URLSearchParams(location.search);
  return { roomId: m ? m[1] : null, asDj: params.get("dj") === "1" };
}

export function navigateToRoom(roomId, asDj = false) {
  const url = `/r/${roomId}${asDj ? "?dj=1" : ""}`;
  history.pushState({}, "", url);
}

function navigateToRoot() {
  history.pushState({}, "", "/");
}

async function ensureIdentityReady() {
  if (!state.clientId) {
    await identify();
    await loadConfig();
  }
}

// WebSocket connection for real-time room updates
function connectRoomUpdatesWebSocket() {
  if (roomUpdatesWs && roomUpdatesWs.readyState === WebSocket.OPEN) {
    return; // Already connected
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws/rooms`;
  // Add connection timeout
  let connectTimeout = setTimeout(() => {
    if (roomUpdatesWs && roomUpdatesWs.readyState === WebSocket.CONNECTING) {
      log("WebSocket connection timeout, retrying...");
      roomUpdatesWs.close();
    }
  }, 10000); // 10 second timeout
  try {
    roomUpdatesWs = new WebSocket(wsUrl);

    roomUpdatesWs.onopen = () => {
      log("📡 WebSocket connected for room updates");
      wsReconnectAttempts = 0;

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      // Clear old ping interval if exists
      if (roomUpdatesPingInterval) {
        clearInterval(roomUpdatesPingInterval);
      }

      // Send periodic ping
      roomUpdatesPingInterval = setInterval(() => {
        if (roomUpdatesWs && roomUpdatesWs.readyState === WebSocket.OPEN) {
          roomUpdatesWs.send("ping");
        }
      }, 30000);
    };

    roomUpdatesWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "rooms") {
          updateRoomsList(data.data);
        }
      } catch (err) {
        log(`WebSocket message error: ${err.message}`);
      }
    };

    roomUpdatesWs.onerror = (error) => {
      log(`WebSocket error: ${error}`);
    };

    roomUpdatesWs.onclose = () => {
      log("📡 WebSocket disconnected");
      roomUpdatesWs = null;
      // Clear ping interval
      if (roomUpdatesPingInterval) {
        clearInterval(roomUpdatesPingInterval);
        roomUpdatesPingInterval = null;
      }

      // Reconnect with exponential backoff
      if (wsReconnectAttempts < MAX_WS_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);
        wsReconnectAttempts++;
        log(
          `Reconnecting WebSocket in ${delay}ms (attempt ${wsReconnectAttempts})`,
        );
        setTimeout(connectRoomUpdatesWebSocket, delay);
      } else {
        log(
          "Max WebSocket reconnect attempts reached, falling back to polling",
        );
        startFallbackPolling();
      }
    };
  } catch (err) {
    clearTimeout(connectTimeout);
    log(`WebSocket connection failed: ${err.message}`);
    startFallbackPolling();
  }
}

// Fallback polling with exponential backoff
function startFallbackPolling() {
  if (pollInterval) return; // Already polling

  log(`Starting fallback polling (${currentPollDelay}ms interval)`);

  pollInterval = setInterval(async () => {
    // Only poll when on landing page
    if (!landing.classList.contains("hidden")) {
      try {
        await renderRoomsList();
        // Reset delay on successful fetch
        currentPollDelay = 10000;
      } catch (err) {
        // Increase delay on error (exponential backoff)
        currentPollDelay = Math.min(currentPollDelay * 1.5, MAX_POLL_DELAY);
        log(`Poll failed, increasing interval to ${currentPollDelay}ms`);
      }
    }
  }, currentPollDelay);
}

// Optimized enterRoom with AbortController
async function enterRoom(roomId, role) {
  // Cancel any ongoing room join
  if (enterRoomAbortController) {
    enterRoomAbortController.abort();
    log("⚠️ Cancelled previous room join");
  }

  if (state.isConnecting) {
    log("⚠️ Already connecting, request cancelled");
    return;
  }

  state.isConnecting = true;
  enterRoomAbortController = new AbortController();
  const signal = enterRoomAbortController.signal;

  try {
    // Check if request was aborted
    if (signal.aborted) return;

    if (!(await roomExists(roomId))) {
      log("Room not found, redirecting to home");
      navigateToRoot();
      show(document.getElementById("landing"));
      await renderRoomsList();
      return;
    }

    state.roomId = roomId;
    state.role = role;

    if (signal.aborted) return;

    const joinRes = await joinRoom(roomId, role);
    if (!joinRes.ok) {
      log("Join failed", joinRes.error || "");
      navigateToRoot();
      show(document.getElementById("landing"));
      await renderRoomsList();
      return;
    }

    state.roomName = joinRes.name || state.roomName || "";

    if (signal.aborted) return;

    const { url, token } = await fetchLkToken(role, roomId);

    if (signal.aborted) return;

    await connectRoom(url, token);
    setupMediaSession(roomId);

    if (role === "dj") {
      setDjRoomMeta();
      show(document.getElementById("djView"));
      await ensureDeviceList();
      await ensurePublishedPresence();
      updateMuteButton();
      highlightActiveSource();
    } else {
      const rooms = await (await fetch("/rooms")).json();
      const r = rooms.rooms.find((x) => x.id === roomId) || {};
      setListenerRoomMeta({
        name: r.name,
        dj_name: r.dj_name,
        listener_count: r.listener_count,
      });
      if (!r.dj_online)
        document.getElementById("offline").classList.remove("hidden");
      show(document.getElementById("listenerView"));
    }
  } catch (err) {
    if (err.name === "AbortError") {
      log("Room join aborted");
    } else {
      log(`Enter room error: ${err.message}`);
      alert("Failed to join room. Please try again.");
      navigateToRoot();
      show(document.getElementById("landing"));
    }
  } finally {
    state.isConnecting = false;
    enterRoomAbortController = null;
  }
}

async function closeFloor() {
  if (!state.roomId || state.role !== "dj") return;
  try {
    if (state.lkRoom) {
      const msg = new TextEncoder().encode(
        JSON.stringify({ type: "room_close" }),
      );
      try {
        await state.lkRoom.localParticipant.publishData(msg, {
          reliable: true,
        });
      } catch {}
    }
  } catch {}
  try {
    stopMediaSession();
    await closeRoom(state.roomId);
  } catch {}
  try {
    state.lkRoom?.disconnect();
  } catch {}
  state.lkRoom = null;
  state.localTrack = null;
  state.currentPub = null;
  state.onAir = false;
  navigateToRoot();
  show(document.getElementById("landing"));
  await renderRoomsList();
}

window.addEventListener("popstate", async () => {
  const route = parseRoute();
  if (route.roomId) {
    await ensureIdentityReady();
    await enterRoom(route.roomId, route.asDj ? "dj" : "listener");
  } else {
    show(document.getElementById("landing"));
    await renderRoomsList();
  }
});

window.addEventListener("load", async () => {
  await ensureIdentityReady();
  const route = parseRoute();

  if (route.roomId) {
    if (!(await roomExists(route.roomId))) {
      navigateToRoot();
      show(document.getElementById("landing"));
      await renderRoomsList();
      return;
    }
    navigateToRoom(route.roomId, route.asDj);
    await enterRoom(route.roomId, route.asDj ? "dj" : "listener");
  } else {
    show(document.getElementById("landing"));
    await renderRoomsList();

    // Connect WebSocket for real-time updates
    connectRoomUpdatesWebSocket();
  }

  updateMuteButton();
  initButtons(enterRoom, closeFloor);

  // Hook up room list join buttons
  document.getElementById("roomsList").addEventListener("click", async (e) => {
    const btn = e.target.closest(".join");
    if (!btn) return;
    const rid = btn.getAttribute("data-id");
    const role = btn.getAttribute("data-role");
    navigateToRoom(rid, role === "dj");
    await enterRoom(rid, role);
  });
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (roomUpdatesWs) {
    roomUpdatesWs.close();
  }
});
