// Audio track creation and waveform rendering - OPTIMIZED
import { state, log } from "./state.js";

// Throttle waveform to 30fps instead of 60fps
const WAVEFORM_FPS = 30;
const WAVEFORM_FRAME_TIME = 1000 / WAVEFORM_FPS;
let lastDjWaveTime = 0;
let lastListenerWaveTime = 0;
let isTabVisible = true;

// Page visibility API to pause waveforms when tab inactive
document.addEventListener("visibilitychange", () => {
  isTabVisible = !document.hidden;
  if (!isTabVisible) {
    log("Tab hidden, pausing waveforms");
  } else {
    log("Tab visible, resuming waveforms");
  }
});

export async function createMicTrack() {
  try {
    log("Requesting microphone access...");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 2,
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: 0,
      },
    });
    const track = stream.getAudioTracks()[0];
    log("Microphone track created");
    return track;
  } catch (e) {
    log(`Microphone error: ${e?.message || e}`);
    throw e;
  }
}

export async function createSystemAudioTrack() {
  try {
    log("Requesting system audio capture...");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      preferCurrentTab: false,
      latency: 0,
    });
    const track = stream.getTracks()[0];
    log("System audio track created");
    return track;
  } catch (e) {
    log(`System audio capture error: ${e?.message || e}`);
    throw e;
  }
}

export async function createExternalTrack(deviceId) {
  try {
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 2,
        sampleRate: 48000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: 0,
      },
      video: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getAudioTracks()[0];
    log(`External track created: ${track.label}`);
    return track;
  } catch (e) {
    log(`External track error: ${e?.message || e}`);
    throw e;
  }
}

export async function switchAudioSource(newTrack, source) {
  const startTime = performance.now();
  const room = state.lkRoom;

  if (!room?.localParticipant) {
    log("Room not ready for source switch");
    return;
  }

  if (source === "screen_share_audio") {
    await room.localParticipant.setScreenShareEnabled(true);
  }

  if (state.currentPub?.track) {
    try {
      await state.currentPub.track.mute();
    } catch (e) {}
  }

  const unpublishPromises = [];
  if (room.localParticipant.trackPublications) {
    for (const pub of [...room.localParticipant.trackPublications.values()]) {
      if (pub.track?.kind === "audio") {
        unpublishPromises.push(
          room.localParticipant.unpublishTrack(pub.track, { stop: true }),
        );
      }
    }
  }

  await Promise.all(unpublishPromises);

  const pub = await room.localParticipant.publishTrack(newTrack);
  state.localTrack = newTrack;
  state.currentPub = pub;

  if (state.onAir) {
    await pub.track.unmute();
  } else {
    await pub.track.mute();
  }

  refreshDjWave();
  const duration = (performance.now() - startTime).toFixed(1);
  log(`✅ Source switched in ${duration}ms`);
}

export function refreshDjWave() {
  stopDjWave();
  if (!state.localTrack) return;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(
      new MediaStream([state.localTrack]),
    );
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    state.djAnalyser = analyser;

    const cvs = document.getElementById("djWave");
    if (!cvs) return;

    const g = cvs.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = (timestamp) => {
      // Throttle to 30fps and pause when tab hidden
      if (!isTabVisible || timestamp - lastDjWaveTime < WAVEFORM_FRAME_TIME) {
        state.djRaf = requestAnimationFrame(draw);
        return;
      }

      lastDjWaveTime = timestamp;
      state.djRaf = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(data);
      g.clearRect(0, 0, cvs.width, cvs.height);
      g.strokeStyle = state.onAir
        ? getComputedStyle(document.documentElement)
            .getPropertyValue("--wave-on")
            .trim()
        : getComputedStyle(document.documentElement)
            .getPropertyValue("--wave-off")
            .trim();
      g.lineWidth = 2;
      g.beginPath();
      const step = cvs.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        const y = cvs.height / 2 + v * (cvs.height / 2 - 4);
        const x = i * step;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    draw(performance.now());
  } catch (e) {
    log(`DJ waveform error: ${e?.message || e}`);
  }
}

export function stopDjWave() {
  if (state.djRaf) cancelAnimationFrame(state.djRaf);
  state.djRaf = 0;
  state.djAnalyser = null;
}

export function startWaveform(audioEl) {
  try {
    stopWaveform();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(audioEl.srcObject);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    state.analyser = analyser;

    const cvs = document.getElementById("wave");
    if (!cvs) return;

    const g = cvs.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = (timestamp) => {
      // Throttle and pause when hidden
      if (
        !isTabVisible ||
        timestamp - lastListenerWaveTime < WAVEFORM_FRAME_TIME
      ) {
        state.raf = requestAnimationFrame(draw);
        return;
      }

      lastListenerWaveTime = timestamp;
      state.raf = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(data);
      g.clearRect(0, 0, cvs.width, cvs.height);
      g.strokeStyle = "#7c5cff";
      g.lineWidth = 2;
      g.beginPath();
      const step = cvs.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        const y = cvs.height / 2 + v * (cvs.height / 2 - 4);
        const x = i * step;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    draw(performance.now());
  } catch (e) {
    log(`Waveform error: ${e?.message || e}`);
  }
}

export function stopWaveform() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.analyser = null;
}

export async function ensureDeviceList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audIns = devices.filter((d) => d.kind === "audioinput");
    if (!state.extDeviceId && audIns[0]) state.extDeviceId = audIns[0].deviceId;
    return audIns;
  } catch (e) {
    log(`Device list error: ${e?.name || e?.message || e}`);
    return [];
  }
}
