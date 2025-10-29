// mediaSession.js - Handle background audio playback on mobile
import { state, log } from "./state.js";

export function setupMediaSession(roomName) {
  if (!("mediaSession" in navigator)) {
    log("⚠️  Media Session API not supported");
    return;
  }

  // Set metadata for lock screen/notification
  navigator.mediaSession.metadata = new MediaMetadata({
    title: roomName || "Silent Disco",
    artist: "Live Stream",
    album: "Silent Disco",
    artwork: [
      { src: "/static/icon-96.png", sizes: "96x96", type: "image/png" },
      { src: "/static/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/static/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });

  // Set playback state
  navigator.mediaSession.playbackState = "playing";

  // Handle media controls (play/pause buttons on lock screen)
  navigator.mediaSession.setActionHandler("play", () => {
    log("▶️  Play from lock screen");
    const audio = document.getElementById("listenerAudio");
    if (audio) {
      audio.play().catch((err) => log(`Play failed: ${err.message}`));
    }
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    log("⏸️  Pause from lock screen");
    const audio = document.getElementById("listenerAudio");
    if (audio) {
      audio.pause();
    }
  });

  // Disable seek controls (not applicable for live streams)
  navigator.mediaSession.setActionHandler("seekbackward", null);
  navigator.mediaSession.setActionHandler("seekforward", null);

  navigator.mediaSession.setActionHandler("stop", () => {
    log("⏹️  Stop from lock screen");
    state.lkRoom?.disconnect();
  });

  log("✅ Media session configured for background playback");
}

export function updateMediaSession(roomName, participantName) {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: roomName || "Silent Disco",
      artist: participantName || "Unknown DJ",
      album: "Live Stream",
      artwork: [
        { src: "/static/icon-96.png", sizes: "96x96", type: "image/png" },
        { src: "/static/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/static/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    log(`Media session updated: ${roomName} - ${participantName}`);
  } catch (err) {
    log(`Media session update error: ${err.message}`);
  }
}

export function stopMediaSession() {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
    log("🛑 Media session stopped");
  } catch (err) {
    log(`Media session stop error: ${err.message}`);
  }
}
