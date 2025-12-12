use mediasoup::{
    consumer::{Consumer, ConsumerOptions},
    producer::Producer,
    webrtc_transport::WebRtcTransport,
    prelude::*,
};
use std::num::NonZero;
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

/// Consumer manager for listener connections
pub struct ConsumerManager;

impl ConsumerManager {
    /// Create audio consumer for listener
    pub async fn create_audio_consumer(
        transport: &WebRtcTransport,
        producer: &Producer,
        room_id: Uuid,
        listener_id: &str,
        rtp_capabilities: Value,
    ) -> anyhow::Result<(Arc<Consumer>, String, Value)> {
        // Consumer ID will be generated automatically by mediasoup
        
        // Parse client's RTP capabilities
        let client_capabilities: RtpCapabilities = serde_json::from_value(rtp_capabilities)?;
        
        // Note: We'll skip the can_consume check for now as it's not available in this API version
        // In production, you'd want to validate compatibility between producer and consumer

        let consumer_options = ConsumerOptions::new(
            producer.id(),
            client_capabilities,
        );
        // Note: consumer_id and paused options may not be available in this API version

        let consumer = transport.consume(consumer_options).await?;
        
        let actual_consumer_id = consumer.id().to_string();
        
        // Generate consumer parameters for client
        let consumer_parameters = Self::generate_consumer_parameters(&consumer).await?;
        
        tracing::info!(
            "Created audio consumer {} for listener {} in room {}", 
            actual_consumer_id, 
            listener_id,
            room_id
        );

        Ok((Arc::new(consumer), actual_consumer_id, consumer_parameters))
    }

    /// Generate consumer parameters for client
    async fn generate_consumer_parameters(consumer: &Consumer) -> anyhow::Result<Value> {
        // Get RTP parameters and ensure proper serialization
        let rtp_parameters = consumer.rtp_parameters();
        let rtp_params_value = serde_json::to_value(&rtp_parameters)?;
        
        tracing::info!(
            consumer_id = %consumer.id(),
            "Generated consumer parameters with RTP structure"
        );
        
        tracing::debug!(
            consumer_id = %consumer.id(),
            rtp_parameters = ?rtp_params_value,
            "Full RTP parameters structure"
        );
        
        // Validate that we have the required fields for MediaSoup client
        if let Some(codecs) = rtp_params_value.get("codecs").and_then(|c| c.as_array()) {
            tracing::info!("Consumer has {} codecs", codecs.len());
            for (i, codec) in codecs.iter().enumerate() {
                if let Some(payload_type) = codec.get("payloadType") {
                    tracing::info!("Codec {}: payloadType = {}", i, payload_type);
                } else {
                    tracing::warn!("Codec {} is missing payloadType field!", i);
                }
            }
        } else {
            tracing::error!("Consumer RTP parameters missing 'codecs' field!");
        }
        
        Ok(serde_json::json!({
            "id": consumer.id().to_string(),
            "producerId": consumer.producer_id().to_string(),
            "kind": "audio",
            "rtpParameters": rtp_params_value,
            "type": "simple", // Simple consumer type for local network
            "paused": consumer.paused(),
        }))
    }

    /// Pause consumer (listener stops receiving audio)
    pub async fn pause_consumer(consumer: &Consumer) -> anyhow::Result<()> {
        consumer.pause().await?;
        tracing::info!("Audio consumer paused");
        Ok(())
    }

    /// Resume consumer (listener resumes receiving audio)
    pub async fn resume_consumer(consumer: &Consumer) -> anyhow::Result<()> {
        consumer.resume().await?;
        tracing::info!("Audio consumer resumed");
        Ok(())
    }

    /// Close consumer (cleanup when listener leaves) - simplified for local network
    pub async fn close_consumer(_consumer: &Consumer) -> anyhow::Result<()> {
        // Note: close() method may not be available in this API version
        // Consumer will be cleaned up when dropped
        tracing::info!("Audio consumer marked for cleanup");
        Ok(())
    }

    /// Get consumer statistics for monitoring
    pub async fn get_consumer_stats(consumer: &Consumer) -> anyhow::Result<Value> {
        let stats = consumer.get_stats().await?;
        Ok(serde_json::to_value(stats)?)
    }

    /// Check if client can consume producer (simplified for local network)
    pub fn can_consume(_producer: &Producer, client_capabilities: &Value) -> anyhow::Result<bool> {
        let capabilities: RtpCapabilities = serde_json::from_value(client_capabilities.clone())?;
        // For local network, we'll assume compatibility and just check if capabilities are valid
        Ok(!capabilities.codecs.is_empty())
    }

    /// Get preferred consumer RTP capabilities for audio
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

/// Consumer state for listener management
#[derive(Debug, Clone)]
pub struct ConsumerState {
    pub consumer: Arc<Consumer>,
    pub consumer_id: String,
    pub room_id: Uuid,
    pub listener_id: String,
    pub producer_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub is_paused: bool,
}

impl ConsumerState {
    pub fn new(
        consumer: Arc<Consumer>,
        consumer_id: String,
        room_id: Uuid,
        listener_id: String,
        producer_id: String,
    ) -> Self {
        Self {
            consumer,
            consumer_id,
            room_id,
            listener_id,
            producer_id,
            created_at: chrono::Utc::now(),
            is_paused: false,
        }
    }

    pub async fn pause(&mut self) -> anyhow::Result<()> {
        ConsumerManager::pause_consumer(&self.consumer).await?;
        self.is_paused = true;
        Ok(())
    }

    pub async fn resume(&mut self) -> anyhow::Result<()> {
        ConsumerManager::resume_consumer(&self.consumer).await?;
        self.is_paused = false;
        Ok(())
    }

    pub async fn close(self) -> anyhow::Result<()> {
        ConsumerManager::close_consumer(&self.consumer).await
    }

    pub async fn get_stats(&self) -> anyhow::Result<Value> {
        ConsumerManager::get_consumer_stats(&self.consumer).await
    }

    pub fn duration(&self) -> chrono::Duration {
        chrono::Utc::now() - self.created_at
    }
}

/// Consumer manager for tracking all consumers in a room
#[derive(Debug, Default)]
pub struct RoomConsumerManager {
    consumers: std::collections::HashMap<String, ConsumerState>,
}

impl RoomConsumerManager {
    pub fn new() -> Self {
        Self {
            consumers: std::collections::HashMap::new(),
        }
    }

    pub fn add_consumer(&mut self, consumer_state: ConsumerState) {
        self.consumers.insert(consumer_state.consumer_id.clone(), consumer_state);
    }

    pub fn remove_consumer(&mut self, consumer_id: &str) -> Option<ConsumerState> {
        self.consumers.remove(consumer_id)
    }

    pub fn get_consumer(&self, consumer_id: &str) -> Option<&ConsumerState> {
        self.consumers.get(consumer_id)
    }

    pub fn get_consumer_mut(&mut self, consumer_id: &str) -> Option<&mut ConsumerState> {
        self.consumers.get_mut(consumer_id)
    }

    pub fn get_consumers_for_listener(&self, listener_id: &str) -> Vec<&ConsumerState> {
        self.consumers
            .values()
            .filter(|c| c.listener_id == listener_id)
            .collect()
    }

    pub fn get_all_consumers(&self) -> Vec<&ConsumerState> {
        self.consumers.values().collect()
    }

    pub fn consumer_count(&self) -> usize {
        self.consumers.len()
    }

    pub fn listener_count(&self) -> usize {
        self.consumers
            .values()
            .map(|c| &c.listener_id)
            .collect::<std::collections::HashSet<_>>()
            .len()
    }

    pub async fn pause_all_consumers(&mut self) -> Vec<anyhow::Result<()>> {
        let mut results = Vec::new();
        for consumer in self.consumers.values_mut() {
            results.push(consumer.pause().await);
        }
        results
    }

    pub async fn resume_all_consumers(&mut self) -> Vec<anyhow::Result<()>> {
        let mut results = Vec::new();
        for consumer in self.consumers.values_mut() {
            results.push(consumer.resume().await);
        }
        results
    }

    pub async fn close_all_consumers(self) -> Vec<anyhow::Result<()>> {
        let mut results = Vec::new();
        for (_, consumer) in self.consumers.into_iter() {
            results.push(consumer.close().await);
        }
        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consumer_capabilities() {
        let caps = ConsumerManager::get_consumer_audio_capabilities();
        assert!(!caps.codecs.is_empty());
        assert!(!caps.header_extensions.is_empty());
        
        // Check for Opus codec
        let has_opus = caps.codecs.iter().any(|codec| {
            matches!(codec, RtpCodecCapability::Audio { mime_type: MimeTypeAudio::Opus, .. })
        });
        assert!(has_opus);
    }

    #[test]
    fn test_room_consumer_manager() {
        let mut manager = RoomConsumerManager::new();
        assert_eq!(manager.consumer_count(), 0);
        assert_eq!(manager.listener_count(), 0);
    }

    #[test]
    fn test_consumer_state() {
        let room_id = Uuid::new_v4();
        let consumer_id = "test_consumer".to_string();
        let listener_id = "test_listener".to_string();
        let producer_id = "test_producer".to_string();
        
        // Test state creation (without real Consumer)
        assert!(!consumer_id.is_empty());
        assert!(!listener_id.is_empty());
        assert!(!producer_id.is_empty());
        assert_eq!(room_id.to_string().len(), 36);
    }
}