/// Audio bot lifecycle state management
/// 
/// This module defines the state machine and lifecycle management for the audio bot,
/// handling transitions between different states based on device availability and errors.

use std::sync::Arc;
use std::time::Instant;
use anyhow::Result;
use uuid::Uuid;
use mediasoup::producer::Producer;
use ringbuf::{SharedRb, Consumer, Producer as RingProducer};
use tokio::task::JoinHandle;

use crate::lib::audio::{
    audio_device_monitor::{AudioDeviceMonitor, DeviceEvent},
    audio_capture::AudioCapture,
    encoder::AudioEncoder,
};
use crate::lib::domain::Lobby;

/// Audio bot operational state
#[derive(Debug, Clone, PartialEq)]
pub enum AudioBotState {
    /// Waiting for a USB audio device to be connected
    WaitingForDevice,
    /// Device found, attempting to initialize audio capture
    Initializing { device_name: String },
    /// Running normally with audio streaming
    Running { 
        device_name: String,
        started_at: Instant,
    },
    /// Device error detected, cleaning up before retry
    DeviceError { 
        device_name: String,
        error: String,
        retry_at: Instant,
    },
    /// Shutting down gracefully
    Shutdown,
}

impl AudioBotState {
    /// Check if the bot is actively streaming audio
    pub fn is_streaming(&self) -> bool {
        matches!(self, AudioBotState::Running { .. })
    }

    /// Check if the bot should attempt device initialization
    pub fn should_initialize(&self) -> bool {
        matches!(self, AudioBotState::WaitingForDevice | AudioBotState::Initializing { .. })
    }

    /// Check if the bot is in an error state and ready to retry
    pub fn should_retry(&self) -> bool {
        match self {
            AudioBotState::DeviceError { retry_at, .. } => Instant::now() >= *retry_at,
            _ => false,
        }
    }

    /// Get current device name if available
    pub fn device_name(&self) -> Option<&str> {
        match self {
            AudioBotState::Initializing { device_name } 
            | AudioBotState::Running { device_name, .. }
            | AudioBotState::DeviceError { device_name, .. } => Some(device_name),
            _ => None,
        }
    }
}

/// Audio capture components that need lifecycle management
pub struct AudioCaptureComponents {
    /// Audio capture instance
    pub capture: AudioCapture,
    /// Device name for tracking
    pub device_name: String,
}

/// Audio encoding components
pub struct AudioEncoderComponents {
    /// Encoder task handle (returns final RTP state on completion)
    pub encoder_handle: JoinHandle<(u16, u32)>,
    /// Shutdown signal sender
    pub shutdown_tx: tokio::sync::mpsc::Sender<()>,
    /// When the encoder was started (to avoid immediate failure detection)
    pub started_at: Instant,
}

/// Lifecycle manager for audio bot components
pub struct AudioLifecycleManager {
    /// Current state of the audio bot
    pub state: AudioBotState,
    /// Device monitor for hot-plug detection
    pub device_monitor: AudioDeviceMonitor,
    /// Current audio capture components (if running)
    pub capture_components: Option<AudioCaptureComponents>,
    /// Current encoder components (if running)
    pub encoder_components: Option<AudioEncoderComponents>,
    /// MediaSoup DirectProducer (persistent)
    pub direct_producer: Arc<Producer>,
    /// Room ID (persistent)
    pub room_id: Uuid,
    /// Lobby handle (cheap Arc clone) used to reach the bot's room so we can
    /// pause/resume the producer + broadcast StreamPaused/StreamResumed on
    /// device loss/return (N1). The bot has no DJ WebSocket, so this is the
    /// only path from the device-state-machine to the room.
    lobby: Lobby,
    /// Retry delay for error recovery
    retry_delay: std::time::Duration,
    /// Device rescan trigger (to force immediate device check on encoder failure)
    rescan_trigger: tokio::sync::mpsc::UnboundedSender<()>,
    rescan_receiver: tokio::sync::mpsc::UnboundedReceiver<()>,
    /// Stream error receiver (for immediate error detection from audio capture)
    stream_error_rx: Option<tokio::sync::mpsc::UnboundedReceiver<()>>,
    /// Stream error sender (to create error channels for AudioCapture)
    stream_error_tx: tokio::sync::mpsc::UnboundedSender<()>,
    /// Last RTP state (for continuity across encoder restarts)
    last_rtp_state: Option<(u16, u32)>, // (sequence_number, timestamp)
}

impl AudioLifecycleManager {
    /// Create a new lifecycle manager
    /// 
    /// # Arguments
    /// * `room_id` - ID of the persistent audio bot room
    /// * `direct_producer` - MediaSoup DirectProducer for audio injection
    /// * `lobby` - Lobby handle for reaching the bot's room (pause/broadcast)
    pub fn new(room_id: Uuid, direct_producer: Arc<Producer>, lobby: Lobby) -> Self {
        let (rescan_trigger, rescan_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (stream_error_tx, stream_error_rx) = tokio::sync::mpsc::unbounded_channel();

        Self {
            state: AudioBotState::WaitingForDevice,
            device_monitor: AudioDeviceMonitor::with_default_interval(),
            capture_components: None,
            encoder_components: None,
            direct_producer,
            room_id,
            lobby,
            retry_delay: std::time::Duration::from_secs(5), // Wait 5s before retry after error
            rescan_trigger,
            rescan_receiver,
            stream_error_rx: Some(stream_error_rx),
            stream_error_tx,
            last_rtp_state: None,
        }
    }

    /// Start the lifecycle management loop
    /// 
    /// This runs the main state machine that handles:
    /// - Device monitoring and hot-plug events
    /// - Audio capture initialization/cleanup
    /// - Error detection and recovery
    /// - State transitions
    pub async fn run(mut self) -> Result<()> {
        tracing::info!(
            room_id = %self.room_id,
            "🔄 Starting audio bot lifecycle management"
        );

        // Start device monitoring
        let mut device_events = self.device_monitor.monitor_devices().await;

        // Main lifecycle loop
        loop {
            tokio::select! {
                // Handle device events
                Some(event) = device_events.recv() => {
                    self.handle_device_event(event).await?;
                }

                // Handle forced device rescans (triggered by encoder failures)
                _ = self.rescan_receiver.recv() => {
                    tracing::info!(
                        room_id = %self.room_id,
                        "🔄 Forced device rescan triggered"
                    );
                    // Force an immediate device scan by creating a one-shot event
                    match self.device_monitor.scan_device().await {
                        Ok(Some(device)) => {
                            let event = DeviceEvent::Connected { name: device.name };
                            self.handle_device_event(event).await?;
                        }
                        Ok(None) => {
                            let event = DeviceEvent::NoDevices;
                            self.handle_device_event(event).await?;
                        }
                        Err(e) => {
                            tracing::warn!("Forced device rescan failed: {}", e);
                        }
                    }
                }

                // Handle stream errors from AudioCapture
                _ = self.stream_error_rx.as_mut().unwrap().recv(), if self.stream_error_rx.is_some() => {
                    tracing::warn!(
                        room_id = %self.room_id,
                        "🚨 Audio stream error detected, triggering device disconnection handling"
                    );
                    
                    // Handle this as a device disconnection event
                    if let Some(current_device) = self.state.device_name().map(|s| s.to_string()) {
                        tracing::info!(
                            room_id = %self.room_id,
                            device = %current_device,
                            "Converting stream error to device disconnection event"
                        );
                        let event = DeviceEvent::Disconnected { name: current_device };
                        self.handle_device_event(event).await?;
                    }
                }

                // Check for encoder errors or completion (only if encoder has been running for a bit)
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)), if self.encoder_components.is_some() => {
                    // Only check encoder status if it's been running for at least 1 second
                    if let Some(ref encoder_components) = self.encoder_components {
                        let running_duration = encoder_components.started_at.elapsed();
                        if running_duration > std::time::Duration::from_secs(1) && encoder_components.encoder_handle.is_finished() {
                            tracing::error!(
                                room_id = %self.room_id,
                                duration = ?running_duration,
                                "❌ Audio encoder task completed unexpectedly after running for {:?}", running_duration
                            );
                            self.handle_encoder_completion().await?;
                        }
                    }
                }

                // Periodic state maintenance
                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                    self.maintain_state().await?;
                }
            }
        }
    }

    /// Handle device plug/unplug events
    async fn handle_device_event(&mut self, event: DeviceEvent) -> Result<()> {
        match event {
            DeviceEvent::Connected { name } => {
                tracing::info!(
                    room_id = %self.room_id,
                    device = %name,
                    "🔌 Device connected, attempting to initialize"
                );

                // Only initialize if we're waiting or in error state
                tracing::debug!(
                    room_id = %self.room_id,
                    current_state = ?self.state,
                    "Checking if should initialize for connected device"
                );
                if self.state.should_initialize() || self.state.should_retry() {
                    self.state = AudioBotState::Initializing { device_name: name.clone() };
                    self.initialize_audio_capture(name).await?;
                } else {
                    tracing::warn!(
                        room_id = %self.room_id,
                        current_state = ?self.state,
                        "Device connected but not initializing due to current state"
                    );
                }
            },

            DeviceEvent::Disconnected { name } => {
                tracing::warn!(
                    room_id = %self.room_id,
                    device = %name,
                    current_state = ?self.state,
                    "🔌 Device disconnected, cleaning up"
                );

                // Clean up current capture if it matches the disconnected device
                if let Some(current_name) = self.state.device_name() {
                    if current_name == name {
                        tracing::info!(
                            room_id = %self.room_id,
                            device = %name,
                            "Device name matches, cleaning up and transitioning to WaitingForDevice"
                        );
                        self.cleanup_audio_capture().await?;
                        self.state = AudioBotState::WaitingForDevice;
                        // N1: device lost -> pause producer + StreamPaused + room Paused
                        self.notify_room_device_lost().await;
                    } else {
                        tracing::debug!(
                            room_id = %self.room_id,
                            disconnected_device = %name,
                            current_device = %current_name,
                            "Disconnected device doesn't match current device"
                        );
                    }
                } else {
                    tracing::debug!(
                        room_id = %self.room_id,
                        "No current device to clean up"
                    );
                }
            },

            DeviceEvent::NoDevices => {
                tracing::info!(
                    room_id = %self.room_id,
                    "🔍 No USB audio devices available"
                );

                if !matches!(self.state, AudioBotState::WaitingForDevice) {
                    self.cleanup_audio_capture().await?;
                    self.state = AudioBotState::WaitingForDevice;
                    // N1: device lost -> pause producer + StreamPaused + room Paused
                    self.notify_room_device_lost().await;
                }
            }
        }

        Ok(())
    }

    /// Initialize audio capture for a detected device
    async fn initialize_audio_capture(&mut self, device_name: String) -> Result<()> {
        // Clean up any existing capture first
        self.cleanup_audio_capture().await?;

        // Try to create new audio capture with stream error channel
        match AudioCapture::try_new_usb_only_with_error_channel(Some(self.stream_error_tx.clone())).await {
            Ok(Some((capture, ring_consumer))) => {
                tracing::info!(
                    room_id = %self.room_id,
                    device = %device_name,
                    "✅ Audio capture initialized successfully"
                );

                // Store the capture components
                self.capture_components = Some(AudioCaptureComponents {
                    capture,
                    device_name: device_name.clone(),
                });

                // Start encoder with new ring buffer consumer
                self.start_encoder_with_consumer(ring_consumer).await?;

                // Update state to running
                self.state = AudioBotState::Running {
                    device_name,
                    started_at: Instant::now(),
                };

                // N1: device returned / capture resumed -> resume producer +
                // StreamResumed + room Live (no-op if the room was never paused).
                self.notify_room_device_returned().await;
            },

            Ok(None) => {
                tracing::warn!(
                    room_id = %self.room_id,
                    "🔍 No USB audio device found during initialization"
                );
                self.state = AudioBotState::WaitingForDevice;
                // N1: device lost -> pause producer + StreamPaused + room Paused
                self.notify_room_device_lost().await;
            },

            Err(e) => {
                tracing::error!(
                    room_id = %self.room_id,
                    device = %device_name,
                    error = %e,
                    "❌ Failed to initialize audio capture"
                );

                self.state = AudioBotState::DeviceError {
                    device_name,
                    error: e.to_string(),
                    retry_at: Instant::now() + self.retry_delay,
                };
                // N1: device error (lost) -> pause producer + StreamPaused + room Paused
                self.notify_room_device_lost().await;
            }
        }

        Ok(())
    }

    /// Start the audio encoder with a ring buffer consumer
    async fn start_encoder_with_consumer(&mut self, ring_consumer: Consumer<f32, std::sync::Arc<SharedRb<f32, Vec<std::mem::MaybeUninit<f32>>>>>) -> Result<()> {
        // Stop existing encoder if running
        self.stop_encoder().await?;

        let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel(1);

        // Create encoder with RTP state continuity
        let encoder = if let Some(last_rtp_state) = self.last_rtp_state.take() {
            tracing::info!(
                room_id = %self.room_id,
                "🎵 Creating encoder with RTP continuity: seq={}, ts={}",
                last_rtp_state.0, last_rtp_state.1
            );
            AudioEncoder::new_with_rtp_state(
                self.direct_producer.clone(),
                ring_consumer,
                shutdown_rx,
                Some(last_rtp_state),
            )?
        } else {
            tracing::info!(
                room_id = %self.room_id,
                "🎵 Creating new encoder (no previous RTP state)"
            );
            AudioEncoder::new(
                self.direct_producer.clone(),
                ring_consumer,
                shutdown_rx,
            )?
        };

        // Start encoder task
        let encoder_handle = tokio::spawn(async move {
            encoder.run().await
        });

        self.encoder_components = Some(AudioEncoderComponents {
            encoder_handle,
            shutdown_tx,
            started_at: Instant::now(),
        });

        tracing::info!(
            room_id = %self.room_id,
            "🎵 Audio encoder started"
        );

        Ok(())
    }

    /// Stop the audio encoder
    async fn stop_encoder(&mut self) -> Result<()> {
        if let Some(encoder_components) = self.encoder_components.take() {
            // Send shutdown signal
            let _ = encoder_components.shutdown_tx.send(()).await;
            
            // Wait for encoder task to complete (with timeout) and capture final RTP state
            match tokio::time::timeout(
                std::time::Duration::from_secs(2),
                encoder_components.encoder_handle
            ).await {
                Ok(Ok(final_rtp_state)) => {
                    self.last_rtp_state = Some(final_rtp_state);
                    tracing::info!(
                        room_id = %self.room_id,
                        "🛑 Audio encoder stopped, saved RTP state: seq={}, ts={}",
                        final_rtp_state.0, final_rtp_state.1
                    );
                }
                Ok(Err(e)) => {
                    tracing::warn!(
                        room_id = %self.room_id,
                        "🛑 Audio encoder stopped with error: {}", e
                    );
                }
                Err(_) => {
                    tracing::warn!(
                        room_id = %self.room_id,
                        "🛑 Audio encoder stop timed out"
                    );
                }
            }
        }
        Ok(())
    }

    /// Clean up all audio capture components
    async fn cleanup_audio_capture(&mut self) -> Result<()> {
        // Stop encoder first
        self.stop_encoder().await?;

        // Clean up capture components
        if let Some(_capture_components) = self.capture_components.take() {
            tracing::info!(
                room_id = %self.room_id,
                "🧹 Audio capture components cleaned up"
            );
        }

        Ok(())
    }

    /// N1: Notify the bot's room that the line-in device was LOST — pause the
    /// DirectProducer + broadcast StreamPaused + flip the room to Paused so
    /// listeners see PAUSED instead of a silent-but-Live room.
    ///
    /// Lock discipline (M2): acquire the room write guard, run the
    /// transition-guarded pause (which does the `producer.pause().await`
    /// mediasoup call), then DROP the guard before broadcasting the lobby
    /// update — never hold the guard across the subsequent lobby await. The
    /// Live->Paused guard inside `handle_audio_bot_device_loss` makes flapping
    /// (repeated WaitingForDevice/DeviceError) a no-op after the first pause.
    async fn notify_room_device_lost(&self) {
        let Some(room_state) = self.lobby.get_room(&self.room_id) else {
            tracing::warn!(
                room_id = %self.room_id,
                "Audio-bot room not found in lobby - cannot pause on device loss"
            );
            return;
        };

        let paused = {
            let mut room_guard = room_state.write().await;
            let result = room_guard.handle_audio_bot_device_loss().await;
            // write guard dropped here, before the lobby broadcast below
            result
        };

        match paused {
            Ok(true) => {
                // Stream flipped Live->Paused: broadcast so lobby clients see it.
                self.lobby.update_room(&self.room_id).await;
                tracing::info!(
                    room_id = %self.room_id,
                    "Audio-bot device loss handled - room paused (stays Paused indefinitely per decision 1a)"
                );
            }
            Ok(false) => {
                tracing::debug!(
                    room_id = %self.room_id,
                    "Audio-bot device loss: no pause needed (already paused / not live / no producer)"
                );
            }
            Err(e) => {
                tracing::error!(
                    room_id = %self.room_id,
                    error = %e,
                    "Failed to pause audio-bot producer on device loss"
                );
            }
        }
    }

    /// N1: Notify the bot's room that the line-in device RETURNED — resume the
    /// DirectProducer + broadcast StreamResumed + flip the room back to Live so
    /// audio + UI recover automatically. Same lock discipline as the loss path;
    /// the Paused->Live guard makes this idempotent.
    async fn notify_room_device_returned(&self) {
        let Some(room_state) = self.lobby.get_room(&self.room_id) else {
            tracing::warn!(
                room_id = %self.room_id,
                "Audio-bot room not found in lobby - cannot resume on device return"
            );
            return;
        };

        let resumed = {
            let mut room_guard = room_state.write().await;
            let result = room_guard.handle_audio_bot_device_return().await;
            // write guard dropped here, before the lobby broadcast below
            result
        };

        match resumed {
            Ok(true) => {
                self.lobby.update_room(&self.room_id).await;
                tracing::info!(
                    room_id = %self.room_id,
                    "Audio-bot device return handled - room resumed to Live"
                );
            }
            Ok(false) => {
                tracing::debug!(
                    room_id = %self.room_id,
                    "Audio-bot device return: no resume needed (already live / no producer)"
                );
            }
            Err(e) => {
                tracing::error!(
                    room_id = %self.room_id,
                    error = %e,
                    "Failed to resume audio-bot producer on device return"
                );
            }
        }
    }

    /// Check encoder status for errors
    async fn check_encoder_status(&mut self) {
        if let Some(ref mut encoder_components) = self.encoder_components {
            if encoder_components.encoder_handle.is_finished() {
                // Get the actual error from the task
                let encoder_handle = std::mem::replace(&mut encoder_components.encoder_handle, 
                    tokio::spawn(async { (0, 0) }));
                
                match encoder_handle.await {
                    Ok(final_rtp_state) => {
                        tracing::warn!(
                            room_id = %self.room_id,
                            "⚠️ Audio encoder task completed unexpectedly, final RTP state: seq={}, ts={}",
                            final_rtp_state.0, final_rtp_state.1
                        );
                        // Save the final state
                        self.last_rtp_state = Some(final_rtp_state);
                    },
                    Err(join_error) => {
                        tracing::error!(
                            room_id = %self.room_id,
                            error = %join_error,
                            "❌ Audio encoder task panicked"
                        );
                    }
                }
            }
        }
    }

    /// Handle encoder task completion (usually indicates an error)
    async fn handle_encoder_completion(&mut self) -> Result<()> {
        if let Some(current_device) = self.state.device_name().map(|s| s.to_string()) {
            tracing::error!(
                room_id = %self.room_id,
                device = %current_device,
                "❌ Audio encoder failed, entering error state"
            );

            self.cleanup_audio_capture().await?;
            
            self.state = AudioBotState::DeviceError {
                device_name: current_device,
                error: "Encoder task failed".to_string(),
                retry_at: Instant::now() + self.retry_delay,
            };

            // N1 (primary failure): the encoder task died (line-in unplugged
            // mid-set) so no frames reach the DirectProducer. Pause the
            // producer + broadcast StreamPaused + flip the room to Paused so
            // listeners see PAUSED instead of dead-silent-but-Live.
            self.notify_room_device_lost().await;

            // Trigger immediate device rescan to check if device is still functional
            tracing::info!(
                room_id = %self.room_id,
                "🔄 Triggering device rescan after encoder failure"
            );
            let _ = self.rescan_trigger.send(());
        }

        Ok(())
    }

    /// Perform periodic state maintenance
    async fn maintain_state(&mut self) -> Result<()> {
        // Check if we should retry after error
        if self.state.should_retry() {
            if let Some(device_name) = self.state.device_name().map(|s| s.to_string()) {
                tracing::info!(
                    room_id = %self.room_id,
                    device = %device_name,
                    "🔄 Retrying audio capture after error"
                );
                self.state = AudioBotState::Initializing { device_name: device_name.clone() };
                self.initialize_audio_capture(device_name).await?;
            }
        }

        Ok(())
    }

    /// Get current state
    pub fn current_state(&self) -> &AudioBotState {
        &self.state
    }

    /// Gracefully shutdown the lifecycle manager
    pub async fn shutdown(mut self) -> Result<()> {
        tracing::info!(
            room_id = %self.room_id,
            "🛑 Shutting down audio lifecycle manager"
        );

        self.state = AudioBotState::Shutdown;
        self.cleanup_audio_capture().await?;

        Ok(())
    }
}