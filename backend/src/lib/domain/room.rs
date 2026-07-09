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
        session_id: String,
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
            dj: Some(DJ::new(session_id, dj_name, id, None)), // Create DJ with session ID and display name during room init
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
    pub fn add_listener(&mut self, listener_state: Listener) {
        let listener_id = listener_state.listener_id.clone();
        self.listeners.insert(listener_id.clone(), listener_state);
        
        // Update listener count
        self.listener_count = self.get_listener_count() as u32;
        self.update_activity();
        
        tracing::info!(
            room_id = %self.id,
            listener_id = %listener_id,
            new_listener_count = self.listener_count,
            "Listener added to room successfully"
        );

        // Broadcast listener count update to all listeners
        let listener_update = crate::lib::models::ListenerEvent::ListenerCountUpdated {
            room_id: self.id.to_string(),
            count: self.listener_count,
        };
        self.broadcast_to_listeners(listener_update);
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

    /// Remove a specific listener from the room with proper MediaSoup cleanup
    #[tracing::instrument(skip(self), fields(room_id = %self.id, listener_id = %listener_id))]
    pub async fn remove_listener(&mut self, listener_id: &str) -> anyhow::Result<()> {
        tracing::info!(
            room_id = %self.id,
            listener_id = %listener_id,
            "Removing listener from room"
        );

        // Remove listener from the room and get mutable reference for cleanup
        if let Some((_, mut listener_state)) = self.listeners.remove(listener_id) {
            // Perform proper MediaSoup cleanup on the listener
            if let Err(e) = listener_state.cleanup().await {
                tracing::warn!(
                    room_id = %self.id,
                    listener_id = %listener_id,
                    error = %e,
                    "Failed to clean up listener resources, continuing with removal"
                );
            }

            // Update listener count
            self.listener_count = self.listener_count.saturating_sub(1);
            self.update_activity();

            tracing::info!(
                room_id = %self.id,
                listener_id = %listener_id,
                new_listener_count = self.listener_count,
                "Listener removed from room successfully"
            );

            // Broadcast listener count update to remaining listeners
            let listener_update = crate::lib::models::ListenerEvent::ListenerCountUpdated {
                room_id: self.id.to_string(),
                count: self.listener_count,
            };
            self.broadcast_to_listeners(listener_update);

            Ok(())
        } else {
            tracing::warn!(
                room_id = %self.id,
                listener_id = %listener_id,
                "Attempted to remove listener that doesn't exist in room"
            );
            Err(anyhow::anyhow!("Listener {} not found in room {}", listener_id, self.id))
        }
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

    /// Abstract coordination: Create DJ producer (Step 15)
    ///
    /// Re-publish detection: when the DJ re-runs the publish flow (page
    /// reload, reconnect-then-Go-Live), the new producer REPLACES the old one
    /// — dropping the old `Arc<Producer>` closes it in mediasoup, which kills
    /// every existing listener's consumer server-side WITHOUT any client
    /// signal (their transports stay ICE/DTLS-connected, so client-side
    /// recovery sees "healthy" and never re-joins → permanent silence).
    /// Broadcast `ProducerChanged` to all listeners so they force a full
    /// re-join against the new producer. Uses the same per-listener event
    /// channel fan-out as StreamPaused/RoomClosed (socket tasks own the
    /// actual WS sends, including backpressure handling).
    pub async fn create_producer(&mut self, rtp_parameters: RtpParameters) -> Result<String> {
        if let Some(ref mut dj) = self.dj {
            // Detect replacement on the raw producer slot (NOT has_producer(),
            // which also requires is_streaming — the slot alone decides whether
            // an old producer is about to be dropped/closed).
            let replacing_existing_producer = dj.producer.is_some();

            let producer_id = dj.create_producer(rtp_parameters).await?;

            // Step 16: Mark room as public after producer is ready
            self.on_producer_ready();

            if replacing_existing_producer {
                tracing::info!(
                    room_id = %self.id,
                    new_producer_id = %producer_id,
                    listener_count = self.listener_count,
                    "Producer REPLACED on DJ re-publish - broadcasting ProducerChanged so listeners re-join"
                );
                self.broadcast_to_listeners(crate::lib::models::ListenerEvent::ProducerChanged {
                    room_id: self.id.to_string(),
                    producer_id: producer_id.clone(),
                });
            }

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
        event_tx: tokio::sync::mpsc::UnboundedSender<crate::lib::models::ListenerEvent>,
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
        
        let transport_options = listener.get_receiver_transport(router).await?;

        tracing::info!("Listener transport initialized for room {}, listener {}", self.id, listener_id);
        Ok((listener, transport_options))
    }

    /// Abstract coordination: Initialize transport for existing listener (Step 2 of new flow)
    /// Handles both new transport creation and transport reuse for reconnection
    pub async fn init_listener_transport(&mut self, session_id: &str) -> Result<TransportOptions> {
        let router = self.router.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No router available for room"))?;

        // Modify listener in place without temporary extraction
        match self.listeners.get_mut(session_id) {
            Some(mut listener_ref) => {
                let listener = listener_ref.value_mut();
                
                // Get or create transport (handles reuse automatically)
                match listener.get_receiver_transport(router).await {
                    Ok(transport_options) => {
                        tracing::info!("Transport initialized for existing listener {} in room {}", session_id, self.id);
                        Ok(transport_options)
                    }
                    Err(e) => {
                        Err(e)
                    }
                }
            }
            None => {
                Err(anyhow::anyhow!("Listener {} not found in room", session_id))
            }
        }
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
        // Use the proper cleanup method that handles MediaSoup resources
        self.remove_listener(listener_id).await?;
        tracing::info!("Listener {} left room {}", listener_id, self.id);
        Ok(())
    }

    /// Handle listener WebSocket connection (reconnection or fresh join).
    /// Rebinds the event channel, cancels any pending disconnect-cleanup timer,
    /// and bumps the listener's connection epoch. Returns the epoch assigned to
    /// this connection so the caller can arm a matching reap timer on close.
    pub async fn handle_listener_connection(
        &self,
        session_id: &str,
        event_tx: tokio::sync::mpsc::UnboundedSender<crate::lib::models::ListenerEvent>
    ) -> Result<u64> {
        // Check if listener already exists (reconnection scenario)
        if let Some(listener_ref) = self.get_listener(session_id) {
            // Update the event channel for the existing listener
            drop(listener_ref); // Release the reference before calling update_listener

            let mut assigned_epoch: u64 = 0;
            let update_success = self.update_listener(session_id, |listener| {
                listener.event_tx = event_tx;
                // Bump the connection epoch so any reap timer armed by a previous
                // socket is invalidated, then cancel a currently-pending timer.
                listener.connection_epoch = listener.connection_epoch.wrapping_add(1);
                assigned_epoch = listener.connection_epoch;
                listener.cancel_disconnect_cleanup_timer(); // Cancel cleanup timer on reconnection
            });

            if update_success {
                tracing::info!(
                    session_id = %session_id,
                    room_id = %self.id,
                    connection_epoch = assigned_epoch,
                    "Updated existing listener's event channel for (re)connection"
                );
                Ok(assigned_epoch)
            } else {
                Err(anyhow::anyhow!("Failed to update listener event channel"))
            }
        } else {
            // Listener doesn't exist - this should have been created by lobby RequestJoin flow
            tracing::warn!(
                session_id = %session_id,
                room_id = %self.id,
                "Listener not found - should have been created by lobby RequestJoin flow"
            );
            Err(anyhow::anyhow!("Listener not found - invalid connection attempt"))
        }
    }

    /// Handle a DJ room-socket (re)connection. Mirrors handle_listener_connection:
    /// bumps the DJ connection epoch (invalidating any disconnect-grace timer
    /// armed by an older socket), cancels a pending timer, and reports whether
    /// the stream was paused by a previous disconnect so the caller can resume
    /// it. Returns (epoch assigned to this connection, should_resume), or None
    /// if the room has no DJ.
    pub fn handle_dj_connection(&mut self) -> Option<(u64, bool)> {
        let dj = self.dj.as_mut()?;
        dj.connection_epoch = dj.connection_epoch.wrapping_add(1);
        let epoch = dj.connection_epoch;
        let should_resume = dj.paused_by_disconnect;
        dj.paused_by_disconnect = false;
        dj.cancel_disconnect_close_timer();

        tracing::info!(
            room_id = %self.id,
            dj_id = %dj.dj_id,
            connection_epoch = epoch,
            resume_after_reconnect = should_resume,
            "DJ room-socket (re)connection registered"
        );

        self.update_activity();
        Some((epoch, should_resume))
    }

    /// Handle a DJ room-socket disconnect (X7: pause-then-close).
    /// If `disconnected_epoch` is stale (a newer socket already took over) this
    /// is a no-op. Otherwise: pause the producer if it was streaming, notify
    /// listeners (StreamPaused), and arm the disconnect-grace timer that closes
    /// the room via lobby.close_room on expiry.
    /// Returns Ok(true) if the stream was paused by this call (caller should
    /// broadcast the room update to the lobby).
    pub async fn handle_dj_disconnect(
        &mut self,
        lobby: crate::lib::domain::Lobby,
        disconnected_epoch: u64,
        grace: std::time::Duration,
    ) -> Result<bool> {
        let room_id = self.id;
        let was_streaming;
        {
            let Some(dj) = self.dj.as_mut() else {
                return Ok(false); // room being torn down, nothing to do
            };
            if dj.connection_epoch != disconnected_epoch {
                tracing::debug!(
                    room_id = %room_id,
                    stale_epoch = disconnected_epoch,
                    current_epoch = dj.connection_epoch,
                    "Stale DJ socket disconnect ignored - a newer DJ connection exists"
                );
                return Ok(false);
            }

            was_streaming = dj.has_producer() && !dj.is_producer_paused();
            if was_streaming {
                dj.pause().await?; // mediasoup producer.pause()
                dj.paused_by_disconnect = true;
            }

            // Arm the grace timer regardless of streaming state: a vanished DJ
            // in a setup/paused room must not leak the room forever either.
            dj.start_disconnect_close_timer(room_id, lobby, grace, disconnected_epoch);
        }

        if was_streaming {
            self.pause(); // Live -> Paused (room stays public/listed as paused)
            self.sync_streaming_state();
            self.broadcast_to_listeners(crate::lib::models::ListenerEvent::StreamPaused {
                room_id: room_id.to_string(),
            });
            tracing::info!(
                room_id = %room_id,
                listener_count = self.listener_count,
                "DJ vanished - stream paused and listeners notified (StreamPaused)"
            );
        }

        self.update_activity();
        Ok(was_streaming)
    }

    /// N1: Handle the audio-bot line-in device being LOST (unplugged mid-set).
    ///
    /// The audio bot has no DJ WebSocket, so it never travels the
    /// `handle_dj_disconnect` path. When the device-state-machine enters
    /// `WaitingForDevice`/`DeviceError` the encoder task dies and no frames
    /// reach the DirectProducer — but the room would otherwise stay Live with
    /// an unpaused producer, so every listener hears dead silence with no UI
    /// signal. This mirrors `handle_dj_disconnect`'s pause+broadcast (minus the
    /// grace/close timer — decision 1a: a line-in rig between sets keeps its
    /// room indefinitely).
    ///
    /// Transition-guarded on `Live -> Paused`: flapping (repeatedly entering
    /// `WaitingForDevice`) is a no-op after the first pause, so `StreamPaused`
    /// is never spammed and the producer is never double-paused.
    ///
    /// Returns Ok(true) if this call performed the Live->Paused pause (caller
    /// should broadcast the room update to the lobby).
    pub async fn handle_audio_bot_device_loss(&mut self) -> Result<bool> {
        let room_id = self.id;

        // Guard: only act on the Live -> Paused transition. If already Paused
        // (device still gone / flapping) or not yet Live, do nothing.
        if !matches!(self.status, RoomStatus::Live) {
            return Ok(false);
        }

        {
            let Some(dj) = self.dj.as_mut() else {
                return Ok(false); // no producer to pause
            };
            if !(dj.has_producer() && !dj.is_producer_paused()) {
                return Ok(false);
            }
            dj.pause().await?; // mediasoup producer.pause()
        }

        self.pause(); // Live -> Paused (room stays public/listed as paused)
        self.sync_streaming_state();
        self.broadcast_to_listeners(crate::lib::models::ListenerEvent::StreamPaused {
            room_id: room_id.to_string(),
        });
        tracing::info!(
            room_id = %room_id,
            listener_count = self.listener_count,
            "🔌 Audio-bot device lost - producer paused, listeners notified (StreamPaused)"
        );

        self.update_activity();
        Ok(true)
    }

    /// N1: Handle the audio-bot line-in device RETURNING (re-plugged, capture
    /// resumed). Resumes the DirectProducer, flips the room back to Live and
    /// notifies listeners (StreamResumed) so audio + UI recover automatically.
    ///
    /// Transition-guarded on `Paused -> Live`: only acts when the room was
    /// paused (by a prior device loss) and a producer exists, so a resume is
    /// never emitted for a room that is already Live.
    ///
    /// Returns Ok(true) if this call performed the Paused->Live resume (caller
    /// should broadcast the room update to the lobby).
    pub async fn handle_audio_bot_device_return(&mut self) -> Result<bool> {
        let room_id = self.id;

        // Guard: only act on the Paused -> Live transition.
        if !matches!(self.status, RoomStatus::Paused) {
            return Ok(false);
        }

        {
            let Some(dj) = self.dj.as_mut() else {
                return Ok(false);
            };
            if !dj.has_producer() {
                return Ok(false);
            }
            dj.resume().await?; // mediasoup producer.resume()
        }

        self.resume(); // Paused -> Live
        self.sync_streaming_state();
        self.broadcast_to_listeners(crate::lib::models::ListenerEvent::StreamResumed {
            room_id: room_id.to_string(),
        });
        tracing::info!(
            room_id = %room_id,
            listener_count = self.listener_count,
            "🔌 Audio-bot device returned - producer resumed, listeners notified (StreamResumed)"
        );

        self.update_activity();
        Ok(true)
    }

    /// Comprehensive room closure with graceful listener cleanup
    /// Handles DJ stopping stream, ejecting all listeners, and cleaning up resources
    pub async fn close_room(&mut self) -> Result<()> {
        tracing::info!("Starting room closure for room {}", self.id);

        // Step 1: Send pause event to all listeners first to prevent audio interruption
        let pause_event = crate::lib::models::ListenerEvent::StreamPaused {
            room_id: self.id.to_string(),
        };
        self.broadcast_to_listeners(pause_event);
        tracing::info!("Sent pause event to {} listeners before room closure", self.listeners.len());

        // Step 2: Gracefully eject all listeners with proper cleanup
        let listener_ids: Vec<String> = self.listeners.iter()
            .map(|entry| entry.key().clone())
            .collect();

        tracing::info!("Ejecting {} listeners from room {}", listener_ids.len(), self.id);
        
        for listener_id in listener_ids {
            // Send room closed notification to listener before removing
            if let Some(listener) = self.listeners.get(&listener_id) {
                let close_event = crate::lib::models::ListenerEvent::RoomClosed {
                    room_id: self.id.to_string(),
                    reason: "Room closed by DJ".to_string(),
                };

                if let Err(e) = listener.event_tx.send(close_event) {
                    tracing::warn!("Failed to send room closed notification to listener {}: {}", listener_id, e);
                }
            }

            // Use existing remove_listener method which already handles cleanup
            if let Err(e) = self.remove_listener(&listener_id).await {
                tracing::warn!("Failed to eject listener {} during room closure: {}", listener_id, e);
                // Continue with other listeners even if one fails
            }
        }

        // Step 3: Clean up DJ resources with proper tracking
        if let Some(mut dj) = self.dj.take() {
            if let Err(e) = dj.cleanup().await {
                tracing::warn!("Failed to clean up DJ resources during room closure: {}", e);
            }
        }

        // Step 4: Mark room as closed
        self.status = RoomStatus::Closed;
        self.update_activity();

        tracing::info!("Room {} closure completed successfully", self.id);
        Ok(())
    }


    /// Get router RTP capabilities for client device initialization (native MediaSoup type)
    pub fn get_router_rtp_capabilities(&self) -> Result<RtpCapabilitiesFinalized> {
        let router = self.router.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No router available for room"))?;
        
        Ok(router.rtp_capabilities())
    }
}