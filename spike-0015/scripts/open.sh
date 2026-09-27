#!/bin/bash
# Cold-start the spike app and navigate its WebView to $1 (a path under https://localhost).
set -eu
cd "$(dirname "$0")"
PKG=dev.openzigs.onyourleft.godotspike
# Spike 0015: the cool-downs turn the screen off; wake it and clear the keyguard before a run.
./adbt shell input keyevent KEYCODE_WAKEUP
./adbt shell wm dismiss-keyguard
sleep 1
./adbt shell am force-stop "$PKG"
./adbt logcat -c
./adbt shell am start -n "$PKG/dev.openzigs.onyourleft.MainActivity" >/dev/null
for _ in $(seq 1 40); do
  PID=$(./adbt shell pidof "$PKG" || true)
  [ -n "$PID" ] && break
  sleep 0.25
done
./adbt forward --remove-all || true
./adbt forward tcp:9222 "localabstract:webview_devtools_remote_$PID" >/dev/null
for _ in $(seq 1 40); do
  if ~/.nvm/versions/node/v24.20.0/bin/node $REPO/apps/mobile/tools/webview-probe.mjs "location.href" 2>/dev/null | grep -q '"https://localhost/'; then break; fi
  sleep 0.25
done
~/.nvm/versions/node/v24.20.0/bin/node $REPO/apps/mobile/tools/webview-probe.mjs "location.href = '$1'"
echo "pid $PID"
