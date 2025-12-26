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
use crate::lib::audio::audio_capture::{OPUS_FRAME_SIZE, OPUS_SAMPLE_RATE, OPUS_CHANNELS};

/// Opus encoder configuration optimized for music streaming
const OPUS_BITRATE: u32 = 320_000;     // 320 kbps for high quality music
const OPUS_COMPLEXITY: u32 = 10;       // Maximum quality (0-10)

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
        tracing::info!("🎵 Initializing Opus encoder pipeline");

        // Create Opus encoder with high-quality settings for music
        tracing::info!("Creating Opus encoder: 48kHz, stereo, music application");
        let mut opus_encoder = Encoder::new(
            OpusSampleRate::Hz48000,
            Channels::Stereo,
            Application::Audio, // Optimized for music vs speech
        ).context("Failed to create Opus encoder")?;

        // Configure encoder for high quality music streaming
        opus_encoder.set_bitrate(Bitrate::BitsPerSecond(OPUS_BITRATE as i32))
            .context("Failed to set Opus bitrate")?;
        
        opus_encoder.set_complexity(OPUS_COMPLEXITY.try_into().unwrap())
            .context("Failed to set Opus complexity")?;
        
        // Enable forward error correction for network resilience
        opus_encoder.enable_inband_fec()
            .context("Failed to enable Opus FEC")?;

        tracing::info!(
            "✅ Opus encoder configured: {}kbps, {}Hz, {} channels, complexity={}",
            OPUS_BITRATE / 1000,
            OPUS_SAMPLE_RATE,
            OPUS_CHANNELS,
            OPUS_COMPLEXITY
        );

        Ok(Self {
            opus_encoder,
            rtp_packetizer: RtpPacketizer::new(),
            direct_producer,
            ring_consumer,
            shutdown_rx,
        })
    }

    /// Start the encoding pipeline
    /// 
    /// This runs in a dedicated async task and continuously processes available audio frames.
    /// Uses adaptive processing to maintain low latency and prevent buffer overruns.
    /// The task will run until a shutdown signal is received or an unrecoverable error occurs.
    pub async fn run(mut self) {
        tracing::info!("🎵 Starting audio encoding pipeline with continuous processing");

        let mut frame_count = 0u64;
        let mut total_samples_consumed = 0u64;
        let mut last_metrics_log = std::time::Instant::now();
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
            let samples_needed = OPUS_FRAME_SIZE * OPUS_CHANNELS; // 1920 samples
            
            // Detect ring buffer overrun and recover
            let overrun_threshold = 9600 * 9 / 10; // 90% of buffer capacity
            if available_samples >= overrun_threshold {
                tracing::warn!("Ring buffer overrun detected ({} samples, {:.1}% full), clearing excess data", 
                             available_samples, (available_samples as f32 / 9600.0) * 100.0);
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
                // Process the frame
                if let Err(e) = self.process_audio_frame(frame_count).await {
                    tracing::error!("Audio encoding error: {}", e);
                }
                frame_count += 1;
                total_samples_consumed += samples_needed as u64;
                
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
                    let fill_ratio = available_samples as f32 / 9600.0; // Total ring buffer capacity
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let consumption_rate = total_samples_consumed as f64 / elapsed;
                    let expected_rate = 48000.0 * 2.0; // 48kHz stereo
                    
                    tracing::info!("🎵 Audio pipeline: {} frames, fill: {:.1}%, rate: {:.0} Hz (expected: {:.0} Hz)", 
                                 frame_count, fill_ratio * 100.0, consumption_rate, expected_rate);
                    
                    if (consumption_rate - expected_rate).abs() > 1000.0 {
                        tracing::warn!("⚠️ Sample rate mismatch: consuming at {:.0} Hz vs expected {:.0} Hz", 
                                     consumption_rate, expected_rate);
                    }
                    
                    last_metrics_log = std::time::Instant::now();
                }
            } else {
                // Not enough data, short sleep to avoid busy waiting
                tokio::time::sleep(Duration::from_micros(1000)).await; // 1ms
            }
        }

        tracing::info!("✅ Audio encoding pipeline stopped after processing {} frames", frame_count);
    }

    /// Process a single audio frame (20ms worth of audio)
    async fn process_audio_frame(&mut self, frame_count: u64) -> Result<()> {
        // Calculate required samples for stereo 20ms frame
        let samples_needed = OPUS_FRAME_SIZE * OPUS_CHANNELS; // 960 * 2 = 1920 samples

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
        tracing::debug!("Encoding {} PCM samples", pcm_data.len());
        
        // Validate input data
        if pcm_data.is_empty() {
            anyhow::bail!("Empty PCM data provided for encoding");
        }
        
        if pcm_data.len() != OPUS_FRAME_SIZE * OPUS_CHANNELS {
            tracing::warn!("Unexpected PCM frame size: {} (expected {})", 
                pcm_data.len(), OPUS_FRAME_SIZE * OPUS_CHANNELS);
        }
        
        // Encode PCM to Opus
        let mut opus_output = vec![0u8; 4000]; // Opus max frame size
        let opus_len = match self.opus_encoder.encode_float(pcm_data, &mut opus_output) {
            Ok(len) => {
                tracing::debug!("Opus encoding successful: {} bytes", len);
                len
            }
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

        // Log occasionally for monitoring
        if self.rtp_packetizer.current_sequence() % 250 == 0 { // Every 5 seconds
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
        tracing::debug!("Encoding silence frame");
        
        // Create silent PCM frame
        let silence_samples = OPUS_FRAME_SIZE * OPUS_CHANNELS;
        let silence_pcm = vec![0f32; silence_samples];
        
        tracing::debug!("Created silence frame with {} samples", silence_pcm.len());

        // Encode and send the silence
        self.encode_and_send_audio(&silence_pcm, frame_count).await
    }
}