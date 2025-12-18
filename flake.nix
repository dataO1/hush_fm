{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    let
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };
        

        # Extract version from Cargo.toml
        cargoToml = builtins.fromTOML (builtins.readFile ./backend/Cargo.toml);
        version = cargoToml.package.version;


        # Common Rust toolchain with cross-compilation targets
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "rustfmt" ];
          targets = [ 
            "x86_64-unknown-linux-gnu"
            "aarch64-unknown-linux-gnu"
          ];
        };
        
        # Development shell
        devShell = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            # Rust toolchain with cross-compilation support
            rustToolchain
            cargo-watch
            
            # Node.js environment (required for mediasoup build)
            nodejs_20
            pnpm
            
            # System dependencies for mediasoup C++ build
            pkg-config
            cmake
            gnumake
            
            # Native compilers (for build tools like flatc)
            gcc
            stdenv.cc
            
            # Use Python 3.11 to avoid SafeConfigParser removal in 3.12+
            python311
            python311Packages.pip
            python311Packages.setuptools
            python311Packages.invoke
            
            git
          ] ++ (with pkgs.stdenv; [ cc ]);

          buildInputs = with pkgs; [
            openssl
            openssl.dev
          ];

          # Environment variables for mediasoup build
          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
          PYTHON = "${pkgs.python311}/bin/python3";
          MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD = "false";
          
          # HushFM service environment variables
          HUSHFM_BACKEND_PORT = "3000";
          HUSHFM_FRONTEND_PORT = "8080";
          HUSHFM_WORKER_PORT_MIN = "40000";
          HUSHFM_WORKER_PORT_MAX = "49999";
          HUSHFM_TLS_ENABLED = "false";
          HUSHFM_CERT_FILE = "./tls/server.crt";
          HUSHFM_KEY_FILE = "./tls/server.key";
          HUSHFM_FRONTEND_URL = "http://localhost:8080";

          shellHook = ''
            echo "🎵 HushFM Development Environment"
            echo ""
            echo "🔨 Build commands:"
            echo "  Backend:   cd backend && cargo build --release"
            echo "  Frontend:  cd frontend && pnpm dev"
            echo "  Watch:     cd backend && cargo watch -x run"
            echo ""
            echo "📱 Raspberry Pi Optimization:"
            echo "  # -C target-cpu=native: Tells LLVM to use every instruction set available on THIS cpu."
            echo "  # For Pi 4, this enables NEON, VFPv4, CRC32, etc."
            echo "  RUSTFLAGS=\"-C target-cpu=native\" cargo build --release"
            echo ""
            echo "🌐 Service Configuration:"
            echo "  Backend:   http://localhost:$HUSHFM_BACKEND_PORT"
            echo "  Frontend:  $HUSHFM_FRONTEND_URL"
            echo "  WebRTC Ports: $HUSHFM_WORKER_PORT_MIN-$HUSHFM_WORKER_PORT_MAX"
            echo "  TLS Enabled:  $HUSHFM_TLS_ENABLED"
            echo ""
          '';
        };
        
        # Simple binary packaging
        makePackage = targetSystem: binaryPath: pkgs.stdenv.mkDerivation {
          pname = "hushfm-backend";
          inherit version;
          
          src = ./.;
          
          installPhase = ''
            mkdir -p $out/bin
            if [ -f "${binaryPath}" ]; then
              cp "${binaryPath}" $out/bin/server
              chmod +x $out/bin/server
            else
              echo "❌ Binary not found at ${binaryPath}"
              echo "💡 Run 'cargo build --release${if targetSystem == "aarch64-linux" then " --target aarch64-unknown-linux-gnu" else ""}' first"
              exit 1
            fi
          '';
          
          meta = with pkgs.lib; {
            description = "HushFM live audio streaming backend";
            homepage = "https://github.com/yourusername/hushfm";
            license = licenses.mit;
            maintainers = [ ];
            platforms = [ targetSystem ];
          };
        };

        # Frontend package (simple directory copy for now)
        hushfm-frontend = pkgs.stdenv.mkDerivation {
          pname = "hushfm-frontend";
          inherit version;
          
          src = ./frontend;
          
          installPhase = ''
            mkdir -p $out
            cp -r $src/* $out/
          '';
          
          meta = with pkgs.lib; {
            description = "HushFM live audio streaming frontend source";
            homepage = "https://github.com/yourusername/hushfm";
            license = licenses.mit;
            maintainers = [ ];
            platforms = platforms.all;
          };
        };
      in
      {
        # Packages for both architectures
        packages = {
          # Architecture-specific backend packages
          hushfm-backend-x86_64 = makePackage "x86_64-linux" "./backend/target/release/server";
          hushfm-backend-aarch64 = makePackage "aarch64-linux" "./backend/target/aarch64-unknown-linux-gnu/server";
          
          # Default to current system architecture  
          hushfm-backend = if system == "x86_64-linux" then makePackage "x86_64-linux" "./backend/target/release/server"
                          else if system == "aarch64-linux" then makePackage "aarch64-linux" "./backend/target/aarch64-unknown-linux-gnu/server"
                          else throw "Unsupported system: ${system}";
          
          inherit hushfm-frontend;
          default = self.packages.${system}.hushfm-backend;
        };

        # Development shells
        devShells = {
          default = devShell;
        };
      }
    ) // {
      # NixOS module for HushFM service (system-independent)
      nixosModules.hushfm = { config, lib, pkgs, ... }:
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
              allowedTCPPorts = [ cfg.backend.port ] ++ (if cfg.tls.enable then [ 443 ] else [ 80 ]);
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
                ExecStart = "${self.packages.${pkgs.system}.hushfm-backend}/bin/server";
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
              recommendedTlsSettings = true;
              recommendedOptimisation = true;
              recommendedGzipSettings = true;
              recommendedProxySettings = false;  # DISABLE THIS
              
              # Add upstream map for WebSocket connection header
              appendHttpConfig = ''
                map $http_upgrade $connection_upgrade {
                  default upgrade;
                  "" close;
                }
              '';
              
              virtualHosts."hushfm-frontend" = {
                listen = [
                  { 
                    addr = "0.0.0.0"; 
                    port = if cfg.tls.enable then 443 else 80; 
                    ssl = cfg.tls.enable;
                  }
                ];
                
                # TLS configuration
                sslCertificate = mkIf cfg.tls.enable cfg.tls.certFile;
                sslCertificateKey = mkIf cfg.tls.enable cfg.tls.keyFile;
                
                # Serve frontend static files
                root = self.packages.${pkgs.system}.hushfm-frontend;
                
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
                      proxy_set_header Connection $connection_upgrade;
                      proxy_set_header Host $host;
                      proxy_set_header X-Real-IP $remote_addr;
                      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                      proxy_set_header X-Forwarded-Proto $scheme;
                    '';
                  };
                };
              };
            };
            
            # Development frontend service (using nginx on frontend port for dev)
            services.nginx.virtualHosts."hushfm-dev" = mkIf (!cfg.tls.enable) {
              listen = [
                { 
                  addr = "0.0.0.0"; 
                  port = cfg.frontend.port;
                  ssl = false;
                }
              ];
              
              # Serve frontend static files for development
              root = self.packages.${pkgs.system}.hushfm-frontend;
              
              locations = {
                "/" = {
                  tryFiles = "$uri $uri/ /index.html";
                };
                
                # Proxy API requests to backend
                "/api/" = {
                  proxyPass = "http://localhost:${toString cfg.backend.port}/api/";
                  extraConfig = ''
                    proxy_set_header Host $host;
                    proxy_set_header X-Real-IP $remote_addr;
                    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                    proxy_set_header X-Forwarded-Proto $scheme;
                  '';
                };
                
                # Proxy WebSocket connections to backend
                "/ws" = {
                  proxyPass = "http://localhost:${toString cfg.backend.port}/ws";
                  extraConfig = ''
                    proxy_http_version 1.1;
                    proxy_set_header Upgrade $http_upgrade;
                    proxy_set_header Connection $connection_upgrade;
                    proxy_set_header Host $host;
                    proxy_set_header X-Real-IP $remote_addr;
                    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                    proxy_set_header X-Forwarded-Proto $scheme;
                  '';
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
        };
    };
}
