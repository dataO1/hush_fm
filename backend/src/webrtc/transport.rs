use mediasoup::{
    router::Router,
    webrtc_transport::{WebRtcTransport, WebRtcTransportOptions},
    prelude::*,
};
use serde_json::{json, Value};
use std::{net::{IpAddr, Ipv4Addr}, sync::Arc};
use uuid::Uuid;

/// Local network transport configuration for WiFi-only operation
#[derive(Clone)]
pub struct LocalTransportConfig {
    pub local_ip: IpAddr,
    pub port_range: Option<(u16, u16)>,
    pub enable_udp: bool,
    pub enable_tcp: bool,
}

impl Default for LocalTransportConfig {
    fn default() -> Self {
        Self {
            local_ip: IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)), // Bind to all interfaces
            port_range: Some((40000, 49999)),
            enable_udp: true,
            enable_tcp: false, // UDP preferred for local network
        }
    }
}

/// Transport manager for local WiFi network
#[derive(Clone)]
pub struct TransportManager {
    config: LocalTransportConfig,
}

impl TransportManager {
    pub fn new(config: LocalTransportConfig) -> Self {
        Self { config }
    }

    /// Create a WebRTC transport for DJ (sending audio)
    pub async fn create_dj_transport(
        &self,
        router: &Router,
        room_id: Uuid,
    ) -> anyhow::Result<(Arc<WebRtcTransport>, Value)> {
        let transport_id = format!("dj_transport_{}", room_id);
        
        let mut transport_options = WebRtcTransportOptions::new(
            WebRtcTransportListenInfos::new(ListenInfo {
                protocol: Protocol::Udp,
                ip: self.config.local_ip,
                announced_address: None, // Use actual IP for local network
                expose_internal_ip: false,
                port: None, // Let mediasoup choose
                port_range: None, // Use default port range for local network
                flags: None,
                send_buffer_size: None,
                recv_buffer_size: None,
            })
        );
        
        // Set additional options via struct fields
        transport_options.enable_udp = self.config.enable_udp;
        transport_options.enable_tcp = self.config.enable_tcp;
        transport_options.initial_available_outgoing_bitrate = 600000; // 600kbps for audio

        let transport = router.create_webrtc_transport(transport_options).await?;
        
        // Generate transport options for client
        let transport_options = self.generate_transport_options(&transport, &transport_id).await?;
        
        Ok((Arc::new(transport), transport_options))
    }

    /// Create a WebRTC transport for listener (receiving audio)
    pub async fn create_listener_transport(
        &self,
        router: &Router,
        room_id: Uuid,
        listener_id: &str,
    ) -> anyhow::Result<(Arc<WebRtcTransport>, Value)> {
        let transport_id = format!("listener_transport_{}_{}", room_id, listener_id);
        
        let mut transport_options = WebRtcTransportOptions::new(
            WebRtcTransportListenInfos::new(ListenInfo {
                protocol: Protocol::Udp,
                ip: self.config.local_ip,
                announced_address: None,
                expose_internal_ip: false,
                port: None,
                port_range: None, // Use default port range for local network
                flags: None,
                send_buffer_size: None,
                recv_buffer_size: None,
            })
        );
        
        // Set additional options via struct fields
        transport_options.enable_udp = self.config.enable_udp;
        transport_options.enable_tcp = self.config.enable_tcp;
        transport_options.initial_available_outgoing_bitrate = 0; // Receiving only

        let transport = router.create_webrtc_transport(transport_options).await?;
        
        // Generate transport options for client
        let transport_options = self.generate_transport_options(&transport, &transport_id).await?;
        
        Ok((Arc::new(transport), transport_options))
    }

    /// Generate transport options for client connection (simplified for local network)
    async fn generate_transport_options(
        &self,
        transport: &WebRtcTransport,
        transport_id: &str,
    ) -> anyhow::Result<Value> {
        // For local network, we don't need ICE candidates
        // Client will connect directly to the transport's listening address
        
        Ok(json!({
            "id": transport_id,
            "dtlsParameters": {
                "role": "server", // mediasoup is always server
                "fingerprints": transport.dtls_parameters().fingerprints
            },
            "iceCandidates": [], // Empty for local network
            "iceParameters": {
                "usernameFragment": "",
                "password": ""
            },
            "localAddress": self.config.local_ip.to_string(),
            "localPort": null // Will be determined by mediasoup
        }))
    }

    /// Connect transport with client's DTLS parameters
    pub async fn connect_transport(
        &self,
        transport: &WebRtcTransport,
        dtls_parameters: Value,
    ) -> anyhow::Result<()> {
        // Parse DTLS parameters from client
        let dtls_params = serde_json::from_value(dtls_parameters)?;
        
        // Connect the transport
        transport.connect(WebRtcTransportRemoteParameters {
            dtls_parameters: dtls_params,
        }).await?;
        
        tracing::info!("WebRTC transport connected successfully");
        Ok(())
    }
}

impl Default for TransportManager {
    fn default() -> Self {
        Self::new(LocalTransportConfig::default())
    }
}

/// Helper to get local network IP address
pub fn get_local_ip() -> anyhow::Result<IpAddr> {
    use std::net::UdpSocket;
    
    // Connect to a dummy address to determine local IP
    let socket = UdpSocket::bind("0.0.0.0:0")?;
    socket.connect("8.8.8.8:80")?;
    let local_addr = socket.local_addr()?;
    
    Ok(local_addr.ip())
}

/// Configuration helper for common local network setups
impl LocalTransportConfig {
    /// Configuration for localhost development
    pub fn localhost() -> Self {
        Self {
            local_ip: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port_range: Some((40000, 49999)),
            enable_udp: true,
            enable_tcp: false,
        }
    }

    /// Configuration for WiFi network (auto-detect local IP)
    pub fn wifi_network() -> anyhow::Result<Self> {
        let local_ip = get_local_ip()?;
        Ok(Self {
            local_ip,
            port_range: Some((40000, 49999)),
            enable_udp: true,
            enable_tcp: false,
        })
    }

    /// Configuration for specific network interface
    pub fn specific_ip(ip: IpAddr) -> Self {
        Self {
            local_ip: ip,
            port_range: Some((40000, 49999)),
            enable_udp: true,
            enable_tcp: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transport_config() {
        let config = LocalTransportConfig::default();
        assert_eq!(config.local_ip, IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)));
        assert!(config.enable_udp);
        assert!(!config.enable_tcp);
    }

    #[test]
    fn test_localhost_config() {
        let config = LocalTransportConfig::localhost();
        assert_eq!(config.local_ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert!(config.enable_udp);
    }

    #[tokio::test]
    async fn test_get_local_ip() {
        let result = get_local_ip();
        assert!(result.is_ok());
    }
}