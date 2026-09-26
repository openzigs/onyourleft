#!/bin/bash
# Cold-start the app $1 times, navigate to the Godot page, and record, relative to the page's own
# timeOrigin: the page's first contentful paint, the moment it asked Godot to start, Godot's
# READY (engine up, models loaded) and FIRST (first frame with a world and a step).
cd "$(dirname "$0")"
for i in $(seq 1 "$1"); do
  ./open.sh "/harness/godot.html${2:-}" >/dev/null
  sleep 9
  node $REPO/apps/mobile/tools/webview-probe.mjs "JSON.stringify({origin: performance.timeOrigin, fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime, lines: window.__oylGodotPage.filter(l => /^OYL-GODOT-(PAGE-START|READY|FIRST)/.test(l))})" 2>/dev/null | tail -1
  ./adbt shell am force-stop dev.openzigs.onyourleft.godotspike
  sleep 3
done
