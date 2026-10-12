#!/bin/bash
# The tablet's state: the owner's app (read only) and the settings this spike touches.
source "$(dirname "$0")/env.sh"
date -u +%FT%TZ
adbt shell pm list packages | grep -i -E "onyourleft"
adbt shell dumpsys package dev.openzigs.onyourleft | grep -E "versionName|versionCode|lastUpdateTime|firstInstallTime|signatures" | head -5
adbt shell dumpsys package com.google.android.webview | grep -m1 versionName
adbt shell getprop ro.build.fingerprint
for k in "global stay_on_while_plugged_in" "system accelerometer_rotation" "system user_rotation" "system screen_brightness" "system screen_brightness_mode" "system screen_off_timeout"; do
  echo "$k=$(adbt shell settings get $k)"
done
adbt shell dumpsys battery | grep -E "level|AC powered|USB powered|Wireless powered|Dock powered"
echo "skin=$(skin)"
