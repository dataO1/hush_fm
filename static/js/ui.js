// UI updates and event handlers - OPTIMIZED
import { state, log } from "./state.js";
import { listRooms, createRoom, closeRoom } from "./api.js";
import { publish } from "./livekit.js";
import {
  createMicTrack,
  createExternalTrack,
  createSystemAudioTrack,
  ensureDeviceList,
  switchAudioSource,
} from "./audio.js";
import { navigateToRoom } from "./app.js";

const landing = document.getElementById("landing");
const djView = document.getElementById("djView");
const listenerView = document.getElementById("listenerView");
const btnMute = document.getElementById("btnMute");

// Cache DOM elements by room ID for differential updates
const roomElementCache = new Map();
let lastRoomHash = null;

export function show(section) {
  landing.classList.add("hidden");
  djView.classList.add("hidden");
  listenerView.classList.add("hidden");

  section.classList.remove("hidden");
}

export function updateMuteButton() {
  if (!btnMute) return;

  if (state.onAir) {
    btnMute.className = "btn rec";
    btnMute.setAttribute("aria-label", "Stop broadcasting");
    btnMute.setAttribute("aria-pressed", "true");
    btnMute.textContent = "● On Air";
  } else {
    btnMute.className = "btn stopped";
    btnMute.setAttribute("aria-label", "Start broadcasting");
    btnMute.setAttribute("aria-pressed", "false");
    btnMute.textContent = "■ Stopped";
  }
}

export function highlightActiveSource(activeId) {
  const sources = ["srcMic", "srcExternal", "srcSystem"];
  sources.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const isActive = id === activeId;
      el.setAttribute("aria-checked", isActive ? "true" : "false");
      el.classList.toggle("active", isActive);
    }
  });
}

export function setDjRoomMeta() {
  const title = document.getElementById("djRoomTitle");
  const name = document.getElementById("djName");
  if (title) title.textContent = state.roomName || "Room";
  if (name) name.textContent = state.name || "DJ";
}

export function setListenerRoomMeta(meta) {
  const title = document.getElementById("lsRoomTitle");
  const dj = document.getElementById("lsDj");
  const count = document.getElementById("lsCount");
  if (title && meta?.name) title.textContent = meta.name;
  if (dj && meta?.dj_name) dj.textContent = meta.dj_name;
  if (count && meta?.listener_count !== undefined) {
    count.textContent = meta.listener_count.toString();
  }
}

// OPTIMIZED: Differential room list updates
export function updateRoomsList(rooms) {
  const roomsList = document.getElementById("roomsList");
  const emptyRooms = document.getElementById("emptyRooms");

  if (!roomsList) return;

  if (!rooms || rooms.length === 0) {
    if (emptyRooms) emptyRooms.classList.remove("hidden");
    roomsList.setAttribute("aria-label", "No rooms available");
    roomElementCache.clear();
    roomsList.innerHTML = "";
    return;
  }

  if (emptyRooms) emptyRooms.classList.add("hidden");

  const roomHash = JSON.stringify(
    rooms.map((r) => [r.id, r.dj_client, r.listener_count]),
  );

  let sortedRooms;
  if (roomHash === lastRoomHash && sortedRooms) {
    // Use cached sort
  } else {
    // Re-sort
    sortedRooms = [...rooms].sort((a, b) => {
      const aIsOwn = a.dj_client === state.clientId;
      const bIsOwn = b.dj_client === state.clientId;
      if (aIsOwn && !bIsOwn) return -1;
      if (!aIsOwn && bIsOwn) return 1;
      return (b.listener_count || 0) - (a.listener_count || 0);
    });
    lastRoomHash = roomHash;
  }
  // Build new room ID set
  const newRoomIds = new Set(sortedRooms.map((r) => r.id));

  // Remove rooms no longer in list
  for (const [roomId, element] of roomElementCache.entries()) {
    if (!newRoomIds.has(roomId)) {
      element.remove();
      roomElementCache.delete(roomId);
    }
  }

  // Update or create room elements
  sortedRooms.forEach((room, index) => {
    const isOwnRoom = room.dj_client === state.clientId;
    let btn = roomElementCache.get(room.id);

    if (!btn) {
      // Create new element
      btn = document.createElement("button");
      btn.className = `btn room-list-item join${isOwnRoom ? " own-room" : ""}`;
      btn.setAttribute("data-id", room.id);
      btn.tabIndex = 0;

      const roomName = document.createElement("div");
      roomName.className = "room-name";
      const roomInfo = document.createElement("div");
      roomInfo.className = "room-info";

      btn.appendChild(roomName);
      btn.appendChild(roomInfo);
      roomElementCache.set(room.id, btn);
    }

    // Update content
    btn.setAttribute("data-role", isOwnRoom ? "dj" : "listener");
    btn.querySelector(".room-name").textContent = room.name || "Unnamed Room";

    const roomInfo = btn.querySelector(".room-info");
    if (isOwnRoom) {
      roomInfo.innerHTML = `<span class="own-badge">Your Room</span> • ${room.listener_count || 0} listening`;
      btn.setAttribute("aria-label", `Return to your DJ room: ${room.name}`);
    } else {
      roomInfo.textContent = `${room.dj_name || "Unknown DJ"} • ${room.listener_count || 0} listening`;
      btn.setAttribute(
        "aria-label",
        `Join room: ${room.name} with ${room.dj_name}`,
      );
    }

    // Maintain order
    if (index < roomsList.children.length) {
      if (roomsList.children[index] !== btn) {
        roomsList.insertBefore(btn, roomsList.children[index]);
      }
    } else {
      roomsList.appendChild(btn);
    }
  });

  roomsList.setAttribute(
    "aria-label",
    `${rooms.length} available room${rooms.length !== 1 ? "s" : ""}`,
  );
}

export async function renderRoomsList() {
  try {
    const rooms = await listRooms();
    updateRoomsList(rooms);
    log(`Rendered ${rooms.length} rooms`);
  } catch (err) {
    log(`Failed to render rooms: ${err.message}`);
  }
}

export function isDesktop() {
  return window.innerWidth > 720;
}

export function initButtons(enterRoomFn, closeFloorFn) {
  // Mute/unmute button
  const btnMute = document.getElementById("btnMute");
  if (btnMute) {
    btnMute.onclick = async () => {
      btnMute.disabled = true;
      try {
        if (state.onAir) {
          if (state.currentPub?.track) await state.currentPub.track.mute();
          state.onAir = false;
        } else {
          if (state.currentPub?.track) await state.currentPub.track.unmute();
          else if (state.localTrack) await publish(state.localTrack);
          state.onAir = true;
        }
        updateMuteButton();
      } finally {
        btnMute.disabled = false;
      }
    };
  }

  // Audio source buttons with disabled state
  const srcMic = document.getElementById("srcMic");
  if (srcMic) {
    srcMic.onclick = async () => {
      srcMic.disabled = true;
      try {
        const track = await createMicTrack();
        await switchAudioSource(track, "microphone");
        state.source = "mic";
        highlightActiveSource("srcMic");
      } catch (err) {
        log(`Mic switch failed: ${err.message}`);
        alert("Failed to access microphone");
      } finally {
        srcMic.disabled = false;
      }
    };
  }

  const srcSystem = document.getElementById("srcSystem");
  if (srcSystem) {
    srcSystem.onclick = async () => {
      srcSystem.disabled = true;
      try {
        const track = await createSystemAudioTrack();
        await switchAudioSource(track, "screen_share_audio");
        state.source = "system";
        highlightActiveSource("srcSystem");
      } catch (err) {
        log(`System audio switch failed: ${err.message}`);
        alert("Failed to capture system audio");
      } finally {
        srcSystem.disabled = false;
      }
    };
  }

  const srcExternal = document.getElementById("srcExternal");
  if (srcExternal) {
    srcExternal.onclick = async () => {
      try {
        const devices = await ensureDeviceList();
        populateExternalDevices(devices);
      } catch (err) {
        log(`Device list failed: ${err.message}`);
      }
    };
  }

  const btnClose = document.getElementById("btnClose");
  if (btnClose && closeFloorFn) {
    btnClose.onclick = closeFloorFn;
  }

  // Create room with auto-join
  const btnCreate = document.getElementById("btnCreate");
  const roomNameInput = document.getElementById("roomNameInput");

  if (btnCreate && enterRoomFn) {
    btnCreate.onclick = async () => {
      const name = roomNameInput?.value?.trim();
      if (!name) {
        alert("Please enter a room name");
        roomNameInput?.focus();
        return;
      }

      btnCreate.disabled = true;
      btnCreate.textContent = "Creating...";

      try {
        const result = await createRoom(name);

        if (result?.room_id) {
          log(`✅ Room created: ${result.room_id}`);

          // Update URL
          const url = `/r/${result.room_id}?dj=1`;
          history.pushState({}, "", url);

          // Clear input
          if (roomNameInput) roomNameInput.value = "";

          // IMPORTANT: Give backend time to sync
          await new Promise(resolve => setTimeout(resolve, 100));

          // Now join
          await enterRoomFn(result.room_id, "dj");
        }
      } catch (err) {
        log(`❌ Create room failed: ${err.message}`);
        alert(`Failed to create room: ${err.message}`);
      } finally {
        btnCreate.disabled = false;
        btnCreate.textContent = "Create Room";
      }
    };
  }

  log("UI buttons initialized");
}

function populateExternalDevices(devices) {
  const dropdown = document.getElementById("extDropdown");
  if (!dropdown) return;

  dropdown.innerHTML = "";

  if (!devices || devices.length === 0) {
    const item = document.createElement("div");
    item.textContent = "No devices found";
    item.style.padding = "12px 16px";
    item.style.color = "var(--muted)";
    dropdown.appendChild(item);
    return;
  }

  devices.forEach((device, index) => {
    const btn = document.createElement("button");
    btn.textContent = device.label || `Device ${index + 1}`;
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = -1;

    btn.onclick = async () => {
      try {
        const track = await createExternalTrack(device.deviceId);
        await switchAudioSource(track);
        state.source = "external";
        state.extDeviceId = device.deviceId;
        highlightActiveSource("srcExternal");
      } catch (err) {
        alert("Failed to switch audio device");
      }
    };

    dropdown.appendChild(btn);
  });
}
