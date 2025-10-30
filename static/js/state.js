// Global application state
export const state = {
  roomName: null,
  isDJ: false,
  onAir: false,
  currentTrack: null,
  token: null,
  lkRoom: null,
};

// In state.js
const DEBUG_MODE = localStorage.getItem("debug") === "false";

export async function loadConfig() {
  const res = await fetch("/config");
  const config = await res.json();
  DEBUG_MODE = config.debug;
  const element = document.getElementById("logCard");
  element.classList.add("hidden");
  return config;
}

export function log(message) {
  const logEl = document.getElementById("log");
  if (logEl) {
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += `[${timestamp}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}
