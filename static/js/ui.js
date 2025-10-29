// UI updates and event handlers
import { state, log } from "./state.js";
import { listRooms, createRoom, closeRoom } from "./api.js";
import { publish } from "./livekit.js";
import { 
  createMicTrack, 
  createExternalTrack, 
  createSystemAudioTrack, 
  ensureDeviceList, 
  switchAudioSource 
} from "./audio.js";

const landing = document.getElementById("landing");
const djView = document.getElementById("djView");
const listenerView = document.getElementById("listenerView");
const statsCard = document.getElementById("statsCard");
const btnMute = document.getElementById("btnMute");

export function show(section) {
  landing.classList.add("hidden");
  djView.classList.add("hidden");
  listenerView.classList.add("hidden");

  section.classList.remove("hidden");

  if (section === djView || section === listenerView) {
    statsCard.classList.remove("hidden");
  } else {
    statsCard.classList.add("hidden");
  }
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

  sources.forEach(id => {
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

export async function renderRoomsList() {
  try {
    const rooms = await listRooms();
    const roomsList = document.getElementById("roomsList");
    const emptyRooms = document.getElementById("emptyRooms");

    if (!roomsList) return;

    roomsList.innerHTML = "";

    if (!rooms || rooms.length === 0) {
      if (emptyRooms) emptyRooms.classList.remove("hidden");
      roomsList.setAttribute("aria-label", "No rooms available");
      return;
    }

    if (emptyRooms) emptyRooms.classList.add("hidden");
    roomsList.setAttribute("aria-label", `${rooms.length} available room${rooms.length !== 1 ? 's' : ''}`);

    // Sort rooms: own rooms first, then by listener count
    const sortedRooms = rooms.sort((a, b) => {
      const aIsOwn = a.dj_client_id === state.clientId;
      const bIsOwn = b.dj_client_id === state.clientId;

      if (aIsOwn && !bIsOwn) return -1;
      if (!aIsOwn && bIsOwn) return 1;

      // Sort by listener count (descending)
      return (b.listener_count || 0) - (a.listener_count || 0);
    });

    sortedRooms.forEach((room) => {
      const isOwnRoom = room.dj_client_id === state.clientId;
      const btn = document.createElement("button");

      btn.className = `btn room-list-item join${isOwnRoom ? ' own-room' : ''}`;
      btn.setAttribute("data-id", room.id);
      btn.setAttribute("data-role", isOwnRoom ? "dj" : "listener");
      btn.tabIndex = 0;

      // Create room content
      const roomName = document.createElement("div");
      roomName.className = "room-name";
      roomName.textContent = room.name || "Unnamed Room";

      const roomInfo = document.createElement("div");
      roomInfo.className = "room-info";

      if (isOwnRoom) {
        roomInfo.innerHTML = `<span class="own-badge">Your Room</span> • ${room.listener_count || 0} listening`;
        btn.setAttribute("aria-label", `Return to your DJ room: ${room.name}`);
      } else {
        roomInfo.textContent = `${room.dj_name || 'Unknown DJ'} • ${room.listener_count || 0} listening`;
        btn.setAttribute("aria-label", `Join room: ${room.name} with ${room.dj_name}`);
      }

      btn.appendChild(roomName);
      btn.appendChild(roomInfo);
      roomsList.appendChild(btn);
    });

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
      if (state.onAir) {
        // Stop broadcasting
        if (state.currentPub?.track) {
          await state.currentPub.track.mute();
        }
        state.onAir = false;
      } else {
        // Start broadcasting
        if (state.currentPub?.track) {
          await state.currentPub.track.unmute();
        } else if (state.localTrack) {
          await publish(state.localTrack);
        }
        state.onAir = true;
      }
      updateMuteButton();
    };
  }

  // Audio source buttons
  const srcMic = document.getElementById("srcMic");
  if (srcMic) {
    srcMic.onclick = async () => {
      try {
        const track = await createMicTrack();
        await switchAudioSource(track, "microphone");
        state.source = "mic";
        highlightActiveSource("srcMic");
      } catch (err) {
        log(`Mic switch failed: ${err.message}`);
        alert("Failed to access microphone");
      }
    };
  }

  const srcSystem = document.getElementById("srcSystem");
  if (srcSystem) {
    srcSystem.onclick = async () => {
      try {
        const track = await createSystemAudioTrack();
        await switchAudioSource(track, "screen_share_audio");
        state.source = "system";
        highlightActiveSource("srcSystem");
      } catch (err) {
        log(`System audio switch failed: ${err.message}`);
        alert("Failed to capture system audio");
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

  // Close room button
  const btnClose = document.getElementById("btnClose");
  if (btnClose && closeFloorFn) {
    btnClose.onclick = closeFloorFn;
  }

  // Create room button - auto-join after creation
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
        if (result?.id) {
          log(`Room created, auto-joining as DJ: ${result.id}`);
          // Auto-join the created room as DJ
          await enterRoomFn(result.id, "dj");

          // Clear the input
          if (roomNameInput) roomNameInput.value = "";
        }
      } catch (err) {
        log(`Create room failed: ${err.message}`);
        alert("Failed to create room");
      } finally {
        btnCreate.disabled = false;
        btnCreate.textContent = "Create Room";
      }
    };

    // Allow Enter key to create room
    if (roomNameInput) {
      roomNameInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          btnCreate.click();
        }
      };
    }
  }

  log("UI buttons initialized");
}

// Populate external audio device dropdown
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
    btn.setAttribute("aria-label", `Select ${device.label || 'device ' + (index + 1)}`);
    btn.tabIndex = -1;

    btn.onclick = async () => {
      try {
        const track = await createExternalTrack(device.deviceId);
        await switchAudioSource(track);
        state.source = "external";
        state.extDeviceId = device.deviceId;
        highlightActiveSource("srcExternal");
        log(`Switched to: ${device.label}`);
      } catch (err) {
        log(`Device switch failed: ${err.message}`);
        alert("Failed to switch audio device");
      }
    };

    dropdown.appendChild(btn);
  });
}
