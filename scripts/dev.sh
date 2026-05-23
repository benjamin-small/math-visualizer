#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v cargo-watch >/dev/null 2>&1; then
  echo "cargo-watch not found. Install with: cargo install cargo-watch" >&2
  exit 1
fi

# Initial build so Vite has something to import.
wasm-pack build crates/viz-core --target web --out-dir pkg

# Rebuild WASM on Rust changes in the background.
cargo watch -w crates/viz-core/src -s 'wasm-pack build crates/viz-core --target web --out-dir pkg' &
WATCH_PID=$!
trap "kill $WATCH_PID 2>/dev/null || true" EXIT

# Foreground: Vite dev server.
cd web
npm run dev
