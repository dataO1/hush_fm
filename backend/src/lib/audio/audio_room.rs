/// Audio room creation with DirectTransport setup
/// 
/// This module handles the creation of a default audio room that uses DirectTransport
/// to inject local audio. It reuses the existing room creation logic and properly
/// integrates with MediaSoup's routing system.

use mediasoup::prelude::*;
use mediasoup::direct_transport::DirectTransportOptions;
use mediasoup::producer::{DirectProducer, ProducerOptions};
use mediasoup_types::rtp_parameters::{RtpHeaderExtension, RtpHeaderExtensionDirection};
use std::num::{NonZeroU32, NonZeroU8};
use std::sync::Arc;
use uuid::Uuid;
use anyhow::{Result, Context};

use crate::lib::config::Config;
use crate::lib::domain::Lobby;
use crate::lib::models::schemas::RoomStatus;

/// Audio bot session ID (fixed, not configurable)
const AUDIO_BOT_SESSION_ID: &str = "audio-bot-session";

/// Create a room with DirectTransport for local audio injection
/// 
/// This function:
/// 1. Creates a room using the existing Lobby::create_room() flow
/// 2. Sets up DirectTransport on the room's router  
/// 3. Creates a DirectProducer with Opus RTP parameters
/// 4. Configures the DJ to use the DirectProducer
/// 5. Sets the room to Live status so it appears publicly
/// 
/// # Arguments
/// * `lobby` - The lobby instance for room management
/// 
/// # Returns
/// * `(Uuid, Arc<Producer>)` - Room ID and Producer for audio injection
pub async fn create_audio_bot_room(lobby: &Lobby) -> Result<(Uuid, Arc<Producer>)> {
    let config = Config::global();

    tracing::info!(
        room_name = %config.audio_bot_room_name(),
        dj_name = %config.audio_bot_dj_name(),
        tags = ?config.audio_bot_tags(),
        "🎵 Creating audio bot room with DirectTransport"
    );

    // Generate room ID
    let room_id = Uuid::new_v4();

    // Create room using existing lobby logic (reuses all the setup code)
    let room = lobby.create_room(
        room_id,
        config.audio_bot_room_name().to_string(),
        config.audio_bot_dj_name().to_string(),
        AUDIO_BOT_SESSION_ID.to_string(),
        Some(config.audio_bot_description().to_string()),
        Some(config.audio_bot_tags().to_vec()),
    ).await.context("Failed to create audio bot room")?;

    // Get the router from the created room
    let router = {
        let room_guard = room.read().await;
        room_guard.router()
            .context("Room was created without router")?
            .clone()
    };

    tracing::info!(
        room_id = %room_id,
        "🎵 Room created, setting up DirectTransport"
    );

    // Create DirectTransport on the router
    let direct_transport = router
        .create_direct_transport(DirectTransportOptions::default())
        .await
        .context("Failed to create DirectTransport")?;

    tracing::info!(
        room_id = %room_id,
        transport_id = %direct_transport.id(),
        "🎵 DirectTransport created, setting up producer"
    );

    // Create DirectProducer with Opus RTP parameters
    let direct_producer = create_opus_producer(&direct_transport).await
        .context("Failed to create Opus producer")?;

    tracing::info!(
        room_id = %room_id,
        "🎵 DirectProducer created, updating room state"
    );

    // Update the DJ to use the DirectProducer and set room to Live
    {
        let mut room_guard = room.write().await;
        
        // Update DJ with the Producer (already in correct enum form)
        if let Some(ref mut dj) = room_guard.dj {
            // Producer is already the correct enum type from create_opus_producer
            dj.producer = Some(Arc::new(direct_producer.clone()));
            dj.producer_id = Some("direct-producer".to_string()); // Use fixed ID for DirectProducer
            dj.is_streaming = true;
            dj.is_paused = false; // Start unpaused
        }

        // Trigger room state transition to Live (makes it publicly visible)
        room_guard.on_producer_ready();
        
        tracing::info!(
            room_id = %room_id,
            room_status = ?room_guard.status,
            is_public = room_guard.is_public(),
            is_streaming = room_guard.is_streaming(),
            "🎵 Audio bot room is now LIVE and publicly visible"
        );
    }

    tracing::info!(
        room_id = %room_id,
        "✅ Audio bot room setup complete"
    );

    Ok((room_id, Arc::new(direct_producer)))
}

/// Create Opus producer with optimal RTP parameters for music streaming
async fn create_opus_producer(direct_transport: &DirectTransport) -> Result<Producer> {
    // Create RTP parameters for Opus codec (matches what DJ flow expects)
    let rtp_parameters = RtpParameters {
        mid: None,
        codecs: vec![
            RtpCodecParameters::Audio {
                mime_type: MimeTypeAudio::Opus,
                payload_type: 100, // Must match RTP packetizer
                clock_rate: NonZeroU32::new(48000).unwrap(), // Opus sample rate
                channels: NonZeroU8::new(2).unwrap(), // Stereo
                parameters: RtpCodecParametersParameters::from([
                    ("stereo".to_string(), "1".into()),           // Enable stereo
                    ("useinbandfec".to_string(), "1".into()),     // Forward Error Correction
                    ("maxplaybackrate".to_string(), "48000".into()), // Max playback rate
                    ("sprop-stereo".to_string(), "1".into()),     // Signal stereo capability
                ]),
                rtcp_feedback: vec![
                    RtcpFeedback::TransportCc, // Transport-wide congestion control
                ],
            }
        ],
        header_extensions: vec![
            // Audio level extension for monitoring
            RtpHeaderExtensionParameters {
                uri: RtpHeaderExtensionUri::AudioLevel,
                id: 1,
                encrypt: false,
            },
            // Transport-wide congestion control  
            RtpHeaderExtensionParameters {
                uri: RtpHeaderExtensionUri::TransportWideCcDraft01,
                id: 5,
                encrypt: false,
            },
        ],
        encodings: vec![
            RtpEncodingParameters {
                ssrc: Some(1111), // Must match RTP packetizer SSRC
                ..RtpEncodingParameters::default()
            }
        ],
        rtcp: RtcpParameters {
            cname: Some("audio-bot".to_string()),
            ..RtcpParameters::default()
        },
    };

    // Create producer options
    let producer_options = ProducerOptions::new(
        MediaKind::Audio,
        rtp_parameters,
    );

    // Create the producer
    let producer = direct_transport
        .produce(producer_options)
        .await
        .context("Failed to create DirectProducer")?;

    tracing::info!(
        producer_type = "DirectProducer", 
        "🎵 Opus producer created with stereo config"
    );

    Ok(producer)
}