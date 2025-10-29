
// UI updates and event handlers
import { state, log } from "./state.js";
import { listRooms, createRoom, closeRoom } from "./api.js";
import { publish } from "./livekit.js";
import { createMicTrack, createExternalTrack, createSystemAudioTrack, ensureDeviceList, switchAudioSource,
} from "./audio.js";

const landing = document.getElementById("landing");
const djView = document.getElementById("djView");
const listenerView = document.getElementById("listenerView");
const statsCard = document.getElementById("statsCard");
const btnMute = document.getElementById("btnMute");
const emptyRooms = document.getElementById("emptyRooms");
const roomsList = document.getElementById("roomsList");

export function show(section) {
  landing.classList.add("hidden");
  djView.classList.add("hidden");
  listenerView.classList.add("hidden");
  section.classList.remove("hidden");
  if (section === djView || section === listenerView) statsCard.classList.remove("hidden");
  else statsCard.classList.add("hidden");
}

export function updateRoomsList(rooms) {
  roomsList.innerHTML = "";
  if (!rooms || rooms.length === 0) {
    emptyRooms.classList.remove("hidden");
    return;
  }
  emptyRooms.classList.add("hidden");
  rooms.forEach(room => {
    const btn = document.createElement("button");
    btn.className = "btn room-list-item";
    btn.textContent = room.name || "Unnamed Room";
    btn.setAttribute("aria-label", `Join room ${room.name}`);
    btn.onclick = () => joinRoom(room.name);
    btn.onkeydown = e => { if (e.key === "Enter") btn.click(); };
    roomsList.appendChild(btn);
  });
}

// Create DJ room - details element reveals the field/button
const btnCreate = document.getElementById("btnCreate");
if(btnCreate){
  btnCreate.onclick = async () => {
    const name = document.getElementById("roomNameInput").value.trim();
    if (!name) return alert("Please provide a room name.");
    await createRoom(name);
  };
}

// Connection state indicator
export function showConnectionStatus(connected) {
  document.getElementById("offline").classList.toggle("hidden", connected);
  document.getElementById("connected").classList.toggle("hidden", !connected);
}

export function updateMuteButton() {
  if (state.onAir) {
    btnMute.className = "btn rec";
    btnMute.setAttribute("aria-label", "Broadcasting");
    btnMute.setAttribute("aria-pressed", "true");
    btnMute.innerHTML = '<span class="broadcast-status" aria-hidden="true">● Recording</span>';
  } else {
    btnMute.className = "btn stopped";
    btnMute.setAttribute("aria-label", "Paused broadcast");
    btnMute.setAttribute("aria-pressed", "false");
    btnMute.innerHTML = '<span class="broadcast-status" aria-hidden="true">■ Stopped</span>';
  }
}

export function highlightActiveSource(activeId) {
  ["srcMic", "srcExternal", "srcSystem"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute("aria-checked", id === activeId ? "true" : "false");
      el.classList.toggle("active", id === activeId);
      el.blur(); // Remove focus ring from programmatic selection
    }
  });
}

// Stats feedback coloring
export function updateStats(stats) {
  // stats = { state, latency, loss, bitrate, codec }
  document.getElementById("statState").textContent = stats.state || "—";
  const latencyTd = document.getElementById("statLatency");
  latencyTd.textContent = stats.latency || "—";
  latencyTd.setAttribute("data-quality",
    (stats.latency < 150) ? "ok" : (stats.latency < 350) ? "warn" : "bad");
  const lossTd = document.getElementById("statLoss");
  lossTd.textContent = stats.loss || "—";
  lossTd.setAttribute("data-quality",
    (stats.loss < 2) ? "ok" : (stats.loss < 10) ? "warn" : "bad");
  document.getElementById("statBitrate").textContent = stats.bitrate || "—";
  document.getElementById("statCodec").textContent = stats.codec || "—";
}

// Eager load pages and fill info async
export function eagerViewLoading(view) {
  // Just show the view before data comes in, fill in later
  show(view);
  // Later fill in info - called by successful connection
}

// Keyboard accessibility for dropdowns (example)
const extDropdown = document.getElementById("extDropdown");
extDropdown && extDropdown.addEventListener("keydown", e => {
  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
    const items = Array.from(extDropdown.querySelectorAll("[role='menuitem']"));
    const idx = items.findIndex(i => i === document.activeElement);
    const nextIdx = e.key === "ArrowDown" ? idx + 1 : idx - 1;
    if (items[nextIdx]) items[nextIdx].focus();
    e.preventDefault();
  }
});
