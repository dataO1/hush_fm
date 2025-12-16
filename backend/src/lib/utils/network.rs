/// Network utilities for getting local IP addresses
use std::net::IpAddr;

/// Get the local IP address for WebRTC transport binding
/// 
/// This function attempts to find a suitable local IP address for WebRTC transport.
/// It prioritizes non-loopback addresses and falls back to localhost if needed.
pub fn get_local_ip() -> anyhow::Result<IpAddr> {
    // Try to get the local IP address
    match local_ip_address::local_ip() {
        Ok(ip) => {
            tracing::debug!("Using local IP address: {}", ip);
            Ok(ip)
        }
        Err(e) => {
            tracing::warn!("Failed to get local IP address: {}, falling back to localhost", e);
            Ok("127.0.0.1".parse().unwrap())
        }
    }
}

