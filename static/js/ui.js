// UI updates and event handlers
import { state, log } from "./state.js";
import { listRooms, createRoom, closeRoom } from "./api.js";
import { publish } from "./livekit.js";
import {
  createMicTrack,
  createExternalTrack,
  createFileTrack,
  ensureDeviceList,
  switchAudioSource,
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
  if (section === djView || section === listenerView)
    statsCard.classList.remove("hidden");
  else statsCard.classList.add("hidden");
}

export function updateMuteButton() {
  if (state.onAir) {
    btnMute.className = "btn rec";
  } else {
    btnMute.className = "btn stopped";
  }
}

export function highlightActiveSource() {
  document
    .getElementById("srcMic")
    .classList.toggle("active", state.source === "mic");
  document
    .getElementById("srcTrack")
    .classList.toggle("active", state.source === "file");
  document
    .getElementById("srcExternal")
    .classList.toggle("active", state.source === "external");
}

export function setDjRoomMeta() {
  document.getElementById("djRoomTitle").textContent = state.roomName || "Room";
  document.getElementById("djRoomId").textContent = state.roomId || "";
  document.getElementById("djName").textContent = state.name || "";
}

export function setListenerRoomMeta(extra) {
  document.getElementById("lsRoomTitle").textContent =
    extra?.name || state.roomName || "Room";
  document.getElementById("lsRoomId").textContent = state.roomId || "";
  document.getElementById("lsDj").textContent = extra?.dj_name || "—";
  document.getElementById("lsCount").textContent = extra?.listener_count ?? "—";
}

export async function renderRoomsList() {
  const rooms = await listRooms();
  const roomsList = document.getElementById("roomsList");
  roomsList.innerHTML = "";
  for (const r of rooms) {
    const div = document.createElement("div");
    div.className = "room-item";
    const status = r.dj_online ? "online" : "offline";
    div.innerHTML = `
      <div class="room-meta">
        <span class="badge">#${r.id}</span>
        <div><div><strong>${r.name || "Room"}</strong></div>
        <div class="section-title">DJ ${r.dj_name || "—"} • ${r.listener_count} listening • ${status}</div></div>
      </div>
      <div class="row">
        ${
          r.dj_client === state.clientId
            ? `<button class="btn secondary join" data-id="${r.id}" data-role="dj" title="Enter as DJ">Enter (DJ)</button>`
            : `<button class="btn primary join" data-id="${r.id}" data-role="listener" title="Join room">Join</button>`
        }
      </div>
    `;
    roomsList.appendChild(div);
  }
}

export function initButtons(enterRoomFn, closeFloorFn) {
  // Create room
  document.getElementById("btnCreate").onclick = async () => {
    const name =
      (document.getElementById("roomNameInput").value || "").trim() ||
      `Room ${state.name}`;
    const data = await createRoom(name);
    if (!data.ok) {
      log("create failed", data.error || "");
      return;
    }
    state.roomName = name;
    await enterRoomFn(data.room_id, "dj");
  };

  // Source buttons
  // Source buttons - NOW USE switchAudioSource
  document.getElementById("srcMic").onclick = async () => {
    state.source = "mic";
    if (state.role === "dj" && state.lkRoom) {
      const track = await createMicTrack();
      await switchAudioSource(track); // ← Changed from publish()
      highlightActiveSource();
    }
  };

  document.getElementById("srcTrack").onclick = () => {
    state.source = "file";
    document.getElementById("fileInput").click();
    highlightActiveSource();
  };

  document.getElementById("srcExternal").onclick = async (e) => {
    e.stopPropagation();
    state.source = "external";
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {}
    const devices = await ensureDeviceList();
    const dropdown = document.getElementById("extDropdown");
    dropdown.innerHTML = "";
    devices.forEach((d) => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = d.label || `audio ${d.deviceId.slice(0, 6)}…`;
      item.onclick = async () => {
        state.extDeviceId = d.deviceId;
        dropdown.classList.remove("show");
        if (state.role === "dj" && state.lkRoom) {
          const track = await createExternalTrack(state.extDeviceId);
          await switchAudioSource(track); // ← Changed from publish()
          highlightActiveSource();
        }
      };
      dropdown.appendChild(item);
    });
    dropdown.classList.toggle("show");
    highlightActiveSource();
  };

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown"))
      document.getElementById("extDropdown").classList.remove("show");
  });

  document.getElementById("fileInput").onchange = async (e) => {
    state.file = e.target.files?.[0] || null;
    if (state.role === "dj" && state.lkRoom && state.file) {
      const { track } = await createFileTrack(state.file);
      await switchAudioSource(track); // ← Changed from publish()
      highlightActiveSource();
    }
  };
  // Mute button
  btnMute.onclick = async () => {
    if (state.role !== "dj" || !state.lkRoom) return;
    const targetOnAir = !state.onAir;
    if (!state.currentPub) {
      let track = state.localTrack;
      if (!track) {
        if (state.source === "mic") track = await createMicTrack();
        else if (state.source === "external")
          track = await createExternalTrack(state.extDeviceId);
        else if (state.source === "file") {
          if (!state.file) {
            log("select a file first");
            return;
          }
          ({ track } = await createFileTrack(state.file));
        }
      }
      if (track) await publish(track);
    }
    if (state.currentPub && state.currentPub.track) {
      try {
        if (targetOnAir) await state.currentPub.track.unmute();
        else await state.currentPub.track.mute();
      } catch (e) {
        log("mute toggle error", e?.message || e);
      }
    }
    state.onAir = targetOnAir;
    updateMuteButton();
  };

  // Close floor
  document.getElementById("btnClose").onclick = closeFloorFn;
}
