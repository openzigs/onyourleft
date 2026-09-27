#!/bin/bash
# The tablet's state before (and after) the spike: the owner's app and the settings touched.
export PATH=$SPIKE_DIR/bin:$PATH
adbt shell pm list packages | grep -i -E "onyourleft|godot"
adbt shell dumpsys package dev.openzigs.onyourleft | grep -E "versionName|lastUpdateTime|firstInstall" | head -4
for k in "global stay_on_while_plugged_in" "system accelerometer_rotation" "system user_rotation" "secure enabled_accessibility_services" "secure accessibility_enabled" "system screen_brightness" "system screen_brightness_mode"; do
  echo "$k=$(adbt shell settings get $k)"
done
