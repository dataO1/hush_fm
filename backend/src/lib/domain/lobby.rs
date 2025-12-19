use dashmap::DashMap;
use mediasoup::{
    prelude::*,
    worker::{WorkerLogLevel, WorkerLogTag, WorkerSettings, WorkerDtlsFiles},
    worker_manager::WorkerManager
};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;
use anyhow::Result;

use crate::lib::models::{Room, LobbyEvent};

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

    /// WebRTC configuration
    port_range: std::ops::RangeInclusive<u16>,
    announced_ip: String,
    
    /// MediaSoup configuration
    listen_ip: String,
    enable_tcp: bool,
    expose_internal_ip: bool,
    
    /// Monitoring configuration
    stale_listener_timeout: std::time::Duration,
}

impl Lobby {
    /// Create new Lobby with pre-allocated MediaSoup workers
    pub async fn new() -> anyhow::Result<Self> {
        Self::with_config(10000, 59999, "localhost", "0.0.0.0", false, false, 0).await
    }
    
    /// Create new Lobby with custom worker port range (deprecated - use with_config)
    pub async fn with_port_range(port_min: u16, port_max: u16) -> anyhow::Result<Self> {
        Self::with_config(port_min, port_max, "localhost", "0.0.0.0", false, false, 0).await
    }

    /// Create new Lobby with full configuration
    pub async fn with_config(
        port_min: u16, 
        port_max: u16, 
        announced_ip: &str,
        listen_ip: &str,
        enable_tcp: bool,
        expose_internal_ip: bool,
        stale_listener_timeout_seconds: u64
    ) -> anyhow::Result<Self> {
        let (broadcast_tx, _) = broadcast::channel(1024);

        // Create worker pool (8 workers for good concurrency)
        let worker_manager = WorkerManager::new();
        let mut workers = Vec::with_capacity(8);

        for i in 0..8 {
            let mut worker_settings = WorkerSettings::default();
            worker_settings.enable_liburing = false;
            worker_settings.log_level = WorkerLogLevel::Debug; // Enable debug logging
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

            // Set configurable port range for WebRTC transport
            worker_settings.rtc_port_range = port_min..=port_max;

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
            port_range: port_min..=port_max,
            announced_ip: announced_ip.to_string(),
            listen_ip: listen_ip.to_string(),
            enable_tcp,
            expose_internal_ip,
            stale_listener_timeout: std::time::Duration::from_secs(stale_listener_timeout_seconds),
        })
    }

    /// Get next worker using round-robin selection
    fn get_next_worker(&self) -> Arc<Worker> {
        let index = self.worker_index.fetch_add(1, Ordering::SeqCst) % self.workers.len();
        self.workers[index].clone()
    }

    /// Get the configured port range
    pub fn port_range(&self) -> std::ops::RangeInclusive<u16> {
        self.port_range.clone()
    }

    /// Get the configured announced IP
    pub fn announced_ip(&self) -> &str {
        &self.announced_ip
    }

    /// Get the configured MediaSoup listen IP
    pub fn listen_ip(&self) -> &str {
        &self.listen_ip
    }

    /// Get whether TCP is enabled
    pub fn enable_tcp(&self) -> bool {
        self.enable_tcp
    }

    /// Get whether to expose internal IP
    pub fn expose_internal_ip(&self) -> bool {
        self.expose_internal_ip
    }
    
    /// Get the configured stale listener timeout
    pub fn stale_listener_timeout(&self) -> std::time::Duration {
        self.stale_listener_timeout
    }

    /// Create a new room with MediaSoup infrastructure
    pub async fn create_room(
        &self,
        id: Uuid,
        name: String,
        dj_name: String,
        description: Option<String>,
        tags: Option<Vec<String>>,
    ) -> anyhow::Result<Arc<RwLock<Room>>> {
        let worker = self.get_next_worker();
        let room = Room::init(
            id, 
            name.clone(), 
            dj_name, 
            description, 
            tags, 
            &worker, 
            self.port_range.clone(), 
            self.announced_ip.clone(),
            self.listen_ip.clone(),
            self.enable_tcp,
            self.expose_internal_ip
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

        // Get room and perform cleanup
        if let Some(room_arc) = self.get_room(room_id) {
            {
                let mut room = room_arc.write().await;
                // Call the room's comprehensive close method
                room.close_room().await?;
            }

            // Remove room from lobby after cleanup
            self.remove_room(room_id).await;

            tracing::info!("Room {} closed and removed from lobby successfully", room_id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Room {} not found for closure", room_id))
        }
    }

    /// Remove room from lobby
    pub async fn remove_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<Room>>> {
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
        if let Some(room_arc) = self.get_room(room_id) {
            let room = room_arc.read().await;

            // Check if room is now public (Step 16 atomic publication)
            if room.is_public() {
                // First time becoming public = RoomAdded, subsequent updates = RoomUpdated
                let event = if matches!(room.status, crate::lib::models::schemas::RoomStatus::Live) {
                    // Room just became Live for first time (producer created)
                    LobbyEvent::RoomAdded {
                        room: room.clone().into(),
                    }
                } else {
                    // Subsequent updates (paused/resumed etc.)
                    LobbyEvent::RoomUpdated {
                        room: room.clone().into(),
                    }
                };

                let _ = self.broadcast_tx.send(event);
                tracing::debug!(
                    room_id = %room_id,
                    room_status = ?room.status,
                    is_public = room.is_public(),
                    "Room state broadcasted to lobby subscribers"
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
