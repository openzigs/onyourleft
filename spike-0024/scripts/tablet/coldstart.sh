#!/bin/bash
# Cold-start the spike app $1 times into page $2 and print the page's first realistic frame, from its own time origin.
source "$(dirname "$0")/env.sh"
cd "$(dirname "$0")"
export OYL_DEVTOOLS_PORT=9224
for i in $(seq 1 "$1"); do
  ./open.sh "$2" >/dev/null
  sleep 16
  node "$PROBE" "JSON.stringify({first: (window.__oylSpike || window.__oylRealistic || {}).firstFrameMs, errors: (window.__oylSpike || window.__oylRealistic || {}).errors, fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime, backend: window.__oylSpike && window.__oylSpike.drawing && window.__oylSpike.drawing.webgpuBackend})" 2>/dev/null | tail -1
  adbt shell am force-stop "$PKG"
  sleep 3
done
