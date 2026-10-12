#!/bin/bash
# Wait (spike app stopped, screen off, as spike 0015 cooled) until the skin is at or below $1 °C, for at most $2 minutes.
source "$(dirname "$0")/env.sh"
adbt shell am force-stop "$PKG"
adbt shell input keyevent KEYCODE_HOME
adbt shell input keyevent KEYCODE_SLEEP
END=$(( $(date +%s) + ${2:-45} * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  T=$(skin)
  echo "$(date +%T) skin=$T"
  if awk "BEGIN{exit !($T <= $1)}"; then exit 0; fi
  sleep 30
done
echo "cool-down timed out at skin=$(skin)"
