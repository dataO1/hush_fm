/// DJ Business Logic Module
/// 
/// Handles all DJ-specific WebRTC operations including sender transport creation,
/// producer management, and DJ lifecycle according to the reference implementation.

use mediasoup::prelude::*;
use mediasoup_types::data_structures::DtlsRole;
use std::sync::Arc;
use anyhow::Result;
use serde_json::Value;
use uuid::Uuid;
use std::num::NonZero;
use tokio::sync::mpsc;
use crate::lib::models::ListenerEvent;
use crate::lib::models::schemas::TransportOptions;

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
        // Use local IP detection for WiFi-optimized transport
        let local_ip = crate::lib::utils::get_local_ip()?;
        
        tracing::info!("Creating DJ sender transport. Announcing IP: {}", local_ip);

        let mut transport_options = WebRtcTransportOptions::new(
            WebRtcTransportListenInfos::new(ListenInfo {
                protocol: Protocol::Udp,
                ip: local_ip,
                announced_address: Some(local_ip.to_string()),
                expose_internal_ip: false,
                port: None,
                port_range: Some(40000..=49999),
                flags: None,
                send_buffer_size: None,
                recv_buffer_size: None,
            })
        );

        // Optimize for local WiFi network sending
        transport_options.enable_udp = true;
        transport_options.enable_tcp = true;
        transport_options.prefer_udp = true;
        transport_options.initial_available_outgoing_bitrate = 600000; // DJ sends audio
        transport_options.ice_consent_timeout = 30;

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

        // Generate transport options for client
        let client_transport_options = self.generate_transport_options(&transport).await?;
        
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

        // Setup producer monitoring
        let producer_arc = Arc::new(producer);
        self.setup_producer_monitoring(producer_arc.clone()).await;

        // Store producer and update state
        self.producer = Some(producer_arc);
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
                    tcp_type: candidate.tcp_type.map(|_| crate::lib::models::schemas::IceCandidateTcpTypeSchema::Passive),
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

        // Validate Opus codec for MediaSoup compatibility
        for codec in &audio_codecs {
            let mime_str = codec.mime_type().as_str();
            if mime_str.contains("opus") {
                self.validate_opus_compatibility(codec)?;
            }
        }

        tracing::info!(
            dj_id = %self.dj_id,
            codecs_count = audio_codecs.len(),
            "Producer RTP parameters validated successfully"
        );

        Ok(())
    }

    /// Validate Opus codec for MediaSoup compatibility
    fn validate_opus_compatibility(&self, codec: &RtpCodecParameters) -> Result<()> {
        let clock_rate = codec.clock_rate().get();
        let payload_type = codec.payload_type();

        // Critical MediaSoup Opus compatibility checks
        if clock_rate != 48000 {
            tracing::error!(
                dj_id = %self.dj_id,
                clock_rate = clock_rate,
                "MediaSoup Opus requires 48kHz - this may cause zero packet transmission"
            );
            return Err(anyhow::anyhow!("Opus clock rate must be 48000 for MediaSoup compatibility"));
        }

        // Validate payload type is in MediaSoup-compatible range
        if payload_type < 96 || payload_type > 127 {
            tracing::error!(
                dj_id = %self.dj_id,
                payload_type = payload_type,
                "MediaSoup requires dynamic payload types (96-127) for Opus"
            );
            return Err(anyhow::anyhow!("Invalid Opus payload type for MediaSoup"));
        }

        tracing::info!(
            dj_id = %self.dj_id,
            clock_rate = clock_rate,
            payload_type = payload_type,
            "Opus codec validated for MediaSoup compatibility"
        );

        Ok(())
    }

    /// Setup enhanced producer monitoring for transmission health
    async fn setup_producer_monitoring(&self, producer: Arc<Producer>) {
        let dj_id = self.dj_id.clone();
        let room_id = self.room_id;
        let producer_id = producer.id();

        tracing::info!(
            producer_id = %producer_id,
            dj_id = %dj_id,
            "Setting up enhanced producer monitoring"
        );

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            let mut stats_check_count = 0;

            loop {
                interval.tick().await;
                stats_check_count += 1;

                match producer.get_stats().await {
                    Ok(stats) => {
                        let stats_value = serde_json::to_value(&stats).unwrap_or_default();
                        
                        // Monitor packet transmission for health
                        if let Some(stats_array) = stats_value.as_array() {
                            let mut total_packets_sent = 0u64;
                            
                            for stat in stats_array {
                                if let Some(stat_obj) = stat.as_object() {
                                    if let Some(packets) = stat_obj.get("packetsSent").and_then(|v| v.as_u64()) {
                                        total_packets_sent += packets;
                                    }
                                }
                            }
                            
                            // Alert on zero transmission after reasonable startup time
                            if stats_check_count >= 3 && total_packets_sent == 0 {
                                tracing::error!(
                                    producer_id = %producer_id,
                                    dj_id = %dj_id,
                                    room_id = %room_id,
                                    checks_performed = stats_check_count,
                                    "🚨 ZERO PACKET TRANSMISSION DETECTED - Producer binding failure"
                                );
                            } else if total_packets_sent > 0 {
                                tracing::debug!(
                                    producer_id = %producer_id,
                                    dj_id = %dj_id,
                                    packets_sent = total_packets_sent,
                                    "Producer transmitting successfully"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            producer_id = %producer_id,
                            dj_id = %dj_id,
                            error = %e,
                            "Failed to get producer stats during monitoring"
                        );
                    }
                }

                // Stop monitoring after reasonable time
                if stats_check_count > 12 { // 1 minute
                    break;
                }
            }
        });
    }

    /// Get preferred audio codec capabilities for MediaSoup routers
    pub fn get_preferred_audio_capabilities() -> Vec<RtpCodecCapability> {
        vec![
            // Opus - preferred for high quality audio
            RtpCodecCapability::Audio {
                mime_type: MimeTypeAudio::Opus,
                preferred_payload_type: Some(111),
                clock_rate: NonZero::new(48000).unwrap(),
                channels: NonZero::new(2).unwrap(), // Stereo
                parameters: RtpCodecParametersParameters::default(),
                rtcp_feedback: vec![],
            },
            // PCMU - fallback
            RtpCodecCapability::Audio {
                mime_type: MimeTypeAudio::Pcmu,
                preferred_payload_type: Some(0),
                clock_rate: NonZero::new(8000).unwrap(),
                channels: NonZero::new(1).unwrap(),
                parameters: RtpCodecParametersParameters::default(),
                rtcp_feedback: vec![],
            },
            // PCMA - fallback
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
}