#!/bin/bash
# Spike 0024: build, serve and run; the build noise filtered. Usage: q.sh '<bash command>'
cd "$(dirname "$0")/../.."
spike-0024/scripts/serve.sh bash -c "$1" 2>&1 | grep -v 'Vite config\|import "\|VITE_CONFIG\|chunks are\|dynamic import\|codeSplitting\|chunkSizeWarning\|vite-reporter\|^$'
