/// Opus encoding pipeline running in async task
/// 
/// This module provides the main audio encoding loop that:
/// 1. Pulls PCM audio from the ring buffer (960 samples = 20ms at 48kHz)
/// 2. Encodes to Opus using optimized settings for music streaming
/// 3. Creates RTP packets and sends them via DirectProducer

use audiopus::{coder::Encoder, Channels, Application, SampleRate as OpusSampleRate, Bitrate};
use ringbuf::{Consumer, SharedRb};
use mediasoup::producer::Producer;
use tokio::time::Duration;
use anyhow::{Result, Context};
use std::sync::Arc;

use crate::lib::audio::rtp_packetizer::RtpPacketizer;
use crate::lib::audio::audio_capture::OPUS_SAMPLE_RATE;
use crate::lib::config::Config;

/// Audio encoding constants
const OPUS_CHANNELS: usize = 2; // Stereo audio

/// Audio encoding pipeline that processes ring buffer data
pub struct AudioEncoder {
    /// Opus encoder instance
    opus_encoder: Encoder,
    /// RTP packet builder
    rtp_packetizer: RtpPacketizer,
    /// MediaSoup Producer for sending RTP packets
    direct_producer: Arc<Producer>,
    /// Ring buffer consumer for reading audio data
    ring_consumer: Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>,
    /// Shutdown signal receiver
    shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    /// Configuration reference
    config: &'static Config,
}

impl AudioEncoder {
    /// Create new audio encoder pipeline
    /// 
    /// # Arguments
    /// * `direct_producer` - MediaSoup Producer for RTP packet injection
    /// * `ring_consumer` - Ring buffer consumer for reading PCM audio data
    /// * `shutdown_rx` - Shutdown signal receiver for graceful cleanup
    pub fn new(
        direct_producer: Arc<Producer>,
        ring_consumer: Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>,
        shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    ) -> Result<Self> {
        Self::new_with_rtp_state(direct_producer, ring_consumer, shutdown_rx, None)
    }

    /// Create new audio encoder pipeline with initial RTP state for continuity
    /// 
    /// # Arguments
    /// * `direct_producer` - MediaSoup Producer for RTP packet injection
    /// * `ring_consumer` - Ring buffer consumer for reading PCM audio data
    /// * `shutdown_rx` - Shutdown signal receiver for graceful cleanup
    /// * `initial_rtp_state` - Optional (sequence_number, timestamp) for continuity
    pub fn new_with_rtp_state(
        direct_producer: Arc<Producer>,
        ring_consumer: Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>,
        shutdown_rx: tokio::sync::mpsc::Receiver<()>,
        initial_rtp_state: Option<(u16, u32)>,
    ) -> Result<Self> {
        let config = Config::global();
        
        tracing::info!("🎵 Initializing Opus encoder pipeline");

        // Create Opus encoder with configurable settings for music
        tracing::info!("Creating Opus encoder: 48kHz, stereo, music application");
        let mut opus_encoder = Encoder::new(
            OpusSampleRate::Hz48000,
            Channels::Stereo,
            Application::Audio, // Optimized for music vs speech
        ).context("Failed to create Opus encoder")?;

        // Configure encoder for music streaming using config values
        opus_encoder.set_bitrate(Bitrate::BitsPerSecond(config.opus_bitrate() as i32))
            .context("Failed to set Opus bitrate")?;
        
        opus_encoder.set_complexity(config.opus_complexity().try_into().unwrap())
            .context("Failed to set Opus complexity")?;
        
        // Configure VBR mode
        if config.opus_enable_vbr() {
            opus_encoder.enable_vbr().context("Failed to enable Opus VBR")?;
        } else {
            opus_encoder.disable_vbr().context("Failed to disable Opus VBR")?;
        }

        // Configure forward error correction based on config.
        // FEC only inserts redundancy when the encoder expects loss, so pair it
        // with the configured packet-loss percentage — otherwise it stays dormant.
        if config.opus_enable_fec() {
            opus_encoder.enable_inband_fec()
                .context("Failed to enable Opus FEC")?;
            opus_encoder.set_packet_loss_perc(config.opus_packet_loss_perc())
                .context("Failed to set Opus packet-loss percentage")?;
        } else {
            opus_encoder.disable_inband_fec()
                .context("Failed to disable Opus FEC")?;
        }

        tracing::info!(
            "✅ Opus encoder configured: {}kbps, {}Hz, {} channels, complexity={}, VBR={}, FEC={}, frame={}ms",
            config.opus_bitrate() / 1000,
            OPUS_SAMPLE_RATE,
            OPUS_CHANNELS,
            config.opus_complexity(),
            config.opus_enable_vbr(),
            config.opus_enable_fec(),
            config.opus_frame_duration()
        );

        // Create RTP packetizer with optional initial state for continuity
        let rtp_packetizer = match initial_rtp_state {
            Some((sequence, timestamp)) => {
                tracing::info!("🎵 Resuming RTP stream: seq={}, ts={}", sequence, timestamp);
                RtpPacketizer::with_initial_state(config.opus_frame_duration(), sequence, timestamp)
            },
            None => {
                tracing::info!("🎵 Starting new RTP stream");
                RtpPacketizer::new(config.opus_frame_duration())
            }
        };

        Ok(Self {
            opus_encoder,
            rtp_packetizer,
            direct_producer,
            ring_consumer,
            shutdown_rx,
            config,
        })
    }

    /// Get current RTP state (sequence number and timestamp) for continuity
    pub fn get_rtp_state(&self) -> (u16, u32) {
        (self.rtp_packetizer.current_sequence(), self.rtp_packetizer.current_timestamp())
    }

    /// Start the encoding pipeline
    /// 
    /// This runs in a dedicated async task and continuously processes available audio frames.
    /// Uses adaptive processing to maintain low latency and prevent buffer overruns.
    /// Handles ring buffer underruns gracefully by sending silence frames.
    /// The task will run until a shutdown signal is received or an unrecoverable error occurs.
    /// 
    /// Returns the final RTP state (sequence_number, timestamp) for continuity
    pub async fn run(mut self) -> (u16, u32) {
        tracing::info!("🎵 Starting audio encoding pipeline with continuous processing");

        let mut frame_count = 0u64;
        let mut total_samples_consumed = 0u64;
        let mut silence_frames_sent = 0u64;
        let mut last_metrics_log = std::time::Instant::now();
        let mut last_audio_time = std::time::Instant::now();
        let start_time = std::time::Instant::now();

        // Continuous audio processing loop
        loop {
            // Check for shutdown signal (non-blocking)
            if let Ok(_) = self.shutdown_rx.try_recv() {
                tracing::info!("🛑 Audio encoder received shutdown signal");
                break;
            }
            
            // Check if we have enough samples for a frame
            let available_samples = self.ring_consumer.len();
            let samples_needed = (self.config.opus_frame_size() * OPUS_CHANNELS as u32) as usize;
            
            // Detect ring buffer overrun and recover
            let buffer_capacity = self.config.ring_buffer_capacity() as usize;
            let overrun_threshold = buffer_capacity * 9 / 10; // 90% of buffer capacity
            if available_samples >= overrun_threshold {
                tracing::warn!("Ring buffer overrun detected ({} samples, {:.1}% full), clearing excess data", 
                             available_samples, (available_samples as f32 / buffer_capacity as f32) * 100.0);
                // Clear excess samples to get back to manageable level (keep ~3 frames worth)
                let target_samples = samples_needed * 3;
                let samples_to_drop = available_samples.saturating_sub(target_samples);
                for _ in 0..samples_to_drop {
                    if self.ring_consumer.pop().is_none() {
                        break;
                    }
                }
                tracing::info!("Dropped {} samples, buffer now has {} samples", 
                             samples_to_drop, self.ring_consumer.len());
            }
            
            if available_samples >= samples_needed {
                // Process the frame with real audio data
                if let Err(e) = self.process_audio_frame(frame_count).await {
                    tracing::error!("Audio encoding error: {}", e);
                }
                frame_count += 1;
                total_samples_consumed += samples_needed as u64;
                last_audio_time = std::time::Instant::now();
                
                // Adaptive processing: If buffer is getting full, process multiple frames to catch up
                let catch_up_threshold = samples_needed * 3; // 3 frames worth
                if available_samples >= catch_up_threshold {
                    tracing::debug!("Ring buffer filling up ({}), processing additional frames", available_samples);
                    // Process up to 2 more frames to catch up
                    for _ in 0..2 {
                        if self.ring_consumer.len() >= samples_needed {
                            if let Err(e) = self.process_audio_frame(frame_count).await {
                                tracing::error!("Catch-up encoding error: {}", e);
                                break;
                            }
                            frame_count += 1;
                            total_samples_consumed += samples_needed as u64;
                        } else {
                            break;
                        }
                    }
                }
                
                // Log metrics every 5 seconds with rate analysis
                if last_metrics_log.elapsed() >= Duration::from_secs(5) {
                    let fill_ratio = available_samples as f32 / buffer_capacity as f32;
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let consumption_rate = total_samples_consumed as f64 / elapsed;
                    let expected_rate = 48000.0 * 2.0; // 48kHz stereo
                    
                    tracing::info!("🎵 Audio pipeline: {} frames ({} audio, {} silence), fill: {:.1}%, rate: {:.0} Hz (expected: {:.0} Hz)", 
                                 frame_count, frame_count - silence_frames_sent, silence_frames_sent, fill_ratio * 100.0, consumption_rate, expected_rate);
                    
                    if (consumption_rate - expected_rate).abs() > 1000.0 {
                        tracing::warn!("⚠️ Sample rate mismatch: consuming at {:.0} Hz vs expected {:.0} Hz", 
                                     consumption_rate, expected_rate);
                    }
                    
                    last_metrics_log = std::time::Instant::now();
                }
            } else {
                // Ring buffer underrun - send silence to maintain stream timing
                let silence_threshold = Duration::from_millis(50); // Send silence after 50ms without audio
                
                if last_audio_time.elapsed() > silence_threshold {
                    if let Err(e) = self.encode_and_send_silence(frame_count).await {
                        tracing::error!("Silence frame encoding error: {}", e);
                    }
                    frame_count += 1;
                    silence_frames_sent += 1;
                    
                    // Log device disconnection after extended silence (very rarely)
                    if silence_frames_sent % 6000 == 0 { // Every ~2 minutes of silence
                        tracing::warn!("🔇 Sending silence frames - no audio device data (frame {})", silence_frames_sent);
                    }
                } else {
                    // Short sleep to avoid busy waiting when we just started or recently had audio
                    tokio::time::sleep(Duration::from_micros(1000)).await; // 1ms
                }
            }
        }

        let final_rtp_state = self.get_rtp_state();
        tracing::info!("✅ Audio encoding pipeline stopped after processing {} frames (duration: {:.2}s), final RTP state: seq={}, ts={}", 
                      frame_count, start_time.elapsed().as_secs_f32(), final_rtp_state.0, final_rtp_state.1);
        
        final_rtp_state
    }

    /// Process a single audio frame (configurable duration worth of audio)
    async fn process_audio_frame(&mut self, frame_count: u64) -> Result<()> {
        // Calculate required samples for stereo frame based on config
        let samples_needed = (self.config.opus_frame_size() * OPUS_CHANNELS as u32) as usize;

        // Ensure we have enough samples before reading
        if self.ring_consumer.len() < samples_needed {
            // This shouldn't happen as we check before calling, but be defensive
            tracing::warn!("Not enough samples in buffer: {} < {}", self.ring_consumer.len(), samples_needed);
            return self.encode_and_send_silence(frame_count).await;
        }

        // Read exactly one frame's worth of samples
        let mut pcm_frame = Vec::with_capacity(samples_needed);
        
        // Use bulk read for better performance
        for _ in 0..samples_needed {
            match self.ring_consumer.pop() {
                Some(sample) => pcm_frame.push(sample),
                None => {
                    // This shouldn't happen but handle gracefully
                    tracing::error!("Ring buffer underrun during frame read at sample {}", pcm_frame.len());
                    // Pad with silence to complete the frame
                    pcm_frame.resize(samples_needed, 0.0);
                    break;
                }
            }
        }

        // Verify we got the right number of samples
        if pcm_frame.len() != samples_needed {
            tracing::warn!("Frame size mismatch: expected {}, got {}", samples_needed, pcm_frame.len());
            pcm_frame.resize(samples_needed, 0.0);
        }

        // Log stereo pattern every 250 frames (5 seconds) to verify interleaving
        if frame_count % 250 == 0 && pcm_frame.len() >= 8 {
            tracing::debug!("Stereo pattern check: [{:.3}, {:.3}, {:.3}, {:.3}, {:.3}, {:.3}, {:.3}, {:.3}]", 
                           pcm_frame[0], pcm_frame[1], pcm_frame[2], pcm_frame[3],
                           pcm_frame[4], pcm_frame[5], pcm_frame[6], pcm_frame[7]);
        }

        // Encode PCM to Opus
        self.encode_and_send_audio(&pcm_frame, frame_count).await
    }

    /// Encode PCM audio and send via DirectProducer
    async fn encode_and_send_audio(&mut self, pcm_data: &[f32], frame_count: u64) -> Result<()> {
        
        // Validate input data
        if pcm_data.is_empty() {
            anyhow::bail!("Empty PCM data provided for encoding");
        }
        
        let expected_frame_size = (self.config.opus_frame_size() * OPUS_CHANNELS as u32) as usize;
        if pcm_data.len() != expected_frame_size {
            tracing::warn!("Unexpected PCM frame size: {} (expected {})", 
                pcm_data.len(), expected_frame_size);
        }
        
        // Encode PCM to Opus
        let mut opus_output = vec![0u8; 4000]; // Opus max frame size
        let opus_len = match self.opus_encoder.encode_float(pcm_data, &mut opus_output) {
            Ok(len) => len,
            Err(e) => {
                tracing::error!("Opus encoding failed with error: {:?}", e);
                tracing::error!("PCM data length: {}, first few samples: {:?}", 
                    pcm_data.len(), 
                    &pcm_data[..pcm_data.len().min(10)]);
                anyhow::bail!("Opus encoding failed: {:?}", e);
            }
        };

        // Trim to actual encoded size
        opus_output.truncate(opus_len);

        // Create RTP packet
        let rtp_packet = self.rtp_packetizer
            .create_packet(&opus_output)
            .context("RTP packetization failed")?;

        // Send via MediaSoup Producer with timeout to prevent blocking
        if let mediasoup::producer::Producer::Direct(ref direct_producer) = self.direct_producer.as_ref() {
            // Use timeout to prevent blocking the encoder if network is congested
            let send_result = tokio::time::timeout(
                Duration::from_millis(5), // 5ms timeout for low-latency
                async {
                    direct_producer
                        .send(rtp_packet.to_vec())
                        .map_err(|e| anyhow::anyhow!("DirectProducer send failed: {}", e))
                }
            ).await;
            
            match send_result {
                Ok(Ok(())) => {
                    // Successfully sent
                }
                Ok(Err(e)) => {
                    tracing::warn!("DirectProducer send error: {}", e);
                    // Continue processing, don't fail the entire pipeline
                }
                Err(_) => {
                    tracing::warn!("DirectProducer send timeout (>5ms), dropping packet to maintain latency");
                    // Drop this packet to maintain real-time performance
                }
            }
        } else {
            anyhow::bail!("Expected DirectProducer for audio bot");
        }

        // Log occasionally for monitoring (much less frequently)
        if self.rtp_packetizer.current_sequence() % 3000 == 0 { // Every 60 seconds
            tracing::debug!(
                "🎵 Sent audio: seq={}, ts={}, opus_len={}",
                self.rtp_packetizer.current_sequence(),
                self.rtp_packetizer.current_timestamp(),
                opus_len
            );
        }

        Ok(())
    }

    /// Encode and send a silence frame to maintain stream timing
    async fn encode_and_send_silence(&mut self, frame_count: u64) -> Result<()> {
        // Create silent PCM frame
        let silence_samples = (self.config.opus_frame_size() * OPUS_CHANNELS as u32) as usize;
        let silence_pcm = vec![0f32; silence_samples];

        // Encode and send the silence
        self.encode_and_send_audio(&silence_pcm, frame_count).await
    }
}