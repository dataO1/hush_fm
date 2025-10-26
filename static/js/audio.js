// Audio track creation and waveform rendering
import { state, log } from './state.js';

export async function createMicTrack() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 2, sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false
  });
  return stream.getAudioTracks()[0];
}

export async function createExternalTrack(deviceId) {
  const constraints = {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 2,
      sampleRate: 48000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    video: false
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return stream.getAudioTracks()[0];
}

export async function createFileTrack(file) {
  const url = URL.createObjectURL(file);
  const audioEl = new Audio();
  audioEl.src = url;
  audioEl.crossOrigin = 'anonymous';
  audioEl.muted = true;
  await audioEl.play().catch(() => {});
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaElementSource(audioEl);
  const dst = ctx.createMediaStreamDestination();
  src.connect(dst);
  const track = dst.stream.getAudioTracks()[0];
  state.fileAudioEl = audioEl;
  state.audioCtx = ctx;
  state.waveSrc = src;
  return { track, audioEl };
}

export function refreshDjWave() {
  stopDjWave();
  if (!state.localTrack) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(new MediaStream([state.localTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    state.djAnalyser = analyser;
    const cvs = document.getElementById('djWave');
    const g = cvs.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      state.djRaf = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      g.clearRect(0, 0, cvs.width, cvs.height);
      g.strokeStyle = state.onAir
        ? getComputedStyle(document.documentElement).getPropertyValue('--wave-on').trim()
        : getComputedStyle(document.documentElement).getPropertyValue('--wave-off').trim();
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
    draw();
  } catch (e) {
    log('dj waveform error', e?.message || e);
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
    const cvs = document.getElementById('wave');
    const g = cvs.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      state.raf = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      g.clearRect(0, 0, cvs.width, cvs.height);
      g.strokeStyle = '#7c5cff';
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
    draw();
  } catch (e) {
    log('waveform error', e?.message || e);
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
    const audIns = devices.filter(d => d.kind === 'audioinput');
    if (!state.extDeviceId && audIns[0]) state.extDeviceId = audIns[0].deviceId;
    return audIns;
  } catch (e) {
    log('device list error', e?.name || e?.message || e);
    return [];
  }
}
