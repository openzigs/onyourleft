#!/bin/bash
# Build the same app WITHOUT Godot (main's Android project, the same staged web build), for K6's
# APK delta. The spike's Android changes are set aside and put back afterwards.
set -eu
S=$SPIKE_DIR
W=$REPO
export PATH=<local>
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
A=apps/mobile/android/app
J=$A/src/main/java/dev/openzigs/onyourleft
mkdir -p "$S/aside"
cd "$W"
cp $A/build.gradle $A/src/main/AndroidManifest.xml $J/MainActivity.java $J/GodotWorldPlugin.java $J/WorldBridgePlugin.java "$S/aside/"
restore() {
  cp "$S/aside/build.gradle" $A/build.gradle
  cp "$S/aside/AndroidManifest.xml" $A/src/main/AndroidManifest.xml
  cp "$S/aside/MainActivity.java" "$S/aside/GodotWorldPlugin.java" "$S/aside/WorldBridgePlugin.java" $J/
}
trap "cd $W; restore" EXIT
git show HEAD:$A/build.gradle > $A/build.gradle
git show HEAD:$A/src/main/AndroidManifest.xml > $A/src/main/AndroidManifest.xml
git show HEAD:$J/MainActivity.java > $J/MainActivity.java
rm $J/GodotWorldPlugin.java $J/WorldBridgePlugin.java
cd apps/mobile/android
rm -f app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug -q 2>&1 | grep -v '^Note:' || true
cp app/build/outputs/apk/debug/app-debug.apk "$S/apk/baseline.apk"
ls -la "$S/apk/baseline.apk"
