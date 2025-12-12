use arc_swap::ArcSwap;
use dashmap::DashMap;
use mediasoup::producer::Producer;
use mediasoup::router::Router;
use mediasoup::webrtc_transport::WebRtcTransport;
use mediasoup::prelude::Transport;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::Room;
use crate::webrtc::consumer::ConsumerState;

/// Enhanced room state with WebRTC resources
#[derive(Debug, Clone)]
pub struct RoomState {
    pub room: Room,
    pub router: Option<Arc<Router>>,
    pub dj_transport: Option<Arc<WebRtcTransport>>,
    pub audio_producer: Option<Arc<Producer>>,
    pub consumers: Arc<DashMap<String, ConsumerState>>, // listener_id -> consumer
    pub listener_transports: Arc<DashMap<String, Arc<WebRtcTransport>>>, // listener_id -> transport
    pub status: RoomStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_activity: Arc<ArcSwap<chrono::DateTime<chrono::Utc>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RoomStatus {
    /// Room is being set up (not visible to public)
    Setup,
    /// Room is live with active producer (visible to public)
    Live,
    /// Room is paused but connection maintained
    Paused,
    /// Room is being torn down
    Closing,
}

impl RoomState {
    pub fn new(room: Room) -> Self {
        let now = chrono::Utc::now();
        Self {
            room,
            router: None,
            dj_transport: None,
            audio_producer: None,
            consumers: Arc::new(DashMap::new()),
            listener_transports: Arc::new(DashMap::new()),
            status: RoomStatus::Setup,
            created_at: now,
            last_activity: Arc::new(ArcSwap::from_pointee(now)),
        }
    }
    
    /// Get the transport ID if DJ transport exists
    pub fn get_dj_transport_id(&self) -> Option<String> {
        self.dj_transport.as_ref().map(|transport| transport.id().to_string())
    }

    /// Check if room should be visible to public
    pub fn is_public(&self) -> bool {
        matches!(self.status, RoomStatus::Live | RoomStatus::Paused)
            && self.router.is_some()
            && self.audio_producer.is_some()
    }

    /// Update last activity timestamp
    pub fn update_activity(&self) {
        self.last_activity.store(Arc::new(chrono::Utc::now()));
    }

    /// Set router for the room
    pub fn set_router(&mut self, router: Arc<Router>) {
        self.router = Some(router);
        self.update_activity();
    }

    /// Set DJ transport
    pub fn set_dj_transport(&mut self, transport: Arc<WebRtcTransport>) {
        self.dj_transport = Some(transport);
        self.update_activity();
    }

    /// Set audio producer and transition to live if all resources ready
    #[tracing::instrument(skip(self, producer), fields(
        room_id = %self.room.id,
        status_before = ?self.status,
        has_router = self.router.is_some(),
        has_transport = self.dj_transport.is_some()
    ))]
    pub fn set_audio_producer(&mut self, producer: Arc<Producer>) {
        let was_public = self.is_public();
        
        self.audio_producer = Some(producer);
        self.room.dj_streaming = true;
        
        // Transition to live if all resources are ready
        if self.router.is_some() && self.dj_transport.is_some() {
            self.status = RoomStatus::Live;
        }
        
        let is_public_now = self.is_public();
        
        tracing::info!(
            status_after = ?self.status,
            was_public = was_public,
            is_public_now = is_public_now,
            dj_streaming = self.room.dj_streaming,
            "Set audio producer on room"
        );
        
        self.update_activity();
    }

    /// Pause the room (keep connections, stop streaming)
    pub fn pause(&mut self) {
        if matches!(self.status, RoomStatus::Live) {
            self.status = RoomStatus::Paused;
            self.room.dj_streaming = false;
            self.update_activity();
        }
    }

    /// Resume the room
    pub fn resume(&mut self) {
        if matches!(self.status, RoomStatus::Paused) && self.audio_producer.is_some() {
            self.status = RoomStatus::Live;
            self.room.dj_streaming = true;
            self.update_activity();
        }
    }

    /// Start closing the room
    pub fn start_closing(&mut self) {
        self.status = RoomStatus::Closing;
        self.room.dj_streaming = false;
        self.update_activity();
    }

    /// Add consumer for listener
    pub fn add_consumer(&self, listener_id: String, consumer_state: ConsumerState) {
        self.consumers.insert(listener_id, consumer_state);
        self.update_activity();
    }

    /// Remove consumer for listener
    pub fn remove_consumer(&self, listener_id: &str) -> Option<ConsumerState> {
        let consumer = self.consumers.remove(listener_id).map(|(_, state)| state);
        if consumer.is_some() {
            self.update_activity();
        }
        consumer
    }

    /// Add listener transport
    pub fn add_listener_transport(&self, listener_id: String, transport: Arc<WebRtcTransport>) {
        self.listener_transports.insert(listener_id, transport);
        self.update_activity();
    }

    /// Remove listener transport
    pub fn remove_listener_transport(&self, listener_id: &str) -> Option<Arc<WebRtcTransport>> {
        let transport = self.listener_transports.remove(listener_id).map(|(_, transport)| transport);
        if transport.is_some() {
            self.update_activity();
        }
        transport
    }

    /// Get number of active listeners
    pub fn get_listener_count(&self) -> usize {
        self.consumers.len()
    }

    /// Update room listener count from actual consumers
    pub fn update_listener_count(&mut self) {
        self.room.listener_count = self.get_listener_count() as u32;
    }

    /// Get time since last activity
    pub fn idle_duration(&self) -> chrono::Duration {
        let last_activity = **self.last_activity.load();
        chrono::Utc::now() - last_activity
    }
}

/// Thread-safe room state manager
#[derive(Clone)]
pub struct RoomStateManager {
    rooms: Arc<DashMap<Uuid, Arc<RwLock<RoomState>>>>,
}

impl RoomStateManager {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(DashMap::new()),
        }
    }

    /// Create a new room in setup state
    pub async fn create_room(&self, room: Room) -> Arc<RwLock<RoomState>> {
        let room_state = Arc::new(RwLock::new(RoomState::new(room)));
        self.rooms.insert(room_state.read().await.room.id, room_state.clone());
        room_state
    }

    /// Get room state by ID
    pub fn get_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<RoomState>>> {
        self.rooms.get(room_id).map(|entry| entry.value().clone())
    }

    /// Get all public rooms (live or paused with producers)
    #[tracing::instrument(skip(self))]
    pub async fn get_public_rooms(&self) -> Vec<Room> {
        let mut public_rooms = Vec::new();
        let total_rooms = self.rooms.len();
        
        for entry in self.rooms.iter() {
            let room_state = entry.value().read().await;
            let is_public = room_state.is_public();
            
            tracing::debug!(
                room_id = %room_state.room.id,
                status = ?room_state.status,
                has_router = room_state.router.is_some(),
                has_dj_transport = room_state.dj_transport.is_some(),
                has_audio_producer = room_state.audio_producer.is_some(),
                dj_streaming = room_state.room.dj_streaming,
                is_public = is_public,
                "Checking room visibility"
            );
            
            if is_public {
                public_rooms.push(room_state.room.clone());
            }
        }
        
        tracing::info!(
            total_rooms = total_rooms,
            public_rooms = public_rooms.len(),
            "Filtered public rooms"
        );
        
        public_rooms
    }

    /// Get all rooms regardless of status
    pub async fn get_all_rooms(&self) -> Vec<Room> {
        let mut all_rooms = Vec::new();
        
        for entry in self.rooms.iter() {
            let room_state = entry.value().read().await;
            all_rooms.push(room_state.room.clone());
        }
        
        all_rooms
    }

    /// Remove room from state
    pub fn remove_room(&self, room_id: &Uuid) -> Option<Arc<RwLock<RoomState>>> {
        self.rooms.remove(room_id).map(|(_, room_state)| room_state)
    }

    /// Get count of rooms by status
    pub async fn get_status_counts(&self) -> std::collections::HashMap<RoomStatus, usize> {
        let mut counts = std::collections::HashMap::new();
        
        for entry in self.rooms.iter() {
            let room_state = entry.value().read().await;
            *counts.entry(room_state.status.clone()).or_insert(0) += 1;
        }
        
        counts
    }

    /// Clean up idle rooms (longer than timeout)
    pub async fn cleanup_idle_rooms(&self, timeout: chrono::Duration) -> Vec<Uuid> {
        let mut removed_rooms = Vec::new();
        let mut to_remove = Vec::new();
        
        for entry in self.rooms.iter() {
            let room_state = entry.value().read().await;
            if room_state.idle_duration() > timeout 
                && matches!(room_state.status, RoomStatus::Setup | RoomStatus::Closing) {
                to_remove.push(*entry.key());
            }
        }
        
        for room_id in to_remove {
            if self.remove_room(&room_id).is_some() {
                removed_rooms.push(room_id);
            }
        }
        
        removed_rooms
    }
}

impl Default for RoomStateManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Room;

    #[tokio::test]
    async fn test_room_state_lifecycle() {
        let room = Room {
            id: Uuid::new_v4(),
            name: "Test Room".to_string(),
            dj_id: "test_dj".to_string(),
            dj_streaming: false,
            listener_count: 0,
        };

        let mut room_state = RoomState::new(room);
        
        // Initially in setup, not public
        assert_eq!(room_state.status, RoomStatus::Setup);
        assert!(!room_state.is_public());
        
        // Still not public without producer
        room_state.status = RoomStatus::Live;
        assert!(!room_state.is_public());
        
        // Public only with all resources
        room_state.router = Some(Arc::new(unsafe { std::mem::zeroed() })); // Mock router
        room_state.audio_producer = Some(Arc::new(unsafe { std::mem::zeroed() })); // Mock producer
        assert!(room_state.is_public());
        
        // Pause maintains public status
        room_state.pause();
        assert_eq!(room_state.status, RoomStatus::Paused);
        assert!(room_state.is_public());
        assert!(!room_state.room.dj_streaming);
    }

    #[tokio::test]
    async fn test_room_manager() {
        let manager = RoomStateManager::new();
        
        let room = Room {
            id: Uuid::new_v4(),
            name: "Test Room".to_string(),
            dj_id: "test_dj".to_string(),
            dj_streaming: false,
            listener_count: 0,
        };
        
        let room_id = room.id;
        let room_state = manager.create_room(room).await;
        
        // Can retrieve the room
        assert!(manager.get_room(&room_id).is_some());
        
        // Initially no public rooms
        let public_rooms = manager.get_public_rooms().await;
        assert_eq!(public_rooms.len(), 0);
        
        // All rooms includes setup rooms
        let all_rooms = manager.get_all_rooms().await;
        assert_eq!(all_rooms.len(), 1);
        
        // Remove room
        assert!(manager.remove_room(&room_id).is_some());
        assert!(manager.get_room(&room_id).is_none());
    }
}