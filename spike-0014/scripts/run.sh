#!/bin/bash
# One measured run. $1 label, $2 page path, $3 seconds measured, $4 layer pattern ('three' or 'godot').
set -eu
cd "$(dirname "$0")"
S=..
LABEL=$1; URL=$2; SECS=$3; KIND=$4
PKG=dev.openzigs.onyourleft.godotspike
OUT=$S/runs/$LABEL
mkdir -p "$OUT"
if [ "$KIND" = godot ]; then PAT='SurfaceView\[dev.openzigs.onyourleft.godotspike.*\(BLAST\)'; else PAT='VRI-dev.openzigs.onyourleft.godotspike'; fi
./adbt push "$S/device/oyl-sampler.sh" /data/local/tmp/oyl-sampler.sh >/dev/null
./adbt shell rm -rf "/data/local/tmp/oyl/$LABEL"
{ echo "start $(date -u +%FT%TZ)"; ./adbt shell dumpsys thermalservice | grep -E "Thermal Status|Current temperatures" -A 13 | grep -E "Status|VIRTUAL-SKIN|G3D|battery"; } > "$OUT/before.txt"
./open.sh "$URL" > "$OUT/open.txt"
PID=$(./adbt shell pidof "$PKG")
./adbt logcat -v epoch > "$OUT/logcat-stream.txt" 2>/dev/null &
LOGCAT=$!
sleep 20
./adbt shell dumpsys gfxinfo "$PKG" reset >/dev/null
./adbt shell "nohup sh /data/local/tmp/oyl-sampler.sh $SECS '$PAT' /data/local/tmp/oyl/$LABEL $PID > /dev/null 2>&1 &"
HALF=$((SECS / 2))
sleep "$HALF"
./adbt shell dumpsys meminfo "$PKG" > "$OUT/meminfo.txt"
./adbt shell dumpsys meminfo | grep -E "godotspike|sandboxed_process|webview" > "$OUT/meminfo-all.txt" || true
sleep $((SECS - HALF))
for _ in $(seq 1 30); do
  if ./adbt shell test -f "/data/local/tmp/oyl/$LABEL/done"; then break; fi
  sleep 2
done
./adbt shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo.txt"
./adbt pull "/data/local/tmp/oyl/$LABEL/." "$OUT/" >/dev/null
kill "$LOGCAT" || true
grep -E "OYL-" "$OUT/logcat-stream.txt" | grep -v "Capacitor/Console.*lines" > "$OUT/oyl.txt" || true
node $REPO/apps/mobile/tools/webview-probe.mjs "JSON.stringify({godot: window.__oylGodotPage, three: window.__oylRealistic})" > "$OUT/page.json" 2>&1 || true
./adbt shell am force-stop "$PKG"
echo "run $LABEL done: $(wc -l < "$OUT/latency.txt") latency lines"
