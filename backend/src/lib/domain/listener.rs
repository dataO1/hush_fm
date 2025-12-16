/// Listener Business Logic Module
/// 
/// Handles all listener-specific WebRTC operations including receiver transport creation,
/// consumer management, and listener lifecycle according to the reference implementation.

use mediasoup::prelude::*;
use mediasoup_types::data_structures::DtlsRole;
use std::sync::Arc;
use anyhow::Result;
use serde_json::Value;
use uuid::Uuid;
use std::num::NonZero;
use tokio::sync::mpsc;
use crate::lib::models::ListenerEvent;
use crate::lib::models::schemas::{TransportOptions, ConsumerParameters, RtpParametersWrapper};

/// Listener state containing all WebRTC resources and metadata for audio receiving
#[derive(Debug, Clone)]
pub struct Listener {
    /// Listener identifier
    pub listener_id: String,
    /// Room this listener belongs to
    pub room_id: Uuid,
    /// WebRTC receiver transport for media receiving
    pub transport: Option<Arc<WebRtcTransport>>,
    /// Device RTP capabilities for consumer creation
    pub device_rtp_capabilities: Value,
    /// Audio consumer for receiving stream
    pub consumer: Option<Arc<Consumer>>,
    /// Consumer ID for reference
    pub consumer_id: Option<String>,
    /// Producer ID this consumer is consuming from
    pub producer_id: Option<String>,
    /// When listener connected to the room
    pub connected_at: chrono::DateTime<chrono::Utc>,
    /// Event channel for sending WebSocket events to listener
    pub event_tx: mpsc::UnboundedSender<ListenerEvent>,
}

impl Listener {
    /// Create new listener state with basic information
    pub fn new(
        listener_id: String,
        room_id: Uuid,
        device_rtp_capabilities: Value,
        event_tx: mpsc::UnboundedSender<ListenerEvent>,
    ) -> Self {
        Self {
            listener_id,
            room_id,
            transport: None,
            device_rtp_capabilities,
            consumer: None,
            consumer_id: None,
            producer_id: None,
            connected_at: chrono::Utc::now(),
            event_tx,
        }
    }

    /// Step 2: Create receiver transport for listener using room's router
    #[tracing::instrument(skip(self, router), fields(listener_id = %self.listener_id, room_id = %self.room_id))]
    pub async fn create_receiver_transport(&mut self, router: &Router) -> Result<TransportOptions> {
        // Use local IP detection for WiFi-optimized transport
        let local_ip = crate::lib::utils::get_local_ip()?;
        
        tracing::info!("Creating listener receiver transport. Announcing IP: {}", local_ip);

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

        // Optimize for local WiFi network receiving
        transport_options.enable_udp = true;
        transport_options.enable_tcp = true;
        transport_options.prefer_udp = true;
        transport_options.initial_available_outgoing_bitrate = 0; // Listener doesn't send
        transport_options.ice_consent_timeout = 30;

        let transport = router.create_webrtc_transport(transport_options).await?;
        let transport_id = transport.id().to_string();

        tracing::info!(
            transport_id = %transport_id,
            listener_id = %self.listener_id,
            ice_role = ?transport.ice_role(),
            ice_state = ?transport.ice_state(),
            dtls_state = ?transport.dtls_state(),
            "Listener receiver transport created successfully"
        );

        // Generate transport options for client
        let client_transport_options = self.generate_transport_options(&transport).await?;
        
        // Store transport
        self.transport = Some(Arc::new(transport));

        Ok(client_transport_options)
    }

    /// Step 9: Connect listener transport with DTLS parameters from client
    #[tracing::instrument(skip(self, dtls_parameters), fields(listener_id = %self.listener_id, transport_id))]
    pub async fn connect_transport(&self, dtls_parameters: DtlsParameters) -> Result<String> {
        let transport = self.transport.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No transport available for listener"))?;

        let transport_id = transport.id().to_string();
        tracing::Span::current().record("transport_id", &transport_id);

        // Force backend to act as server for DTLS handshake
        let original_role = dtls_parameters.role;
        let mut dtls_parameters = dtls_parameters;
        dtls_parameters.role = DtlsRole::Server;
        
        tracing::info!(
            transport_id = %transport_id,
            listener_id = %self.listener_id,
            original_dtls_role = ?original_role,
            forced_dtls_role = ?dtls_parameters.role,
            "Connecting listener transport with DTLS role fix"
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
                    listener_id = %self.listener_id,
                    ice_state = ?transport.ice_state(),
                    dtls_state = ?transport.dtls_state(),
                    "Listener transport connected successfully"
                );
                Ok(transport_id)
            }
            Ok(Err(e)) => {
                tracing::error!(
                    transport_id = %transport_id,
                    listener_id = %self.listener_id,
                    error = %e,
                    "Listener transport connection failed"
                );
                Err(anyhow::anyhow!("Listener transport connection failed: {}", e))
            }
            Err(_) => {
                tracing::error!("Listener transport connection timed out after 10 seconds");
                Err(anyhow::anyhow!("Listener transport connection timed out"))
            }
        }
    }

    /// Step 5: Create audio consumer for listening to DJ's stream
    #[tracing::instrument(skip(self, producer), fields(listener_id = %self.listener_id, transport_id))]
    pub async fn create_consumer(
        &mut self,
        producer: &Producer,
        router: &Router,
    ) -> Result<ConsumerParameters> {
        let transport = self.transport.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No transport available for consumer creation"))?;

        let transport_id = transport.id().to_string();
        tracing::Span::current().record("transport_id", &transport_id);

        // Parse client's RTP capabilities
        let client_capabilities: RtpCapabilities = serde_json::from_value(self.device_rtp_capabilities.clone())?;

        // Check if router can consume this producer with client capabilities
        if !router.can_consume(&producer.id(), &client_capabilities) {
            return Err(anyhow::anyhow!("Router cannot consume producer with client capabilities"));
        }

        let consumer_options = ConsumerOptions::new(
            producer.id(),
            client_capabilities,
        );

        let consumer = transport.consume(consumer_options).await?;
        let consumer_id = consumer.id().to_string();
        let producer_id = producer.id().to_string();

        tracing::info!(
            consumer_id = %consumer_id,
            producer_id = %producer_id,
            listener_id = %self.listener_id,
            transport_id = %transport_id,
            "Audio consumer created successfully for listener"
        );

        // Generate consumer parameters for client
        let consumer_parameters = self.generate_consumer_parameters(&consumer, producer).await?;

        // Store consumer and update state
        let consumer_arc = Arc::new(consumer);
        self.consumer = Some(consumer_arc);
        self.consumer_id = Some(consumer_id);
        self.producer_id = Some(producer_id);

        Ok(consumer_parameters)
    }

    /// Pause listener's audio consumption
    pub async fn pause(&self) -> Result<()> {
        if let Some(consumer) = &self.consumer {
            consumer.pause().await?;
            tracing::info!(listener_id = %self.listener_id, "Listener audio consumption paused");
        }
        Ok(())
    }

    /// Resume listener's audio consumption
    pub async fn resume(&self) -> Result<()> {
        if let Some(consumer) = &self.consumer {
            consumer.resume().await?;
            tracing::info!(listener_id = %self.listener_id, "Listener audio consumption resumed");
        }
        Ok(())
    }

    /// Stop consuming and clean up consumer
    pub async fn stop_consuming(&mut self) -> Result<()> {
        if let Some(_consumer) = self.consumer.take() {
            // MediaSoup automatically handles cleanup when dropped
            self.consumer_id = None;
            self.producer_id = None;
            tracing::info!(listener_id = %self.listener_id, "Listener consumption stopped and cleaned up");
        }
        Ok(())
    }

    /// Check if listener has a transport ready
    pub fn has_transport(&self) -> bool {
        self.transport.is_some()
    }

    /// Check if listener has an active consumer
    pub fn has_consumer(&self) -> bool {
        self.consumer.is_some()
    }

    /// Get consumer pause state (MediaSoup as source of truth)
    pub fn is_consumer_paused(&self) -> bool {
        self.consumer.as_ref().map_or(true, |c| c.paused())
    }

    /// Get consumer statistics for monitoring
    pub async fn get_consumer_stats(&self) -> Result<Value> {
        if let Some(consumer) = &self.consumer {
            let stats = consumer.get_stats().await?;
            Ok(serde_json::to_value(&stats)?)
        } else {
            Err(anyhow::anyhow!("No consumer available for stats"))
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

    /// Generate consumer parameters for client
    async fn generate_consumer_parameters(
        &self,
        consumer: &Consumer,
        producer: &Producer,
    ) -> Result<ConsumerParameters> {
        // Get RTP parameters and convert to wrapper
        let rtp_parameters = consumer.rtp_parameters().clone();
        let rtp_wrapper = RtpParametersWrapper::from(rtp_parameters);

        tracing::info!(
            consumer_id = %consumer.id(),
            listener_id = %self.listener_id,
            "Generated consumer parameters with RTP structure"
        );

        // Validate that we have the required fields for MediaSoup client
        if rtp_wrapper.codecs.is_empty() {
            tracing::error!(
                consumer_id = %consumer.id(),
                listener_id = %self.listener_id,
                "Consumer RTP parameters missing codecs!"
            );
            return Err(anyhow::anyhow!("Consumer missing audio codecs"));
        }

        // Create ConsumerParameters struct
        let consumer_params = ConsumerParameters {
            id: consumer.id().to_string(),
            producer_id: consumer.producer_id().to_string(),
            kind: "audio".to_string(),
            rtp_parameters: rtp_wrapper,
            r#type: "simple".to_string(), // Simple consumer type for local network
            producer_paused: producer.paused(),
        };

        Ok(consumer_params)
    }

    /// Check if client can consume producer (compatibility check)
    pub fn can_consume_producer(
        producer: &Producer,
        client_capabilities: &Value,
        router: &Router,
    ) -> Result<bool> {
        let capabilities: RtpCapabilities = serde_json::from_value(client_capabilities.clone())?;
        Ok(router.can_consume(&producer.id(), &capabilities))
    }

    /// Get consumer audio capabilities for client device initialization
    pub fn get_consumer_audio_capabilities() -> RtpCapabilities {
        RtpCapabilities {
            codecs: vec![
                // Opus - preferred
                RtpCodecCapability::Audio {
                    mime_type: MimeTypeAudio::Opus,
                    preferred_payload_type: Some(111),
                    clock_rate: NonZero::new(48000).unwrap(),
                    channels: NonZero::new(2).unwrap(),
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
            ],
            header_extensions: vec![
                // Simplified header extensions for local network
            ],
        }
    }
}

