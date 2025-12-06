use crate::webrtc::MediasoupState;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::models::{BroadcastMessage, Room};

#[derive(Clone)]
pub struct AppState {
    pub rooms: Arc<DashMap<Uuid, Room>>,
    pub mediasoup: MediasoupState,
    pub broadcast_tx: broadcast::Sender<BroadcastMessage>,
}

impl AppState {
    pub async fn new() -> anyhow::Result<Self> {
        let (broadcast_tx, _) = broadcast::channel(1024);
        
        Ok(Self {
            rooms: Arc::new(DashMap::new()),
            mediasoup: MediasoupState::new().await?,
            broadcast_tx,
        })
    }

    pub fn add_room(&self, room: Room) {
        self.rooms.insert(room.id, room.clone());
        let _ = self.broadcast_tx.send(BroadcastMessage::RoomAdded { room });
    }

    pub fn update_room(&self, room: Room) {
        if let Some(mut entry) = self.rooms.get_mut(&room.id) {
            *entry = room.clone();
            let _ = self.broadcast_tx.send(BroadcastMessage::RoomUpdated { room });
        }
    }

    pub fn remove_room(&self, room_id: Uuid) {
        if self.rooms.remove(&room_id).is_some() {
            let _ = self.broadcast_tx.send(BroadcastMessage::RoomRemoved { room_id });
        }
    }

    pub fn get_rooms(&self) -> Vec<Room> {
        self.rooms.iter().map(|entry| entry.value().clone()).collect()
    }
}