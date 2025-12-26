/// AudioBot orchestrator with lifecycle management
/// 
/// This is the main coordinator that manages the entire audio bot lifecycle:
/// - Audio capture from default device
/// - Room creation with DirectTransport 
/// - Encoder pipeline coordination
/// - Graceful shutdown handling

use std::sync::Arc;
use uuid::Uuid;
use anyhow::{Result, Context};
use tokio::task::JoinHandle;

use crate::lib::domain::Lobby;
use crate::lib::audio::{
    audio_capture::AudioCapture,
    audio_room::create_audio_bot_room,
    encoder::AudioEncoder,
};

/// AudioBot manages the complete audio streaming pipeline
pub struct AudioBot {
    /// Room ID of the created audio bot room
    pub room_id: Uuid,
    /// Audio capture system (keeping this alive maintains audio input)
    _audio_capture: AudioCapture,
    /// Encoder task handle (keeping this alive maintains the encoding pipeline)  
    _encoder_task: JoinHandle<()>,
    /// Shutdown signal sender
    shutdown_tx: tokio::sync::mpsc::Sender<()>,
}

impl AudioBot {
    /// Create and start a new AudioBot with complete audio pipeline
    /// 
    /// This creates:
    /// 1. Audio capture from default input device
    /// 2. Room with DirectTransport producer
    /// 3. Encoder task that bridges capture -> RTP -> DirectProducer
    /// 4. Proper lifecycle management for graceful shutdown
    /// 
    /// # Arguments
    /// * `lobby` - Lobby instance for room management
    /// 
    /// # Returns
    /// * `AudioBot` - Running audio bot instance
    pub async fn new(lobby: &Lobby) -> Result<Self> {
        tracing::info!("🎵 Starting AudioBot initialization");

        // Step 1: Initialize audio capture and get ring buffer consumer
        let (audio_capture, ring_consumer) = AudioCapture::new()
            .context("Failed to initialize audio capture")?;

        // Step 2: Create room with DirectTransport
        let (room_id, direct_producer) = create_audio_bot_room(lobby).await
            .context("Failed to create audio bot room")?;

        // Step 3: Create shutdown coordination
        let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel(1);

        // Step 4: Start encoder pipeline
        let encoder = AudioEncoder::new(
            direct_producer,
            ring_consumer,
            shutdown_rx,
        ).context("Failed to create audio encoder")?;

        // Spawn encoder task
        let encoder_task = tokio::spawn(async move {
            encoder.run().await;
        });

        tracing::info!(
            room_id = %room_id,
            "✅ AudioBot initialization complete - audio pipeline active"
        );

        Ok(Self {
            room_id,
            _audio_capture: audio_capture,
            _encoder_task: encoder_task,
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
    /// 1. Audio encoder task via shutdown signal
    /// 2. Audio capture (automatically when AudioCapture is dropped)
    /// 
    /// Note: The room remains in the lobby for any connected listeners
    pub async fn shutdown(self) -> Result<()> {
        tracing::info!(
            room_id = %self.room_id,
            "🛑 Shutting down AudioBot"
        );

        // Send shutdown signal to encoder task
        if let Err(_) = self.shutdown_tx.send(()).await {
            tracing::warn!("Encoder task may have already stopped");
        }

        tracing::info!(
            room_id = %self.room_id,
            "✅ AudioBot shutdown complete"
        );

        Ok(())
    }
}

impl Drop for AudioBot {
    /// Ensure graceful shutdown on drop
    fn drop(&mut self) {
        tracing::info!(
            room_id = %self.room_id,
            "🧹 AudioBot dropped - cleaning up resources"
        );

        // Send shutdown signal if still available
        if let Ok(_) = self.shutdown_tx.try_send(()) {
            tracing::debug!("Sent shutdown signal to encoder task");
        }
        
        // Audio capture and encoder task will be cleaned up automatically
        // when their respective structs are dropped
    }
}