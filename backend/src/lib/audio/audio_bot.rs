/// AudioBot orchestrator with lifecycle management
/// 
/// This is the main coordinator that manages the entire audio bot lifecycle:
/// - Room creation with DirectTransport (persistent)
/// - Device hot-plug monitoring
/// - Audio capture lifecycle management
/// - Graceful error recovery and restart
/// - Encoder pipeline coordination

use std::sync::Arc;
use uuid::Uuid;
use anyhow::{Result, Context};
use tokio::task::JoinHandle;

use crate::lib::domain::Lobby;
use crate::lib::audio::{
    audio_room::create_audio_bot_room,
    audio_lifecycle::AudioLifecycleManager,
};

/// AudioBot manages the complete audio streaming pipeline with lifecycle management
pub struct AudioBot {
    /// Room ID of the created audio bot room (persistent)
    pub room_id: Uuid,
    /// Lifecycle manager task handle
    lifecycle_handle: JoinHandle<Result<()>>,
    /// Shutdown signal for lifecycle manager
    shutdown_tx: tokio::sync::mpsc::Sender<()>,
}

impl AudioBot {
    /// Create and start a new AudioBot with lifecycle management
    /// 
    /// This creates:
    /// 1. Room with DirectTransport producer (persistent)
    /// 2. Lifecycle manager for device monitoring and hot-plug support
    /// 3. Automatic error recovery and device reconnection
    /// 4. Graceful shutdown coordination
    /// 
    /// The room remains available even when no audio device is connected.
    /// Audio streaming resumes automatically when a USB device is connected.
    /// 
    /// # Arguments
    /// * `lobby` - Lobby instance for room management
    /// 
    /// # Returns
    /// * `AudioBot` - Running audio bot instance with lifecycle management
    pub async fn new(lobby: &Lobby) -> Result<Self> {
        tracing::info!("🎵 Starting AudioBot with lifecycle management");

        // Step 1: Create persistent room with DirectTransport
        let (room_id, direct_producer) = create_audio_bot_room(lobby).await
            .context("Failed to create audio bot room")?;

        tracing::info!(
            room_id = %room_id,
            "✅ Audio bot room created - starting lifecycle management"
        );

        // Step 2: Create lifecycle manager
        let lifecycle_manager = AudioLifecycleManager::new(room_id, direct_producer);

        // Step 3: Start lifecycle management task
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel(1);
        let lifecycle_handle = tokio::spawn(async move {
            tokio::select! {
                result = lifecycle_manager.run() => {
                    tracing::info!("🔄 Lifecycle manager completed: {:?}", result);
                    result
                }
                _ = shutdown_rx.recv() => {
                    tracing::info!("🛑 Lifecycle manager shutdown requested");
                    Ok(())
                }
            }
        });

        tracing::info!(
            room_id = %room_id,
            "✅ AudioBot lifecycle management started"
        );

        Ok(Self {
            room_id,
            lifecycle_handle,
            shutdown_tx,
        })
    }

    /// Get the room ID of the audio bot room
    pub fn room_id(&self) -> Uuid {
        self.room_id
    }

    /// Gracefully shutdown the audio bot
    /// 
    /// This stops:
    /// 1. Lifecycle manager task
    /// 2. Audio capture and encoder (via lifecycle manager)
    /// 3. Device monitoring
    /// 
    /// Note: The room remains in the lobby for any connected listeners
    pub async fn shutdown(mut self) -> Result<()> {
        tracing::info!(
            room_id = %self.room_id,
            "🛑 Shutting down AudioBot lifecycle management"
        );

        // Send shutdown signal to lifecycle manager
        if let Err(_) = self.shutdown_tx.send(()).await {
            tracing::warn!("Lifecycle manager task may have already stopped");
        }

        // Take ownership of the handle to avoid Drop trait conflict
        let lifecycle_handle = std::mem::replace(&mut self.lifecycle_handle, 
            tokio::spawn(async { Ok(()) }));

        // Wait for lifecycle manager to complete (with timeout)
        match tokio::time::timeout(
            std::time::Duration::from_secs(5),
            lifecycle_handle
        ).await {
            Ok(Ok(Ok(()))) => {
                tracing::info!(
                    room_id = %self.room_id,
                    "✅ AudioBot shutdown complete"
                );
            },
            Ok(Ok(Err(e))) => {
                tracing::warn!(
                    room_id = %self.room_id,
                    error = %e,
                    "⚠️ AudioBot shutdown with lifecycle error"
                );
            },
            Ok(Err(join_error)) => {
                tracing::warn!(
                    room_id = %self.room_id,
                    error = %join_error,
                    "⚠️ AudioBot lifecycle task panicked"
                );
            },
            Err(_) => {
                tracing::warn!(
                    room_id = %self.room_id,
                    "⚠️ AudioBot shutdown timeout - lifecycle manager may still be running"
                );
            }
        }

        Ok(())
    }
}

impl Drop for AudioBot {
    /// Ensure graceful shutdown on drop
    fn drop(&mut self) {
        tracing::info!(
            room_id = %self.room_id,
            "🧹 AudioBot dropped - cleaning up lifecycle management"
        );

        // Send shutdown signal if still available
        if let Ok(_) = self.shutdown_tx.try_send(()) {
            tracing::debug!("Sent shutdown signal to lifecycle manager");
        }
        
        // Abort the lifecycle task if needed
        self.lifecycle_handle.abort();
    }
}