use dashmap::DashMap;
use mediasoup::{
    prelude::*,
    worker::{WorkerLogLevel, WorkerSettings},
    worker_manager::WorkerManager
};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

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
}

impl Lobby {
    /// Create new Lobby with pre-allocated MediaSoup workers
    pub async fn new() -> anyhow::Result<Self> {
        let (broadcast_tx, _) = broadcast::channel(1024);

        // Create worker pool (8 workers for good concurrency)
        let worker_manager = WorkerManager::new();
        let mut workers = Vec::with_capacity(8);

        for i in 0..8 {
            let mut worker_settings = WorkerSettings::default();
            worker_settings.enable_liburing = false;
            worker_settings.log_level = WorkerLogLevel::Warn;

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
        })
    }

    /// Get next worker using round-robin selection
    fn get_next_worker(&self) -> Arc<Worker> {
        let index = self.worker_index.fetch_add(1, Ordering::SeqCst) % self.workers.len();
        self.workers[index].clone()
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
        let room = Room::init(id, name.clone(), dj_name, description, tags, &worker).await?;
        let room_arc = Arc::new(RwLock::new(room));

        // Store room
        self.rooms.insert(id, room_arc.clone());

        // Broadcast room creation
        let room_clone = room_arc.read().await.clone();
        let _ = self.broadcast_tx.send(LobbyEvent::RoomAdded {
            room: room_clone.into(),
        });

        tracing::info!("Created room '{}' with ID {}", name, id);
        Ok(room_arc)
    }

    /// Get room by ID
    pub fn get_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<Room>>> {
        self.rooms.get(room_id).map(|entry| entry.value().clone())
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

    /// Remove room from lobby
    pub async fn remove_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<Room>>> {
        if let Some((_, room_arc)) = self.rooms.remove(room_id) {
            // Broadcast room removal
            let _ = self.broadcast_tx.send(LobbyEvent::RoomRemoved {
                room_id: room_id.to_string(),
            });

            tracing::info!("Removed room with ID {}", room_id);
            Some(room_arc)
        } else {
            None
        }
    }

    /// Update room and broadcast changes
    pub async fn update_room(&self, room_id: &Uuid) {
        if let Some(room_arc) = self.get_room(room_id) {
            let room = room_arc.read().await;
            let _ = self.broadcast_tx.send(LobbyEvent::RoomUpdated {
                room: room.clone().into(),
            });
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
