/// Audio subsystem for local audio capture and DirectTransport injection
/// 
/// This module provides audio bot functionality that captures audio from the default
/// audio interface and injects it into a MediaSoup room using DirectTransport.
/// 
/// Architecture:
/// - High-priority audio thread (CPAL) pushes PCM to lock-free ring buffer
/// - Async encoder task pulls from buffer, encodes to Opus, and sends via DirectProducer
/// - AudioBot orchestrates the entire lifecycle and integrates with room management

mod audio_bot;
mod audio_capture;
mod audio_room;
mod encoder;
mod rtp_packetizer;

pub use audio_bot::AudioBot;

use crate::lib::domain::Lobby;
use anyhow::Result;

/// Main entry point to start an audio bot with a default room
/// 
/// This creates:
/// 1. A default room in the lobby using existing room creation logic
/// 2. DirectTransport and DirectProducer for local audio injection
/// 3. AudioBot orchestrator that manages the audio pipeline lifecycle
/// 
/// The room will appear in the lobby like any other room and clients can connect
/// using the existing WebSocket API without any changes.
pub async fn start_audio_bot_room(lobby: &Lobby) -> Result<AudioBot> {
    tracing::info!("🎵 Starting audio bot with default room");
    
    // Create the audio bot (this handles room creation and audio pipeline setup)
    let audio_bot = AudioBot::new(lobby).await?;
    
    tracing::info!("✅ Audio bot started successfully");
    Ok(audio_bot)
}