/// DJ Business Logic Module
///
/// Handles all DJ-specific WebRTC operations including sender transport creation,
/// producer management, and DJ lifecycle according to the reference implementation.

use mediasoup::prelude::*;
use mediasoup::transport::{TransportTraceEventType, TransportTraceEventData};
use mediasoup_types::data_structures::DtlsRole;
use mediasoup_types::rtp_parameters::{RtpHeaderExtensionDirection, RtpHeaderExtension};
use std::sync::Arc;
use anyhow::Result;
use serde_json::Value;
use uuid::Uuid;
use std::num::NonZero;
use tokio::sync::mpsc;
use crate::lib::models::ListenerEvent;
use crate::lib::models::schemas::TransportOptions;
use crate::lib::config::Config;

/// DJ state containing all WebRTC resources and metadata for audio streaming
#[derive(Debug, Clone)]
pub struct DJ {
    /// DJ identifier (usually their name or session ID)
    pub dj_id: String,
    /// Room this DJ belongs to
    pub room_id: Uuid,
    /// WebRTC sender transport for media streaming
    pub transport: Option<Arc<WebRtcTransport>>,
    /// Audio producer for streaming
    pub producer: Option<Arc<Producer>>,
    /// Producer ID for reference
    pub producer_id: Option<String>,
    /// Whether DJ is currently streaming
    pub is_streaming: bool,
    /// Whether stream is paused (muted)
    pub is_paused: bool,
    /// When DJ connected to the room
    pub connected_at: chrono::DateTime<chrono::Utc>,
    /// Event channel for sending WebSocket events to DJ
    pub event_tx: Option<mpsc::UnboundedSender<ListenerEvent>>,
}

impl DJ {
    /// Create new DJ state with basic information
    pub fn new(
        dj_id: String,
        room_id: Uuid,
        event_tx: Option<mpsc::UnboundedSender<ListenerEvent>>,
    ) -> Self {
        Self {
            dj_id,
            room_id,
            transport: None,
            producer: None,
            producer_id: None,
            is_streaming: false,
            is_paused: false,
            connected_at: chrono::Utc::now(),
            event_tx,
        }
    }

    /// Step 6: Create sender transport for DJ using room's router
    #[tracing::instrument(skip(self, router), fields(dj_id = %self.dj_id, room_id = %self.room_id))]
    pub async fn create_sender_transport(&mut self, router: &Router) -> Result<TransportOptions> {
        let config = Config::global();
        // Use stored configuration - bind to correct interface for environment
        // let bind_ip = if self.announced_ip == "localhost" { "127.0.0.1" } else { "0.0.0.0" };
        // let announced_address = if self.announced_ip == "localhost" {  Some("127.0.0.1".to_string())  } else { Some(self.announced_ip.clone()) };

        // tracing::info!("Creating DJ sender transport with configured settings");
        // tracing::info!("  - Bind IP: {} ({})", bind_ip, if self.announced_ip == "localhost" { "localhost only" } else { "all interfaces" });
        // tracing::info!("  - Announced IP: {} (for ICE candidates)", self.announced_ip);
        // tracing::info!("  - Port range: {:?}", self.port_range);

        // Create transport with configured settings
        let mut listen_infos = WebRtcTransportListenInfos::new(ListenInfo {
            protocol: Protocol::Udp,
            ip: config.mediasoup_listen_ip().parse()?,
            announced_address: Some(config.announced_ip().to_string()),
            expose_internal_ip: config.mediasoup_expose_internal_ip(),
            port: None,
            port_range: Some(config.worker_port_range()),
            flags: None,
            send_buffer_size: None,
            recv_buffer_size: None,
        });

        // Conditionally add TCP fallback if enabled
        if config.mediasoup_enable_tcp() {
            listen_infos = listen_infos
                .insert(ListenInfo {
                    protocol: Protocol::Tcp,
                    ip: config.mediasoup_listen_ip().parse()?,
                    announced_address: Some(config.announced_ip().to_string()),
                    expose_internal_ip: config.mediasoup_expose_internal_ip(),
                    port: None,
                    port_range: Some(config.worker_port_range()),
                    flags: None,
                    send_buffer_size: None,
                    recv_buffer_size: None,
                });
        }
        // if self.announced_ip == "localhost"{
        //     listen_infos = listen_infos
        //     // Add TCP fallback, only for localhost, since this seems to be required!
        //     .insert(ListenInfo {
        //         protocol: Protocol::Tcp,
        //         ip: self.announced_ip.parse()?,
        //         announced_address: None,
        //         expose_internal_ip: false,
        //         port: None,
        //         port_range: Some(self.port_range.clone()),
        //         flags: None,
        //         send_buffer_size: None,
        //         recv_buffer_size: None,
        //     });
        // }

        let mut transport_options = WebRtcTransportOptions::new(listen_infos);

        // Configure UDP/TCP based on configuration
        transport_options.enable_udp = true;
        transport_options.enable_tcp = config.mediasoup_enable_tcp();
        transport_options.prefer_udp = true;
        // transport_options.initial_available_outgoing_bitrate = 600000; // DJ sends audio
        // transport_options.ice_consent_timeout = 30;

        let transport = router.create_webrtc_transport(transport_options).await?;
        let transport_id = transport.id().to_string();

        tracing::info!(
            transport_id = %transport_id,
            dj_id = %self.dj_id,
            ice_role = ?transport.ice_role(),
            ice_state = ?transport.ice_state(),
            dtls_state = ?transport.dtls_state(),
            "DJ sender transport created successfully"
        );

        // Enable transport trace events for debugging ICE/DTLS connectivity
        transport.enable_trace_event(vec![
            TransportTraceEventType::Probation,
            TransportTraceEventType::Bwe
        ]).await?;

        // Add transport event listener for connection monitoring
        let transport_id_for_events = transport_id.clone();
        let dj_id_for_events = self.dj_id.clone();
        let _trace_handler = transport.on_trace(Arc::new(move |trace_event: &TransportTraceEventData| {
            match trace_event {
                TransportTraceEventData::Probation { timestamp, direction, info } => {
                    tracing::info!(
                        transport_id = %transport_id_for_events,
                        dj_id = %dj_id_for_events,
                        event_type = "probation",
                        timestamp = %timestamp,
                        direction = ?direction,
                        "DJ Transport Probation Event: {:?}", info
                    );
                },
                TransportTraceEventData::Bwe { timestamp, direction, info } => {
                    tracing::info!(
                        transport_id = %transport_id_for_events,
                        dj_id = %dj_id_for_events,
                        event_type = "bwe",
                        timestamp = %timestamp,
                        direction = ?direction,
                        "DJ Transport BWE Event: {:?}", info
                    );
                }
            }
        }));

        // Generate transport options for client
        let client_transport_options = self.generate_transport_options(&transport).await?;

        tracing::info!(
            transport_id = %transport.id(),
            dj_id = %self.dj_id,
            room_id = %self.room_id,
            "DJ sender transport created successfully - ready for DTLS connection"
        );

        // Store transport
        self.transport = Some(Arc::new(transport));

        Ok(client_transport_options)
    }

    /// Step 12: Connect DJ transport with DTLS parameters from client
    #[tracing::instrument(skip(self, dtls_parameters), fields(dj_id = %self.dj_id, transport_id))]
    pub async fn connect_transport(&self, dtls_parameters: DtlsParameters) -> Result<String> {
        let transport = self.transport.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No transport available for DJ"))?;

        let transport_id = transport.id().to_string();
        tracing::Span::current().record("transport_id", &transport_id);

        // Force backend to act as server for DTLS handshake
        let original_role = dtls_parameters.role;
        let mut dtls_parameters = dtls_parameters;
        dtls_parameters.role = DtlsRole::Server;

        tracing::info!(
            transport_id = %transport_id,
            dj_id = %self.dj_id,
            original_dtls_role = ?original_role,
            forced_dtls_role = ?dtls_parameters.role,
            "Connecting DJ transport with DTLS role fix"
        );

        // Connect with timeout
        let connect_result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            transport.connect(WebRtcTransportRemoteParameters {
                dtls_parameters,
            })
        ).await;

        match connect_result {
            Ok(Ok(())) => {
                tracing::info!(
                    transport_id = %transport_id,
                    dj_id = %self.dj_id,
                    ice_state = ?transport.ice_state(),
                    dtls_state = ?transport.dtls_state(),
                    "DJ transport connected successfully"
                );
                Ok(transport_id)
            }
            Ok(Err(e)) => {
                tracing::error!(
                    transport_id = %transport_id,
                    dj_id = %self.dj_id,
                    error = %e,
                    "DJ transport connection failed"
                );
                Err(anyhow::anyhow!("DJ transport connection failed: {}", e))
            }
            Err(_) => {
                tracing::error!("DJ transport connection timed out after 10 seconds");
                Err(anyhow::anyhow!("DJ transport connection timed out"))
            }
        }
    }

    /// Step 15: Create audio producer for DJ streaming
    #[tracing::instrument(skip(self, rtp_parameters), fields(dj_id = %self.dj_id, transport_id))]
    pub async fn create_producer(&mut self, rtp_parameters: RtpParameters) -> Result<String> {
        let transport = self.transport.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No transport available for producer creation"))?;

        let transport_id = transport.id().to_string();
        tracing::Span::current().record("transport_id", &transport_id);

        // Validate RTP parameters for audio streaming
        self.validate_producer_requirements(&rtp_parameters).await?;

        let producer_options = ProducerOptions::new(
            MediaKind::Audio,
            rtp_parameters,
        );

        let producer = transport.produce(producer_options).await?;
        let producer_id = producer.id().to_string();

        tracing::info!(
            producer_id = %producer_id,
            dj_id = %self.dj_id,
            transport_id = %transport_id,
            producer_paused = %producer.paused(),
            "Audio producer created successfully for DJ"
        );

        // Store producer and update state
        self.producer = Some(Arc::new(producer));
        self.producer_id = Some(producer_id.clone());
        self.is_streaming = true;
        self.is_paused = false;

        Ok(producer_id)
    }

    /// Pause DJ audio stream (keep connection)
    pub async fn pause(&mut self) -> Result<()> {
        if let Some(producer) = &self.producer {
            producer.pause().await?;
            self.is_paused = true;
            tracing::info!(dj_id = %self.dj_id, "DJ audio paused");
        }
        Ok(())
    }

    /// Resume DJ audio stream
    pub async fn resume(&mut self) -> Result<()> {
        if let Some(producer) = &self.producer {
            producer.resume().await?;
            self.is_paused = false;
            tracing::info!(dj_id = %self.dj_id, "DJ audio resumed");
        }
        Ok(())
    }

    /// Stop streaming and clean up producer
    pub async fn stop_streaming(&mut self) -> Result<()> {
        if let Some(_producer) = self.producer.take() {
            // MediaSoup automatically handles cleanup when dropped
            self.producer_id = None;
            self.is_streaming = false;
            self.is_paused = false;
            tracing::info!(dj_id = %self.dj_id, "DJ streaming stopped and cleaned up");
        }
        Ok(())
    }

    /// Complete cleanup of DJ resources including producer and transport
    #[tracing::instrument(skip(self), fields(dj_id = %self.dj_id, producer_cleaned = tracing::field::Empty, transport_cleaned = tracing::field::Empty))]
    pub async fn cleanup(&mut self) -> Result<()> {
        let span = tracing::Span::current();
        tracing::info!(dj_id = %self.dj_id, "Starting complete DJ cleanup");

        let mut producer_cleaned = false;
        let mut transport_cleaned = false;

        // Step 1: Clean up producer (MediaSoup auto-cleans when dropped)
        if let Some(_producer) = self.producer.take() {
            producer_cleaned = true;
            // Clear producer state
            self.producer_id = None;
            self.is_streaming = false;
            self.is_paused = false;
            tracing::info!(dj_id = %self.dj_id, "Producer cleaned up");
        }

        // Step 2: Clean up transport (MediaSoup auto-cleans when dropped)
        if let Some(_transport) = self.transport.take() {
            transport_cleaned = true;
            tracing::info!(dj_id = %self.dj_id, "Transport cleaned up");
        }

        // Record cleanup results in tracing span
        span.record("producer_cleaned", producer_cleaned);
        span.record("transport_cleaned", transport_cleaned);

        tracing::info!(
            dj_id = %self.dj_id,
            producer_cleaned = producer_cleaned,
            transport_cleaned = transport_cleaned,
            "Complete DJ cleanup finished"
        );

        Ok(())
    }

    /// Check if DJ has a transport ready
    pub fn has_transport(&self) -> bool {
        self.transport.is_some()
    }

    /// Check if DJ is actively producing
    pub fn has_producer(&self) -> bool {
        self.producer.is_some() && self.is_streaming
    }

    /// Get producer pause state (MediaSoup as source of truth)
    pub fn is_producer_paused(&self) -> bool {
        self.producer.as_ref().map_or(true, |p| p.paused())
    }

    /// Get producer statistics for monitoring
    pub async fn get_producer_stats(&self) -> Result<Value> {
        if let Some(producer) = &self.producer {
            let stats = producer.get_stats().await?;
            Ok(serde_json::to_value(&stats)?)
        } else {
            Err(anyhow::anyhow!("No producer available for stats"))
        }
    }

    /// Generate transport options for client connection
    async fn generate_transport_options(&self, transport: &WebRtcTransport) -> Result<TransportOptions> {
        let ice_params = transport.ice_parameters();
        let dtls_params = transport.dtls_parameters();
        let ice_candidates = transport.ice_candidates();

        Ok(TransportOptions {
            id: transport.id().to_string(),
            ice_parameters: crate::lib::models::schemas::IceParametersWrapper {
                ice_lite: ice_params.ice_lite,
                password: ice_params.password.clone(),
                username_fragment: ice_params.username_fragment.clone(),
            },
            ice_candidates: ice_candidates.into_iter().map(|candidate| {
                crate::lib::models::schemas::IceCandidateSchema {
                    foundation: candidate.foundation.clone(),
                    priority: candidate.priority,
                    address: candidate.address.to_string(),
                    protocol: match candidate.protocol {
                        mediasoup::prelude::Protocol::Udp => crate::lib::models::schemas::ProtocolSchema::Udp,
                        mediasoup::prelude::Protocol::Tcp => crate::lib::models::schemas::ProtocolSchema::Tcp,
                    },
                    port: candidate.port,
                    candidate_type: crate::lib::models::schemas::IceCandidateTypeSchema::Host, // Default to Host
                    tcp_type: match candidate.protocol {
                        mediasoup::prelude::Protocol::Tcp => Some(crate::lib::models::schemas::IceCandidateTcpTypeSchema::Passive),
                        mediasoup::prelude::Protocol::Udp => None,
                    },
                }
            }).collect(),
            dtls_parameters: crate::lib::models::schemas::DtlsParametersWrapper {
                role: match dtls_params.role {
                    DtlsRole::Auto => "auto".to_string(),
                    DtlsRole::Client => "client".to_string(),
                    DtlsRole::Server => "server".to_string(),
                },
                fingerprints: dtls_params.fingerprints.into_iter()
                    .map(|fp| fp.into())
                    .collect(),
            },
            sctp_parameters: None,
        })
    }

    /// Validate RTP parameters for audio streaming compatibility
    async fn validate_producer_requirements(&self, rtp_params: &RtpParameters) -> Result<()> {
        // Check if we have audio codecs
        let audio_codecs: Vec<_> = rtp_params.codecs.iter()
            .filter(|codec| codec.mime_type().as_str().starts_with("audio/"))
            .collect();

        if audio_codecs.is_empty() {
            return Err(anyhow::anyhow!("No audio codecs found in RTP parameters"));
        }

        // Audio codecs validated - MediaSoup will handle codec compatibility internally

        tracing::info!(
            dj_id = %self.dj_id,
            codecs_count = audio_codecs.len(),
            "Producer RTP parameters validated successfully"
        );

        Ok(())
    }



    /// Get preferred audio codec capabilities for MediaSoup routers
    /// Optimized for high-quality music streaming with low latency
    pub fn get_preferred_audio_capabilities() -> Vec<RtpCodecCapability> {
        // Create music-optimized Opus parameters
        let mut opus_params = RtpCodecParametersParameters::default();

        // Essential Opus parameters for high-quality music streaming
        opus_params.insert("useinbandfec", "1");  // Forward Error Correction for packet loss
        opus_params.insert("stereo", "1");        // Enable stereo encoding
        opus_params.insert("sprop-stereo", "1");  // Signal stereo preference to receiver
        opus_params.insert("maxaveragebitrate", "320000"); // 320kbps for music quality
        opus_params.insert("maxplaybackrate", "48000");    // Full 48kHz bandwidth
        opus_params.insert("ptime", "20");        // 20ms frame size for low latency
        opus_params.insert("minptime", "3");      // Allow down to 3ms for ultra-low latency
        opus_params.insert("maxptime", "60");     // Allow up to 60ms if needed

        vec![
            // Opus - optimized for high-quality music streaming
            RtpCodecCapability::Audio {
                mime_type: MimeTypeAudio::Opus,
                preferred_payload_type: Some(111),
                clock_rate: NonZero::new(48000).unwrap(), // 48kHz for full audio bandwidth
                channels: NonZero::new(2).unwrap(), // Stereo for music
                parameters: opus_params,
                rtcp_feedback: vec![
                    RtcpFeedback::TransportCc, // Transport-wide congestion control for network adaptation
                    RtcpFeedback::Nack,        // NACK for packet loss recovery
                ],
            },
            // PCMU - fallback for compatibility
            RtpCodecCapability::Audio {
                mime_type: MimeTypeAudio::Pcmu,
                preferred_payload_type: Some(0),
                clock_rate: NonZero::new(8000).unwrap(),
                channels: NonZero::new(1).unwrap(),
                parameters: RtpCodecParametersParameters::default(),
                rtcp_feedback: vec![],
            },
            // PCMA - fallback for compatibility
            RtpCodecCapability::Audio {
                mime_type: MimeTypeAudio::Pcma,
                preferred_payload_type: Some(8),
                clock_rate: NonZero::new(8000).unwrap(),
                channels: NonZero::new(1).unwrap(),
                parameters: RtpCodecParametersParameters::default(),
                rtcp_feedback: vec![],
            },
        ]
    }

    /// Get essential audio header extensions for MediaSoup routers
    /// These extensions provide audio level monitoring and network adaptation for music streaming
    pub fn get_preferred_header_extensions() -> Vec<RtpHeaderExtension> {
        vec![
            // Audio level extension - provides volume information in RTP header
            RtpHeaderExtension {
                kind: MediaKind::Audio,
                uri: RtpHeaderExtensionUri::AudioLevel, // urn:ietf:params:rtp-hdrext:ssrc-audio-level
                preferred_id: 1,
                preferred_encrypt: false,
                direction: RtpHeaderExtensionDirection::SendRecv,
            },
            // Transport-wide congestion control - essential for network adaptation
            RtpHeaderExtension {
                kind: MediaKind::Audio,
                uri: RtpHeaderExtensionUri::TransportWideCcDraft01, // http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
                preferred_id: 5,
                preferred_encrypt: false,
                direction: RtpHeaderExtensionDirection::SendRecv,
            },
            // Absolute send time - provides timing information for synchronization
            RtpHeaderExtension {
                kind: MediaKind::Audio,
                uri: RtpHeaderExtensionUri::AbsSendTime, // http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
                preferred_id: 4,
                preferred_encrypt: false,
                direction: RtpHeaderExtensionDirection::SendRecv,
            },
            // Time offset - provides timestamp offset for enhanced timing
            RtpHeaderExtension {
                kind: MediaKind::Audio,
                uri: RtpHeaderExtensionUri::TimeOffset, // urn:ietf:params:rtp-hdrext:toffset
                preferred_id: 2,
                preferred_encrypt: false,
                direction: RtpHeaderExtensionDirection::SendRecv,
            },
        ]
    }
}
