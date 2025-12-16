/// Centralized Room Management with Abstract Coordination
/// 
/// This module contains room coordination logic that delegates to DJ and Listener
/// for business logic operations, following the reference implementation flow.

use crate::lib::models::schemas::{Room, RoomStatus, TransportOptions, ConsumerParameters};
use mediasoup::prelude::*;
use std::sync::Arc;
use anyhow::Result;
use crate::lib::domain::{DJ, Listener};

impl Room {
    /// Initialize a new room in setup state (Step 1 of DJ flow)
    /// Creates room with worker and router but not public yet
    pub async fn init(
        id: uuid::Uuid, 
        name: String, 
        dj_name: String, 
        description: Option<String>, 
        tags: Option<Vec<String>>,
        worker: &Arc<Worker>,
    ) -> Result<Self> {
        let now = chrono::Utc::now();
        
        // Create MediaSoup router with codecs (Step 1 requirement)
        let router = worker
            .create_router(mediasoup::router::RouterOptions::new(Self::get_media_codecs()))
            .await?;
        
        Ok(Self {
            // API fields (serialized)
            id,
            name,
            listener_count: 0,
            dj_streaming: false,
            created_at: now,
            description,
            tags: tags.unwrap_or_default(),
            last_activity: now,
            
            // WebRTC Infrastructure (not serialized)
            router: Some(Arc::new(router)),
            dj: Some(DJ::new(dj_name, id, None)), // Create DJ with name during room init
            listeners: Arc::new(dashmap::DashMap::new()),
            status: RoomStatus::Setup,
            last_activity_atomic: Arc::new(arc_swap::ArcSwap::new(Arc::new(now))),
        })
    }
    
    /// Get the router for this room (needed for Step 2)
    pub fn router(&self) -> Option<&Arc<mediasoup::prelude::Router>> {
        self.router.as_ref()
    }
    
    /// Update activity timestamp
    pub fn update_activity(&self) {
        let now = chrono::Utc::now();
        self.last_activity_atomic.store(Arc::new(now));
    }
    
    /// Check if room should be visible to public
    pub fn is_public(&self) -> bool {
        matches!(self.status, RoomStatus::Live | RoomStatus::Paused)
            && self.router.is_some()
            && self.dj.as_ref().map_or(false, |dj| dj.has_producer())
    }
    
    /// Check if producer is currently paused (MediaSoup state as single source of truth)
    pub fn is_producer_paused(&self) -> bool {
        self.dj.as_ref().map_or(true, |dj| dj.is_producer_paused())
    }
    
    /// Check if room is currently streaming (has producer and not paused)
    pub fn is_streaming(&self) -> bool {
        self.dj.as_ref().map_or(false, |dj| dj.has_producer() && !dj.is_producer_paused())
    }
    
    /// Sync the room's dj_streaming field with the actual producer state
    pub fn sync_streaming_state(&mut self) {
        self.dj_streaming = self.is_streaming();
    }
    
    /// Pause the room (keep connections, stop streaming)
    pub fn pause(&mut self) {
        if matches!(self.status, RoomStatus::Live) {
            self.status = RoomStatus::Paused;
            self.update_activity();
        }
    }

    /// Resume the room
    pub fn resume(&mut self) {
        if matches!(self.status, RoomStatus::Paused) && self.dj.as_ref().map_or(false, |dj| dj.has_producer()) {
            self.status = RoomStatus::Live;
            self.update_activity();
        }
    }

    /// Start closing the room
    pub fn start_closing(&mut self) {
        self.status = RoomStatus::Closing;
        self.update_activity();
    }

    /// Add complete listener state
    pub fn add_listener(&self, listener_state: Listener) {
        let listener_id = listener_state.listener_id.clone();
        self.listeners.insert(listener_id, listener_state);
        self.update_activity();
    }

    /// Get listener state
    pub fn get_listener(&self, listener_id: &str) -> Option<dashmap::mapref::one::Ref<'_, String, Listener>> {
        self.listeners.get(listener_id)
    }

    /// Update listener state
    pub fn update_listener<F>(&self, listener_id: &str, update_fn: F) -> bool 
    where 
        F: FnOnce(&mut Listener)
    {
        if let Some(mut entry) = self.listeners.get_mut(listener_id) {
            update_fn(entry.value_mut());
            self.update_activity();
            true
        } else {
            false
        }
    }

    /// Remove listener completely
    pub fn remove_listener(&self, listener_id: &str) -> Option<Listener> {
        let listener = self.listeners.remove(listener_id).map(|(_, state)| state);
        if listener.is_some() {
            self.update_activity();
        }
        listener
    }

    /// Get all listener IDs
    pub fn get_listener_ids(&self) -> Vec<String> {
        self.listeners.iter().map(|entry| entry.key().clone()).collect()
    }

    /// Get number of active listeners
    pub fn get_listener_count(&self) -> usize {
        self.listeners.len()
    }

    /// Update room listener count from actual consumers
    pub fn update_listener_count(&mut self) {
        self.listener_count = self.get_listener_count() as u32;
    }

    /// Get time since last activity
    pub fn idle_duration(&self) -> chrono::Duration {
        let last_activity = **self.last_activity_atomic.load();
        chrono::Utc::now() - last_activity
    }

    /// Broadcast event to all listeners in this room
    pub fn broadcast_to_listeners(&self, event: crate::lib::models::ListenerEvent) {
        let mut successful_sends = 0;
        let mut failed_sends = 0;
        
        for listener_entry in self.listeners.iter() {
            let listener_state = listener_entry.value();
            match listener_state.event_tx.send(event.clone()) {
                Ok(()) => successful_sends += 1,
                Err(_) => {
                    failed_sends += 1;
                    tracing::warn!(
                        listener_id = %listener_state.listener_id,
                        room_id = %self.id,
                        "Failed to send event to listener, channel may be closed"
                    );
                }
            }
        }
        
        tracing::debug!(
            room_id = %self.id,
            event_type = event.event_type(),
            successful_sends = successful_sends,
            failed_sends = failed_sends,
            total_listeners = self.listeners.len(),
            "Broadcasted event to room listeners"
        );
    }
    
    /// Get the transport ID if DJ transport exists
    pub fn get_dj_transport_id(&self) -> Option<String> {
        self.dj.as_ref()
            .and_then(|dj| dj.transport.as_ref())
            .map(|transport| transport.id().to_string())
    }
    
    /// Set DJ state
    pub fn set_dj(&mut self, dj_state: DJ) {
        self.dj = Some(dj_state);
        self.update_activity();
    }
    
    
    /// Transition to live when DJ has producer ready (Step 16)
    #[tracing::instrument(skip(self), fields(
        room_id = %self.id,
        status_before = ?self.status,
        has_router = self.router.is_some(),
        has_dj = self.dj.is_some()
    ))]
    pub fn on_producer_ready(&mut self) {
        let was_public = self.is_public();
        let previous_status = self.status.clone();
        
        // Step 16 room state transition span
        let step16_span = tracing::info_span!(
            "dj_flow_step16_room_transition",
            flow.type = "dj_creation",
            flow.step = 16,
            flow.phase = "initiated",
            room.id = %self.id,
            room.status_before = ?previous_status,
            room.was_public = was_public
        );
        let _step16_guard = step16_span.enter();
        
        // Transition to live if all resources are ready
        if self.router.is_some() && self.dj.as_ref().map_or(false, |dj| dj.has_producer()) {
            self.status = RoomStatus::Live;
            step16_span.record("room.status_after", format!("{:?}", self.status).as_str());
            
            tracing::info!(
                room_id = %self.id,
                previous_status = ?previous_status,
                new_status = ?self.status,
                "Step 16: Room status transitioned to LIVE - producer created and room is now PUBLIC"
            );
        }
        
        let is_public_now = self.is_public();
        let is_streaming = self.is_streaming();
        
        step16_span.record("room.is_public_now", is_public_now);
        step16_span.record("room.is_streaming", is_streaming);
        step16_span.record("flow.phase", "completed");
        
        tracing::info!(
            room_id = %self.id,
            status_after = ?self.status,
            was_public = was_public,
            is_public_now = is_public_now,
            is_streaming = is_streaming,
            producer_paused = self.is_producer_paused(),
            "Step 16: COMPLETED - Room is now publicly visible and ready for listeners to join"
        );
        
        self.update_activity();
    }
    
    /// Get preferred audio codec capabilities for MediaSoup routers
    fn get_media_codecs() -> Vec<RtpCodecCapability> {
        DJ::get_preferred_audio_capabilities()
    }

    // ========================================================================
    // Abstract Coordination Methods (delegate to DJ and Listener)
    // ========================================================================

    /// Abstract coordination: Initialize DJ transport (Step 6)
    pub async fn initialize_dj_transport(&mut self) -> Result<TransportOptions> {
        let router = self.router.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No router available for room"))?;

        // DJ should already exist from room creation
        if let Some(ref mut dj) = self.dj {
            let transport_options = dj.create_sender_transport(router).await?;
            self.update_activity();
            tracing::info!("DJ transport initialized for room {}", self.id);
            Ok(transport_options)
        } else {
            Err(anyhow::anyhow!("No DJ found in room - this should not happen"))
        }
    }

    /// Abstract coordination: Connect DJ transport (Step 12)
    pub async fn connect_dj(&self, dtls_parameters: DtlsParameters) -> Result<String> {
        if let Some(dj) = &self.dj {
            dj.connect_transport(dtls_parameters).await
        } else {
            Err(anyhow::anyhow!("No DJ available for transport connection"))
        }
    }

    /// Abstract coordination: Create DJ producer (Step 15)
    pub async fn create_producer(&mut self, rtp_parameters: RtpParameters) -> Result<String> {
        if let Some(ref mut dj) = self.dj {
            let producer_id = dj.create_producer(rtp_parameters).await?;
            
            // Step 16: Mark room as public after producer is ready
            self.on_producer_ready();
            
            Ok(producer_id)
        } else {
            Err(anyhow::anyhow!("No DJ available for producer creation"))
        }
    }

    /// Abstract coordination: Initialize listener (Step 2)
    pub async fn add_listener_to_room(
        &self,
        listener_id: String,
        device_capabilities: serde_json::Value,
        event_tx: tokio::sync::mpsc::UnboundedSender<crate::lib::models::ListenerEvent>
    ) -> Result<(Listener, TransportOptions)> {
        let router = self.router.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No router available for room"))?;

        // Create new listener and delegate transport creation
        let mut listener = Listener::new(
            listener_id.clone(),
            self.id,
            device_capabilities,
            event_tx,
        );
        
        let transport_options = listener.create_receiver_transport(router).await?;

        tracing::info!("Listener transport initialized for room {}, listener {}", self.id, listener_id);
        Ok((listener, transport_options))
    }

    /// Abstract coordination: Connect listener transport (Step 9)
    pub async fn connect_listener(&self, listener_id: &str, dtls_parameters: DtlsParameters) -> Result<String> {
        let listener_ref = self.get_listener(listener_id)
            .ok_or_else(|| anyhow::anyhow!("Listener not found"))?;

        listener_ref.connect_transport(dtls_parameters).await
    }

    /// Abstract coordination: Create consumer for listener (Step 5)
    pub async fn create_consumer_for_listener(&self, listener_id: &str) -> Result<ConsumerParameters> {
        // Get DJ producer
        let dj = self.dj.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No DJ available for consumer creation"))?;
        
        let producer = dj.producer.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No producer available for consumer creation"))?;

        let router = self.router.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No router available"))?;

        // Get listener and delegate consumer creation
        let mut listener_ref = self.listeners.get_mut(listener_id)
            .ok_or_else(|| anyhow::anyhow!("Listener not found"))?;

        let consumer_params = listener_ref.create_consumer(producer, router).await?;
        
        tracing::info!("Consumer created for listener {} in room {}", listener_id, self.id);
        Ok(consumer_params)
    }

    /// Abstract coordination: Pause DJ streaming
    pub async fn pause_streaming(&mut self) -> Result<()> {
        if let Some(ref mut dj) = self.dj {
            dj.pause().await?;
            self.pause();
            tracing::info!("DJ streaming paused for room {}", self.id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("No DJ available to pause"))
        }
    }

    /// Abstract coordination: Resume DJ streaming  
    pub async fn resume_streaming(&mut self) -> Result<()> {
        if let Some(ref mut dj) = self.dj {
            dj.resume().await?;
            self.resume();
            tracing::info!("DJ streaming resumed for room {}", self.id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("No DJ available to resume"))
        }
    }

    /// Abstract coordination: Stop DJ streaming and close room
    pub async fn stop_streaming(&mut self) -> Result<()> {
        if let Some(ref mut dj) = self.dj {
            dj.stop_streaming().await?;
            self.start_closing();
            tracing::info!("DJ streaming stopped for room {}", self.id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("No DJ available to stop"))
        }
    }

    /// Abstract coordination: Handle listener leaving room
    pub async fn handle_listener_leave(&mut self, listener_id: &str) -> Result<()> {
        if let Some(mut listener) = self.remove_listener(listener_id) {
            // Delegate cleanup to Listener
            listener.stop_consuming().await?;
            self.update_listener_count();
            tracing::info!("Listener {} left room {}", listener_id, self.id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Listener {} not found in room", listener_id))
        }
    }

    /// Get router capabilities for client device initialization
    pub fn get_router_capabilities(&self) -> Result<serde_json::Value> {
        let router = self.router.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No router available for room"))?;
        
        Ok(serde_json::to_value(router.rtp_capabilities())?)
    }
}