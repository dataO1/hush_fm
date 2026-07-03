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


        # Rust toolchain — NATIVE builds only.
        #
        # NOTE: NO CROSS-COMPILATION. We tried cross-compiling the backend for
        # the Pi (aarch64) from x86_64 and it never worked (mediasoup's C++
        # worker build breaks under cross toolchains). The backend for the Pi
        # is ALWAYS built natively ON the Pi itself:
        #   ssh into the Pi → git pull → nix develop → cargo build --release
        # The flake packages below just wrap whatever binary the local
        # `cargo build --release` produced (see makePackage).
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "rustfmt" ];
        };

        # Development shell
        devShell = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            # Rust toolchain (native builds only — see note above)
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

            # Audio system libraries for CPAL/ALSA and Opus
            alsa-lib
            alsa-lib.dev
            libopus
            libopus.dev
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
          HUSHFM_HOST_NAME = "127.0.0.1";

          # MediaSoup configuration for localhost development
          HUSHFM_MEDIASOUP_LISTEN_IP = "127.0.0.1";
          HUSHFM_MEDIASOUP_ENABLE_TCP = "true";
          HUSHFM_MEDIASOUP_EXPOSE_INTERNAL_IP = "false";
          HUSHFM_MEDIASOUP_WORKER_DEBUG = "false";

          # Monitoring configuration for localhost development
          HUSHFM_STALE_LISTENER_TIMEOUT = "0";

          # Audio Bot Room configuration
          HUSHFM_AUDIO_BOT_ROOM_NAME = "Main Floor";
          HUSHFM_AUDIO_BOT_DJ_NAME = "AudioBot";
          HUSHFM_AUDIO_BOT_DESCRIPTION = "Local audio input stream from server";
          HUSHFM_AUDIO_BOT_TAGS = "dnb,live,trommeln und bass,party,fun fun fun";

          # Rust logging configuration - suppress verbose debug logs
          RUST_LOG = "info,server::lib::audio::encoder=warn,server::lib::audio::audio_device_monitor=info,mediasoup=info,mediasoup::worker=info";

          # Audio optimization configuration
          HUSHFM_OPUS_BITRATE = "256000";        # 256kbps for transparent quality
          HUSHFM_OPUS_COMPLEXITY = "8";          # High quality, less CPU
          HUSHFM_OPUS_ENABLE_FEC = "false";      # No FEC on WiFi 6
          HUSHFM_OPUS_ENABLE_VBR = "true";       # Constrained VBR
          HUSHFM_OPUS_FRAME_DURATION = "10";     # 20ms frames (10ms experimental)
          HUSHFM_AUDIO_BUFFER_SIZE = "1024";     # CPAL buffer size in frames
          HUSHFM_RING_BUFFER_CAPACITY = "4800";  # 100ms buffer
          HUSHFM_ENABLE_THREAD_PRIORITY = "true"; # Real-time priority
          HUSHFM_DSCP_MARKING = "46";            # QoS EF marking

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
            echo "  Hostname:  $HUSHFM_HOST_NAME (nginx proxy on :443 for production)"
            echo "  WebRTC Ports: $HUSHFM_WORKER_PORT_MIN-$HUSHFM_WORKER_PORT_MAX"
            echo ""
            echo "📡 MediaSoup Configuration:"
            echo "  Listen IP: $HUSHFM_MEDIASOUP_LISTEN_IP (localhost development)"
            echo "  TCP Enabled: $HUSHFM_MEDIASOUP_ENABLE_TCP"
            echo "  Expose Internal IP: $HUSHFM_MEDIASOUP_EXPOSE_INTERNAL_IP"
            echo ""
          '';
        };

        # Simple binary packaging
        makePackage = targetSystem: binaryPath: pkgs.stdenv.mkDerivation {
          pname = "hushfm-backend";
          inherit version;

          src = ./.;

          buildInputs = with pkgs; [
            # Audio system libraries for CPAL/ALSA and Opus
            alsa-lib
            libopus
          ];

          installPhase = ''
            mkdir -p $out/bin
            if [ -f "${binaryPath}" ]; then
              cp "${binaryPath}" $out/bin/server
              chmod +x $out/bin/server
            else
              echo "❌ Binary not found at ${binaryPath}"
              echo "💡 Run 'cargo build --release' first (natively on THIS machine — no cross-compilation)"
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

        # Default frontend package for development
        hushfm-frontend = pkgs.buildNpmPackage rec {
          pname = "hushfm-frontend";
          inherit version;

          src = ./frontend;

          # The hash of the dependencies - will need to be updated when dependencies change
          npmDepsHash = "sha256-Xwex3PkDwE4hc1PCWYxfjanluxYCzIC2FwN+KfsIrQM=";

          # Pass environment variables to build process
          env = {
            HUSHFM_HOST_NAME = "localhost"; # Default for dev builds
          };

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
        # Packages — NATIVE builds only (no cross-compilation; see toolchain
        # note above). On every architecture the binary comes from a local
        # `cargo build --release`, i.e. ./backend/target/release/server.
        # On the Pi: build ON the Pi, then nixos-rebuild picks it up from here.
        packages = {
          # Backend package wraps the natively-built binary of THIS machine
          hushfm-backend = makePackage system "./backend/target/release/server";

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

          # Frontend package builder function (takes environment variables)
          buildFrontend = extraEnv: pkgs.buildNpmPackage rec {
            pname = "hushfm-frontend";
            version = "0.1.0";

            src = ./frontend;

            # The hash of the dependencies - will need to be updated when dependencies change
            npmDepsHash = "sha256-Xwex3PkDwE4hc1PCWYxfjanluxYCzIC2FwN+KfsIrQM=";

            # Pass environment variables to build process
            env = {
              HUSHFM_HOST_NAME = "localhost"; # Default for dev builds
            } // extraEnv;

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
            HUSHFM_HOST_NAME = cfg.hostName;  # Configurable hostname for nginx reverse proxy

            # MediaSoup configuration
            HUSHFM_MEDIASOUP_LISTEN_IP = cfg.mediasoup.listenIp;
            HUSHFM_MEDIASOUP_ENABLE_TCP = if cfg.mediasoup.enableTcp then "true" else "false";
            HUSHFM_MEDIASOUP_EXPOSE_INTERNAL_IP = if cfg.mediasoup.exposeInternalIp then "true" else "false";
            HUSHFM_MEDIASOUP_WORKER_DEBUG = "false";

            # Monitoring configuration
            HUSHFM_STALE_LISTENER_TIMEOUT = toString cfg.monitoring.staleListenerTimeout;

            # Audio Bot Room configuration
            HUSHFM_AUDIO_BOT_ROOM_NAME = cfg.audioBot.roomName;
            HUSHFM_AUDIO_BOT_DJ_NAME = cfg.audioBot.djName;
            HUSHFM_AUDIO_BOT_DESCRIPTION = cfg.audioBot.description;
            HUSHFM_AUDIO_BOT_TAGS = lib.concatStringsSep "," cfg.audioBot.tags;

            # Audio optimization configuration
            HUSHFM_OPUS_BITRATE = toString cfg.audio.opusBitrate;
            HUSHFM_OPUS_COMPLEXITY = toString cfg.audio.opusComplexity;
            HUSHFM_OPUS_ENABLE_FEC = if cfg.audio.opusEnableFec then "true" else "false";
            HUSHFM_OPUS_ENABLE_VBR = if cfg.audio.opusEnableVbr then "true" else "false";
            HUSHFM_OPUS_FRAME_DURATION = toString cfg.audio.opusFrameDuration;
            HUSHFM_AUDIO_BUFFER_SIZE = toString cfg.audio.bufferSize;
            HUSHFM_RING_BUFFER_CAPACITY = toString cfg.audio.ringBufferCapacity;
            HUSHFM_ENABLE_THREAD_PRIORITY = if cfg.audio.enableThreadPriority then "true" else "false";
            HUSHFM_DSCP_MARKING = toString cfg.audio.dscpMarking;

            # Enable trace level logging for production debugging
            RUST_LOG = "info,server::lib::audio::encoder=warn,server::lib::audio::audio_device_monitor=info,mediasoup=info,mediasoup::worker=info";
          };

          # Build frontend with only frontend-relevant environment variables
          frontendEnv = {
            HUSHFM_BACKEND_PORT = toString cfg.backend.port;
            HUSHFM_FRONTEND_PORT = toString cfg.frontend.port;
            HUSHFM_HOST_NAME = cfg.hostName;
          };

          frontendPackage = buildFrontend frontendEnv;

        in {
          options.services.hushfm = {
            enable = mkEnableOption "HushFM live audio streaming platform";

            backend = {
              port = mkOption {
                type = types.port;
                default = 3000;
                description = "Port for the backend HTTP server";
              };

              binaryPath = mkOption {
                type = types.str;
                default = "${self.packages.${pkgs.system}.hushfm-backend}/bin/server";
                description = ''
                  Absolute path of the backend binary to run. Default wraps the
                  flake package (requires the binary inside the flake source).
                  On the Pi, point this directly at the natively-built binary
                  (e.g. /home/data01/Projects/hush_fm/backend/target/release/server)
                  so the flake input can be a slim git+file:// reference instead
                  of a path: input that would copy the multi-GB target/ dir into
                  the nix store on every rebuild.
                '';
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

            mediasoup = {
              listenIp = mkOption {
                type = types.str;
                default = "0.0.0.0";
                description = "IP address for MediaSoup transports to bind to (0.0.0.0 for all interfaces)";
              };

              enableTcp = mkOption {
                type = types.bool;
                default = false;
                description = "Enable TCP fallback for MediaSoup transports (in addition to UDP)";
              };

              exposeInternalIp = mkOption {
                type = types.bool;
                default = false;
                description = "Expose internal IP in MediaSoup ICE candidates";
              };
            };

            monitoring = {
              staleListenerTimeout = mkOption {
                type = types.int;
                default = 0;
                description = "Timeout in seconds for cleaning up stale listeners (0 = disabled)";
              };
            };

            audioBot = {
              roomName = mkOption {
                type = types.str;
                default = "Main Floor";
                description = "Name of the auto-created audio bot room";
              };

              djName = mkOption {
                type = types.str;
                default = "AudioBot";
                description = "DJ name for the audio bot room";
              };

              description = mkOption {
                type = types.str;
                default = "Local audio input stream from server";
                description = "Description for the audio bot room";
              };

              tags = mkOption {
                type = types.listOf types.str;
                default = [ "dnb" "live" "trommeln und bass" "party" "fun fun fun" ];
                description = "Tags for the audio bot room";
              };
            };

            audio = {
              opusBitrate = mkOption {
                type = types.int;
                default = 256000;
                description = "Opus bitrate in bps (256000 for transparent quality)";
              };

              opusComplexity = mkOption {
                type = types.int;
                default = 8;
                description = "Opus complexity (0-10, higher = better quality, more CPU)";
              };

              opusEnableFec = mkOption {
                type = types.bool;
                default = false;
                description = "Enable Opus Forward Error Correction";
              };

              opusEnableVbr = mkOption {
                type = types.bool;
                default = true;
                description = "Enable Opus Variable Bit Rate";
              };

              opusFrameDuration = mkOption {
                type = types.int;
                default = 10;
                description = "Opus frame duration in ms (10, 20, 40, 60)";
              };

              bufferSize = mkOption {
                type = types.int;
                default = 1024;
                description = "CPAL audio buffer size in frames";
              };

              ringBufferCapacity = mkOption {
                type = types.int;
                default = 4800;
                description = "Ring buffer capacity in frames (100ms buffer)";
              };

              enableThreadPriority = mkOption {
                type = types.bool;
                default = true;
                description = "Enable real-time thread priority";
              };

              dscpMarking = mkOption {
                type = types.int;
                default = 46;
                description = "DSCP marking for QoS (46 = Expedited Forwarding)";
              };
            };

            hostName = mkOption {
              type = types.str;
              default = "hushfm.dedyn.io";
              description = "Public hostname for the ACME certificate and nginx server_name (e.g., hushfm.dedyn.io)";
            };

            acme = {
              email = mkOption {
                type = types.str;
                default = "daniel.tabellion@gmx.de";
                description = "Email address for Let's Encrypt / ACME account registration";
              };

              credentialsFile = mkOption {
                type = types.path;
                default = "/var/lib/secrets/desec-token.env";
                description = ''
                  Path to a file containing the deSEC API token for the DNS-01 challenge.
                  The file must contain exactly one line: DESEC_TOKEN=<your-api-token>
                  Permissions must be 600 with owner root:root.
                '';
              };
            };

          };

          config = mkIf cfg.enable {
            # Open firewall ports (reverse proxy on 443, WebRTC UDP range, optional TCP range)
            networking.firewall = {
              allowedTCPPorts = [ 443 ];  # nginx reverse proxy exposed
              allowedTCPPortRanges = lib.optionals cfg.mediasoup.enableTcp [
                { from = portRange.min; to = portRange.max; }  # WebRTC TCP fallback when enabled
              ];
              allowedUDPPortRanges = [
                { from = portRange.min; to = portRange.max; }  # WebRTC direct access (always enabled)
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
                ExecStart = cfg.backend.binaryPath;
                Restart = "always";
                RestartSec = 5;

                # Security settings
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                # read-only (not true): binaryPath may live under /home when the
                # backend is built natively outside nix (see backend.binaryPath)
                ProtectHome = "read-only";
                ProtectKernelTunables = true;
                ProtectKernelModules = true;
                ProtectControlGroups = true;
                RestrictSUIDSGID = true;
                RestrictRealtime = true;
                RestrictNamespaces = true;
                LockPersonality = true;
              };
            };

            # ACME / Let's Encrypt certificate via DNS-01 challenge (deSEC provider).
            #
            # Offline-resilience: nixpkgs' security.acme module automatically creates
            # acme-selfsigned-<domain>.service, which generates a temporary self-signed
            # bootstrap cert on first boot so that nginx always has a cert to start with.
            # The nginx systemd unit is ordered as:
            #   after  = acme-selfsigned-<domain>.service  (bootstrap cert guaranteed)
            #   wants  = acme-finished-<domain>.target     (non-blocking, best-effort)
            # A failed ACME renewal (e.g., Pi is offline at the party) does NOT block
            # nginx from starting; it will serve the previously-obtained real cert from
            # /var/lib/acme/<domain>/ or the bootstrap self-signed cert on first boot.
            security.acme = {
              acceptTerms = true;
              defaults.email = cfg.acme.email;

              certs."${cfg.hostName}" = {
                domain = cfg.hostName;
                # Wildcard covers *.hushfm.dedyn.io (e.g., future subdomains).
                extraDomainNames = [ "*.${cfg.hostName}" ];
                dnsProvider = "desec";
                # environmentFile feeds lego's DESEC_TOKEN env var via systemd
                # EnvironmentFile=; the file must contain DESEC_TOKEN=<token>.
                # Do NOT set webroot — DNS-01 challenge requires no HTTP endpoint.
                environmentFile = cfg.acme.credentialsFile;
                # Allow nginx to read the private key.
                group = "nginx";
              };
            };

            # Reverse proxy (nginx) with TLS termination
            services.nginx = {
              enable = true;
              recommendedTlsSettings = true;
              recommendedOptimisation = true;
              recommendedGzipSettings = true;
              recommendedProxySettings = true;  # Enable WebSocket support

              virtualHosts."${cfg.hostName}" = {
                # serverName ensures the nginx server_name directive matches the domain.
                # default = true catches all unmatched hostnames (including LAN IP access).
                serverName = cfg.hostName;
                default = true;
                forceSSL = true;
                # Delegate cert management to the security.acme block above.
                # nixpkgs will set sslCertificate/sslCertificateKey automatically,
                # pointing at /var/lib/acme/<domain>/{cert,key}.pem.
                useACMEHost = cfg.hostName;

                locations = {
                  # Serve frontend static files
                  "/" = {
                    root = frontendPackage;
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

            # No manual nginx systemd override needed: security.acme wires up
            # acme-selfsigned-<domain>.service (bootstrap) and the acme-finished
            # target automatically so nginx always starts, even offline.

            # Create hushfm user and group
            users.users.hushfm = {
              isSystemUser = true;
              group = "hushfm";
              extraGroups = [ "audio" ];  # Required for ALSA audio device access
              description = "HushFM service user";
              home = "/var/lib/hushfm";
              createHome = true;
            };

            users.groups.hushfm = {};
          };
        };
    };
}
