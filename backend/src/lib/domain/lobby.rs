use dashmap::DashMap;
use mediasoup::{
    prelude::*,
    worker::{WorkerLogLevel, WorkerLogTag, WorkerSettings},
    worker_manager::WorkerManager
};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;
use anyhow::Result;

use crate::lib::models::{Room, LobbyEvent};
use crate::lib::config::Config;

/// Fixed session id of the local audio-bot DJ.
///
/// MUST stay in sync with the private `AUDIO_BOT_SESSION_ID` in
/// `crate::lib::audio::audio_room` (that module is owned by another agent, so
/// we mirror the value here rather than reach into it). The setup-room sweeper
/// uses this to NEVER close the audio-bot room, which may legitimately sit in
/// Setup/Paused between sets.
pub const AUDIO_BOT_SESSION_ID: &str = "audio-bot-session";

/// Main application state - manages rooms and MediaSoup workers
#[derive(Clone)]
pub struct Lobby {
    /// All rooms in the application
    rooms: Arc<DashMap<Uuid, Arc<RwLock<Room>>>>,

    /// Pre-allocated MediaSoup workers for efficient room creation
    workers: Arc<Vec<Arc<Worker>>>,

    /// Round-robin counter for worker selection
    worker_index: Arc<AtomicUsize>,

    /// Lobby events broadcast channel (room list updates)
    broadcast_tx: broadcast::Sender<LobbyEvent>,

    /// Last-known public state per room, used by `update_room` to emit
    /// `RoomAdded` exactly on the false→true (became-public) transition and
    /// `RoomUpdated` otherwise. Replaces the old 30s wall-clock heuristic that
    /// mis-classified a slow DJ (>30s announce→produce) as an update.
    public_state: Arc<DashMap<Uuid, bool>>,
}

impl Lobby {
    /// Create new Lobby with pre-allocated MediaSoup workers
    pub async fn new() -> anyhow::Result<Self> {
        let config = Config::global();
        let (broadcast_tx, _) = broadcast::channel(1024);

        // Create worker pool (8 workers for good concurrency)
        let worker_manager = WorkerManager::new();
        let mut workers = Vec::with_capacity(8);

        for i in 0..8 {
            let mut worker_settings = WorkerSettings::default();
            worker_settings.enable_liburing = false;
            
            // Configure worker log level based on config
            if config.mediasoup_worker_debug() {
                worker_settings.log_level = WorkerLogLevel::Debug;
                worker_settings.log_tags = vec![
                    WorkerLogTag::Info,
                    WorkerLogTag::Ice,
                    WorkerLogTag::Dtls,
                    WorkerLogTag::Rtp,
                    WorkerLogTag::Srtp,
                    WorkerLogTag::Rtcp,
                    WorkerLogTag::Rtx,
                    WorkerLogTag::Bwe,
                    WorkerLogTag::Score,
                    WorkerLogTag::Simulcast,
                    WorkerLogTag::Svc,
                    WorkerLogTag::Sctp,
                    WorkerLogTag::Message,
                ]; // Enable all available log tags for debugging
                tracing::info!("Worker {}: Debug logging enabled with all log tags", i);
            } else {
                worker_settings.log_level = WorkerLogLevel::Warn;
                worker_settings.log_tags = vec![
                    WorkerLogTag::Info,
                ]; // Only basic info for production
                tracing::debug!("Worker {}: Production logging (warn level, info tag only)", i);
            }

            // Set configurable port range for WebRTC transport
            worker_settings.rtc_port_range = config.worker_port_range();

            // Configure custom DTLS certificates with SHA-256 fingerprints
            // Compute absolute paths relative to the server binary location
            // let current_dir = std::env::current_dir()
            //     .map_err(|e| anyhow::anyhow!("Failed to get current directory: {}", e))?;
            // let cert_path = current_dir.join("dtls").join("dtls.cert.pem");
            // let key_path = current_dir.join("dtls").join("dtls.key.pem");
            //
            // worker_settings.dtls_files = Some(WorkerDtlsFiles {
            //     certificate: cert_path,
            //     private_key: key_path,
            // });

            let worker = worker_manager
                .create_worker(worker_settings)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to create worker {}: {}", i, e))?;

            workers.push(Arc::new(worker));
        }

        tracing::info!("Created {} MediaSoup workers for room management", workers.len());

        Ok(Self {
            rooms: Arc::new(DashMap::new()),
            workers: Arc::new(workers),
            worker_index: Arc::new(AtomicUsize::new(0)),
            broadcast_tx,
            public_state: Arc::new(DashMap::new()),
        })
    }

    /// Get next worker using round-robin selection
    fn get_next_worker(&self) -> Arc<Worker> {
        let index = self.worker_index.fetch_add(1, Ordering::SeqCst) % self.workers.len();
        self.workers[index].clone()
    }

    /// Number of pre-allocated MediaSoup workers (for /health).
    pub fn worker_count(&self) -> usize {
        self.workers.len()
    }

    /// Total number of rooms currently tracked in the lobby (for /health).
    /// Includes non-public (Setup) rooms; not just publicly listed ones.
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }


    /// Create a new room with MediaSoup infrastructure
    pub async fn create_room(
        &self,
        id: Uuid,
        name: String,
        dj_name: String,
        session_id: String,
        description: Option<String>,
        tags: Option<Vec<String>>,
    ) -> anyhow::Result<Arc<RwLock<Room>>> {
        let worker = self.get_next_worker();
        let room = Room::init(
            id,
            name.clone(),
            dj_name,
            session_id,
            description,
            tags,
            &worker
        ).await?;
        let room_arc = Arc::new(RwLock::new(room));

        // Store room
        self.rooms.insert(id, room_arc.clone());

        // NOTE: Room is NOT broadcasted here (Step 1) - only when it becomes public (Step 16)
        // This implements the atomic room publication pattern

        tracing::info!("Created room '{}' with ID {}", name, id);
        Ok(room_arc)
    }

    /// Get room by ID
    pub fn get_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<Room>>> {
        self.rooms.get(room_id).map(|entry| entry.value().clone())
    }

    /// Find room containing a listener with the given session_id
    pub async fn find_room_by_listener_session(&self, session_id: &str) -> Option<(Uuid, Arc<RwLock<Room>>)> {
        for entry in self.rooms.iter() {
            let room_id = *entry.key();
            let room_arc = entry.value().clone();
            let room_guard = room_arc.read().await;
            if room_guard.get_listener(session_id).is_some() {
                drop(room_guard); // Release the read lock
                return Some((room_id, room_arc));
            }
        }
        None
    }

    /// Find room with a DJ that has the given session_id
    pub async fn find_room_by_dj_session_id(&self, session_id: &str) -> Option<Arc<RwLock<Room>>> {
        for entry in self.rooms.iter() {
            let room_arc = entry.value().clone();
            let room_guard = room_arc.read().await;
            if let Some(dj) = &room_guard.dj {
                if dj.dj_id == session_id {
                    drop(room_guard); // Release the read lock
                    return Some(room_arc);
                }
            }
        }
        None
    }

    /// Get all public rooms (live or paused with producers)
    pub async fn get_public_rooms(&self) -> Vec<Room> {
        let mut public_rooms = Vec::new();

        for entry in self.rooms.iter() {
            let room = entry.value().read().await;
            if room.is_public() {
                public_rooms.push(room.clone());
            }
        }

        tracing::debug!("Found {} public rooms out of {}", public_rooms.len(), self.rooms.len());
        public_rooms
    }

    /// Close room with graceful cleanup and remove from lobby
    /// This is the proper domain method for room closure initiated by DJ
    pub async fn close_room(&self, room_id: &Uuid) -> Result<()> {
        tracing::info!("Starting room closure process for room {}", room_id);

        // Get room and check if we need to broadcast removal
        if let Some(room_arc) = self.get_room(room_id) {
            // Check if room is public before cleanup (so we know if lobby clients should be notified)
            let should_broadcast = {
                let room_guard = room_arc.read().await;
                room_guard.is_public()
            };

            // CRITICAL: Broadcast room removal BEFORE cleanup so lobby clients receive the event
            // If we broadcast after close_room(), the lobby WebSocket connections will already be closed
            if should_broadcast {
                let _ = self.broadcast_tx.send(LobbyEvent::RoomRemoved {
                    room_id: room_id.to_string(),
                });
                tracing::info!("Broadcasted room removal to lobby before cleanup for room {}", room_id);
            }

            // Now perform the comprehensive room cleanup (ejecting listeners, stopping streams, etc.)
            {
                let mut room = room_arc.write().await;
                room.close_room().await?;
            }

            // Remove room from lobby (skip broadcast since we already did it above)
            if let Some((_, removed_room_arc)) = self.rooms.remove(room_id) {
                tracing::info!("Room {} removed from lobby after cleanup", room_id);
                drop(removed_room_arc); // Explicitly drop the room reference
            }
            self.public_state.remove(room_id); // Drop last-known public state

            tracing::info!("Room {} closed and removed from lobby successfully", room_id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Room {} not found for closure", room_id))
        }
    }

    /// Remove room from lobby
    pub async fn remove_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<Room>>> {
        self.public_state.remove(room_id); // Drop last-known public state
        if let Some((_, room_arc)) = self.rooms.remove(room_id) {
            // Only broadcast room removal if the room was public (visible to lobby clients)
            // This prevents broadcasts for unfinished rooms that failed during setup
            let room_guard = room_arc.read().await;
            let was_public = room_guard.is_public();
            drop(room_guard);

            if was_public {
                let _ = self.broadcast_tx.send(LobbyEvent::RoomRemoved {
                    room_id: room_id.to_string(),
                });
                tracing::info!("Removed public room with ID {} and broadcasted to lobby", room_id);
            } else {
                tracing::info!("Removed unfinished room with ID {} (no broadcast - room was not public)", room_id);
            }

            Some(room_arc)
        } else {
            None
        }
    }

    /// Update room and broadcast changes (atomic publication pattern)
    pub async fn update_room(&self, room_id: &Uuid) {
        tracing::info!(room_id = %room_id, "Lobby.update_room called");
        if let Some(room_arc) = self.get_room(room_id) {
            let room = room_arc.read().await;

            // Check if room is now public (Step 16 atomic publication)
            if room.is_public() {
                // Determine event type from the REAL public-state transition
                // (fix #5): emit RoomAdded EXACTLY on the false→true (became-
                // public) edge, RoomUpdated for every subsequent change. This
                // replaces the old 30s wall-clock heuristic which mis-labelled a
                // slow DJ (>30s announce→produce) as RoomUpdated, so
                // already-connected lobby clients never saw the room appear.
                let was_public = self
                    .public_state
                    .get(room_id)
                    .map(|entry| *entry.value())
                    .unwrap_or(false);

                // Record the new public state for the next transition check.
                self.public_state.insert(*room_id, true);

                let became_public = !was_public; // false → true edge

                let event = if became_public {
                    LobbyEvent::RoomAdded {
                        room: room.clone().into(),
                    }
                } else {
                    LobbyEvent::RoomUpdated {
                        room: room.clone().into(),
                    }
                };

                let event_type_str = match &event {
                    LobbyEvent::RoomAdded { .. } => "RoomAdded",
                    LobbyEvent::RoomUpdated { .. } => "RoomUpdated",
                    _ => "Other",
                };
                let _ = self.broadcast_tx.send(event);
                tracing::info!(
                    room_id = %room_id,
                    room_status = ?room.status,
                    listener_count = room.listener_count,
                    is_public = room.is_public(),
                    was_public = was_public,
                    became_public = became_public,
                    event_type = event_type_str,
                    "Room state broadcasted to lobby subscribers"
                );
            } else {
                // Room is not (yet / no longer) public: remember false so the
                // next time it becomes public we correctly emit RoomAdded.
                self.public_state.insert(*room_id, false);
            }
        }
    }

    /// Periodic sweep: close leaked Setup-state rooms.
    ///
    /// A DJ that announces (creating a Setup room + router) but never opens the
    /// room WS leaks the room forever, because the disconnect-grace timer only
    /// arms on WS *close*. This closes rooms that are NOT public
    /// (`is_public() == false` → Setup) and have been idle longer than
    /// `idle_threshold` (via `Room::idle_duration()`).
    ///
    /// CRITICAL: the audio-bot room is NEVER swept — it may legitimately sit in
    /// Setup/Paused between sets. It is identified by its DJ session id matching
    /// [`AUDIO_BOT_SESSION_ID`]. (Paused rooms are already public so they'd be
    /// skipped anyway, but the explicit session-id check also protects a bot
    /// room that is still in Setup, e.g. before its first device connects.)
    pub async fn sweep_setup_rooms(&self, idle_threshold: std::time::Duration) {
        // Snapshot candidate ids first to avoid holding DashMap refs across the
        // await in close_room().
        let mut to_close: Vec<Uuid> = Vec::new();

        for entry in self.rooms.iter() {
            let room_id = *entry.key();
            let room_arc = entry.value().clone();
            let room = room_arc.read().await;

            // Skip anything already public (Live/Paused) — those are handled by
            // the DJ-disconnect grace timer / normal close flow.
            if room.is_public() {
                continue;
            }

            // NEVER sweep the audio-bot room.
            let is_audio_bot = room
                .dj
                .as_ref()
                .map_or(false, |dj| dj.dj_id == AUDIO_BOT_SESSION_ID);
            if is_audio_bot {
                continue;
            }

            let idle = room.idle_duration();
            if idle.to_std().map_or(false, |d| d >= idle_threshold) {
                tracing::info!(
                    room_id = %room_id,
                    idle_seconds = idle.num_seconds(),
                    "Setup-room sweeper: closing leaked non-public room idle past threshold"
                );
                to_close.push(room_id);
            }
        }

        for room_id in to_close {
            if let Err(e) = self.close_room(&room_id).await {
                tracing::warn!(
                    room_id = %room_id,
                    error = %e,
                    "Setup-room sweeper: failed to close leaked room"
                );
            }
        }
    }

    /// Subscribe to lobby events (room list changes)
    pub fn subscribe_lobby_events(&self) -> broadcast::Receiver<LobbyEvent> {
        self.broadcast_tx.subscribe()
    }

    /// Send lobby event to all subscribers
    pub fn send_lobby_event(&self, event: LobbyEvent) -> Result<usize, broadcast::error::SendError<LobbyEvent>> {
        self.broadcast_tx.send(event)
    }

}
