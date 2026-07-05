/// Audio device monitoring for hot-plug support
/// 
/// This module provides periodic monitoring of USB audio devices to detect
/// when external audio interfaces are connected or disconnected. It uses the same
/// device filtering logic as AudioCapture but only checks for availability.

use std::time::Duration;
use anyhow::Result;
use cpal::{Device, traits::{DeviceTrait, HostTrait}};
use tokio::time::{interval, Instant};

/// Device state change events
#[derive(Debug, Clone, PartialEq)]
pub enum DeviceEvent {
    /// USB audio device became available
    Connected { name: String },
    /// USB audio device was disconnected
    Disconnected { name: String },
    /// No USB audio devices available
    NoDevices,
}

/// Device information for tracking
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceInfo {
    pub name: String,
    pub has_input: bool,
}

/// How many consecutive polls a connected device must be ABSENT from the
/// enumeration before we declare it disconnected. Debounces transient
/// enumeration hiccups (× 2 s poll = ~6 s grace).
const DISCONNECT_MISS_THRESHOLD: u32 = 3;

/// Monitors USB audio device availability
pub struct AudioDeviceMonitor {
    /// Current device state
    current_device: Option<DeviceInfo>,
    /// Polling interval
    poll_interval: Duration,
    /// Last successful poll time
    last_poll: Instant,
    /// Consecutive polls the current device was absent (debounce disconnect).
    absent_polls: u32,
    /// Event sender for manual events
    manual_event_tx: Option<tokio::sync::mpsc::UnboundedSender<DeviceEvent>>,
}

impl AudioDeviceMonitor {
    /// Create a new device monitor
    /// 
    /// # Arguments
    /// * `poll_interval` - How often to check for devices (recommended: 2 seconds)
    pub fn new(poll_interval: Duration) -> Self {
        Self {
            current_device: None,
            poll_interval,
            last_poll: Instant::now(),
            absent_polls: 0,
            manual_event_tx: None,
        }
    }

    /// Create a device monitor with 2-second polling interval
    pub fn with_default_interval() -> Self {
        Self::new(Duration::from_secs(2))
    }

    /// Start monitoring devices and yield events when changes occur
    /// 
    /// This runs indefinitely, yielding `DeviceEvent` when device state changes.
    /// It uses the same USB device filtering as AudioCapture but only checks availability.
    pub async fn monitor_devices(&mut self) -> tokio::sync::mpsc::UnboundedReceiver<DeviceEvent> {
        let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
        let poll_interval = self.poll_interval;
        
        // Store the event sender for manual triggers
        self.manual_event_tx = Some(event_tx.clone());
        
        // Move the monitoring logic to instance method for state sharing
        let monitor = AudioDeviceMonitor::new(poll_interval);
        tokio::spawn(async move {
            monitor.run_monitoring_loop(event_tx).await;
        });
        
        event_rx
    }

    /// Internal monitoring loop with proper state management
    async fn run_monitoring_loop(mut self, event_tx: tokio::sync::mpsc::UnboundedSender<DeviceEvent>) {
        let mut interval = interval(self.poll_interval);
        
        loop {
            interval.tick().await;
            self.check_device_status(&event_tx).await;
        }
    }

    /// Check device status and send events if state changed
    async fn check_device_status(&mut self, event_tx: &tokio::sync::mpsc::UnboundedSender<DeviceEvent>) {
        // If we already have a device, DON'T re-probe it by opening it — while
        // our capture stream owns the interface, an open-probe (default_input_
        // config) fails with "busy" and would look like a disconnect, causing a
        // teardown→reopen flap every poll. Instead just check whether the device
        // NAME is still present in the enumeration (cheap, no open), with a
        // debounce so a transient enumeration hiccup doesn't tear down a live
        // capture.
        if let Some(current_name) = self.current_device.as_ref().map(|d| d.name.clone()) {
            let present = Self::is_device_name_present(&current_name).await;
            if present {
                self.absent_polls = 0; // still here
            } else {
                self.absent_polls += 1;
                if self.absent_polls >= DISCONNECT_MISS_THRESHOLD {
                    tracing::warn!("🔌 USB audio device disconnected: {} (absent {} polls)", current_name, self.absent_polls);
                    self.current_device = None;
                    self.absent_polls = 0;
                    let _ = event_tx.send(DeviceEvent::Disconnected { name: current_name });
                    let _ = event_tx.send(DeviceEvent::NoDevices);
                } else {
                    tracing::debug!("🔍 Device {} absent this poll ({}/{}), not disconnecting yet", current_name, self.absent_polls, DISCONNECT_MISS_THRESHOLD);
                }
            }
            return;
        }

        // No current device — do the full probe scan to find AND verify a new
        // device before connecting (open-probe is fine here: nothing owns it).
        match Self::scan_for_usb_device().await {
            Ok(Some(detected_device)) => {
                tracing::info!("🔌 USB audio device connected: {}", detected_device.name);
                let _ = event_tx.send(DeviceEvent::Connected { name: detected_device.name.clone() });
                self.current_device = Some(detected_device);
                self.absent_polls = 0;
            },
            Ok(None) => { /* still no device — nothing to do */ },
            Err(e) => {
                tracing::warn!("🔍 Error scanning for USB audio devices: {}", e);
            }
        }
    }

    /// Cheap presence check: is a device with this exact name in the current
    /// enumeration? Does NOT open the device (so it succeeds even while our own
    /// capture stream holds it). This is what breaks the disconnect/reconnect
    /// flap.
    async fn is_device_name_present(name: &str) -> bool {
        let target = name.to_string();
        tokio::task::spawn_blocking(move || {
            let host = cpal::default_host();
            match host.devices() {
                Ok(devices) => devices.filter_map(|d| d.description().ok().map(|desc| desc.name().to_string()))
                    .any(|n| n == target),
                Err(_) => true, // enumeration failed — assume still present (debounce handles real loss)
            }
        })
        .await
        .unwrap_or(true)
    }

    /// Scan for available USB audio devices (async wrapper)
    async fn scan_for_usb_device() -> Result<Option<DeviceInfo>> {
        // Run device scan in blocking task to avoid blocking async runtime
        tokio::task::spawn_blocking(|| Self::scan_for_usb_device_blocking()).await?
    }

    /// Scan for USB audio devices using the same logic as AudioCapture
    fn scan_for_usb_device_blocking() -> Result<Option<DeviceInfo>> {
        let host = cpal::default_host();
        
        // Use the same USB device finding logic as AudioCapture
        if let Some(device) = Self::find_usb_audio_interface(&host) {
            let device_name = device.description()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|_| "Unknown USB Device".to_string());
            
            // Verify the device is actually functional by testing input config access
            let has_input = match device.default_input_config() {
                Ok(_config) => {
                    // Double-check by trying to get supported configs to verify device is truly accessible
                    match device.supported_input_configs() {
                        Ok(mut configs) => {
                            configs.next().is_some() // Device has at least one supported config
                        }
                        Err(_) => {
                            tracing::debug!("Device {} found but not accessible (no supported configs)", device_name);
                            false // Device not accessible
                        }
                    }
                }
                Err(_) => {
                    tracing::debug!("Device {} found but has no input capability", device_name);
                    false // No input capability
                }
            };
            
            if has_input {
                tracing::debug!("Device {} verified as functional", device_name);
                Ok(Some(DeviceInfo {
                    name: device_name,
                    has_input,
                }))
            } else {
                tracing::debug!("Device {} found but not functional, treating as no device", device_name);
                Ok(None) // Device not functional, treat as no device available
            }
        } else {
            Ok(None)
        }
    }

    /// Find external audio interfaces using device name pattern matching
    /// 
    /// This is copied from AudioCapture to ensure consistent device filtering.
    /// IMPORTANT: No fallback to internal devices - returns None if no USB device found.
    fn find_usb_audio_interface(host: &cpal::Host) -> Option<Device> {
        let devices = match host.devices() {
            Ok(devices) => devices,
            Err(e) => {
                tracing::debug!("Failed to enumerate audio devices: {}", e);
                return None;
            }
        };

        // Known audio interface brands/patterns (same as AudioCapture)
        let audio_interface_patterns = [
            // Professional audio interface brands
            "scarlett", "focusrite", "presonus", "steinberg", "rme", "motu", 
            "zoom", "tascam", "behringer", "mackie", "roland", "yamaha",
            "native instruments", "apogee", "universal audio", "antelope",
            // USB audio indicators
            "usb audio", "usb sound", "usb microphone", "usb mic",
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
            
            tracing::info!("🔍 Found audio device: '{}'", device_name);
            
            // Check if device supports input
            if device.default_input_config().is_err() {
                tracing::info!("🔍   → No input capability, skipping");
                continue;
            } else {
                tracing::info!("🔍   → Has input capability");
            }

            let device_name_lower = device_name.to_lowercase();
            
            // Skip devices that match built-in patterns
            let is_builtin = builtin_patterns.iter()
                .any(|pattern| device_name_lower.contains(pattern));
            
            if is_builtin {
                tracing::info!("🔍   → Built-in device, skipping");
                continue;
            }

            // Check if device matches audio interface patterns
            let priority = audio_interface_patterns.iter()
                .position(|pattern| device_name_lower.contains(pattern));

            if let Some(priority_index) = priority {
                tracing::info!("🔍   → Matches audio interface pattern '{}' (priority {})", 
                              audio_interface_patterns[priority_index], priority_index);
                external_interfaces.push((device, priority_index));
            } else {
                tracing::info!("🔍   → No pattern match, skipping");
            }
        }

        if external_interfaces.is_empty() {
            return None;
        }

        // Sort by priority (lower index = higher priority)
        external_interfaces.sort_by_key(|(_, priority)| *priority);

        // Return the highest priority external interface
        external_interfaces.into_iter().next().map(|(device, _)| device)
    }

    /// Scan for available USB audio devices (public interface for forced scans)
    pub async fn scan_device(&self) -> Result<Option<DeviceInfo>> {
        Self::scan_for_usb_device().await
    }

    /// Check if a USB audio device is currently available (one-time check)
    pub async fn is_device_available() -> bool {
        Self::scan_for_usb_device().await
            .map(|device| device.is_some())
            .unwrap_or(false)
    }

    /// Get current device state
    pub fn current_device(&self) -> Option<&DeviceInfo> {
        self.current_device.as_ref()
    }

    /// Force a device status check (useful when stream errors occur)
    pub async fn force_device_check(&self) -> Result<()> {
        if let Some(ref event_tx) = self.manual_event_tx {
            // Trigger immediate device check by scanning manually
            match Self::scan_for_usb_device().await {
                Ok(Some(device)) => {
                    tracing::info!("🔄 Forced device check found: {}", device.name);
                    let _ = event_tx.send(DeviceEvent::Connected { name: device.name });
                },
                Ok(None) => {
                    tracing::warn!("🔄 Forced device check found no devices");
                    let _ = event_tx.send(DeviceEvent::NoDevices);
                },
                Err(e) => {
                    tracing::warn!("🔄 Forced device check failed: {}", e);
                    return Err(e);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_device_scan() {
        let result = AudioDeviceMonitor::scan_for_usb_device().await;
        // Just ensure it doesn't crash - actual device availability varies by system
        assert!(result.is_ok());
    }
    
    #[test]
    fn test_device_monitor_creation() {
        let monitor = AudioDeviceMonitor::with_default_interval();
        assert!(monitor.current_device.is_none());
    }
}