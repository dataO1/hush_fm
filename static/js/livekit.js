// LiveKit room connection and publishing
import { state, log } from "./state.js";
import { switchAudioSource } from "./audio.js"; // Add this import
import {
  createMicTrack,
  createExternalTrack,
  createSystemAudioTrack,
  refreshDjWave,
  startWaveform,
  stopWaveform,
} from "./audio.js";

const LK = window.LivekitClient;

export async function connectRoom(url, token) {
  const { Room, RoomEvent, setLogLevel, LogLevel } = LK;
  // ✅ CRITICAL FIX: Disconnect existing room first
  if (state.lkRoom && state.lkRoom.state !== "disconnected") {
    log("⚠️ Disconnecting existing room before reconnecting");
    try {
      await state.lkRoom.disconnect();
    } catch (e) {
      log("Disconnect error (non-fatal):", e?.message || e);
    }
    state.lkRoom = null;
  }
  setLogLevel(LogLevel.warn);
  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    // ADD THESE:
    audioCaptureDefaults: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    publishDefaults: {
      audioBitrate: 128000, // Opus stereo at 128kbps
      dtx: false, // Disable discontinuous transmission for music
      red: true, // Keep redundancy for packet loss
      simulcast: false,
    },
  });
  room.prepareConnection(url, token);

  room.on(RoomEvent.Connected, async () => {
    log("LiveKit connected");
    await ensurePublishedPresence();
  });
  room.on(RoomEvent.Reconnected, async () => {
    log("LiveKit reconnected");
    await ensurePublishedPresence();
  });
  room.on(RoomEvent.ParticipantConnected, async () => {
    await ensurePublishedPresence();
  });
  room.on(RoomEvent.Disconnected, (reason) => {
    log("LiveKit disconnected:", reason);
    stopStatsMonitor();

    // ✅ Handle token expiration
    if (reason === "TOKEN_EXPIRED") {
      log("Token expired, fetching new token...");
      setTimeout(async () => {
        try {
          const { url: newUrl, token: newToken } = await fetchLkToken(
            state.role,
            state.roomId,
          );
          await connectRoom(newUrl, newToken);
        } catch (e) {
          log("Token refresh failed:", e?.message || e);
        }
      }, 1000);
    }
  });
  room.on(RoomEvent.DataReceived, (payload, participant, kind) => {
    try {
      const msg = new TextDecoder().decode(payload);
      const data = JSON.parse(msg || "{}");
      if (data?.type === "room_close") {
        log("Room closing signal");
        try {
          room.disconnect();
        } catch {}
      }
    } catch {}
  });

  room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
    if (track.kind === "audio") {
      const el = document.getElementById("listenerAudio");
      try {
        el.srcObject = null;
      } catch {}
      track.attach(el);
      el.play().catch(() => {});
      document.getElementById("offline").classList.add("hidden");
      startWaveform(el);
      // log("Subscribed audio from", participant.identity);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === "audio") {
      document.getElementById("offline").classList.remove("hidden");
      stopWaveform();
    }
  });

  await room.connect(url, token);
  state.lkRoom = room;
  startStatsMonitor();
  return room;
}

function isAudioPublished() {
  const room = state.lkRoom;
  if (
    !room ||
    !room.localParticipant ||
    !room.localParticipant.trackPublications
  )
    return false;
  const pubs = [...room.localParticipant.trackPublications.values()];
  return pubs.some(
    (p) => (p.track && p.track.kind === "audio") || p.kind === "audio",
  );
}

export async function publish(track) {
  const room = state.lkRoom;
  if (!room || !room.localParticipant) {
    log("Room not ready for publishing");
    return;
  }
  try {
    if (room.localParticipant.trackPublications) {
      for (const p of [...room.localParticipant.trackPublications.values()]) {
        if (p.track?.kind === "audio") {
          log("Unpublishing old track:", p.track.sid);
          await room.localParticipant.unpublishTrack(p.track, { stop: false });
        }
      }
    }
  } catch (e) {
    log("Unpublish error (non-fatal):", e?.message || e);
  }
  try {
    const pub = await room.localParticipant.publishTrack(track, {
      dtx: false, // Music needs constant bitrate
      red: true,
      forceStereo: true,
      audioPreset: {
        maxBitrate: 128000,
        priority: "high",
      },
    });
    state.localTrack = track;
    state.currentPub = pub;
    if (state.onAir) await pub.track.unmute();
    else await pub.track.mute();
    refreshDjWave();
    log("Published single audio (stereo); onAir=", state.onAir);
  } catch (e) {
    log("Publish error:", e?.message || e);
  }
}

export async function ensurePublishedPresence() {
  if (state.role !== "dj" || !state.lkRoom || !state.lkRoom.localParticipant)
    return;

  if (!isAudioPublished() || !state.currentPub) {
    let track = state.localTrack;
    if (!track) {
      try {
        if (state.source === "mic") {
          track = await createMicTrack();
          await switchAudioSource(track, "microphone");
        } else if (state.source === "external") {
          await switchAudioSource(track);
          await switchAudioSource(track);
        } else if (state.source === "system") {
          track = await createSystemAudioTrack();
          await switchAudioSource(track, "screen_share_audio");
        }
      } catch (e) {
        log("Track creation error:", e?.message || e);
        return;
      }
    }
  } else {
    try {
      if (state.currentPub && state.currentPub.track) {
        if (state.onAir) await state.currentPub.track.unmute();
        else await state.currentPub.track.mute();
      }
    } catch (e) {
      log("mute/unmute error:", e?.message || e);
    }
  }
}

function startStatsMonitor() {
  if (state.statsInterval) clearInterval(state.statsInterval);
  state.statsInterval = setInterval(async () => {
    if (!state.lkRoom) return;
    try {
      document.getElementById("statState").textContent =
        state.lkRoom.state || "—";

      if (state.role === "dj" && state.currentPub && state.currentPub.track) {
        try {
          const sender = state.currentPub.track.sender;
          if (sender && typeof sender.getStats === "function") {
            const stats = await sender.getStats();
            stats.forEach((report) => {
              if (report.type === "outbound-rtp" && report.kind === "audio") {
                if (report.bytesSent && report.timestamp) {
                  const kbps = Math.round((report.bytesSent * 8) / 1000);
                  document.getElementById("statBitrate").textContent =
                    `${kbps} kbps`;
                }
                if (report.codecId) {
                  const codec = stats.get(report.codecId);
                  if (codec && codec.mimeType) {
                    document.getElementById("statCodec").textContent =
                      codec.mimeType.split("/")[1] || codec.mimeType;
                  }
                }
                document.getElementById("statLoss").textContent =
                  report.packetsLost !== undefined
                    ? `${report.packetsLost}`
                    : "0";
              }
              if (
                report.type === "remote-inbound-rtp" &&
                report.kind === "audio"
              ) {
                if (report.roundTripTime !== undefined) {
                  document.getElementById("statLatency").textContent =
                    `${Math.round(report.roundTripTime * 1000)} ms`;
                }
              }
            });
          }
        } catch (e) {
          log("DJ stats error:", e?.message || e);
        }
      } else if (state.role === "listener") {
        const audioTracks = Array.from(state.lkRoom.remoteParticipants.values())
          .flatMap((p) => Array.from(p.trackPublications.values()))
          .filter((pub) => pub.kind === "audio" && pub.track);

        if (audioTracks.length > 0) {
          const audioTrack = audioTracks[0].track;
          try {
            const receiver = audioTrack.receiver;
            if (receiver && typeof receiver.getStats === "function") {
              const stats = await receiver.getStats();
              stats.forEach((report) => {
                if (report.type === "inbound-rtp" && report.kind === "audio") {
                  if (report.bytesReceived && report.timestamp) {
                    const kbps = Math.round((report.bytesReceived * 8) / 1000);
                    document.getElementById("statBitrate").textContent =
                      `${kbps} kbps`;
                  }
                  if (report.codecId) {
                    const codec = stats.get(report.codecId);
                    if (codec && codec.mimeType) {
                      document.getElementById("statCodec").textContent =
                        codec.mimeType.split("/")[1] || codec.mimeType;
                    }
                  }
                  document.getElementById("statLoss").textContent =
                    report.packetsLost !== undefined
                      ? `${report.packetsLost}`
                      : "0";
                  if (report.jitter !== undefined) {
                    document.getElementById("statLatency").textContent =
                      `${Math.round(report.jitter * 1000)} ms`;
                  }
                }
              });
            }
          } catch (e) {
            log("Listener stats error:", e?.message || e);
          }
        }
      }
    } catch (e) {
      log("stats error", e?.message || e);
    }
  }, 2000);
}

function stopStatsMonitor() {
  if (state.statsInterval) clearInterval(state.statsInterval);
  state.statsInterval = null;
}
