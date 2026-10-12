#!/bin/bash
# Spike 0024: build and serve both pages, then run a command.
#   4331: the spike's page (this worktree, `three` aliased to the shim)
#   4332: the CONTROL, `realistic.html` built from $OYL_MAIN (a checkout of main with
#         nothing of the spike in it), by main's own vite.browser.config.ts
# Usage: OYL_MAIN=<checkout of main> OYL_SCRATCH=<dir outside the repository> serve.sh <command...>
set -eu
export PATH=~/.nvm/versions/node/v24.20.0/bin:$PATH
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
: "${OYL_MAIN:?a checkout of main}" "${OYL_SCRATCH:?a directory outside the repository}"
if [ "${OYL_SKIP_BUILD:-0}" != 1 ]; then
  (cd "$HERE/apps/web" && pnpm exec vite build --config vite.webgpu.config.ts > "$OYL_SCRATCH/build-spike.log" 2>&1)
  (cd "$OYL_MAIN/apps/web" && pnpm exec vite build --config vite.browser.config.ts --outDir "$OYL_SCRATCH/control-dist" --emptyOutDir > "$OYL_SCRATCH/build-control.log" 2>&1)
fi
(cd "$HERE/apps/web" && exec pnpm exec vite preview --config vite.webgpu.config.ts --host 127.0.0.1 --port 4331 --strictPort > /dev/null 2>&1) &
A=$!
(cd "$OYL_MAIN/apps/web" && exec pnpm exec vite preview --config vite.browser.config.ts --outDir "$OYL_SCRATCH/control-dist" --host 127.0.0.1 --port 4332 --strictPort > /dev/null 2>&1) &
B=$!
trap 'kill $A $B 2>/dev/null; pkill -f "vite preview.*--port 433[12]" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do curl -s -o /dev/null http://127.0.0.1:4331/webgpu.html && curl -s -o /dev/null http://127.0.0.1:4332/realistic.html && break; sleep 0.2; done
cd "$HERE"
"$@"
