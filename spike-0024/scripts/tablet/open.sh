#!/bin/bash
# Cold-start the SPIKE app and navigate its WebView to $1 (a path under https://localhost).
source "$(dirname "$0")/env.sh"
set -eu
adbt shell input keyevent KEYCODE_WAKEUP
adbt shell wm dismiss-keyguard
sleep 1
adbt shell am force-stop "$PKG"
adbt logcat -c || true
adbt shell am start -n "$PKG/$ACTIVITY" >/dev/null
PID=
for _ in $(seq 1 40); do
  PID=$(adbt shell pidof "$PKG" || true)
  [ -n "$PID" ] && break
  sleep 0.25
done
adbt forward --remove tcp:9224 >/dev/null 2>&1 || true
adbt forward tcp:9224 "localabstract:webview_devtools_remote_$PID" >/dev/null
export OYL_DEVTOOLS_PORT=9224
for _ in $(seq 1 60); do
  if node "$PROBE" "location.href" 2>/dev/null | grep -q 'https://localhost/'; then break; fi
  sleep 0.25
done
node "$PROBE" "location.href = '$1'" >/dev/null
echo "pid $PID"
