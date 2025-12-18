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
        
        # Cross-compilation package sets
        pkgsCross = pkgs.pkgsCross;
        pkgsAarch64 = pkgsCross.aarch64-multiplatform;

        # Extract version from Cargo.toml
        cargoToml = builtins.fromTOML (builtins.readFile ./backend/Cargo.toml);
        version = cargoToml.package.version;


        # Common Rust toolchain with cross-compilation targets
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" ];
          targets = [ 
            "x86_64-unknown-linux-gnu"
            "aarch64-unknown-linux-gnu"
          ];
        };
        
        # Create development shell for cross-compilation
        makeDevShell = targetPkgs: rustTarget: targetPkgs.mkShell {
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
          ] ++ (with targetPkgs.stdenv; [ cc ]);

          buildInputs = with targetPkgs; [
            # Target libraries (will be cross-compiled)
            openssl
            openssl.dev
          ];

          # Environment variables for mediasoup build
          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
          PYTHON = "${pkgs.python311}/bin/python3";
          MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD = "false";

          shellHook = ''
            ${if rustTarget == "aarch64-unknown-linux-gnu" then ''
              echo "🛠️  Cross-compilation environment ready!"
              echo "📍 Target: ARM64 (aarch64-unknown-linux-gnu)"
              echo "📍 Rust targets available:"
              rustc --print target-list | grep -E "(x86_64|aarch64).*linux"
            '' else ''
              echo "🎵 HushFM Development Environment"
              echo "📍 Target: Native x86_64"
            ''}
            
            ${if rustTarget == "aarch64-unknown-linux-gnu" then ''
              # Set up cargo cross-compilation environment
              export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="${targetPkgs.stdenv.cc.targetPrefix}cc"
              export CC_aarch64_unknown_linux_gnu="${targetPkgs.stdenv.cc.targetPrefix}cc"
              export CXX_aarch64_unknown_linux_gnu="${targetPkgs.stdenv.cc.targetPrefix}c++"
              export AR_aarch64_unknown_linux_gnu="${targetPkgs.stdenv.cc.targetPrefix}ar"
              
              # OpenSSL cross-compilation setup
              export PKG_CONFIG_PATH="${targetPkgs.openssl.dev}/lib/pkgconfig"
              export PKG_CONFIG_ALLOW_CROSS=1
              export OPENSSL_STATIC=1
              export OPENSSL_LIB_DIR="${targetPkgs.openssl.out}/lib"
              export OPENSSL_INCLUDE_DIR="${targetPkgs.openssl.dev}/include"
            '' else ""}
            
            # Build commands
            echo ""
            echo "🔨 Build commands:"
            ${if rustTarget == "aarch64-unknown-linux-gnu" then ''
              echo "  Native x86_64: cd backend && cargo build --release"
              echo "  Cross ARM64:   cd backend && cargo build --release --target aarch64-unknown-linux-gnu"
              echo ""
              echo "📋 Cross-compilation notes:"
              echo "  🎯 Nix cross-compilation toolchain pre-configured"
              echo "  🔧 Cross-compilers and OpenSSL setup automatically"
              echo "  ⚠️  mediasoup-sys may have build issues (known limitation)"
            '' else ''
              echo "  Backend:   cd backend && cargo build --release"
            ''}
            echo "  Frontend:  cd frontend && pnpm dev"
            echo "  Watch:     cd backend && cargo watch -x run"
            echo ""
            echo "Ports:"
            echo "  Backend:   http://localhost:3000"
            echo "  Frontend:  http://localhost:5173"
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
          hushfm-backend-aarch64 = makePackage "aarch64-linux" "./backend/target/aarch64-unknown-linux-gnu/release/server";
          
          # Default to current system architecture  
          hushfm-backend = if system == "x86_64-linux" then makePackage "x86_64-linux" "./backend/target/release/server"
                          else if system == "aarch64-linux" then makePackage "aarch64-linux" "./backend/target/aarch64-unknown-linux-gnu/release/server"
                          else throw "Unsupported system: ${system}";
          
          inherit hushfm-frontend;
          default = self.packages.${system}.hushfm-backend;
        };

        # Development shells
        devShells = {
          # Default shell for native development
          default = makeDevShell pkgs "x86_64-unknown-linux-gnu";
          
          # Cross-compilation shell for ARM64
          cross-aarch64 = makeDevShell pkgsAarch64 "aarch64-unknown-linux-gnu";
        };
      }
    );
}
