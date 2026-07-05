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
use thread_priority::{ThreadPriority, ThreadPriorityValue, set_current_thread_priority};

use crate::lib::config::Config;

/// Audio capture configuration constants
const SAMPLE_RATE: u32 = 48000;    // Opus native sample rate
const CHANNELS: u16 = 2;           // Stereo audio

/// Audio capture system with ring buffer for thread-safe audio transfer
pub struct AudioCapture {
    /// CPAL audio input stream (keeping this alive maintains the audio capture)
    _stream: Stream,
    /// Stream error event sender (optional for lifecycle notifications)
    error_tx: Option<tokio::sync::mpsc::UnboundedSender<()>>,
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
            error_tx: None,
        }, ring_consumer))
    }

    /// Try to initialize audio capture with USB devices only (no fallback)
    /// 
    /// This is used by the lifecycle manager for hot-plug support.
    /// Returns None if no USB audio device is found, instead of falling back to built-in devices.
    /// 
    /// # Returns
    /// * `Some((AudioCapture, Consumer))` - Audio system and ring buffer consumer if USB device found
    /// * `None` - No USB audio device available
    pub async fn try_new_usb_only() -> Result<Option<(Self, Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>)>> {
        Self::try_new_usb_only_with_error_channel(None).await
    }

    /// Create a new USB-only audio capture with optional error channel for stream error events
    pub async fn try_new_usb_only_with_error_channel(
        error_tx: Option<tokio::sync::mpsc::UnboundedSender<()>>
    ) -> Result<Option<(Self, Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>)>> {
        tracing::info!("🎤 Attempting USB-only audio capture initialization");

        // Initialize CPAL host (auto-detects best backend: ALSA/PulseAudio/PipeWire)
        let host = cpal::default_host();
        
        // Try to find a USB audio interface - NO FALLBACK to default
        let device = Self::find_usb_audio_interface(&host);
        
        if let Some(device) = device {
            let device_info = device.description()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|_| "Unknown".to_string());
            tracing::info!("🎤 Found USB audio device: {}", device_info);

            // Try to create stream with the USB device
            match Self::create_audio_stream_with_error_channel(&device, error_tx.clone()) {
                Ok((stream, ring_consumer)) => {
                    // Start the audio stream
                    stream.play().context("Failed to start USB audio stream")?;

                    tracing::info!("✅ USB audio capture initialized successfully: {}", device_info);

                    Ok(Some((Self {
                        _stream: stream,
                        error_tx,
                    }, ring_consumer)))
                },
                Err(e) => {
                    tracing::error!("Failed to create stream with USB device '{}': {}", device_info, e);
                    return Err(e);
                }
            }
        } else {
            tracing::info!("🔍 No USB audio interface found");
            Ok(None)
        }
    }

    /// Check if the audio stream is experiencing errors
    /// 
    /// This can be used to detect ALSA POLLERR cascades or other stream issues.
    /// Returns true if the stream is likely in an error state and should be restarted.
    pub fn is_stream_healthy(&self) -> bool {
        // For now, we'll assume the stream is healthy if it exists
        // In a more sophisticated implementation, we could track error counts
        // from the audio callback and expose them here
        true
    }

    /// Get information about the current audio device
    pub fn device_info(&self) -> String {
        // This would require storing device info during initialization
        // For now, return a placeholder
        "Current Audio Device".to_string()
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
        let config_global = Config::global();
        
        // Configure audio stream for Opus-compatible settings
        let config = Self::create_stream_config(device)?;
        
        tracing::info!("🎤 Audio config: {}Hz, {} channels", config.sample_rate, config.channels);

        // Create ring buffer for lock-free audio transfer using configurable capacity
        let ring_buffer_capacity = config_global.ring_buffer_capacity() as usize;
        let ring_buffer = SharedRb::<f32, Vec<std::mem::MaybeUninit<f32>>>::new(ring_buffer_capacity);
        let (ring_producer, ring_consumer) = ring_buffer.split();

        tracing::info!("🎤 Ring buffer capacity: {} samples ({:.1}ms)", 
                      ring_buffer_capacity, 
                      (ring_buffer_capacity as f32) / (SAMPLE_RATE as f32 * CHANNELS as f32) * 1000.0);

        // Build input stream with f32 samples (CPAL handles conversion)
        let stream = Self::build_f32_stream(device, &config, ring_producer)?;

        Ok((stream, ring_consumer))
    }

    /// Create audio stream with optional error channel for stream error notifications
    fn create_audio_stream_with_error_channel(
        device: &Device, 
        error_tx: Option<tokio::sync::mpsc::UnboundedSender<()>>
    ) -> Result<(Stream, Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>)> {
        let config_global = Config::global();
        
        // Configure audio stream for Opus-compatible settings
        let config = Self::create_stream_config(device)?;
        
        tracing::info!("🎤 Audio config: {}Hz, {} channels", config.sample_rate, config.channels);

        // Create ring buffer for lock-free audio transfer using configurable capacity
        let ring_buffer_capacity = config_global.ring_buffer_capacity() as usize;
        let ring_buffer = SharedRb::<f32, Vec<std::mem::MaybeUninit<f32>>>::new(ring_buffer_capacity);
        let (ring_producer, ring_consumer) = ring_buffer.split();

        tracing::info!("🎤 Ring buffer capacity: {} samples ({:.1}ms)", 
                      ring_buffer_capacity, 
                      (ring_buffer_capacity as f32) / (SAMPLE_RATE as f32 * CHANNELS as f32) * 1000.0);

        // Build input stream with error channel support
        let stream = Self::build_f32_stream_with_error_channel(device, &config, ring_producer, error_tx)?;

        Ok((stream, ring_consumer))
    }

    /// Create optimal stream configuration for Opus encoding
    fn create_stream_config(device: &Device) -> Result<StreamConfig> {
        let config_global = Config::global();
        
        // Get supported input configurations
        let mut supported_configs = device
            .supported_input_configs()
            .context("Failed to get supported input configurations")?;

        // Find a configuration that supports our target sample rate
        let supported_config = supported_configs
            .find(|config| {
                config.min_sample_rate() <= SAMPLE_RATE 
                && config.max_sample_rate() >= SAMPLE_RATE
                && config.channels() >= CHANNELS
            })
            .context("No suitable audio configuration found (need 48kHz stereo support)")?;

        // Build final configuration optimized for low-latency streaming
        let final_channels = CHANNELS.min(supported_config.channels());
        
        // Check supported buffer size range
        let supported_buffer_size = supported_config.buffer_size();
        tracing::info!("🎤 Device supported buffer size: {:?}", supported_buffer_size);
        
        // cpal's SupportedBufferSize::Range and BufferSize::Fixed are both in
        // FRAMES (samples-per-channel), NOT total samples. The previous code
        // passed frames*channels to Fixed(), so a requested 1024-frame buffer
        // became a 2048-FRAME ALSA period (42.7ms) — DOUBLE the intended latency
        // (confirmed via /proc period_size=2048). Request the frame count directly.
        let requested_buffer_frames = config_global.audio_buffer_size() as u32;
        let buffer_size = match supported_buffer_size {
            cpal::SupportedBufferSize::Range { min, max } => {
                let frames = requested_buffer_frames.clamp(*min, *max);
                tracing::info!("🎤 Requesting capture buffer: {} frames ({:.1}ms) [device range {}-{}]",
                              frames, (frames as f32) / (SAMPLE_RATE as f32) * 1000.0, min, max);
                cpal::BufferSize::Fixed(frames)
            },
            cpal::SupportedBufferSize::Unknown => {
                tracing::warn!("🎤 Device buffer size unknown, using default");
                cpal::BufferSize::Default
            }
        };
        
        let (final_buffer_frames, final_buffer_samples) = match &buffer_size {
            // Fixed holds FRAMES; total samples = frames * channels.
            cpal::BufferSize::Fixed(frames) => (*frames, frames * (final_channels as u32)),
            cpal::BufferSize::Default => (0, 0), // determined by CPAL at runtime
        };
        
        if final_buffer_frames > 0 {
            tracing::info!("🎤 Stream config: {}Hz, {} channels, {} frames ({} samples, {:.1}ms)", 
                          SAMPLE_RATE, final_channels, final_buffer_frames, final_buffer_samples,
                          (final_buffer_frames as f32) / (SAMPLE_RATE as f32) * 1000.0);
        } else {
            tracing::info!("🎤 Stream config: {}Hz, {} channels, buffer size determined by device", 
                          SAMPLE_RATE, final_channels);
        }
        
        Ok(StreamConfig {
            channels: final_channels,
            sample_rate: SAMPLE_RATE,
            buffer_size,
        })
    }

    /// Build audio stream for f32 samples
    fn build_f32_stream(
        device: &Device,
        config: &StreamConfig,
        mut ring_producer: Producer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>
    ) -> Result<Stream> {
        let config_global = Config::global();
        
        // Create error counter for rate limiting ALSA errors and diagnostic counters
        use std::sync::{Arc, atomic::{AtomicUsize, AtomicU64, AtomicBool, Ordering}};
        let error_count = Arc::new(AtomicUsize::new(0));
        let error_count_clone = error_count.clone();
        
        let callback_count = Arc::new(AtomicUsize::new(0));
        let total_samples_written = Arc::new(AtomicU64::new(0));
        let callback_count_clone = callback_count.clone();
        let total_samples_clone = total_samples_written.clone();
        
        // Thread priority setup
        let thread_priority_enabled = config_global.enable_thread_priority();
        let thread_priority_set = Arc::new(AtomicBool::new(false));
        let thread_priority_set_clone = thread_priority_set.clone();
        
        let stream = device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Set real-time thread priority once
                if thread_priority_enabled && !thread_priority_set_clone.load(Ordering::Relaxed) {
                    if let Err(e) = set_current_thread_priority(ThreadPriority::Max) {
                        eprintln!("⚠️ Failed to set real-time thread priority: {}", e);
                    } else {
                        eprintln!("🎤 Set audio thread to real-time priority");
                    }
                    thread_priority_set_clone.store(true, Ordering::Relaxed);
                }
                
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
                // Rate limit error messages to avoid spam from ALSA POLLERR during disconnection
                let count = error_count_clone.fetch_add(1, Ordering::Relaxed);
                if count < 3 {
                    tracing::warn!("Audio stream error #{}: {}", count + 1, err);
                } else if count == 3 {
                    tracing::info!("Audio device disconnected (suppressing further stream errors)");
                }
                // No further logging after first 3 errors to reduce spam during disconnection
            },
            None,
        )?;

        Ok(stream)
    }

    /// Build f32 audio stream with optional error channel for stream error notifications
    fn build_f32_stream_with_error_channel(
        device: &Device,
        config: &StreamConfig,
        mut ring_producer: Producer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>,
        error_tx: Option<tokio::sync::mpsc::UnboundedSender<()>>
    ) -> Result<Stream> {
        let config_global = Config::global();
        
        // Create error counter for rate limiting ALSA errors and diagnostic counters
        use std::sync::{Arc, atomic::{AtomicUsize, AtomicU64, AtomicBool, Ordering}};
        let error_count = Arc::new(AtomicUsize::new(0));
        let error_count_clone = error_count.clone();
        
        let callback_count = Arc::new(AtomicUsize::new(0));
        let total_samples_written = Arc::new(AtomicU64::new(0));
        let callback_count_clone = callback_count.clone();
        let total_samples_clone = total_samples_written.clone();
        
        // Thread priority setup
        let thread_priority_enabled = config_global.enable_thread_priority();
        let thread_priority_set = Arc::new(AtomicBool::new(false));
        let thread_priority_set_clone = thread_priority_set.clone();
        
        let stream = device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Set real-time thread priority once
                if thread_priority_enabled && !thread_priority_set_clone.load(Ordering::Relaxed) {
                    if let Err(e) = set_current_thread_priority(ThreadPriority::Max) {
                        eprintln!("⚠️ Failed to set real-time thread priority: {}", e);
                    } else {
                        eprintln!("🎤 Set audio thread to real-time priority");
                    }
                    thread_priority_set_clone.store(true, Ordering::Relaxed);
                }
                
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
                // Rate limit error messages to avoid spam from ALSA POLLERR during disconnection
                let count = error_count_clone.fetch_add(1, Ordering::Relaxed);
                if count < 3 {
                    tracing::warn!("Audio stream error #{}: {}", count + 1, err);
                } else if count == 3 {
                    tracing::info!("Audio device disconnected (suppressing further stream errors)");
                }
                
                // Send error notification to lifecycle manager after first error
                if count == 0 {
                    if let Some(ref tx) = error_tx {
                        // Non-blocking send to avoid hanging the audio callback
                        let _ = tx.send(());
                    }
                }
                // No further logging after first 3 errors to reduce spam during disconnection
            },
            None,
        )?;

        Ok(stream)
    }

}

/// Audio capture constants
pub const OPUS_SAMPLE_RATE: u32 = SAMPLE_RATE; // 48000 Hz