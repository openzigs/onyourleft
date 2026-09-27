#!/bin/bash
# Wait (app stopped) until the tablet's skin is at or below $1 °C, for at most $2 minutes.
cd "$(dirname "$0")"
./adbt shell am force-stop dev.openzigs.onyourleft.godotspike
./adbt shell input keyevent KEYCODE_HOME
# Spike 0015: screen off while cooling (on charge with the screen on, the skin settles near 26.5 C).
./adbt shell input keyevent KEYCODE_SLEEP
END=$(( $(date +%s) + ${2:-15} * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  SKIN=$(./adbt shell dumpsys thermalservice | grep -A 30 "Current temperatures" | grep -m1 "VIRTUAL-SKIN" | sed -E 's/.*mValue=([0-9.]+).*/\1/')
  G3D=$(./adbt shell dumpsys thermalservice | grep -A 30 "Current temperatures" | grep -m1 "mName=G3D" | sed -E 's/.*mValue=([0-9.]+).*/\1/')
  echo "$(date +%T) skin=$SKIN g3d=$G3D"
  if awk "BEGIN{exit !($SKIN <= $1)}"; then exit 0; fi
  sleep 30
done
echo "cool-down timed out"
