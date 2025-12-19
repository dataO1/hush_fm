/// Listener Business Logic Module
///
/// Handles all listener-specific WebRTC operations including receiver transport creation,
/// consumer management, and listener lifecycle according to the reference implementation.

use mediasoup::prelude::*;
use mediasoup::transport::{TransportTraceEventType, TransportTraceEventData};
use mediasoup_types::data_structures::DtlsRole;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use anyhow::Result;
use serde_json::Value;
use uuid::Uuid;
use std::num::NonZero;
use tokio::sync::mpsc;
use crate::lib::models::ListenerEvent;
use crate::lib::models::schemas::{TransportOptions, ConsumerParameters, RtpParametersWrapper};

/// Listener state containing all WebRTC resources and metadata for audio receiving
#[derive(Debug)]
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
    /// When listener last disconnected (WebSocket closed)
    pub last_disconnected_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Cleanup timer handle (cancelled on reconnection)
    pub cleanup_timer: Option<tokio::task::JoinHandle<()>>,
    /// Event channel for sending WebSocket events to listener
    pub event_tx: mpsc::UnboundedSender<ListenerEvent>,

    // Configuration
    /// WebRTC port range configuration
    pub port_range: std::ops::RangeInclusive<u16>,
    /// Announced IP address configuration
    pub announced_ip: String,
}

impl Listener {
    /// Create new listener state with basic information
    pub fn new(
        listener_id: String,
        room_id: Uuid,
        device_rtp_capabilities: Value,
        event_tx: mpsc::UnboundedSender<ListenerEvent>,
        port_range: std::ops::RangeInclusive<u16>,
        announced_ip: String,
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
            last_disconnected_at: None,
            cleanup_timer: None,
            event_tx,
            port_range,
            announced_ip,
        }
    }

    /// Step 2: Get receiver transport for listener using room's router
    /// Single source of truth - always creates new transport (WebRTC transports are stateful and cannot be reused)
    #[tracing::instrument(skip(self, router), fields(listener_id = %self.listener_id, room_id = %self.room_id))]
    pub async fn get_receiver_transport(&mut self, router: &Router) -> Result<TransportOptions> {
        // Clean up existing transport if any (for reconnection scenarios)
        if let Some(old_transport) = self.transport.take() {
            tracing::info!(
                listener_id = %self.listener_id,
                old_transport_id = %old_transport.id(),
                "Cleaning up existing transport before creating new one for reconnection"
            );
            // Transport will be cleaned up when Arc is dropped
        }
        // Use stored configuration - bind to correct interface for environment
        // let bind_ip = if self.announced_ip == "localhost" { "127.0.0.1" } else { "0.0.0.0" };
        // let announced_address = if self.announced_ip == "localhost" { Some("127.0.0.1".to_string()) } else { Some(self.announced_ip.clone()) };
        //
        // tracing::info!("Creating listener receiver transport with configured settings");
        // tracing::info!("  - Bind IP: {} ({})", bind_ip, if self.announced_ip == "localhost" { "localhost only" } else { "all interfaces" });
        // tracing::info!("  - Announced IP: {} (for ICE candidates)", self.announced_ip);
        // tracing::info!("  - Port range: {:?}", self.port_range);

        let mut listen_infos = WebRtcTransportListenInfos::new(ListenInfo {
            protocol: Protocol::Udp,
            ip: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
            announced_address: Some(self.announced_ip.clone()),
            expose_internal_ip: false,
            port: None,
            port_range: Some(self.port_range.clone()),
            flags: None,
            send_buffer_size: None,
            recv_buffer_size: None,
        });
        if self.announced_ip == "localhost"{
            listen_infos = listen_infos
            // Add TCP fallback, only for localhost, since this seems to be required!
            .insert(ListenInfo {
                protocol: Protocol::Tcp,
                ip: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
                announced_address: Some(self.announced_ip.clone()),
                expose_internal_ip: false,
                port: None,
                port_range: Some(self.port_range.clone()),
                flags: None,
                send_buffer_size: None,
                recv_buffer_size: None,
            });
        }

        let mut transport_options = WebRtcTransportOptions::new(listen_infos);

        // Optimize for local WiFi network sending
        transport_options.enable_udp = true;
        // transport_options.enable_tcp = true;
        transport_options.prefer_udp = true;
        // transport_options.initial_available_outgoing_bitrate = 600000; // DJ sends audio
        // transport_options.ice_consent_timeout = 30;

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

        // Enable transport trace events for debugging ICE/DTLS connectivity
        transport.enable_trace_event(vec![
            TransportTraceEventType::Probation,
            TransportTraceEventType::Bwe
        ]).await?;

        // Add transport event listener for connection monitoring
        let transport_id_for_events = transport_id.clone();
        let listener_id_for_events = self.listener_id.clone();
        let _trace_handler = transport.on_trace(Arc::new(move |trace_event: &TransportTraceEventData| {
            match trace_event {
                TransportTraceEventData::Probation { timestamp, direction, info } => {
                    tracing::info!(
                        transport_id = %transport_id_for_events,
                        listener_id = %listener_id_for_events,
                        event_type = "probation",
                        timestamp = %timestamp,
                        direction = ?direction,
                        "Listener Transport Probation Event: {:?}", info
                    );
                },
                TransportTraceEventData::Bwe { timestamp, direction, info } => {
                    tracing::info!(
                        transport_id = %transport_id_for_events,
                        listener_id = %listener_id_for_events,
                        event_type = "bwe",
                        timestamp = %timestamp,
                        direction = ?direction,
                        "Listener Transport BWE Event: {:?}", info
                    );
                }
            }
        }));

        // Generate transport options for client
        let client_transport_options = self.generate_transport_options(&transport).await?;

        tracing::info!(
            transport_id = %transport.id(),
            listener_id = %self.listener_id,
            room_id = %self.room_id,
            "Listener receiver transport created successfully - ready for DTLS connection"
        );

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
            // MediaSoup consumer automatically cleans up when dropped (Arc is dropped)
            // Clear consumer state
            self.consumer_id = None;
            self.producer_id = None;
            tracing::info!(listener_id = %self.listener_id, "Listener consumption stopped and consumer cleaned up");
        }
        Ok(())
    }

    /// Complete cleanup of listener resources including transport and consumer
    #[tracing::instrument(skip(self), fields(listener_id = %self.listener_id, consumer_cleaned = tracing::field::Empty, transport_cleaned = tracing::field::Empty))]
    pub async fn cleanup(&mut self) -> Result<()> {
        let span = tracing::Span::current();
        tracing::info!(listener_id = %self.listener_id, "Starting complete listener cleanup");

        let mut consumer_cleaned = false;
        let mut transport_cleaned = false;

        // Step 1: Clean up consumer (MediaSoup auto-cleans when dropped)
        if let Some(_consumer) = self.consumer.take() {
            consumer_cleaned = true;
            // Clear consumer state
            self.consumer_id = None;
            self.producer_id = None;
            tracing::info!(listener_id = %self.listener_id, "Consumer cleaned up");
        }

        // Step 2: Clean up transport (MediaSoup auto-cleans when dropped)
        if let Some(_transport) = self.transport.take() {
            transport_cleaned = true;
            tracing::info!(listener_id = %self.listener_id, "Transport cleaned up");
        }

        // Record cleanup results in tracing span
        span.record("consumer_cleaned", consumer_cleaned);
        span.record("transport_cleaned", transport_cleaned);

        tracing::info!(
            listener_id = %self.listener_id,
            consumer_cleaned = consumer_cleaned,
            transport_cleaned = transport_cleaned,
            "Complete listener cleanup finished"
        );

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
    pub async fn generate_transport_options(&self, transport: &WebRtcTransport) -> Result<TransportOptions> {
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

    /// Start cleanup timer when listener disconnects (WebSocket closes)
    pub fn start_disconnect_cleanup_timer(
        &mut self,
        room_id: uuid::Uuid,
        session_id: String,
        lobby: crate::lib::domain::Lobby,
    ) {
        // Cancel any existing timer
        if let Some(timer) = self.cleanup_timer.take() {
            timer.abort();
        }

        // Record disconnect time
        self.last_disconnected_at = Some(chrono::Utc::now());

        // Start new cleanup timer (1 minute timeout)
        let cleanup_timer = tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

            // Check if listener is still disconnected and remove if so
            if let Some(room_state) = lobby.get_room(&room_id) {
                // First check if cleanup is needed
                let should_cleanup = {
                    let room_guard = room_state.read().await;
                    let listener_ref = room_guard.get_listener(&session_id);
                    listener_ref.map_or(false, |l| l.last_disconnected_at.is_some())
                };

                if should_cleanup {
                    // Perform cleanup using existing domain method
                    let mut room_write_guard = room_state.write().await;
                    if let Err(e) = room_write_guard.remove_listener(&session_id).await {
                        tracing::error!(
                            session_id = %session_id,
                            room_id = %room_id,
                            error = %e,
                            "Failed to cleanup abandoned listener"
                        );
                    } else {
                        tracing::info!(
                            session_id = %session_id,
                            room_id = %room_id,
                            "Cleaned up abandoned listener after timeout"
                        );

                        // Update lobby state to reflect listener count change
                        // This ensures the public room list shows the correct listener count
                        if room_write_guard.is_public() {
                            drop(room_write_guard); // Release write lock before lobby call

                            lobby.update_room(&room_id).await;
                            tracing::debug!(
                                session_id = %session_id,
                                room_id = %room_id,
                                "Updated lobby state after listener cleanup"
                            );
                        }
                    }
                }
            }
        });

        self.cleanup_timer = Some(cleanup_timer);
    }

    /// Cancel cleanup timer when listener reconnects
    pub fn cancel_disconnect_cleanup_timer(&mut self) {
        if let Some(timer) = self.cleanup_timer.take() {
            timer.abort();
            tracing::debug!(
                listener_id = %self.listener_id,
                "Cancelled disconnect cleanup timer due to reconnection"
            );
        }

        // Clear disconnect timestamp since listener is now connected
        self.last_disconnected_at = None;
    }
}

