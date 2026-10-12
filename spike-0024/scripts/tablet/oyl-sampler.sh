#!/system/bin/sh
# Spike 0013 sampler, run ON the tablet as the shell user.
# $1 seconds to run, $2 grep -E pattern picking the layer to time, $3 output directory, $4 pid.
SECS=$1; PAT=$2; OUT=$3; PID=$4
mkdir -p "$OUT"
LAYER=$(dumpsys SurfaceFlinger --list | grep -E "$PAT" | head -1 | sed -e 's/^RequestedLayerState{//' -e 's/ parentId=.*$//' -e 's/}$//')
echo "$LAYER" > "$OUT/layer.txt"
START=$(date +%s)
END=$((START + SECS))
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
  i=$((i + 1))
  sleep 0.5
done
echo done > "$OUT/done"
