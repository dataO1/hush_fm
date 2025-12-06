use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use uuid::Uuid;

use crate::models::{Room, BroadcastMessage};

/// Enhanced broadcast event types for real-time updates
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum BroadcastEvent {
    /// Room lifecycle events
    RoomCreated { room: Room },
    RoomUpdated { room: Room },
    RoomRemoved { room_id: Uuid },
    RoomStatusChanged { room_id: Uuid, status: String },
    
    /// Streaming events
    StreamStarted { room_id: Uuid, producer_id: String },
    StreamStopped { room_id: Uuid },
    StreamPaused { room_id: Uuid },
    StreamResumed { room_id: Uuid },
    
    /// Listener events
    ListenerJoined { room_id: Uuid, listener_count: u32 },
    ListenerLeft { room_id: Uuid, listener_count: u32 },
    
    /// System events
    SystemStats { 
        total_rooms: u32, 
        live_rooms: u32, 
        total_listeners: u32 
    },
    ServerMaintenance { message: String },
    
    /// Connection events
    TransportConnected { room_id: Uuid, transport_type: String },
    TransportDisconnected { room_id: Uuid, transport_type: String },
}

/// Broadcast channel configuration
#[derive(Debug, Clone)]
pub struct BroadcastConfig {
    pub lobby_capacity: usize,
    pub room_capacity: usize,
    pub system_capacity: usize,
    pub stats_interval_secs: u64,
}

impl Default for BroadcastConfig {
    fn default() -> Self {
        Self {
            lobby_capacity: 1024,
            room_capacity: 256,
            system_capacity: 128,
            stats_interval_secs: 30,
        }
    }
}

/// Enhanced broadcast manager with multiple channels
#[derive(Clone)]
pub struct BroadcastManager {
    config: BroadcastConfig,
    
    /// Global lobby updates (room list changes)
    lobby_tx: broadcast::Sender<BroadcastEvent>,
    
    /// Room-specific updates (streaming, listeners)
    room_channels: Arc<dashmap::DashMap<Uuid, broadcast::Sender<BroadcastEvent>>>,
    
    /// System-wide events (stats, maintenance)
    system_tx: broadcast::Sender<BroadcastEvent>,
}

impl BroadcastManager {
    pub fn new(config: BroadcastConfig) -> Self {
        let (lobby_tx, _) = broadcast::channel(config.lobby_capacity);
        let (system_tx, _) = broadcast::channel(config.system_capacity);
        
        Self {
            config,
            lobby_tx,
            room_channels: Arc::new(dashmap::DashMap::new()),
            system_tx,
        }
    }

    /// Subscribe to lobby updates (room list changes)
    pub fn subscribe_lobby(&self) -> broadcast::Receiver<BroadcastEvent> {
        self.lobby_tx.subscribe()
    }

    /// Subscribe to room-specific updates
    pub fn subscribe_room(&self, room_id: Uuid) -> broadcast::Receiver<BroadcastEvent> {
        let tx = self.room_channels
            .entry(room_id)
            .or_insert_with(|| {
                let (tx, _) = broadcast::channel(self.config.room_capacity);
                tx
            });
        tx.subscribe()
    }

    /// Subscribe to system events
    pub fn subscribe_system(&self) -> broadcast::Receiver<BroadcastEvent> {
        self.system_tx.subscribe()
    }

    /// Broadcast room creation to lobby
    pub fn broadcast_room_created(&self, room: Room) {
        let event = BroadcastEvent::RoomCreated { room };
        let _ = self.lobby_tx.send(event);
    }

    /// Broadcast room update to lobby and room channel
    pub fn broadcast_room_updated(&self, room: Room) {
        let event = BroadcastEvent::RoomUpdated { room: room.clone() };
        
        // Send to lobby
        let _ = self.lobby_tx.send(event.clone());
        
        // Send to room-specific channel
        if let Some(room_tx) = self.room_channels.get(&room.id) {
            let _ = room_tx.send(event);
        }
    }

    /// Broadcast room removal
    pub fn broadcast_room_removed(&self, room_id: Uuid) {
        let event = BroadcastEvent::RoomRemoved { room_id };
        
        // Send to lobby
        let _ = self.lobby_tx.send(event.clone());
        
        // Send to room channel and clean it up
        if let Some((_, room_tx)) = self.room_channels.remove(&room_id) {
            let _ = room_tx.send(event);
        }
    }

    /// Broadcast stream started
    pub fn broadcast_stream_started(&self, room_id: Uuid, producer_id: String) {
        let event = BroadcastEvent::StreamStarted { room_id, producer_id };
        
        // Send to room channel
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event.clone());
        }
        
        // Send to lobby for room list updates
        let _ = self.lobby_tx.send(event);
    }

    /// Broadcast stream stopped
    pub fn broadcast_stream_stopped(&self, room_id: Uuid) {
        let event = BroadcastEvent::StreamStopped { room_id };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event.clone());
        }
        
        let _ = self.lobby_tx.send(event);
    }

    /// Broadcast stream paused
    pub fn broadcast_stream_paused(&self, room_id: Uuid) {
        let event = BroadcastEvent::StreamPaused { room_id };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event);
        }
    }

    /// Broadcast stream resumed
    pub fn broadcast_stream_resumed(&self, room_id: Uuid) {
        let event = BroadcastEvent::StreamResumed { room_id };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event);
        }
    }

    /// Broadcast listener joined
    pub fn broadcast_listener_joined(&self, room_id: Uuid, listener_count: u32) {
        let event = BroadcastEvent::ListenerJoined { room_id, listener_count };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event.clone());
        }
        
        let _ = self.lobby_tx.send(event);
    }

    /// Broadcast listener left
    pub fn broadcast_listener_left(&self, room_id: Uuid, listener_count: u32) {
        let event = BroadcastEvent::ListenerLeft { room_id, listener_count };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event.clone());
        }
        
        let _ = self.lobby_tx.send(event);
    }

    /// Broadcast system statistics
    pub fn broadcast_system_stats(&self, total_rooms: u32, live_rooms: u32, total_listeners: u32) {
        let event = BroadcastEvent::SystemStats { 
            total_rooms, 
            live_rooms, 
            total_listeners 
        };
        let _ = self.system_tx.send(event);
    }

    /// Broadcast maintenance message
    pub fn broadcast_maintenance(&self, message: String) {
        let event = BroadcastEvent::ServerMaintenance { message };
        let _ = self.system_tx.send(event.clone());
        let _ = self.lobby_tx.send(event);
    }

    /// Broadcast transport connection
    pub fn broadcast_transport_connected(&self, room_id: Uuid, transport_type: String) {
        let event = BroadcastEvent::TransportConnected { room_id, transport_type };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event);
        }
    }

    /// Broadcast transport disconnection
    pub fn broadcast_transport_disconnected(&self, room_id: Uuid, transport_type: String) {
        let event = BroadcastEvent::TransportDisconnected { room_id, transport_type };
        
        if let Some(room_tx) = self.room_channels.get(&room_id) {
            let _ = room_tx.send(event);
        }
    }

    /// Get statistics about the broadcast system
    pub fn get_stats(&self) -> BroadcastStats {
        BroadcastStats {
            lobby_subscribers: self.lobby_tx.receiver_count(),
            room_channels: self.room_channels.len(),
            system_subscribers: self.system_tx.receiver_count(),
            total_room_subscribers: self.room_channels
                .iter()
                .map(|entry| entry.value().receiver_count())
                .sum(),
        }
    }

    /// Clean up empty room channels
    pub fn cleanup_empty_channels(&self) -> usize {
        let mut cleaned = 0;
        
        self.room_channels.retain(|_, tx| {
            if tx.receiver_count() == 0 {
                cleaned += 1;
                false
            } else {
                true
            }
        });
        
        cleaned
    }
}

impl Default for BroadcastManager {
    fn default() -> Self {
        Self::new(BroadcastConfig::default())
    }
}

/// Statistics about the broadcast system
#[derive(Debug, Clone, Serialize)]
pub struct BroadcastStats {
    pub lobby_subscribers: usize,
    pub room_channels: usize,
    pub system_subscribers: usize,
    pub total_room_subscribers: usize,
}

/// Utility to convert BroadcastEvent to legacy BroadcastMessage for compatibility
impl From<BroadcastEvent> for BroadcastMessage {
    fn from(event: BroadcastEvent) -> Self {
        match event {
            BroadcastEvent::RoomCreated { room } => BroadcastMessage::RoomAdded { room },
            BroadcastEvent::RoomUpdated { room } => BroadcastMessage::RoomUpdated { room },
            BroadcastEvent::RoomRemoved { room_id } => BroadcastMessage::RoomRemoved { room_id },
            _ => BroadcastMessage::RoomAdded { 
                room: Room {
                    id: Uuid::new_v4(),
                    name: "Unknown".to_string(),
                    dj_id: "unknown".to_string(),
                    dj_streaming: false,
                    listener_count: 0,
                }
            },
        }
    }
}

/// Stream wrapper for easier integration with async code
pub struct BroadcastEventStream {
    inner: BroadcastStream<BroadcastEvent>,
}

impl BroadcastEventStream {
    pub fn new(receiver: broadcast::Receiver<BroadcastEvent>) -> Self {
        Self {
            inner: BroadcastStream::new(receiver),
        }
    }

    pub async fn next_event(&mut self) -> Option<BroadcastEvent> {
        match self.inner.next().await {
            Some(Ok(event)) => Some(event),
            Some(Err(_)) => None, // Lagged receiver
            None => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    #[tokio::test]
    async fn test_broadcast_manager() {
        let manager = BroadcastManager::new(BroadcastConfig::default());
        let room_id = Uuid::new_v4();
        
        // Subscribe to lobby
        let mut lobby_rx = manager.subscribe_lobby();
        
        // Subscribe to room
        let mut room_rx = manager.subscribe_room(room_id);
        
        // Create a room
        let room = Room {
            id: room_id,
            name: "Test Room".to_string(),
            dj_id: "test_dj".to_string(),
            dj_streaming: false,
            listener_count: 0,
        };
        
        manager.broadcast_room_created(room.clone());
        
        // Should receive in lobby
        let lobby_event = timeout(Duration::from_millis(100), lobby_rx.recv()).await.unwrap().unwrap();
        if let BroadcastEvent::RoomCreated { room: received_room } = lobby_event {
            assert_eq!(received_room.id, room_id);
        } else {
            panic!("Expected RoomCreated event");
        }
        
        // Start streaming
        manager.broadcast_stream_started(room_id, "producer_123".to_string());
        
        // Should receive in room channel
        let room_event = timeout(Duration::from_millis(100), room_rx.recv()).await.unwrap().unwrap();
        if let BroadcastEvent::StreamStarted { room_id: received_id, producer_id } = room_event {
            assert_eq!(received_id, room_id);
            assert_eq!(producer_id, "producer_123");
        } else {
            panic!("Expected StreamStarted event");
        }
    }

    #[tokio::test]
    async fn test_broadcast_stats() {
        let manager = BroadcastManager::new(BroadcastConfig::default());
        let room_id = Uuid::new_v4();
        
        // Initially no subscribers
        let stats = manager.get_stats();
        assert_eq!(stats.lobby_subscribers, 0);
        assert_eq!(stats.room_channels, 0);
        
        // Subscribe to lobby
        let _lobby_rx = manager.subscribe_lobby();
        
        // Subscribe to room
        let _room_rx = manager.subscribe_room(room_id);
        
        let stats = manager.get_stats();
        assert_eq!(stats.lobby_subscribers, 1);
        assert_eq!(stats.room_channels, 1);
        assert_eq!(stats.total_room_subscribers, 1);
    }
}