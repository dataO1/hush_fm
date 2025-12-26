/// Audio capture using CPAL with lock-free ring buffer
/// 
/// This module handles audio device initialization and capture from the default
/// audio input device. It uses a lock-free ring buffer to transfer audio data
/// from the real-time audio callback to the async encoder task.

use cpal::{
    Device, SampleFormat, SampleRate, Stream, StreamConfig, 
    traits::{DeviceTrait, HostTrait, StreamTrait}
};
use ringbuf::{SharedRb, Producer, Consumer, Rb};
use anyhow::{Result, Context};

/// Audio capture configuration optimized for Opus encoding
const SAMPLE_RATE: u32 = 48000;    // Opus native sample rate
const CHANNELS: u16 = 2;           // Stereo audio
const FRAMES_PER_BUFFER: usize = 960; // 20ms at 48kHz (Opus frame size)
const RING_BUFFER_CAPACITY: usize = 9600; // ~200ms of audio for low-latency streaming (10 frames)

/// Audio capture system with ring buffer for thread-safe audio transfer
pub struct AudioCapture {
    /// CPAL audio input stream (keeping this alive maintains the audio capture)
    _stream: Stream,
}

impl AudioCapture {
    /// Initialize audio capture with default input device
    /// 
    /// This sets up:
    /// 1. Default audio input device at 48kHz stereo
    /// 2. Lock-free ring buffer for audio transfer
    /// 3. Real-time audio callback that feeds the ring buffer
    /// 
    /// # Returns
    /// * `(AudioCapture, Consumer)` - Audio system and ring buffer consumer
    pub fn new() -> Result<(Self, Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>)> {
        tracing::info!("🎤 Initializing audio capture system");

        // Initialize CPAL host (auto-detects best backend: ALSA/PulseAudio/PipeWire)
        let host = cpal::default_host();
        
        // Try to find a USB audio interface first, fall back to default if none found
        let device = Self::find_usb_audio_interface(&host)
            .or_else(|| {
                tracing::warn!("No USB audio interface found, falling back to default input device");
                host.default_input_device()
            })
            .context("No suitable input device available")?;

        let device_info = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| "Unknown".to_string());
        tracing::info!("🎤 Using audio device: {}", device_info);

        // Try to create stream with selected device first, fallback if needed
        let (stream, ring_consumer) = Self::create_audio_stream(&device)
            .or_else(|e| {
                tracing::warn!("Failed to create stream with selected device: {}", e);
                tracing::info!("Attempting fallback to default input device...");
                
                let fallback_device = host.default_input_device()
                    .context("No fallback input device available")?;
                    
                let fallback_name = fallback_device.description()
                    .map(|d| d.name().to_string())
                    .unwrap_or_else(|_| "Unknown".to_string());
                    
                tracing::info!("🎤 Using fallback audio device: {}", fallback_name);
                Self::create_audio_stream(&fallback_device)
            })?;

        // Start the audio stream
        stream.play().context("Failed to start audio stream")?;

        tracing::info!("✅ Audio capture initialized successfully");

        Ok((Self {
            _stream: stream,
        }, ring_consumer))
    }

    /// Find external audio interfaces using device name pattern matching
    /// 
    /// CPAL's interface type detection returns "Unknown" for all devices on Linux,
    /// so we use device name patterns to identify USB audio interfaces instead.
    fn find_usb_audio_interface(host: &cpal::Host) -> Option<Device> {
        tracing::info!("🔍 Searching for external audio interfaces using name patterns...");
        
        let devices = match host.devices() {
            Ok(devices) => devices,
            Err(e) => {
                tracing::error!("Failed to enumerate audio devices: {}", e);
                return None;
            }
        };

        // Known audio interface brands/patterns (prioritized order)
        let audio_interface_patterns = [
            // Professional audio interface brands
            "scarlett", "focusrite", "presonus", "steinberg", "rme", "motu", 
            "zoom", "tascam", "behringer", "mackie", "roland", "yamaha",
            "native instruments", "apogee", "universal audio", "antelope",
            // USB audio indicators
            "usb audio", "usb sound", "usb microphone", "usb mic",
            // Avoid built-in audio
        ];

        // Patterns to avoid (built-in audio)
        let builtin_patterns = [
            "built-in", "internal", "analog", "digital", "hdmi", "speakers",
            "headphones", "line out", "microphone", "webcam", "camera"
        ];

        let mut external_interfaces = Vec::new();
        
        for device in devices {
            let device_name = device.description()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|_| "Unknown".to_string());
            
            tracing::debug!("Checking device: {}", device_name);
            
            // Check if device supports input
            if device.default_input_config().is_err() {
                tracing::debug!("  → Skipping (no input capability)");
                continue;
            }

            let device_name_lower = device_name.to_lowercase();
            
            // Skip devices that match built-in patterns
            let is_builtin = builtin_patterns.iter()
                .any(|pattern| device_name_lower.contains(pattern));
            
            if is_builtin {
                tracing::debug!("  → Skipping built-in device: {}", device_name);
                continue;
            }

            // Check if device matches audio interface patterns
            let priority = audio_interface_patterns.iter()
                .position(|pattern| device_name_lower.contains(pattern));

            if let Some(priority_index) = priority {
                tracing::info!("  → Found external audio interface: {} (priority: {})", 
                             device_name, priority_index);
                external_interfaces.push((device, device_name, priority_index));
            } else {
                tracing::debug!("  → Skipping unknown device: {}", device_name);
            }
        }

        if external_interfaces.is_empty() {
            tracing::warn!("No external audio interfaces found using name patterns");
            return None;
        }

        // Sort by priority (lower index = higher priority)
        external_interfaces.sort_by_key(|(_, _, priority)| *priority);

        // Use the highest priority external interface
        let (selected_device, selected_name, priority) = external_interfaces.into_iter().next().unwrap();
        tracing::info!("Selected external audio interface: {} (priority: {})", selected_name, priority);

        Some(selected_device)
    }

    /// Create audio stream and ring buffer for a specific device
    fn create_audio_stream(device: &Device) -> Result<(Stream, Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>)> {
        // Configure audio stream for Opus-compatible settings
        let config = Self::create_stream_config(device)?;
        
        tracing::info!("🎤 Audio config: {}Hz, {} channels", config.sample_rate, config.channels);

        // Create ring buffer for lock-free audio transfer  
        let ring_buffer = SharedRb::<f32, Vec<std::mem::MaybeUninit<f32>>>::new(RING_BUFFER_CAPACITY);
        let (ring_producer, ring_consumer) = ring_buffer.split();

        // Build input stream with f32 samples (CPAL handles conversion)
        let stream = Self::build_f32_stream(device, &config, ring_producer)?;

        Ok((stream, ring_consumer))
    }

    /// Create optimal stream configuration for Opus encoding
    fn create_stream_config(device: &Device) -> Result<StreamConfig> {
        // Get supported input configurations
        let mut supported_configs = device
            .supported_input_configs()
            .context("Failed to get supported input configurations")?;

        // Find a configuration that supports our target sample rate
        let config = supported_configs
            .find(|config| {
                config.min_sample_rate() <= SAMPLE_RATE 
                && config.max_sample_rate() >= SAMPLE_RATE
                && config.channels() >= CHANNELS
            })
            .context("No suitable audio configuration found (need 48kHz stereo support)")?;

        // Build final configuration optimized for low-latency streaming
        let final_channels = CHANNELS.min(config.channels());
        
        // For stereo (2 channels): CPAL expects total sample count per callback
        // 960 frames * 2 channels = 1920 total samples per 20ms period
        let total_samples_per_period = (FRAMES_PER_BUFFER as u32) * (final_channels as u32);
        
        tracing::info!("🎤 Stream config: {}Hz, {} channels, {} samples per period", 
                      SAMPLE_RATE, final_channels, total_samples_per_period);
        
        Ok(StreamConfig {
            channels: final_channels,
            sample_rate: SAMPLE_RATE,
            // Use total sample count (frames * channels) for CPAL buffer size
            buffer_size: cpal::BufferSize::Fixed(total_samples_per_period),
        })
    }

    /// Build audio stream for f32 samples
    fn build_f32_stream(
        device: &Device,
        config: &StreamConfig,
        mut ring_producer: Producer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>
    ) -> Result<Stream> {
        // Create error counter for rate limiting ALSA errors and diagnostic counters
        use std::sync::{Arc, atomic::{AtomicUsize, AtomicU64, Ordering}};
        let error_count = Arc::new(AtomicUsize::new(0));
        let error_count_clone = error_count.clone();
        
        let callback_count = Arc::new(AtomicUsize::new(0));
        let total_samples_written = Arc::new(AtomicU64::new(0));
        let callback_count_clone = callback_count.clone();
        let total_samples_clone = total_samples_written.clone();
        
        let stream = device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Real-time audio callback - never block!
                let callback_num = callback_count_clone.fetch_add(1, Ordering::Relaxed);
                
                // Diagnostic logging every 100 callbacks (roughly every 2 seconds at 20ms buffers)
                if callback_num % 100 == 0 {
                    eprintln!("🎤 CPAL callback #{}: {} samples provided, buffer_size={}", 
                             callback_num, data.len(), data.len() / 2);
                }
                
                // Push samples to ring buffer, drop if full (brief glitch vs crash)
                let mut dropped_samples = 0;
                let mut written_samples = 0;
                for &sample in data {
                    if ring_producer.push(sample).is_err() {
                        // Ring buffer full - count dropped samples
                        dropped_samples += 1;
                    } else {
                        written_samples += 1;
                    }
                }
                
                total_samples_clone.fetch_add(written_samples, Ordering::Relaxed);
                
                if dropped_samples > 0 {
                    // Use eprintln! in audio callback to avoid blocking on tracing infrastructure
                    eprintln!("⚠️ Audio ring buffer full, dropped {} samples (wrote {})", dropped_samples, written_samples);
                }
            },
            move |err| {
                // Rate limit error messages to avoid spam from ALSA POLLERR
                let count = error_count_clone.fetch_add(1, Ordering::Relaxed);
                if count < 3 || count % 50 == 0 {
                    tracing::warn!("Audio stream error #{}: {}", count + 1, err);
                    if count == 3 {
                        tracing::info!("Further audio stream errors will be logged every 50 occurrences to reduce spam");
                    }
                }
            },
            None,
        )?;

        Ok(stream)
    }

}

/// Audio capture frame size constants
pub const OPUS_FRAME_SIZE: usize = FRAMES_PER_BUFFER; // 960 samples for 20ms
pub const OPUS_SAMPLE_RATE: u32 = SAMPLE_RATE;        // 48000 Hz
pub const OPUS_CHANNELS: usize = CHANNELS as usize;   // 2 channels (stereo)