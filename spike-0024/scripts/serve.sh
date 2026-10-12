#!/bin/bash
# Spike 0024: build the spike page and run a command with it served on 4331. Usage: serve.sh <command...>
set -eu
cd "$(dirname "$0")/../../apps/web"
pnpm exec vite build --config vite.webgpu.config.ts > /dev/null
pnpm exec vite preview --config vite.webgpu.config.ts --host 127.0.0.1 --port 4331 --strictPort > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1:4331/webgpu.html && break; sleep 0.2; done
cd ../..
"$@"
