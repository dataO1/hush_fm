use mediasoup::{
    prelude::*, router::{Router, RouterOptions}, worker::{WorkerLogLevel, WorkerSettings}, worker_manager::WorkerManager
};
use std::sync::Arc;

pub mod transport;
pub mod producer;
pub mod consumer;

pub use transport::{TransportManager, LocalTransportConfig};
pub use producer::{ProducerManager, ProducerState};
pub use consumer::{ConsumerManager, ConsumerState, RoomConsumerManager};

#[derive(Clone)]
pub struct MediasoupState {
    worker_manager: Arc<WorkerManager>,
    transport_manager: TransportManager,
}

impl MediasoupState {
    pub async fn new() -> anyhow::Result<Self> {
        let worker_manager = WorkerManager::new();

        // Try to get local network IP, fallback to localhost
        let transport_config = match LocalTransportConfig::wifi_network() {
            Ok(config) => {
                tracing::info!("Using WiFi network configuration: {}", config.local_ip);
                config
            }
            Err(_) => {
                tracing::warn!("Failed to detect local IP, using localhost");
                LocalTransportConfig::localhost()
            }
        };

        Ok(Self {
            worker_manager: Arc::new(worker_manager),
            transport_manager: TransportManager::new(transport_config),
        })
    }

    pub async fn create_router(&self) -> anyhow::Result<Router> {
        // disable liburing, since it fails
        let mut worker_settings = WorkerSettings::default();
        worker_settings.enable_liburing = false;
        worker_settings.log_level = WorkerLogLevel::Warn;
        // Create worker
        let worker = self.worker_manager
            .create_worker(worker_settings)
            .await?;

        // Create router with media codecs
        let router = worker
            .create_router(RouterOptions::new(get_media_codecs()))
            .await?;

        Ok(router)
    }

    pub fn get_transport_manager(&self) -> &TransportManager {
        &self.transport_manager
    }
}

fn get_media_codecs() -> Vec<RtpCodecCapability> {
    // Use the preferred audio capabilities from ProducerManager
    producer::ProducerManager::get_preferred_audio_capabilities()
}
