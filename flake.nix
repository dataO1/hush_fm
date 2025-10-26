{
  description = "Silent Disco - WebRTC Audio Streaming with complete system libraries";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Use Python 3.11 (aiohttp 3.8.5 compatible)
        pythonExplicit = pkgs.python311;

        # Audio/video libraries required by av (PyAV)
        audioVideoLibs = [
          pkgs.ffmpeg
          pkgs.libopus
          pkgs.libvorbis
          pkgs.libvpx
          pkgs.x264
          pkgs.x265
        ];

        # C++ standard library and runtime dependencies
        cppLibs = [
          pkgs.stdenv.cc.cc.lib  # libstdc++.so.6
          pkgs.gcc.cc.lib         # Additional C++ libs
          pkgs.glibc              # glibc runtime
        ];

        # System-level build tools
        buildInputs = audioVideoLibs ++ cppLibs ++ [
          pythonExplicit
          pkgs.gcc                # C compiler
          pkgs.pkg-config
          pkgs.git
          pkgs.libffi
          pkgs.openssl
          pkgs.zlib
          pkgs.coturn
          pkgs.livekit
        ];

      in
      {
        # Development shell with all dependencies
        devShells.default = pkgs.mkShell {
          buildInputs = buildInputs;

          # Set all necessary environment variables
          shellHook = ''
            set -e

            echo "🎧 Silent Disco Development Environment"
            echo "========================================"

            # Get Python 3.11 path explicitly
            PYTHON_311_PATH="${pythonExplicit}/bin/python"

            # Verify we have Python 3.11
            PYTHON_VERSION=$("$PYTHON_311_PATH" --version 2>&1)
            echo "📍 Using Python: $PYTHON_VERSION"

            # Check if it's NOT Python 3.12 (fail if it is)
            if echo "$PYTHON_VERSION" | grep -q "3.12"; then
              echo "❌ ERROR: Still using Python 3.12!"
              echo "Run: nix flake update && rm -rf .venv"
              exit 1
            fi

            # Create virtual environment with explicit Python 3.11
            if [ ! -d ".venv" ]; then
              echo "📦 Creating Python 3.11 virtual environment..."
              "$PYTHON_311_PATH" -m venv .venv
              echo "✅ Virtual environment created"
            fi

            # Activate virtual environment
            source .venv/bin/activate

            # Verify venv is using correct Python
            VENV_PYTHON_VERSION=$(python --version 2>&1)
            echo "✅ venv Python: $VENV_PYTHON_VERSION"

            if echo "$VENV_PYTHON_VERSION" | grep -q "3.12"; then
              echo "❌ ERROR: venv is using Python 3.12!"
              exit 1
            fi

            # Set library paths for FFmpeg, audio codecs, and C++ runtime
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (audioVideoLibs ++ cppLibs)}:$LD_LIBRARY_PATH"
            export PKG_CONFIG_PATH="${pkgs.ffmpeg}/lib/pkgconfig:$PKG_CONFIG_PATH"
            export CFLAGS="-I${pkgs.ffmpeg}/include -I${pkgs.libffi}/include"
            export LDFLAGS="-L${pkgs.ffmpeg}/lib -L${pkgs.lib.makeLibraryPath cppLibs}"

            # Livekit
            export LIVEKIT_WS_URL=ws://192.168.178.79:7880
            export LIVEKIT_API_KEY=devkey
            export LIVEKIT_API_SECRET=m2yYtSY5XDaekJ26wf8ZKMnHKPQwD2L3

            # Install/upgrade pip
            echo "📥 Upgrading pip..."
            pip install --upgrade pip setuptools wheel --quiet 2>/dev/null || true

            # Install requirements if they exist
            if [ -f "requirements-webrtc.txt" ]; then
              echo "📥 Installing Python packages from requirements-webrtc.txt..."
              pip install -r requirements-webrtc.txt --quiet 2>/dev/null || pip install -r requirements-webrtc.txt
              echo "✅ Python packages installed"
            elif [ -f "requirements.txt" ]; then
              echo "📥 Installing Python packages from requirements.txt..."
              pip install -r requirements.txt --quiet 2>/dev/null || pip install -r requirements.txt
              echo "✅ Python packages installed"
            else
              echo "⚠️  No requirements.txt found"
            fi

            echo ""
            echo "✅ Python: $(python --version)"
            echo "✅ Pip: $(pip --version)"
            echo "✅ venv: $VIRTUAL_ENV"
            echo "✅ ffmpeg: $(ffmpeg -version 2>/dev/null | head -1)"
            echo "✅ ffprobe: $(ffprobe -version 2>/dev/null | head -1)"
            echo "✅ gcc: $(gcc --version 2>/dev/null | head -1)"
            echo "✅ C++ runtime: Available (libstdc++.so.6)"
            echo ""
            echo "FFmpeg, audio codecs, and C++ runtime configured"
            echo "Ready to run: python main.py"
            echo ""
          '';
        };

        # Convenience shell alias
        devShell = self.devShells.${system}.default;

        # Simple package definition
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "silent-disco";
          version = "1.0.0";

          src = ./.;

          buildInputs = buildInputs;

          buildPhase = ''
            echo "Silent Disco is ready"
          '';

          installPhase = ''
            mkdir -p $out/share/silent-disco
            mkdir -p $out/share/silent-disco/uploads

            cp -r . $out/share/silent-disco/ 2>/dev/null || true

            mkdir -p $out/bin
            cat > $out/bin/silent-disco << 'EOF'
            #!/bin/sh
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (audioVideoLibs ++ cppLibs)}:$LD_LIBRARY_PATH"
            cd $out/share/silent-disco

            if [ ! -d ".venv" ]; then
              ${pythonExplicit}/bin/python -m venv .venv
            fi
            source .venv/bin/activate

            if [ -f "requirements-webrtc.txt" ] && [ ! -f ".venv/bin/aiohttp" ]; then
              pip install -r requirements-webrtc.txt
            fi

            python main.py "''${@}"
            EOF
            chmod +x $out/bin/silent-disco
          '';
        };

        packages.silent-disco = self.packages.${system}.default;
        defaultPackage = self.packages.${system}.default;
      }
    );
}
