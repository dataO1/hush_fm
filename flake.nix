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

            # Copy all application files
            cp -r static $out/share/hush/ || true
            cp -r server $out/share/hush/ || true
            cp main.py $out/share/hush/

            # Create uploads directory
            mkdir -p $out/share/hush/uploads

            # Create wrapper script
            mkdir -p $out/bin
            makeWrapper ${pythonEnv}/bin/python $out/bin/hush \
              --add-flags "$out/share/hush/main.py" \
              --prefix PYTHONPATH : "$out/share/hush" \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath (audioVideoLibs ++ cppLibs)}" \
              --set HUSH_STATIC_DIR "$out/share/hush/static" \
              --set HUSH_SERVER_DIR "$out/share/hush/server" \
              --chdir "\''${HUSH_DATA_DIR:-/var/lib/hush}"
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
      in
      {
        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = hushPackage.buildInputs ++ [
            pkgs.livekit
            pkgs.python311Packages.pip
            pkgs.python311Packages.virtualenv
          ];

          shellHook = ''
            echo "🎧 Hush Development Environment"
            echo "=============================="
            echo ""
            echo "Commands:"
            echo "  python main.py          - Start dev server"
            echo "  livekit-server --dev    - Start LiveKit"
            echo ""

            export HUSH_DATA_DIR="$PWD/data"
            mkdir -p "$HUSH_DATA_DIR/uploads"

            # LiveKit environment variables for testing
            export LIVEKIT_WS_URL="ws://localhost:7880"
            export LIVEKIT_API_KEY="devkey"
            export LIVEKIT_API_SECRET="secret"

            # Server settings
            export PORT="3000"
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
          hushPackage = mkPackage pkgs pkgs.system;
        in {
          options.services.hush = {
            enable = mkEnableOption "Hush Silent Disco server";

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
              default = "secret";
              description = "LiveKit API secret (use agenix for production!)";
            };

            dataDir = mkOption {
              type = types.path;
              default = "/var/lib/hush";
              description = "Data directory for uploads and logs";
            };

            openFirewall = mkOption {
              type = types.bool;
              default = true;
              description = "Open firewall ports automatically";
            };

            logLevel = mkOption {
              type = types.enum [ "debug" "info" "warn" "error" ];
              default = "info";
              description = "LiveKit log level";
            };
          };

          config = mkIf cfg.enable {
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
                  ${pkgs.livekit}/bin/livekit-server \
                    --bind 0.0.0.0 \
                    --port ${toString cfg.livekitPort} \
                    --udp-port ${toString cfg.rtcPort} \
                    --tcp-port ${toString (cfg.rtcPort + 1)} \
                    --keys "${cfg.apiKey}: ${cfg.apiSecret}" \
                    --log-level ${cfg.logLevel}
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
                LIVEKIT_WS_URL = "ws://localhost:${toString cfg.livekitPort}";
                LIVEKIT_API_KEY = cfg.apiKey;
                LIVEKIT_API_SECRET = cfg.apiSecret;
                HUSH_DATA_DIR = cfg.dataDir;
              };

              serviceConfig = {
                Type = "simple";
                User = "hush";
                Group = "hush";
                WorkingDirectory = cfg.dataDir;
                Restart = "always";
                RestartSec = "5s";

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
            networking.firewall = mkIf cfg.openFirewall {
              allowedTCPPorts = [
                cfg.port
                cfg.livekitPort
                (cfg.rtcPort + 1)  # TCP fallback
              ];
              allowedUDPPorts = [ cfg.rtcPort ];
            };
          };
        };
    };
}
