use mediasoup::{
    worker::WorkerSettings,
    worker_manager::WorkerManager,
    router::{Router, RouterOptions},
    prelude::*,
};
use std::{sync::Arc, num::NonZero};

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
            mime_type: MimeTypeAudio::Opus,
            preferred_payload_type: Some(111),
            clock_rate: NonZero::new(48000).unwrap(),
            channels: NonZero::new(2).unwrap(),
            parameters: RtpCodecParametersParameters::default(),
            rtcp_feedback: vec![],
        },
    ]
}