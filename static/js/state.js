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

export function log(...args) {
  console.log(...args);
  if (DEBUG_MODE) {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour12: false });
    logEl.textContent +=
      `[${time}] ` +
      args
        .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
        .join(" ") +
      "\n";
  }
}
