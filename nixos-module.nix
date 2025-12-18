{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.hushfm;
  
  # Parse port range string (e.g., "40000-49999") into min/max
  parsePortRange = portRange: 
    let
      parts = lib.splitString "-" portRange;
      min = lib.toInt (lib.head parts);
      max = lib.toInt (lib.last parts);
    in { inherit min max; };
  
  portRange = parsePortRange cfg.worker.portRange;
  
  # Environment variables for services
  backendEnv = {
    HUSHFM_BACKEND_PORT = toString cfg.backend.port;
    HUSHFM_FRONTEND_PORT = toString cfg.frontend.port;
    HUSHFM_WORKER_PORT_MIN = toString portRange.min;
    HUSHFM_WORKER_PORT_MAX = toString portRange.max;
    HUSHFM_TLS_ENABLED = if cfg.tls.enable then "true" else "false";
    HUSHFM_CERT_FILE = cfg.tls.certFile;
    HUSHFM_KEY_FILE = cfg.tls.keyFile;
    HUSHFM_FRONTEND_URL = "${if cfg.tls.enable then "https" else "http"}://localhost:${toString cfg.frontend.port}";
  };
  
  frontendEnv = backendEnv // {
    HUSHFM_API_BASE_URL = "${if cfg.tls.enable then "https" else "http"}://localhost:${toString cfg.backend.port}";
    HUSHFM_WS_PROTOCOL = if cfg.tls.enable then "wss" else "ws";
  };

in {
  options.services.hushfm = {
    enable = mkEnableOption "HushFM live audio streaming platform";

    backend = {
      port = mkOption {
        type = types.port;
        default = 3000;
        description = "Port for the backend HTTP/HTTPS server";
      };
    };

    frontend = {
      port = mkOption {
        type = types.port;
        default = 8080;
        description = "Port for the frontend HTTP/HTTPS server";
      };
    };

    worker = {
      portRange = mkOption {
        type = types.str;
        default = "40000-49999";
        description = "Port range for WebRTC worker processes (format: min-max)";
      };
    };

    tls = {
      enable = mkEnableOption "TLS/HTTPS for both backend and frontend";
      
      certFile = mkOption {
        type = types.str;
        default = "";
        description = "Path to TLS certificate file";
      };
      
      keyFile = mkOption {
        type = types.str;
        default = "";
        description = "Path to TLS private key file";
      };
    };
  };

  config = mkIf cfg.enable {
    # Open firewall ports
    networking.firewall = {
      allowedTCPPorts = [ cfg.backend.port cfg.frontend.port ];
      allowedUDPPortRanges = [
        { from = portRange.min; to = portRange.max; }
      ];
    };

    # Backend service
    systemd.services.hushfm-backend = {
      description = "HushFM Backend Server";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      
      environment = backendEnv;
      
      serviceConfig = {
        Type = "simple";
        User = "hushfm";
        Group = "hushfm";
        ExecStart = "${pkgs.hushfm-backend}/bin/server";
        Restart = "always";
        RestartSec = 5;
        
        # Security settings
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        RestrictRealtime = true;
        RestrictNamespaces = true;
        LockPersonality = true;
      };
    };

    # Frontend service (using nginx to serve static files)
    services.nginx = {
      enable = true;
      virtualHosts."hushfm-frontend" = {
      listen = [
        { 
          addr = "0.0.0.0"; 
          port = cfg.frontend.port; 
          ssl = cfg.tls.enable;
        }
      ];
      
      # TLS configuration
      sslCertificate = mkIf cfg.tls.enable cfg.tls.certFile;
      sslCertificateKey = mkIf cfg.tls.enable cfg.tls.keyFile;
      
      # Serve frontend static files
      root = pkgs.hushfm-frontend;
      
      locations = {
        "/" = {
          tryFiles = "$uri $uri/ /index.html";
          extraConfig = ''
            # Enable gzip compression
            gzip on;
            gzip_types text/css application/javascript application/json;
            
            # Cache static assets
            location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
              expires 1y;
              add_header Cache-Control "public, immutable";
            }
          '';
        };
        
        # Proxy API requests to backend
        "/api/" = {
          proxyPass = "${if cfg.tls.enable then "https" else "http"}://localhost:${toString cfg.backend.port}/api/";
          extraConfig = ''
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
          '';
        };
        
        # Proxy WebSocket connections to backend
        "/ws" = {
          proxyPass = "${if cfg.tls.enable then "https" else "http"}://localhost:${toString cfg.backend.port}/ws";
          extraConfig = ''
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
          '';
        };
      };
      };
    };

    # Create hushfm user and group
    users.users.hushfm = {
      isSystemUser = true;
      group = "hushfm";
      description = "HushFM service user";
      home = "/var/lib/hushfm";
      createHome = true;
    };
    
    users.groups.hushfm = {};

    # Ensure TLS files are readable by hushfm user if TLS is enabled
    assertions = [
      {
        assertion = !cfg.tls.enable || (cfg.tls.certFile != "" && cfg.tls.keyFile != "");
        message = "TLS certificate and key files must be specified when TLS is enabled";
      }
    ];
  };
}