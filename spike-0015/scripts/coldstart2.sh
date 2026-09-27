#!/bin/bash
# Spike 0015: cold-start the app $1 times into $2 ('godot' or 'three') and print, from the page's own
# time origin: the page's first contentful paint and the first frame with the realistic world in it.
# Godot: OYL-GODOT-FIRST's wall-clock time less performance.timeOrigin (one device clock).
# three.js: realistic-harness.ts's first realistic frame (window.__oylFirstFrameMs).
cd "$(dirname "$0")"
PROBE=$REPO/apps/mobile/tools/webview-probe.mjs
NODE=node
for i in $(seq 1 "$1"); do
  if [ "$2" = godot ]; then
    ./open.sh "/harness/godot-realistic.html" >/dev/null
    sleep 14
    $NODE $PROBE "JSON.stringify({kind:'godot', fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime, first: (l => l ? JSON.parse(l.split(' ').slice(1).join(' ')).epochMs - performance.timeOrigin : null)((window.__oylGodotPage||[]).find(l => l.startsWith('OYL-GODOT-FIRST')))})" 2>/dev/null | tail -1
  else
    ./open.sh "/harness/realistic.html?world=realistic&panel=0&ladder=0&seconds=30&soak=0" >/dev/null
    sleep 14
    $NODE $PROBE "JSON.stringify({kind:'three', fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime, first: window.__oylFirstFrameMs})" 2>/dev/null | tail -1
  fi
  ./adbt shell am force-stop dev.openzigs.onyourleft.godotspike
  sleep 3
done
