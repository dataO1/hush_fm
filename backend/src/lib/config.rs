/// Configuration Management Module
///
/// Provides a thread-safe singleton configuration system for the HushFM backend.
/// Parses environment variables once at startup with comprehensive error handling,
/// validation, and sensible defaults.

use std::ops::RangeInclusive;
use std::time::Duration;
use std::net::Ipv4Addr;
use std::str::FromStr;
use once_cell::sync::OnceCell;

/// Configuration errors with detailed context
#[derive(Debug, Clone, thiserror::Error)]
pub enum ConfigError {
    #[error("Environment variable '{var_name}' not found")]
    EnvVarNotFound { var_name: String },
    
    #[error("Failed to parse '{var_name}' = '{value}' as {expected_type}: {reason}")]
    ParseError {
        var_name: String,
        value: String,
        expected_type: &'static str,
        reason: String,
    },
    
    #[error("Invalid value for '{var_name}' = '{value}': {reason}")]
    ValidationError {
        var_name: String,
        value: String,
        reason: String,
    },
    
    #[error("Invalid port range: min={min} must be less than max={max}")]
    InvalidPortRange { min: u16, max: u16 },
}

/// Configuration source tracking
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConfigSource {
    Environment,
    Default,
}

impl std::fmt::Display for ConfigSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigSource::Environment => write!(f, "Env Var"),
            ConfigSource::Default => write!(f, "Default"),
        }
    }
}

/// Individual configuration value with source tracking
#[derive(Debug, Clone)]
pub struct ConfigValue<T> {
    pub value: T,
    pub source: ConfigSource,
}

impl<T> ConfigValue<T> {
    fn new(value: T, source: ConfigSource) -> Self {
        Self { value, source }
    }
}

/// Main configuration structure
#[derive(Debug, Clone)]
pub struct Config {
    // Server Configuration
    backend_port: ConfigValue<u16>,
    frontend_port: ConfigValue<u16>,
    host_name: ConfigValue<String>,
    mediasoup_announced_ip: ConfigValue<String>,
    
    // WebRTC Configuration
    worker_port_min: ConfigValue<u16>,
    worker_port_max: ConfigValue<u16>,
    
    // MediaSoup Configuration
    mediasoup_listen_ip: ConfigValue<String>,
    mediasoup_enable_tcp: ConfigValue<bool>,
    mediasoup_expose_internal_ip: ConfigValue<bool>,
    mediasoup_worker_debug: ConfigValue<bool>,
    
    // Monitoring Configuration
    stale_listener_timeout: ConfigValue<Duration>,
    
    // Audio Bot Room Configuration
    audio_bot_room_name: ConfigValue<String>,
    audio_bot_dj_name: ConfigValue<String>,
    audio_bot_description: ConfigValue<String>,
    audio_bot_tags: ConfigValue<Vec<String>>,

    // Audio Configuration
    opus_bitrate: ConfigValue<u32>,
    opus_complexity: ConfigValue<u32>,
    opus_enable_fec: ConfigValue<bool>,
    opus_enable_vbr: ConfigValue<bool>,
    opus_frame_duration: ConfigValue<u32>,
    opus_packet_loss_perc: ConfigValue<u8>,
    audio_buffer_size: ConfigValue<u32>,
    ring_buffer_capacity: ConfigValue<u32>,
    enable_thread_priority: ConfigValue<bool>,
    dscp_marking: ConfigValue<u8>,
}

/// Global singleton instance
static CONFIG: OnceCell<Config> = OnceCell::new();

impl Config {
    /// Initialize the global configuration singleton
    /// This should be called once at application startup
    pub fn init() -> Result<&'static Config, ConfigError> {
        CONFIG.set(Self::load()?).map_err(|_| ConfigError::EnvVarNotFound { var_name: "CONFIG_ALREADY_INITIALIZED".to_string() })?;
        Ok(CONFIG.get().unwrap())
    }

    /// Get the global configuration instance
    /// Panics if not initialized - call init() first
    pub fn global() -> &'static Config {
        CONFIG.get().expect("Config not initialized - call Config::init() first")
    }

    /// Load configuration from environment variables with comprehensive error handling
    fn load() -> Result<Config, ConfigError> {
        tracing::info!("🔧 Loading HushFM configuration from environment...");
        
        let mut warnings = Vec::new();

        // Server Configuration
        let backend_port = Self::parse_env_var_with_default(
            "HUSHFM_BACKEND_PORT", 
            "3000", 
            3000, 
            &mut warnings
        );

        let frontend_port = Self::parse_env_var_with_default(
            "HUSHFM_FRONTEND_PORT", 
            "8080", 
            8080, 
            &mut warnings
        );

        let host_name = Self::parse_env_var_with_default(
            "HUSHFM_HOST_NAME", 
            "localhost", 
            "localhost".to_string(), 
            &mut warnings
        );

        // Announced address for WebRTC ICE candidates. MUST be an IP literal:
        // Firefox's ICE stack (nICEr) rejects FQDN candidates outright (parse
        // error -> zero pairs -> ICE failed), while Chrome/Android resolve them.
        // Empty (default) falls back to host_name for backward compatibility --
        // only valid when host_name is itself an IP.
        let mediasoup_announced_ip = Self::parse_env_var_with_default(
            "HUSHFM_MEDIASOUP_ANNOUNCED_IP",
            "",
            String::new(),
            &mut warnings
        );

        // WebRTC Configuration
        let worker_port_min = Self::parse_env_var_with_default(
            "HUSHFM_WORKER_PORT_MIN", 
            "40000", 
            40000, 
            &mut warnings
        );

        let worker_port_max = Self::parse_env_var_with_default(
            "HUSHFM_WORKER_PORT_MAX", 
            "49999", 
            49999, 
            &mut warnings
        );

        // MediaSoup Configuration
        let mediasoup_listen_ip = Self::parse_env_var_with_default(
            "HUSHFM_MEDIASOUP_LISTEN_IP", 
            "0.0.0.0", 
            "0.0.0.0".to_string(), 
            &mut warnings
        );

        let mediasoup_enable_tcp = Self::parse_env_var_with_default(
            "HUSHFM_MEDIASOUP_ENABLE_TCP", 
            "false", 
            false, 
            &mut warnings
        );

        let mediasoup_expose_internal_ip = Self::parse_env_var_with_default(
            "HUSHFM_MEDIASOUP_EXPOSE_INTERNAL_IP", 
            "false", 
            false, 
            &mut warnings
        );

        let mediasoup_worker_debug = Self::parse_env_var_with_default(
            "HUSHFM_MEDIASOUP_WORKER_DEBUG", 
            "false", 
            false, 
            &mut warnings
        );

        // Monitoring Configuration
        let stale_listener_timeout_secs = Self::parse_env_var_with_default(
            "HUSHFM_STALE_LISTENER_TIMEOUT", 
            "0", 
            0u64, 
            &mut warnings
        );
        let stale_listener_timeout = ConfigValue::new(
            Duration::from_secs(stale_listener_timeout_secs.value),
            stale_listener_timeout_secs.source
        );

        // Audio Bot Room Configuration
        let audio_bot_room_name = Self::parse_env_var_with_default(
            "HUSHFM_AUDIO_BOT_ROOM_NAME",
            "Main Floor",
            "Main Floor".to_string(),
            &mut warnings
        );

        let audio_bot_dj_name = Self::parse_env_var_with_default(
            "HUSHFM_AUDIO_BOT_DJ_NAME",
            "AudioBot",
            "AudioBot".to_string(),
            &mut warnings
        );

        let audio_bot_description = Self::parse_env_var_with_default(
            "HUSHFM_AUDIO_BOT_DESCRIPTION",
            "Local audio input stream from server",
            "Local audio input stream from server".to_string(),
            &mut warnings
        );

        let audio_bot_tags = Self::parse_string_list_env_var(
            "HUSHFM_AUDIO_BOT_TAGS",
            vec!["dnb".to_string(), "live".to_string(), "trommeln und bass".to_string(), "party".to_string(), "fun fun fun".to_string()],
        );

        // Audio Configuration
        // Audio defaults are party-tuned (2026-07-05, see docs/offline-router-
        // connectivity.md): 160k earbud-transparent, complexity 5 (WebRTC's ARM
        // default — transparent at 160k, avoids the 8-9 dead zone, banks Pi CPU),
        // FEC off (music+PLC hides single-frame loss; toggle on for dropouts),
        // CBR (predictable airtime), 20 ms frames (latency vs packet rate).
        let opus_bitrate = Self::parse_env_var_with_default(
            "HUSHFM_OPUS_BITRATE",
            "160000",
            160000,
            &mut warnings
        );

        let opus_complexity = Self::parse_env_var_with_default(
            "HUSHFM_OPUS_COMPLEXITY",
            "5",
            5,
            &mut warnings
        );

        let opus_enable_fec = Self::parse_env_var_with_default(
            "HUSHFM_OPUS_ENABLE_FEC",
            "false",
            false,
            &mut warnings
        );

        let opus_enable_vbr = Self::parse_env_var_with_default(
            "HUSHFM_OPUS_ENABLE_VBR",
            "false",
            false,
            &mut warnings
        );

        let opus_frame_duration = Self::parse_env_var_with_default(
            "HUSHFM_OPUS_FRAME_DURATION",
            "20",
            20,
            &mut warnings
        );

        // Only takes effect when FEC is enabled: tells Opus the expected loss so
        // it actually inserts redundancy (FEC stays dormant at 0).
        let opus_packet_loss_perc = Self::parse_env_var_with_default(
            "HUSHFM_OPUS_PACKET_LOSS_PERC",
            "10",
            10u8,
            &mut warnings
        );

        let audio_buffer_size = Self::parse_env_var_with_default(
            "HUSHFM_AUDIO_BUFFER_SIZE",
            "512",
            512,
            &mut warnings
        );

        let ring_buffer_capacity = Self::parse_env_var_with_default(
            "HUSHFM_RING_BUFFER_CAPACITY",
            "19200",
            19200,
            &mut warnings
        );

        let enable_thread_priority = Self::parse_env_var_with_default(
            "HUSHFM_ENABLE_THREAD_PRIORITY",
            "true",
            true,
            &mut warnings
        );

        let dscp_marking = Self::parse_env_var_with_default(
            "HUSHFM_DSCP_MARKING",
            "46",
            46,
            &mut warnings
        );

        let config = Config {
            backend_port,
            frontend_port,
            host_name,
            mediasoup_announced_ip,
            worker_port_min,
            worker_port_max,
            mediasoup_listen_ip,
            mediasoup_enable_tcp,
            mediasoup_expose_internal_ip,
            mediasoup_worker_debug,
            stale_listener_timeout,
            audio_bot_room_name,
            audio_bot_dj_name,
            audio_bot_description,
            audio_bot_tags,
            opus_bitrate,
            opus_complexity,
            opus_enable_fec,
            opus_enable_vbr,
            opus_frame_duration,
            opus_packet_loss_perc,
            audio_buffer_size,
            ring_buffer_capacity,
            enable_thread_priority,
            dscp_marking,
        };

        // Validate configuration
        config.validate()?;

        // Display any warnings
        for warning in warnings {
            tracing::warn!("{}", warning);
        }

        // Display complete configuration
        config.display();

        tracing::info!("✅ Configuration loaded successfully");

        Ok(config)
    }

    /// Parse an environment variable with fallback to default and error handling
    fn parse_env_var_with_default<T>(
        var_name: &str,
        default_str: &str,
        default_value: T,
        warnings: &mut Vec<String>,
    ) -> ConfigValue<T>
    where
        T: FromStr + Clone,
        T::Err: std::error::Error + Send + Sync + 'static,
    {
        match std::env::var(var_name) {
            Ok(value) => {
                match value.parse::<T>() {
                    Ok(parsed) => ConfigValue::new(parsed, ConfigSource::Environment),
                    Err(e) => {
                        warnings.push(format!(
                            "Failed to parse {}: '{}' ({}). Using default: {}",
                            var_name, value, e, default_str
                        ));
                        ConfigValue::new(default_value, ConfigSource::Default)
                    }
                }
            },
            Err(_) => ConfigValue::new(default_value, ConfigSource::Default),
        }
    }

    /// Parse an environment variable as a comma-separated list of strings
    fn parse_string_list_env_var(
        var_name: &str,
        default_value: Vec<String>,
    ) -> ConfigValue<Vec<String>> {
        match std::env::var(var_name) {
            Ok(value) => {
                let parsed: Vec<String> = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                ConfigValue::new(parsed, ConfigSource::Environment)
            },
            Err(_) => ConfigValue::new(default_value, ConfigSource::Default),
        }
    }

    /// Validate the loaded configuration
    fn validate(&self) -> Result<(), ConfigError> {
        // Validate port range
        if self.worker_port_min.value >= self.worker_port_max.value {
            return Err(ConfigError::InvalidPortRange {
                min: self.worker_port_min.value,
                max: self.worker_port_max.value,
            });
        }

        // Validate port numbers are in reasonable range
        if self.worker_port_min.value < 1024 || self.worker_port_max.value > 65535 {
            return Err(ConfigError::ValidationError {
                var_name: "WORKER_PORT_RANGE".to_string(),
                value: format!("{}-{}", self.worker_port_min.value, self.worker_port_max.value),
                reason: "Ports must be between 1024 and 65535".to_string(),
            });
        }

        // Warn if port range is too small
        let port_range_size = self.worker_port_max.value - self.worker_port_min.value;
        if port_range_size < 100 {
            tracing::warn!(
                "Small WebRTC port range ({} ports). Consider using at least 100 ports for better connectivity",
                port_range_size
            );
        }

        // Validate IP address format
        if Ipv4Addr::from_str(&self.mediasoup_listen_ip.value).is_err() {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_MEDIASOUP_LISTEN_IP".to_string(),
                value: self.mediasoup_listen_ip.value.clone(),
                reason: "Must be a valid IPv4 address".to_string(),
            });
        }

        // Validate backend port
        if self.backend_port.value == 0 || self.backend_port.value < 1024 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_BACKEND_PORT".to_string(),
                value: self.backend_port.value.to_string(),
                reason: "Backend port must be >= 1024".to_string(),
            });
        }

        // Validate frontend port
        if self.frontend_port.value == 0 || self.frontend_port.value < 1024 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_FRONTEND_PORT".to_string(),
                value: self.frontend_port.value.to_string(),
                reason: "Frontend port must be >= 1024".to_string(),
            });
        }

        // Validate audio configuration
        if self.opus_bitrate.value < 32000 || self.opus_bitrate.value > 512000 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_OPUS_BITRATE".to_string(),
                value: self.opus_bitrate.value.to_string(),
                reason: "Opus bitrate must be between 32000 and 512000 bps".to_string(),
            });
        }

        if self.opus_complexity.value > 10 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_OPUS_COMPLEXITY".to_string(),
                value: self.opus_complexity.value.to_string(),
                reason: "Opus complexity must be between 0 and 10".to_string(),
            });
        }

        if self.opus_frame_duration.value != 10 && self.opus_frame_duration.value != 20 && self.opus_frame_duration.value != 40 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_OPUS_FRAME_DURATION".to_string(),
                value: self.opus_frame_duration.value.to_string(),
                reason: "Opus frame duration must be 10, 20, or 40 ms".to_string(),
            });
        }

        if self.audio_buffer_size.value < 64 || self.audio_buffer_size.value > 4096 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_AUDIO_BUFFER_SIZE".to_string(),
                value: self.audio_buffer_size.value.to_string(),
                reason: "Audio buffer size must be between 64 and 4096 frames".to_string(),
            });
        }

        if self.ring_buffer_capacity.value < 1024 || self.ring_buffer_capacity.value > 48000 {
            return Err(ConfigError::ValidationError {
                var_name: "HUSHFM_RING_BUFFER_CAPACITY".to_string(),
                value: self.ring_buffer_capacity.value.to_string(),
                reason: "Ring buffer capacity must be between 1024 and 48000 samples".to_string(),
            });
        }

        Ok(())
    }

    /// Display the complete configuration in a formatted table
    fn display(&self) {
        tracing::info!("🔧 HushFM Configuration Loaded:");
        tracing::info!("┌─────────────────────────────────┬─────────────────┬────────────┐");
        tracing::info!("│ Setting                         │ Value           │ Source     │");
        tracing::info!("├─────────────────────────────────┼─────────────────┼────────────┤");
        tracing::info!("│ Backend Port                    │ {:15} │ {:10} │", self.backend_port.value, self.backend_port.source);
        tracing::info!("│ Frontend Port                   │ {:15} │ {:10} │", self.frontend_port.value, self.frontend_port.source);
        tracing::info!("│ Host Name                       │ {:15} │ {:10} │", self.host_name.value, self.host_name.source);
        tracing::info!("│ Announced IP (ICE)              │ {:15} │ {:10} │", self.announced_ip(), self.mediasoup_announced_ip.source);
        tracing::info!("│ Worker Port Range               │ {:15} │ {:10} │", 
                      format!("{}-{}", self.worker_port_min.value, self.worker_port_max.value),
                      if self.worker_port_min.source == ConfigSource::Environment || self.worker_port_max.source == ConfigSource::Environment { "Env Var" } else { "Default" }
        );
        tracing::info!("│ MediaSoup Listen IP (bind_ip)   │ {:15} │ {:10} │", self.mediasoup_listen_ip.value, self.mediasoup_listen_ip.source);
        tracing::info!("│ MediaSoup TCP Enabled           │ {:15} │ {:10} │", self.mediasoup_enable_tcp.value, self.mediasoup_enable_tcp.source);
        tracing::info!("│ MediaSoup Expose Internal IP    │ {:15} │ {:10} │", self.mediasoup_expose_internal_ip.value, self.mediasoup_expose_internal_ip.source);
        tracing::info!("│ MediaSoup Worker Debug          │ {:15} │ {:10} │", self.mediasoup_worker_debug.value, self.mediasoup_worker_debug.source);
        
        let timeout_display = if self.stale_listener_timeout.value.is_zero() {
            "0s (disabled)".to_string()
        } else {
            format!("{}s", self.stale_listener_timeout.value.as_secs())
        };
        tracing::info!("│ Stale Listener Timeout          │ {:15} │ {:10} │", timeout_display, self.stale_listener_timeout.source);
        tracing::info!("├─────────────────────────────────┼─────────────────┼────────────┤");
        tracing::info!("│ Audio Bot Room Name             │ {:15} │ {:10} │", self.audio_bot_room_name.value, self.audio_bot_room_name.source);
        tracing::info!("│ Audio Bot DJ Name               │ {:15} │ {:10} │", self.audio_bot_dj_name.value, self.audio_bot_dj_name.source);
        let tags_display = if self.audio_bot_tags.value.len() > 2 {
            format!("{}...", self.audio_bot_tags.value[..2].join(", "))
        } else {
            self.audio_bot_tags.value.join(", ")
        };
        tracing::info!("│ Audio Bot Tags                  │ {:15} │ {:10} │", tags_display, self.audio_bot_tags.source);
        tracing::info!("├─────────────────────────────────┼─────────────────┼────────────┤");
        tracing::info!("│ Opus Bitrate                    │ {:15} │ {:10} │", format!("{}kbps", self.opus_bitrate.value / 1000), self.opus_bitrate.source);
        tracing::info!("│ Opus Complexity                 │ {:15} │ {:10} │", self.opus_complexity.value, self.opus_complexity.source);
        tracing::info!("│ Opus FEC Enabled                │ {:15} │ {:10} │", self.opus_enable_fec.value, self.opus_enable_fec.source);
        tracing::info!("│ Opus Packet Loss % (FEC only)   │ {:15} │ {:10} │", format!("{}%", self.opus_packet_loss_perc.value), self.opus_packet_loss_perc.source);
        tracing::info!("│ Opus VBR Enabled                │ {:15} │ {:10} │", self.opus_enable_vbr.value, self.opus_enable_vbr.source);
        tracing::info!("│ Opus Frame Duration             │ {:15} │ {:10} │", format!("{}ms", self.opus_frame_duration.value), self.opus_frame_duration.source);
        tracing::info!("│ Audio Buffer Size               │ {:15} │ {:10} │", format!("{} frames", self.audio_buffer_size.value), self.audio_buffer_size.source);
        tracing::info!("│ Ring Buffer Capacity            │ {:15} │ {:10} │", format!("{} samples", self.ring_buffer_capacity.value), self.ring_buffer_capacity.source);
        tracing::info!("│ Thread Priority Enabled         │ {:15} │ {:10} │", self.enable_thread_priority.value, self.enable_thread_priority.source);
        tracing::info!("│ DSCP Marking                    │ {:15} │ {:10} │", self.dscp_marking.value, self.dscp_marking.source);
        tracing::info!("└─────────────────────────────────┴─────────────────┴────────────┘");
    }

    // Readonly getters for configuration values

    /// Get backend server port
    pub fn backend_port(&self) -> u16 {
        self.backend_port.value
    }

    /// Get frontend server port
    pub fn frontend_port(&self) -> u16 {
        self.frontend_port.value
    }

    /// Get configured hostname for the service
    pub fn host_name(&self) -> &str {
        &self.host_name.value
    }

    /// Get WebRTC worker port range
    pub fn worker_port_range(&self) -> RangeInclusive<u16> {
        self.worker_port_min.value..=self.worker_port_max.value
    }

    /// Get MediaSoup listen IP address
    pub fn mediasoup_listen_ip(&self) -> &str {
        &self.mediasoup_listen_ip.value
    }

    /// Announced address for ICE candidates. Prefers the explicit
    /// HUSHFM_MEDIASOUP_ANNOUNCED_IP (must be an IP literal -- Firefox rejects
    /// FQDN candidates); falls back to host_name when unset.
    pub fn announced_ip(&self) -> &str {
        if self.mediasoup_announced_ip.value.is_empty() {
            &self.host_name.value
        } else {
            &self.mediasoup_announced_ip.value
        }
    }

    /// Check if MediaSoup TCP transport is enabled
    pub fn mediasoup_enable_tcp(&self) -> bool {
        self.mediasoup_enable_tcp.value
    }

    /// Check if MediaSoup should expose internal IP in candidates
    pub fn mediasoup_expose_internal_ip(&self) -> bool {
        self.mediasoup_expose_internal_ip.value
    }

    /// Check if MediaSoup worker debug logging is enabled
    pub fn mediasoup_worker_debug(&self) -> bool {
        self.mediasoup_worker_debug.value
    }

    /// Get stale listener cleanup timeout
    pub fn stale_listener_timeout(&self) -> Duration {
        self.stale_listener_timeout.value
    }

    // Audio Bot Room Configuration Getters

    /// Get audio bot room name
    pub fn audio_bot_room_name(&self) -> &str {
        &self.audio_bot_room_name.value
    }

    /// Get audio bot DJ name
    pub fn audio_bot_dj_name(&self) -> &str {
        &self.audio_bot_dj_name.value
    }

    /// Get audio bot room description
    pub fn audio_bot_description(&self) -> &str {
        &self.audio_bot_description.value
    }

    /// Get audio bot room tags
    pub fn audio_bot_tags(&self) -> &[String] {
        &self.audio_bot_tags.value
    }

    // Audio Configuration Getters

    /// Get Opus encoder bitrate in bits per second
    pub fn opus_bitrate(&self) -> u32 {
        self.opus_bitrate.value
    }

    /// Get Opus encoder complexity (0-10)
    pub fn opus_complexity(&self) -> u32 {
        self.opus_complexity.value
    }

    /// Check if Opus Forward Error Correction is enabled
    pub fn opus_enable_fec(&self) -> bool {
        self.opus_enable_fec.value
    }

    /// Check if Opus Variable Bit Rate is enabled
    pub fn opus_enable_vbr(&self) -> bool {
        self.opus_enable_vbr.value
    }

    /// Get Opus frame duration in milliseconds (10, 20, or 40)
    pub fn opus_frame_duration(&self) -> u32 {
        self.opus_frame_duration.value
    }

    /// Get Opus expected packet-loss percent (only active when FEC is enabled)
    pub fn opus_packet_loss_perc(&self) -> u8 {
        self.opus_packet_loss_perc.value
    }

    /// Get audio buffer size in samples
    pub fn audio_buffer_size(&self) -> u32 {
        self.audio_buffer_size.value
    }

    /// Get ring buffer capacity in samples
    pub fn ring_buffer_capacity(&self) -> u32 {
        self.ring_buffer_capacity.value
    }

    /// Check if real-time thread priority is enabled
    pub fn enable_thread_priority(&self) -> bool {
        self.enable_thread_priority.value
    }

    /// Get DSCP marking value for QoS
    pub fn dscp_marking(&self) -> u8 {
        self.dscp_marking.value
    }

    /// Calculate Opus frame size in samples based on duration
    pub fn opus_frame_size(&self) -> u32 {
        // 48kHz sample rate * frame duration in seconds
        48000 * self.opus_frame_duration.value / 1000
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        // Temporarily clear environment variables
        std::env::remove_var("HUSHFM_BACKEND_PORT");
        std::env::remove_var("HUSHFM_HOST_NAME");
        
        let config = Config::load().expect("Should load with defaults");
        
        assert_eq!(config.backend_port(), 3000);
        assert_eq!(config.host_name(), "localhost");
        assert_eq!(config.worker_port_range(), 40000..=49999);
        assert_eq!(config.mediasoup_listen_ip(), "0.0.0.0");
        assert!(!config.mediasoup_enable_tcp());
        assert!(!config.mediasoup_expose_internal_ip());
        assert_eq!(config.stale_listener_timeout(), Duration::from_secs(0));
    }

    #[test]
    fn test_config_validation() {
        std::env::set_var("HUSHFM_WORKER_PORT_MIN", "50000");
        std::env::set_var("HUSHFM_WORKER_PORT_MAX", "40000");
        
        let result = Config::load();
        assert!(result.is_err());
        
        // Clean up
        std::env::remove_var("HUSHFM_WORKER_PORT_MIN");
        std::env::remove_var("HUSHFM_WORKER_PORT_MAX");
    }
}