{
  description = "Hush - Silent Disco WebRTC Audio Streaming";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      # Common package definition for all systems
      mkPackage = pkgs: system:
        let
          # Use Python 3.11
          python = pkgs.python311;

          # Define Python dependencies
          pythonEnv = python.withPackages (ps: with ps; [
            aiohttp
            aiohttp-cors
            pyjwt
            livekit-api
            livekit-protocol
          ]);

          # Audio/video libraries
          audioVideoLibs = [
            pkgs.ffmpeg
            pkgs.libopus
            pkgs.libvorbis
            pkgs.libvpx
            pkgs.x264
            pkgs.x265
          ];

          # C++ runtime libraries
          cppLibs = [
            pkgs.stdenv.cc.cc.lib
            pkgs.gcc.cc.lib
            pkgs.glibc
          ];

        in pkgs.stdenv.mkDerivation {
          pname = "hush";
          version = "1.0.0";

          src = ./.;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          buildInputs = audioVideoLibs ++ cppLibs ++ [ pythonEnv ];

          installPhase = ''
            mkdir -p $out/share/hush

            # Copy application files
            cp -r static $out/share/hush/ 2>/dev/null || true
            cp -r server $out/share/hush/ 2>/dev/null || true
            cp main.py $out/share/hush/

            # Create wrapper
            mkdir -p $out/bin
            makeWrapper ${pythonEnv}/bin/python $out/bin/hush \
              --add-flags "$out/share/hush/main.py" \
              --prefix PYTHONPATH : "$out/share/hush" \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath (audioVideoLibs ++ cppLibs)}" \
              --set HUSH_STATIC_DIR "$out/share/hush/static" \
              --set HUSH_SERVER_DIR "$out/share/hush/server" \
              --run 'mkdir -p "''${HUSH_DATA_DIR:-/var/lib/hush}/uploads"'
              '';

          meta = with pkgs.lib; {
            description = "Hush - Silent Disco WebRTC Audio Streaming";
            homepage = "https://github.com/youruser/hush";
            license = licenses.mit;
            platforms = platforms.linux;
          };
        };
    in
    # Per-system outputs
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        hushPackage = mkPackage pkgs system;
        # LiveKit configuration file with low-latency optimizations
      in
      {
        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = hushPackage.buildInputs ++ [
            pkgs.livekit
            pkgs.python311Packages.pip
            pkgs.python311Packages.virtualenv
          ];

          # Environment variables
          LIVEKIT_API_KEY = "devkey";
          LIVEKIT_API_SECRET = "secret";
          LIVEKIT_SECURE = "false";
          PORT = "3000";

          shellHook = ''
            echo "🎧 Hush Development Environment"
            echo "=============================="
            echo ""

            # Set up data directory
            export HUSH_DATA_DIR="$PWD/data"
            mkdir -p "$HUSH_DATA_DIR/uploads"
            mkdir -p "$HUSH_DATA_DIR/logs"

            echo ""
            echo "📋 Commands:"
            echo "   python main.py       - Start Hush web server"
            echo "   livekit-server       - Start LiveKit server"
            echo "   tail -f data/logs/livekit.log - View LiveKit logs"
            echo ""
            echo "Ready to develop! 🎉"
            echo ""
          '';

        };

        # Package outputs
        packages = {
          default = hushPackage;
          hush = hushPackage;
        };

        # App runner
        apps.default = {
          type = "app";
          program = "${hushPackage}/bin/hush";
        };
      }
    ) // {
      # NixOS module (cross-system)
      nixosModules.default = { config, lib, pkgs, ... }:
        with lib;
        let
          cfg = config.services.hush;
          livekitConfig = pkgs.writeText "livekit.yaml" ''
            port: ${toString cfg.livekitPort}
            bind_addresses:
              - "0.0.0.0"

            rtc:
              port_range_start: ${toString cfg.rtcPort}
              port_range_end: ${toString (cfg.rtcPort + 100)}
              use_external_ip: false
              udp_port: ${toString cfg.rtcPort}
              # use_ice_lite: true
              # Enable congestion control for better quality
              congestion_control:
                enabled: true
                # Don't pause tracks even under congestion (for music streaming)
                allow_pause: false
              # SMALLER buffers = lower latency (but less tolerance for jitter)
              packet_buffer_size_audio: 200
              packet_buffer_size_video: 200
                  # AGGRESSIVE PLI for faster recovery
              pli_throttle:
                low_quality: 100ms
                mid_quality: 200ms
                high_quality: 300ms
              # Enable batch I/O for efficiency without adding latency
              batch_io:
                batch_size: 32
                max_flush_interval: 1ms
           # Audio - optimized for LOW LATENCY music
            audio:
              # More sensitive detection
              active_level: 0
              # FAST updates for reactive feedback
              update_interval: 100
              # Less smoothing = more responsive
              smooth_intervals: 2
              # RED encoding for packet loss but adds ~20ms
              active_red_encoding: false
            # Room defaults - LOW LATENCY focused
            room:
              auto_create: true
              empty_timeout: 300
              departure_timeout: 20
              max_participants: 0

              # Only Opus (fastest audio codec)
              enabled_codecs:
                - mime: audio/opus
                - mime: audio/red

              enable_remote_unmute: false

              # MINIMAL playout delay for low latency
              playout_delay:
                enabled: true
                min: 20
                max: 200

              # Disable sync_streams - adds latency
              sync_streams: false
            keys:
              ${cfg.apiKey}: ${cfg.apiSecret}

            logging:
              level: info
          '';
          hushPackage = mkPackage pkgs pkgs.system;
        in {
          options.services.hush = {
            enable = mkEnableOption "Hush Silent Disco server";

            secure = mkOption {
              type = types.bool;
              default = true;
              description = "use HTTPS and wss or not";
            };

            port = mkOption {
              type = types.int;
              default = 3000;
              description = "HTTP port for the web interface";
            };

            livekitPort = mkOption {
              type = types.int;
              default = 7880;
              description = "LiveKit signaling port";
            };

            rtcPort = mkOption {
              type = types.int;
              default = 7882;
              description = "LiveKit RTC media port (UDP)";
            };

            apiKey = mkOption {
              type = types.str;
              default = "devkey";
              description = "LiveKit API key";
            };

            apiSecret = mkOption {
              type = types.str;
              description = "LiveKit API secret (use agenix for production!)";
            };

            dataDir = mkOption {
              type = types.path;
              default = "/var/lib/hush";
              description = "Data directory for uploads and logs";
            };

            # openFirewall = mkOption {
            #   type = types.bool;
            #   default = true;
            #   description = "Open firewall ports automatically";
            # };
            optimizeKernel = mkOption {
              type = types.bool;
              default = true;
              description = ''
                Automatically optimize kernel parameters for WebRTC.
                Increases UDP buffer sizes to prevent packet loss with 50+ clients.
                Recommended for production deployments.
              '';
            };
          };

          config = mkIf cfg.enable {
            boot.kernel.sysctl = mkIf cfg.optimizeKernel {
              # UDP receive buffer (for incoming WebRTC packets)
              "net.core.rmem_max" = mkDefault 5000000;        # 5 MB
              "net.core.rmem_default" = mkDefault 2500000;    # 2.5 MB

              # UDP send buffer (for outgoing WebRTC packets)
              "net.core.wmem_max" = mkDefault 5000000;        # 5 MB
              "net.core.wmem_default" = mkDefault 2500000;    # 2.5 MB

              # Connection tracking for many concurrent clients
              "net.netfilter.nf_conntrack_max" = mkDefault 262144;
            };
            # Install packages
            environment.systemPackages = [
              pkgs.livekit
              hushPackage
            ];

            # Create data directory
            systemd.tmpfiles.rules = [
              "d ${cfg.dataDir} 0755 hush hush -"
              "d ${cfg.dataDir}/uploads 0755 hush hush -"
              "d ${cfg.dataDir}/logs 0755 hush hush -"
            ];

            # Create user
            users.users.hush = {
              isSystemUser = true;
              group = "hush";
              home = cfg.dataDir;
              description = "Hush Silent Disco service user";
            };

            users.groups.hush = {};

            # LiveKit service
            systemd.services.hush-livekit = {
              description = "LiveKit Server for Hush";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              serviceConfig = {
                Type = "simple";
                User = "hush";
                Group = "hush";
                Restart = "always";
                RestartSec = "5s";

                ExecStart = ''
                  ${pkgs.livekit}/bin/livekit-server --config ${livekitConfig}
                '';
                # Security hardening
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ "${cfg.dataDir}/logs" ];

                # Resource limits
                LimitNOFILE = 65536;
                LimitNPROC = 512;
              };
            };

            # Hush web app service
            systemd.services.hush = {
              description = "Hush Silent Disco Web Server";
              after = [ "network.target" "hush-livekit.service" ];
              wants = [ "hush-livekit.service" ];
              wantedBy = [ "multi-user.target" ];

              environment = {
                PORT = toString cfg.port;
                LIVEKIT_PORT = toString cfg.livekitPort;
                LIVEKIT_API_KEY = cfg.apiKey;
                LIVEKIT_API_SECRET = cfg.apiSecret;
                LIVEKIT_SECURE = lib.boolToString cfg.secure;  # becomes "true" or "false"
                HUSH_DATA_DIR = cfg.dataDir;
              };

              serviceConfig = {
                Type = "simple";
                User = "hush";
                Group = "hush";
                WorkingDirectory = cfg.dataDir;
                Restart = "always";
                RestartSec = "5s";
                ExecStartPre = "${pkgs.coreutils}/bin/mkdir -p ${cfg.dataDir}/uploads";
                ExecStart = "${hushPackage}/bin/hush";

                # Security hardening
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.dataDir ];

                # Resource limits
                LimitNOFILE = 4096;
              };
            };

            # Firewall
            # networking.firewall = mkIf cfg.openFirewall {
            #   allowedTCPPorts = [
            #     cfg.port
            #     cfg.livekitPort
            #     (cfg.rtcPort + 1)  # TCP fallback
            #   ];
            #   allowedUDPPorts = [ cfg.rtcPort ];
            # };
          };
        };
    };
}
