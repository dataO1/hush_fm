// Global application state
export const state = {
  clientId: null,
  name: null,
  role: null,
  roomId: null,
  roomName: "",
  lkRoom: null,
  localTrack: null,
  currentPub: null,
  onAir: false,
  source: "mic",
  file: null,
  fileAudioEl: null,
  audioCtx: null,
  waveSrc: null,
  analyser: null,
  raf: 0,
  djAnalyser: null,
  djRaf: 0,
  extDeviceId: null,
  listenerAttached: false,
  statsInterval: null,
};

// Logging utility
const t0 = performance.now();
const ts = () => (performance.now() - t0).toFixed(1);
const logEl = document.getElementById("log");

export function log(...args) {
  console.log(...args);
  logEl.textContent +=
    `[${ts()}ms] ` +
    args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") +
    "\n";
}
