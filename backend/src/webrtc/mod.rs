use mediasoup::{
    worker::{Worker, WorkerSettings},
    worker_manager::WorkerManager,
    router::{Router, RouterOptions},
    rtp_capabilities::RtpCodecCapability,
    data_structures::{DtlsParameters, RtpParameters},
};
use std::sync::Arc;

#[derive(Clone)]
pub struct MediasoupState {
    worker_manager: Arc<WorkerManager>,
}

impl MediasoupState {
    pub async fn new() -> anyhow::Result<Self> {
        let worker_manager = WorkerManager::new();

        Ok(Self {
            worker_manager: Arc::new(worker_manager),
        })
    }

    pub async fn create_router(&self) -> anyhow::Result<Router> {
        // Create worker
        let worker = self.worker_manager
            .create_worker(WorkerSettings::default())
            .await?;

        // Create router with media codecs
        let router = worker
            .create_router(RouterOptions::new(get_media_codecs()))
            .await?;

        Ok(router)
    }
}

fn get_media_codecs() -> Vec<RtpCodecCapability> {
    vec![
        RtpCodecCapability::Audio {
            mime_type: "audio/opus".to_string(),
            preferred_payload_type: Some(111),
            clock_rate: 48000,
            channels: Some(2),
            parameters: [("useinbandfec".to_string(), "1".to_string())]
                .iter()
                .cloned()
                .collect(),
            rtcp_feedback: vec![],
        },
    ]
}