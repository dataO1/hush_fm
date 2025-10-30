// LiveKit room connection and publishing
import { state, log } from "./state.js";
import { switchAudioSource } from "./audio.js";
import {
  createMicTrack,
  createExternalTrack,
  createSystemAudioTrack,
  refreshDjWave,
  startWaveform,
  stopWaveform,
} from "./audio.js";
import { fetchLkToken } from "./api.js";

const LK = window.LivekitClient;

export async function connectRoom(url, token) {
  const { Room, RoomEvent, setLogLevel, LogLevel } = LK;

  // Disconnect existing room first
  if (state.lkRoom && state.lkRoom.state !== "disconnected") {
    log("⚠️ Disconnecting existing room before reconnecting");
    try {
      await state.lkRoom.disconnect();
    } catch (e) {
      log(`Disconnect error (non-fatal): ${e?.message || e}`);
    }
    state.lkRoom = null;
  }

  setLogLevel(LogLevel.warn);

  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    webAudioMix: false,
    audioCaptureDefaults: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    publishDefaults: {
      audioBitrate: 128000, // Start lower
      dtx: false,
      red: true,
      simulcast: false,
      audioPreset: {
        maxBitrate: 256000, // Can go up to 256k if network allows
        priority: "high",
      },
    },
  });

  room.prepareConnection(url, token);

  // Connected event
  room.on(RoomEvent.Connected, async () => {
    log("LiveKit connected");
    await ensurePublishedPresence();

    // Update UI connection status
    if (window.onDJStatusChange) {
      window.onDJStatusChange(true);
    }
  });

  // Reconnected event
  room.on(RoomEvent.Reconnected, async () => {
    log("LiveKit reconnected");
    await ensurePublishedPresence();
  });

  // // Participant connected
  // room.on(RoomEvent.ParticipantConnected, async (participant) => {
  //   log(`Participant connected: ${participant.identity}`);
  //   await ensurePublishedPresence();
  //
  //   // Update listener count
  //   if (window.updateListenerCount) {
  //     window.updateListenerCount(room.participants.size);
  //   }
  // });

  // Participant disconnected
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    log(`Participant disconnected: ${participant.identity}`);

    // Update listener count
    if (window.updateListenerCount) {
      window.updateListenerCount(room.participants.size);
    }
  });
  // Track DJ online/offline status via LiveKit events
  room.on(RoomEvent.ParticipantConnected, async (participant) => {
    log(`Participant connected: ${participant.identity}`);

    // Check if this participant is a DJ (has audio publications)
    const isDJ = Array.from(participant.trackPublications.values()).some(
      (pub) => pub.kind === "audio" && pub.source === "microphone",
    );

    if (isDJ) {
      log(`DJ came online: ${participant.identity}`);
      // Update backend about DJ presence
      await updateDJPresence(state.roomId, participant.identity, true);

      // Broadcast room update to all WebSocket clients
      // (backend will handle this if you have WebSocket implemented)
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
    log(`Participant disconnected: ${participant.identity}`);

    // Check if this was the DJ
    if (state.role === "listener" && participant.trackPublications.size > 0) {
      log(`DJ went offline: ${participant.identity}`);
      await updateDJPresence(state.roomId, participant.identity, false);

      // Show offline status in UI
      document.getElementById("offline")?.classList.remove("hidden");
      document.getElementById("connected")?.classList.add("hidden");
    }
  });

  // Track when DJ starts/stops publishing
  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    if (
      publication.kind === "audio" &&
      participant.identity !== state.clientId
    ) {
      log(`DJ started publishing: ${participant.identity}`);
      document.getElementById("offline")?.classList.add("hidden");
      document.getElementById("connected")?.classList.remove("hidden");
    }
  });

  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    if (
      publication.kind === "audio" &&
      participant.identity !== state.clientId
    ) {
      log(`DJ stopped publishing: ${participant.identity}`);
    }
  });

  // Disconnected event
  room.on(RoomEvent.Disconnected, (reason) => {
    log(`LiveKit disconnected: ${reason}`);

    // Handle token expiration
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
          log(`Token refresh failed: ${e?.message || e}`);
        }
      }, 1000);
    }

    // Update UI connection status
    if (window.onDJStatusChange) {
      window.onDJStatusChange(false);
    }
  });

  // Data received (room close signal)
  room.on(RoomEvent.DataReceived, (payload, participant, kind) => {
    try {
      const msg = new TextDecoder().decode(payload);
      const data = JSON.parse(msg || "{}");
      if (data?.type === "room_close") {
        log("Room closing signal received");
        try {
          room.disconnect();
        } catch (e) {
          log(`Disconnect on close error: ${e?.message || e}`);
        }
      }
    } catch (e) {
      log(`Data decode error: ${e?.message || e}`);
    }
  });

  // Track subscribed (listener receiving audio)
  room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
    if (track.kind === "audio") {
      log(`Audio track subscribed from ${participant.identity}`);

      const el = document.getElementById("listenerAudio");
      if (!el) return;

      try {
        el.srcObject = null;
      } catch (e) {}

      track.attach(el);
      el.mozAudioChannelType = "content";
      el.play().catch((err) => {
        log(`Autoplay failed: ${err.message}`);
      });

      document.getElementById("offline")?.classList.add("hidden");
      document.getElementById("connected")?.classList.remove("hidden");

      startWaveform(el);

      // Update DJ name
      if (window.updateDJName) {
        window.updateDJName(participant.identity);
      }

      // Update connection status
      if (window.onDJStatusChange) {
        window.onDJStatusChange(true);
      }
    }
  });

  // Track unsubscribed
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === "audio") {
      log("Audio track unsubscribed");

      document.getElementById("offline")?.classList.remove("hidden");
      document.getElementById("connected")?.classList.add("hidden");

      stopWaveform();

      // Update connection status
      if (window.onDJStatusChange) {
        window.onDJStatusChange(false);
      }
    }
  });

  await room.connect(url, token);
  state.lkRoom = room;

  return room;
}

// Helper function to update backend about DJ presence
async function updateDJPresence(roomId, djClientId, isOnline) {
  try {
    await fetch("/presence/dj-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_id: roomId,
        dj_client_id: djClientId,
        is_online: isOnline,
      }),
    });
  } catch (err) {
    log(`Failed to update DJ presence: ${err.message}`);
  }
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
    throw new Error("Room not connected");
  }

  try {
    // Unpublish old tracks first
    if (room.localParticipant.trackPublications) {
      for (const p of [...room.localParticipant.trackPublications.values()]) {
        if (p.track?.kind === "audio") {
          log(`Unpublishing old track: ${p.track.sid}`);
          await room.localParticipant.unpublishTrack(p.track, { stop: false });
        }
      }
    }
  } catch (e) {
    log(`Unpublish error (non-fatal): ${e?.message || e}`);
  }

  try {
    const pub = await room.localParticipant.publishTrack(track, {
      dtx: false,
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
    log(`Published audio track; onAir=${state.onAir}`);
  } catch (e) {
    log(`Publish error: ${e?.message || e}`);
    throw e;
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
        } else if (state.source === "system") {
          track = await createSystemAudioTrack();
          await switchAudioSource(track, "screen_share_audio");
        }
      } catch (e) {
        log(`Track creation error: ${e?.message || e}`);
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
      log(`Mute/unmute error: ${e?.message || e}`);
    }
  }
}
