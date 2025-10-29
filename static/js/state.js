// Global application state
export const state = {
  roomName: null,
  isDJ: false,
  onAir: false,
  currentTrack: null,
  token: null,
  lkRoom: null,
};

// Simple logging function
export function log(message) {
  const logEl = document.getElementById("log");
  if (logEl) {
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += `[${timestamp}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}
