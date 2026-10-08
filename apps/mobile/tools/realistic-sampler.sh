#!/system/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The realistic world's 20-minute sampler (#616) -- spike 0015's
# `oyl-sampler.sh`, committed so every issue in #615 is measured with the same
# instrument. It runs ON the tablet, as adb's shell user, and writes plain text;
# `realistic-summary.mjs` beside it turns a directory of that text into one row
# of validation 0002's table. The procedure -- cooling, orientation, the page's
# URL, the adb commands that start and collect this -- is that Part, not this
# file: this asks nothing of its own, as `webview-probe.mjs` does not.
#
# Why here and not under `scripts/`: that is the bare-clone set, and this needs
# adb and a Pixel Tablet (docs/agents/layout.md section 2). Nothing in CI runs it.
#
# Usage (from the host, after `adb push` to /data/local/tmp):
#   adb shell "nohup sh /data/local/tmp/realistic-sampler.sh SECONDS 'LAYER' OUT PID [MEMINFO_AT] >/dev/null 2>&1 &"
#
#   SECONDS     how long to sample: 1200 for the Part's 20 minutes
#   LAYER       a grep -E pattern picking the app's SurfaceFlinger layer, e.g.
#               'VRI-dev.openzigs.onyourleft' -- the first match is timed
#   OUT         a directory on the device; everything is written under it
#   PID         the app's process, `pidof dev.openzigs.onyourleft`
#   MEMINFO_AT  seconds in at which `dumpsys meminfo PID` is taken once
#               (default SECONDS / 2: minute 10 of 20)
#
# What it writes, and how often:
#
#   latency.txt  every 0.5 s: `dumpsys SurfaceFlinger --latency LAYER`, whose
#                second column is each frame's PRESENT time in nanoseconds; the
#                dumps overlap and the summary de-duplicates them
#   gpu.txt      every second: `EPOCH KHZ` from the Mali DVFS node
#                /sys/class/misc/mali0/device/cur_freq -- the GPU clock the
#                governor chose, which is NOT a count of work (spike 0015 section
#                1); it is the engine-neutral before/after instrument, because a
#                lower mean clock that still makes every vsync is less GPU work
#                per frame. The utilisation counters are permission-denied.
#   thermal.txt  every 30 s: `== EPOCH`, the thermal status and temperatures
#                (VIRTUAL-SKIN among them), the app's own `top` line, and after
#                `-- top` the twelve busiest processes -- the WebView renderer
#                is the `sandboxed_process` among them
#   meminfo.txt  once, at MEMINFO_AT: `dumpsys meminfo PID` -- `Graphics` and
#                `GL mtrack` are read from it
#   layer.txt    the SurfaceFlinger layer the latencies are for
#   done         written last; the host waits for it before pulling
#
# The commands are spike 0015's, unchanged, because they are the ones that
# produced its T20 baseline; `meminfo.txt` is the one addition, moved onto the
# device from the host so it is taken at a known second of the run.

SECS=$1
PAT=$2
OUT=$3
PID=$4
MEMINFO_AT=${5:-$((SECS / 2))}
if [ -z "$SECS" ] || [ -z "$PAT" ] || [ -z "$OUT" ] || [ -z "$PID" ]; then
  echo "usage: realistic-sampler.sh SECONDS LAYER-PATTERN OUT-DIR PID [MEMINFO-AT]" >&2
  exit 2
fi
mkdir -p "$OUT"
LAYER=$(dumpsys SurfaceFlinger --list | grep -E "$PAT" | head -1 | sed -e 's/^RequestedLayerState{//' -e 's/ parentId=.*$//' -e 's/}$//')
if [ -z "$LAYER" ]; then
  echo "realistic-sampler: no SurfaceFlinger layer matches $PAT" > "$OUT/error.txt"
  echo 'done' > "$OUT/done"
  exit 1
fi
echo "$LAYER" > "$OUT/layer.txt"
START=$(date +%s)
END=$((START + SECS))
MEMINFO_TAKEN=0
i=0
while [ "$(date +%s)" -lt "$END" ]; do
  NOW=$(date +%s)
  dumpsys SurfaceFlinger --latency "$LAYER" | tail -n +2 >> "$OUT/latency.txt"
  if [ $((i % 2)) -eq 0 ]; then
    echo "$NOW $(cat /sys/class/misc/mali0/device/cur_freq)" >> "$OUT/gpu.txt"
  fi
  if [ $((i % 60)) -eq 0 ]; then
    {
      echo "== $NOW"
      dumpsys thermalservice | grep -E "Thermal Status|Current temperatures" -A 40 | grep -E "Status|Current|VIRTUAL-SKIN|G3D|BIG|MID|LITTLE|battery"
      top -b -n 1 -p "$PID" | tail -1
      echo "-- top"
      top -b -n 1 -s 2 -m 12 -o PID,%CPU,RES,ARGS | tail -n 12
    } >> "$OUT/thermal.txt"
  fi
  if [ "$MEMINFO_TAKEN" -eq 0 ] && [ $((NOW - START)) -ge "$MEMINFO_AT" ]; then
    {
      echo "== $NOW"
      dumpsys meminfo "$PID"
    } > "$OUT/meminfo.txt"
    MEMINFO_TAKEN=1
  fi
  i=$((i + 1))
  sleep 0.5
done
echo 'done' > "$OUT/done"
