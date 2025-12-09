use crate::webrtc::MediasoupState;
use std::sync::Arc;
use uuid::Uuid;

use crate::models::{LobbyEvent, Room};

pub mod room;
pub mod broadcast;

pub use room::{RoomState, RoomStateManager, RoomStatus};
pub use broadcast::{BroadcastManager, BroadcastEvent, BroadcastConfig, BroadcastStats};

#[derive(Clone)]
pub struct AppState {
    pub room_manager: RoomStateManager,
    pub mediasoup: MediasoupState,
    pub broadcast_manager: BroadcastManager,
    
    // Lobby events broadcast (room updates)
    pub broadcast_tx: tokio::sync::broadcast::Sender<LobbyEvent>,
}

impl AppState {
    pub async fn new() -> anyhow::Result<Self> {
        let (broadcast_tx, _) = tokio::sync::broadcast::channel(1024);
        
        Ok(Self {
            room_manager: RoomStateManager::new(),
            mediasoup: MediasoupState::new().await?,
            broadcast_manager: BroadcastManager::new(BroadcastConfig::default()),
            broadcast_tx,
        })
    }

    // Legacy compatibility methods
    pub async fn add_room(&self, room: Room) {
        let room_state = self.room_manager.create_room(room.clone()).await;
        self.broadcast_manager.broadcast_room_created(room.clone());
        let _ = self.broadcast_tx.send(LobbyEvent::RoomAdded { 
            room: room.clone().into(),
            trace_context: None,
        });
    }

    pub async fn update_room(&self, room: Room) {
        if let Some(room_state) = self.room_manager.get_room(&room.id) {
            let mut state = room_state.write().await;
            state.room = room.clone();
            state.update_activity();
        }
        
        self.broadcast_manager.broadcast_room_updated(room.clone());
        let _ = self.broadcast_tx.send(LobbyEvent::RoomUpdated { 
            room: room.clone().into(),
            trace_context: None,
        });
    }

    pub fn remove_room(&self, room_id: Uuid) {
        if self.room_manager.remove_room(&room_id).is_some() {
            self.broadcast_manager.broadcast_room_removed(room_id);
            let _ = self.broadcast_tx.send(LobbyEvent::RoomRemoved { 
                room_id: room_id.to_string(),
                trace_context: None,
            });
        }
    }

    pub async fn get_rooms(&self) -> Vec<Room> {
        self.room_manager.get_public_rooms().await
    }

    // Enhanced methods using new state management
    pub async fn create_room_enhanced(&self, room: Room) -> Arc<tokio::sync::RwLock<RoomState>> {
        let room_state = self.room_manager.create_room(room.clone()).await;
        self.broadcast_manager.broadcast_room_created(room.clone());
        let _ = self.broadcast_tx.send(LobbyEvent::RoomAdded { 
            room: room.clone().into(),
            trace_context: None,
        });
        room_state
    }

    pub fn get_room_state(&self, room_id: &Uuid) -> Option<Arc<tokio::sync::RwLock<RoomState>>> {
        self.room_manager.get_room(room_id)
    }

    pub async fn start_stream(&self, room_id: Uuid, producer_id: String) {
        if let Some(room_state) = self.room_manager.get_room(&room_id) {
            let mut state = room_state.write().await;
            state.room.dj_streaming = true;
            if state.status == RoomStatus::Setup {
                state.status = RoomStatus::Live;
            } else if state.status == RoomStatus::Paused {
                state.resume();
            }
            let room = state.room.clone();
            drop(state);

            self.broadcast_manager.broadcast_stream_started(room_id, producer_id);
            self.broadcast_manager.broadcast_room_updated(room.clone());
            let _ = self.broadcast_tx.send(LobbyEvent::RoomUpdated { 
            room: room.clone().into(),
            trace_context: None,
        });
        }
    }

    pub async fn stop_stream(&self, room_id: Uuid) {
        if let Some(room_state) = self.room_manager.get_room(&room_id) {
            let mut state = room_state.write().await;
            state.pause();
            let room = state.room.clone();
            drop(state);

            self.broadcast_manager.broadcast_stream_stopped(room_id);
            self.broadcast_manager.broadcast_room_updated(room.clone());
            let _ = self.broadcast_tx.send(LobbyEvent::RoomUpdated { 
            room: room.clone().into(),
            trace_context: None,
        });
        }
    }

    pub async fn update_listener_count(&self, room_id: Uuid, count: u32) {
        if let Some(room_state) = self.room_manager.get_room(&room_id) {
            let mut state = room_state.write().await;
            state.room.listener_count = count;
            state.update_activity();
            let room = state.room.clone();
            drop(state);

            if count > 0 {
                self.broadcast_manager.broadcast_listener_joined(room_id, count);
            } else {
                self.broadcast_manager.broadcast_listener_left(room_id, count);
            }
            
            self.broadcast_manager.broadcast_room_updated(room.clone());
            let _ = self.broadcast_tx.send(LobbyEvent::RoomUpdated { 
            room: room.clone().into(),
            trace_context: None,
        });
        }
    }

    pub async fn cleanup_idle_rooms(&self, timeout: chrono::Duration) -> Vec<Uuid> {
        let removed_rooms = self.room_manager.cleanup_idle_rooms(timeout).await;
        
        for room_id in &removed_rooms {
            self.broadcast_manager.broadcast_room_removed(*room_id);
            let _ = self.broadcast_tx.send(LobbyEvent::RoomRemoved { 
            room_id: room_id.to_string(),
            trace_context: None,
        });
        }
        
        removed_rooms
    }

    pub fn get_broadcast_stats(&self) -> BroadcastStats {
        self.broadcast_manager.get_stats()
    }
}