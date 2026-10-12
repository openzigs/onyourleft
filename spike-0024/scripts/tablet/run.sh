#!/bin/bash
# One measured run on the tablet, as spike 0015's run.sh. $1 label, $2 page path and query, $3 seconds measured.
source "$(dirname "$0")/env.sh"
set -eu
cd "$(dirname "$0")"
LABEL=$1; URL=$2; SECS=$3
OUT=$RUNS/$LABEL
rm -rf "$OUT"; mkdir -p "$OUT"
export OYL_DEVTOOLS_PORT=9224
adbt push oyl-sampler.sh /data/local/tmp/oyl-sampler.sh >/dev/null
adbt shell rm -rf "/data/local/tmp/oyl/$LABEL"
{ echo "start $(date -u +%FT%TZ)"; echo "url $URL"; echo "skin $(skin)"; echo "brightness $(adbt shell settings get system screen_brightness)";
  adbt shell dumpsys thermalservice | grep -E "Thermal Status|Current temperatures" -A 13 | grep -E "Status|VIRTUAL-SKIN|G3D|battery"; uptime; } > "$OUT/before.txt"
./open.sh "$URL" > "$OUT/open.txt"
PID=$(adbt shell pidof "$PKG")
adbt logcat -v epoch > "$OUT/logcat-stream.txt" 2>/dev/null &
LOGCAT=$!
sleep 12
# One frame-gap counter for the unchanged control and the spike's page alike, put in after the first frame.
node "$PROBE" "$(cat raf.js)" > "$OUT/raf-install.txt" 2>&1 || true
sleep 8
PAT="VRI-$PKG"
adbt shell dumpsys SurfaceFlinger --list | grep -i -E "onyourleft" > "$OUT/layers.txt" || true
adbt shell dumpsys gfxinfo "$PKG" reset >/dev/null
adbt shell "nohup sh /data/local/tmp/oyl-sampler.sh $SECS '${OYL_LAYER_PATTERN:-$PAT}' /data/local/tmp/oyl/$LABEL $PID > /dev/null 2>&1 &"
HALF=$((SECS / 2))
sleep "$HALF"
adbt shell dumpsys meminfo "$PKG" > "$OUT/meminfo.txt"
adbt shell dumpsys meminfo | grep -E "webgpuspike|sandboxed_process|webview" > "$OUT/meminfo-all.txt" || true
sleep $((SECS - HALF))
for _ in $(seq 1 30); do
  if adbt shell test -f "/data/local/tmp/oyl/$LABEL/done"; then break; fi
  sleep 2
done
adbt shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo.txt"
adbt pull "/data/local/tmp/oyl/$LABEL/." "$OUT/" >/dev/null
kill "$LOGCAT" || true
grep -E "OYL-" "$OUT/logcat-stream.txt" > "$OUT/oyl.txt" || true
rm -f "$OUT/logcat-stream.txt"   # other apps' logging: never kept
node "$PROBE" "JSON.stringify({spike: window.__oylSpike, three: window.__oylRealistic, raf: window.__oylRafStats, now: performance.now()})" > "$OUT/page.json" 2> "$OUT/page.err" || true
{ echo "end $(date -u +%FT%TZ)"; echo "skin $(skin)"; echo "brightness $(adbt shell settings get system screen_brightness)"; uptime; } > "$OUT/after.txt"
adbt shell am force-stop "$PKG"
adbt shell rm -rf "/data/local/tmp/oyl/$LABEL"
python3 -I analyse.py "$OUT" > "$OUT/summary.json" || true
echo "run $LABEL done: $(wc -l < "$OUT/latency.txt") latency lines, skin $(skin)"
