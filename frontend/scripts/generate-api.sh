#!/usr/bin/env bash

# Generate API client for HushFM frontend
# This script:
# 1. Generates OpenAPI spec from the backend
# 2. Moves it to the frontend directory
# 3. Generates TypeScript client using Orval

set -e

echo "🔄 Generating OpenAPI spec from backend..."

# Navigate to backend and generate OpenAPI spec
cd ../backend
cargo run --bin server -- --export-openapi > ../frontend/openapi.yaml

echo "✅ OpenAPI spec generated: openapi.yaml"

# Navigate back to frontend and generate client
cd ../frontend

echo "🔄 Generating TypeScript client with Orval..."
npx orval

echo "✅ API client generation complete!"