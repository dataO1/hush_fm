/// Audio subsystem for local audio capture and DirectTransport injection with lifecycle management
/// 
/// This module provides audio bot functionality with hot-plug support that captures audio 
/// from USB interfaces and injects it into a MediaSoup room using DirectTransport.
/// 
/// Architecture:
/// - Device monitor polls for USB audio devices (2s interval)
/// - Lifecycle manager handles device connection/disconnection events
/// - High-priority audio thread (CPAL) pushes PCM to lock-free ring buffer
/// - Async encoder task pulls from buffer, encodes to Opus, and sends via DirectProducer  
/// - AudioBot orchestrates the entire lifecycle with automatic error recovery

mod audio_bot;
mod audio_capture;
mod audio_room;
mod encoder;
mod rtp_packetizer;
mod audio_device_monitor;
mod audio_lifecycle;

pub use audio_bot::AudioBot;

use crate::lib::domain::Lobby;
use anyhow::Result;

/// Main entry point to start an audio bot with lifecycle management
/// 
/// This creates:
/// 1. A persistent room in the lobby using existing room creation logic
/// 2. DirectTransport and DirectProducer for local audio injection
/// 3. AudioBot with lifecycle manager for device hot-plug support
/// 4. Automatic error recovery and device reconnection
/// 
/// The room will always be available in the lobby for clients to connect.
/// Audio streaming starts automatically when USB devices are available.
/// The system handles device disconnection/reconnection gracefully.
pub async fn start_audio_bot_room(lobby: &Lobby) -> Result<AudioBot> {
    tracing::info!("🎵 Starting audio bot with default room");
    
    // Create the audio bot (this handles room creation and audio pipeline setup)
    let audio_bot = AudioBot::new(lobby).await?;
    
    tracing::info!("✅ Audio bot started successfully");
    Ok(audio_bot)
}