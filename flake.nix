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
          pythonExplicit = pkgs.python311;

          audioVideoLibs = [
            pkgs.ffmpeg
            pkgs.libopus
            pkgs.libvorbis
            pkgs.libvpx
            pkgs.x264
            pkgs.x265
          ];

          cppLibs = [
            pkgs.stdenv.cc.cc.lib
            pkgs.gcc.cc.lib
            pkgs.glibc
          ];

          buildInputs = audioVideoLibs ++ cppLibs ++ [
            pythonExplicit
            pkgs.gcc
            pkgs.pkg-config
            pkgs.git
            pkgs.libffi
            pkgs.openssl
            pkgs.zlib
          ];

        in pkgs.stdenv.mkDerivation {
          pname = "hush";
          version = "1.0.0";

          src = ./.;

          buildInputs = buildInputs;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          buildPhase = ''
            echo "Building Hush Silent Disco..."
          '';

        installPhase = ''
  mkdir -p $out/share/hush
  mkdir -p $out/share/hush/static
  mkdir -p $out/share/hush/server

  # Copy application files
  cp -r static/* $out/share/hush/static/ || true
  cp -r server/* $out/share/hush/server/ || true
  cp main.py $out/share/hush/ || true
  cp requirements*.txt $out/share/hush/ || true

  # Create data directory structure
  mkdir -p $out/share/hush/uploads

  # Create wrapper script
  mkdir -p $out/bin
  cat > $out/bin/hush << EOF
#!/bin/sh
set -e

export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (audioVideoLibs ++ cppLibs)}:\$LD_LIBRARY_PATH"

# Use system data dir if available, else local
DATA_DIR=\''${HUSH_DATA_DIR:-"\$HOME/.local/share/hush"}
mkdir -p "\$DATA_DIR/uploads"
cd "\$DATA_DIR"

# Create venv if needed
if [ ! -d ".venv" ]; then
  ${pythonExplicit}/bin/python -m venv .venv
fi

source .venv/bin/activate

# Install requirements if needed
if [ ! -f ".venv/.installed" ]; then
  if [ -f "$out/share/hush/requirements-webrtc.txt" ]; then
    pip install -r "$out/share/hush/requirements-webrtc.txt"
  elif [ -f "$out/share/hush/requirements.txt" ]; then
    pip install -r "$out/share/hush/requirements.txt"
  fi
  touch .venv/.installed
fi

# Copy static files to data dir if needed
if [ ! -d "static" ]; then
  cp -r $out/share/hush/static .
fi

if [ ! -d "server" ]; then
  cp -r $out/share/hush/server .
fi

if [ ! -f "main.py" ]; then
  cp $out/share/hush/main.py .
fi

exec python main.py "\''${@}"
EOF
  chmod +x $out/bin/hush
  '';
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
            pkgs.coturn
          ];

          shellHook = ''
            echo "🎧 Hush Development Environment"
            echo "=============================="
            echo ""
            echo "Available commands:"
            echo "  python main.py          - Start development server"
            echo "  livekit-server --dev    - Start LiveKit in dev mode"
            echo ""

            # Auto-activate venv if it exists
            if [ -d ".venv" ]; then
              source .venv/bin/activate
            fi
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
              description = "LiveKit API secret";
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
          };

          config = mkIf cfg.enable {
            # Install LiveKit
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
                    --keys "${cfg.apiKey}: ${cfg.apiSecret}"
                '';

                # Security
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ "${cfg.dataDir}/logs" ];
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

                # Security
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.dataDir ];
              };
            };

            # Firewall
            networking.firewall = mkIf cfg.openFirewall {
              allowedTCPPorts = [ cfg.port cfg.livekitPort (cfg.rtcPort + 1) ];
              allowedUDPPorts = [ cfg.rtcPort ];
            };
          };
        };
    };
}
