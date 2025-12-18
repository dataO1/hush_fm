{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
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
            nodejs_20.pkgs.npm

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
          HUSHFM_PROXY_URL = "https://localhost";

          shellHook = ''
            echo "🎵 HushFM Development Environment"
            echo ""
            echo "🔨 Build commands:"
            echo "  Backend:   cd backend && cargo build --release"
            echo "  Frontend:  cd frontend && npm run dev"
            echo "  Watch:     cd backend && cargo watch -x run"
            echo ""
            echo "📱 Raspberry Pi Optimization:"
            echo "  # -C target-cpu=native: Tells LLVM to use every instruction set available on THIS cpu."
            echo "  # For Pi 4, this enables NEON, VFPv4, CRC32, etc."
            echo "  RUSTFLAGS=\"-C target-cpu=native\" cargo build --release"
            echo ""
            echo "🌐 Service Configuration:"
            echo "  Backend:   http://localhost:$HUSHFM_BACKEND_PORT"  
            echo "  Frontend:  http://localhost:$HUSHFM_FRONTEND_PORT"
            echo "  Proxy:     $HUSHFM_PROXY_URL (via nginx on :443)"
            echo "  WebRTC Ports: $HUSHFM_WORKER_PORT_MIN-$HUSHFM_WORKER_PORT_MAX"
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

        # Frontend package (built production bundle)
        hushfm-frontend = pkgs.buildNpmPackage {
          pname = "hushfm-frontend";
          inherit version;

          src = ./frontend;

          # The hash of the dependencies - will need to be updated when dependencies change
          npmDepsHash = "sha256-J3gScJKvjaqGH+MVQnoa5vKOnX0BXtm+8LQ6tVOfZ48=";


          # Build script and install
          buildScript = "build";

          installPhase = ''
            runHook preInstall

            # Copy built files to output
            mkdir -p $out
            cp -r dist/* $out/

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "HushFM live audio streaming frontend";
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

          # Environment variables for services (backend runs HTTP, nginx handles TLS)
          serviceEnv = {
            HUSHFM_BACKEND_PORT = toString cfg.backend.port;
            HUSHFM_FRONTEND_PORT = toString cfg.frontend.port;
            HUSHFM_WORKER_PORT_MIN = toString portRange.min;
            HUSHFM_WORKER_PORT_MAX = toString portRange.max;
            HUSHFM_PROXY_URL = "https://localhost";  # Nginx reverse proxy URL
          };

        in {
          options.services.hushfm = {
            enable = mkEnableOption "HushFM live audio streaming platform";

            backend = {
              port = mkOption {
                type = types.port;
                default = 3000;
                description = "Port for the backend HTTP server";
              };
            };

            frontend = {
              port = mkOption {
                type = types.port;
                default = 8080;
                description = "Port for the frontend development server";
              };
            };

            worker = {
              portRange = mkOption {
                type = types.str;
                default = "40000-49999";
                description = "Port range for WebRTC worker processes (format: min-max)";
              };
            };

          };

          config = mkIf cfg.enable {
            # Open firewall ports (reverse proxy on 443, WebRTC UDP range)
            networking.firewall = {
              allowedTCPPorts = [ 443 ];  # Only nginx reverse proxy exposed
              allowedUDPPortRanges = [
                { from = portRange.min; to = portRange.max; }  # WebRTC direct access
              ];
            };

            # Backend service
            systemd.services.hushfm-backend = {
              description = "HushFM Backend Server";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              environment = serviceEnv;

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

            # Certificate generation service
            systemd.services.generate-nginx-cert = {
              description = "Generate self-signed certificate for Nginx";
              wantedBy = [ "multi-user.target" ];
              before = [ "nginx.service" ];
              script = ''
                cert_dir="/var/lib/nginx/certs"
                cert_file="$cert_dir/cert.pem"
                key_file="$cert_dir/key.pem"
                
                # Ensure directory exists
                mkdir -p "$cert_dir"
                
                # Generate certificate if it doesn't exist
                if [ ! -f "$cert_file" ]; then
                  echo "Generating new SSL certificate..."
                  ${pkgs.openssl}/bin/openssl req -x509 -newkey rsa:2048 \
                    -keyout "$key_file" \
                    -out "$cert_file" \
                    -days 365 -nodes \
                    -subj "/CN=hushfm.local" \
                    -addext "subjectAltName=IP:127.0.0.1,IP:192.168.178.105,DNS:hushfm.local,DNS:localhost"
                  echo "SSL certificate generated"
                else
                  echo "SSL certificate already exists"
                fi
                
                # Always ensure correct ownership and permissions (idempotent)
                echo "Setting correct ownership and permissions..."
                chown nginx:nginx "$key_file" "$cert_file"
                chmod 640 "$key_file"  # nginx group can read
                chmod 644 "$cert_file"
                
                echo "Certificate setup complete"
              '';
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
              };
            };

            # Certificate renewal service
            systemd.services.renew-nginx-cert = {
              description = "Renew nginx self-signed certificate if needed";
              script = ''
                cert_file="/var/lib/nginx/certs/cert.pem"
                key_file="/var/lib/nginx/certs/key.pem"
                
                # Check if certificate exists and is close to expiry (less than 30 days)
                if [ -f "$cert_file" ]; then
                  exp_date=$(${pkgs.openssl}/bin/openssl x509 -in "$cert_file" -noout -enddate | cut -d= -f2)
                  exp_epoch=$(date -d "$exp_date" +%s)
                  now_epoch=$(date +%s)
                  days_until_exp=$(( (exp_epoch - now_epoch) / 86400 ))
                  
                  echo "Certificate expires in $days_until_exp days"
                  
                  if [ $days_until_exp -lt 30 ]; then
                    echo "Certificate expiring soon, regenerating..."
                    rm -f "$cert_file" "$key_file"
                    
                    # Generate new certificate
                    ${pkgs.openssl}/bin/openssl req -x509 -newkey rsa:2048 \
                      -keyout "$key_file" \
                      -out "$cert_file" \
                      -days 365 -nodes \
                      -subj "/CN=hushfm.local" \
                      -addext "subjectAltName=IP:127.0.0.1,IP:192.168.178.105,DNS:hushfm.local,DNS:localhost"
                    
                    # Set proper ownership and permissions (idempotent)
                    chown nginx:nginx "$key_file" "$cert_file"
                    chmod 640 "$key_file"  # nginx group can read
                    chmod 644 "$cert_file"
                    
                    # Reload nginx to use new certificate
                    systemctl reload nginx
                    echo "Certificate renewed and nginx reloaded"
                  else
                    echo "Certificate is still valid, no renewal needed"
                  fi
                else
                  echo "Certificate file not found, will be generated by generate-nginx-cert service"
                fi
              '';
              serviceConfig = {
                Type = "oneshot";
                User = "root";
              };
            };

            # Certificate renewal timer (daily check)
            systemd.timers.renew-nginx-cert = {
              description = "Timer for nginx certificate renewal check";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnCalendar = "daily";
                Persistent = true;
                RandomizedDelaySec = "1h";
              };
            };

            # Reverse proxy (nginx) with TLS termination
            services.nginx = {
              enable = true;
              recommendedTlsSettings = true;
              recommendedOptimisation = true;
              recommendedGzipSettings = true;
              recommendedProxySettings = true;  # Enable WebSocket support

              virtualHosts."hushfm-frontend" = {
                default = true;
                forceSSL = true;
                sslCertificate = "/var/lib/nginx/certs/cert.pem";
                sslCertificateKey = "/var/lib/nginx/certs/key.pem";

                locations = {
                  # Serve frontend static files
                  "/" = {
                    root = self.packages.${pkgs.system}.hushfm-frontend;
                    index = "index.html";
                    tryFiles = "$uri $uri/ /index.html";  # SPA fallback
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

                  # Proxy API requests to backend (HTTP)
                  "/api" = {
                    proxyPass = "http://127.0.0.1:${toString cfg.backend.port}";
                  };

                  # Proxy WebSocket connections to backend (HTTP)
                  "/ws" = {
                    proxyPass = "http://127.0.0.1:${toString cfg.backend.port}";
                    proxyWebsockets = true;
                  };
                };
              };
            };

            # Ensure nginx waits for certificate generation
            systemd.services.nginx = {
              after = [ "generate-nginx-cert.service" ];
              wants = [ "generate-nginx-cert.service" ];
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
          };
        };
    };
}
