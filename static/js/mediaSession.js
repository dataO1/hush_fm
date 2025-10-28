// mediaSession.js - Handle background audio playback on mobile

import { state, log } from "./state.js";

export function setupMediaSession(roomName) {
  if (!("mediaSession" in navigator)) {
    log("⚠️  Media Session API not supported");
    return;
  }

  // Set metadata for lock screen/notification
  navigator.mediaSession.metadata = new MediaMetadata({
    title: roomName || "Hush FM",
    artist: "Silent Disco",
    album: "Live Stream",
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
    // Resume audio if paused
    state.lkRoom?.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((pub) => {
        if (pub.track) {
          pub.track.unmute();
        }
      });
    });
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    log("⏸️  Pause from lock screen");
    // Pause audio
    state.lkRoom?.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((pub) => {
        if (pub.track) {
          pub.track.mute();
        }
      });
    });
  });

  // Optional: Handle other controls
  navigator.mediaSession.setActionHandler("seekbackward", () => {
    log("⏪ Seek backward (not applicable for live stream)");
  });

  navigator.mediaSession.setActionHandler("seekforward", () => {
    log("⏩ Seek forward (not applicable for live stream)");
  });

  navigator.mediaSession.setActionHandler("stop", () => {
    log("⏹️  Stop from lock screen");
    // Disconnect from room
    state.lkRoom?.disconnect();
  });

  log("✅ Media session configured for background playback");
}

export function updateMediaSession(roomName, participantName) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${roomName} - Now playing`,
      artist: participantName || "DJ",
      album: "Hush FM Live",
      artwork: [
        { src: "/static/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
    });
  }
}

export function stopMediaSession() {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "none";
    log("🛑 Media session stopped");
  }
}
