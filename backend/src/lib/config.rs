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
    
    // WebRTC Configuration
    worker_port_min: ConfigValue<u16>,
    worker_port_max: ConfigValue<u16>,
    
    // MediaSoup Configuration
    mediasoup_listen_ip: ConfigValue<String>,
    mediasoup_enable_tcp: ConfigValue<bool>,
    mediasoup_expose_internal_ip: ConfigValue<bool>,
    
    // Monitoring Configuration
    stale_listener_timeout: ConfigValue<Duration>,
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

        let config = Config {
            backend_port,
            frontend_port,
            host_name,
            worker_port_min,
            worker_port_max,
            mediasoup_listen_ip,
            mediasoup_enable_tcp,
            mediasoup_expose_internal_ip,
            stale_listener_timeout,
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
        tracing::info!("│ Host Name (announced_ip)        │ {:15} │ {:10} │", self.host_name.value, self.host_name.source);
        tracing::info!("│ Worker Port Range               │ {:15} │ {:10} │", 
                      format!("{}-{}", self.worker_port_min.value, self.worker_port_max.value),
                      if self.worker_port_min.source == ConfigSource::Environment || self.worker_port_max.source == ConfigSource::Environment { "Env Var" } else { "Default" }
        );
        tracing::info!("│ MediaSoup Listen IP (bind_ip)   │ {:15} │ {:10} │", self.mediasoup_listen_ip.value, self.mediasoup_listen_ip.source);
        tracing::info!("│ MediaSoup TCP Enabled           │ {:15} │ {:10} │", self.mediasoup_enable_tcp.value, self.mediasoup_enable_tcp.source);
        tracing::info!("│ MediaSoup Expose Internal IP    │ {:15} │ {:10} │", self.mediasoup_expose_internal_ip.value, self.mediasoup_expose_internal_ip.source);
        
        let timeout_display = if self.stale_listener_timeout.value.is_zero() {
            "0s (disabled)".to_string()
        } else {
            format!("{}s", self.stale_listener_timeout.value.as_secs())
        };
        tracing::info!("│ Stale Listener Timeout          │ {:15} │ {:10} │", timeout_display, self.stale_listener_timeout.source);
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

    /// Get announced IP (derived from host_name for backward compatibility)
    pub fn announced_ip(&self) -> &str {
        &self.host_name.value
    }

    /// Check if MediaSoup TCP transport is enabled
    pub fn mediasoup_enable_tcp(&self) -> bool {
        self.mediasoup_enable_tcp.value
    }

    /// Check if MediaSoup should expose internal IP in candidates
    pub fn mediasoup_expose_internal_ip(&self) -> bool {
        self.mediasoup_expose_internal_ip.value
    }

    /// Get stale listener cleanup timeout
    pub fn stale_listener_timeout(&self) -> Duration {
        self.stale_listener_timeout.value
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