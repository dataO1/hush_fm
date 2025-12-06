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
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Rust toolchain
            (rust-bin.stable.latest.default.override {
              extensions = [ "rust-src" "rust-analyzer" ];
            })
            cargo-watch
            
            # Node.js environment (required for mediasoup build)
            nodejs_20
            pnpm
            
            # System dependencies for mediasoup C++ build
            pkg-config
            openssl
            # Use Python 3.11 to avoid SafeConfigParser removal in 3.12+
            python311
            python311Packages.pip
            python311Packages.setuptools
            python311Packages.invoke
            cmake
            gnumake
            gcc
            
            # Additional tools
            git
          ];
          
          # Environment variables
          RUST_SRC_PATH = "${pkgs.rust-bin.stable.latest.rust-src}/lib/rustlib/src/rust/library";
          PYTHON = "${pkgs.python311}/bin/python3";
          # Let mediasoup-sys build its own meson/ninja with Python 3.11 (compatible)
          MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD = "false";
          
          shellHook = ''
            echo "🎵 HushFM Development Environment"
            echo ""
            echo "Commands:"
            echo "  Backend:  cd backend && cargo watch -x run"
            echo "  Frontend: cd frontend && pnpm dev"
            echo "  Build:    cargo build && pnpm build"
            echo ""
            echo "Ports:"
            echo "  Backend:  http://localhost:3000"
            echo "  Frontend: http://localhost:5173"
            echo ""
          '';
        };
      }
    );
}