/// RTP packet creation for Opus frames
/// 
/// This module handles RTP packetization of Opus-encoded audio data for injection
/// into MediaSoup DirectTransport. It maintains proper RTP sequence numbers and
/// timestamps according to the Opus RTP specification (RFC 7587).

use bytes::{Bytes, BytesMut, BufMut};
use anyhow::Result;

/// RTP packet builder for Opus audio frames
pub struct RtpPacketizer {
    /// RTP payload type (must match router codec configuration)
    payload_type: u8,
    /// RTP synchronization source identifier
    ssrc: u32,
    /// RTP sequence number (incremented for each packet)
    sequence_number: u16,
    /// RTP timestamp (incremented by frame_size for each frame at 48kHz)
    timestamp: u32,
    /// Timestamp increment per frame (depends on frame duration)
    timestamp_increment: u32,
    /// DSCP marking for QoS
    dscp_marking: u8,
}

impl RtpPacketizer {
    /// Create new RTP packetizer with configurable frame duration for Opus
    /// 
    /// # Arguments
    /// * `frame_duration_ms` - Frame duration in milliseconds (10, 20, or 40)
    pub fn new(frame_duration_ms: u32) -> Self {
        // Calculate timestamp increment: 48000 Hz * frame_duration_seconds
        let timestamp_increment = 48000 * frame_duration_ms / 1000;
        
        Self {
            payload_type: 100, // Standard dynamic payload type for Opus
            ssrc: 1111,        // Fixed SSRC for audio bot
            sequence_number: 0,
            timestamp: 0,
            timestamp_increment,
            dscp_marking: 46, // Default to EF (Expedited Forwarding) for audio
        }
    }

    /// Create RTP packet from Opus-encoded audio data
    /// 
    /// # Arguments
    /// * `opus_data` - Encoded Opus audio frame data
    /// 
    /// # Returns
    /// * `Bytes` - Complete RTP packet ready for DirectProducer.send()
    pub fn create_packet(&mut self, opus_data: &[u8]) -> Result<Bytes> {
        // RTP header is 12 bytes + payload
        let packet_size = 12 + opus_data.len();
        let mut packet = BytesMut::with_capacity(packet_size);
        
        // RTP Header Format (RFC 3550):
        // 0                   1                   2                   3
        // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
        // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
        // |V=2|P|X|  CC   |M|     PT      |       sequence number         |
        // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
        // |                           timestamp                           |
        // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
        // |           synchronization source (SSRC) identifier            |
        // +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

        // Byte 0: Version(2) + Padding(0) + Extension(0) + CSRC Count(0)
        packet.put_u8(0x80); // Version 2, no padding, no extension, no CSRC

        // Byte 1: Marker(0) + Payload Type
        packet.put_u8(self.payload_type); // No marker bit, Opus payload type

        // Bytes 2-3: Sequence number (big-endian)
        packet.put_u16(self.sequence_number);

        // Bytes 4-7: Timestamp (big-endian)
        packet.put_u32(self.timestamp);

        // Bytes 8-11: SSRC (big-endian)
        packet.put_u32(self.ssrc);

        // Payload: Opus encoded data
        packet.put_slice(opus_data);

        // Update counters for next packet
        self.sequence_number = self.sequence_number.wrapping_add(1);
        self.timestamp = self.timestamp.wrapping_add(self.timestamp_increment);

        Ok(packet.freeze())
    }

    /// Get current RTP timestamp (for debugging/monitoring)
    pub fn current_timestamp(&self) -> u32 {
        self.timestamp
    }

    /// Get current sequence number (for debugging/monitoring)
    pub fn current_sequence(&self) -> u16 {
        self.sequence_number
    }

    /// Set DSCP marking for QoS
    pub fn set_dscp_marking(&mut self, dscp: u8) {
        self.dscp_marking = dscp;
    }

    /// Get DSCP marking value
    pub fn dscp_marking(&self) -> u8 {
        self.dscp_marking
    }

    /// Get timestamp increment per frame
    pub fn timestamp_increment(&self) -> u32 {
        self.timestamp_increment
    }
}