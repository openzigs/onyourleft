#!/bin/bash
# Spike 0015: build the spike APK (arm64 only, AGP's default packaging).
# $1 = Godot Maven version (e.g. 4.7.1.stable), $2 = output name, $3.. extra Gradle args.
# The Godot project is packed as the APK's assets WITHOUT the source files (the .glb/.jpg/.png/.hdr
# copies of the committed set), the editor's desktop texture variants (*.s3tc.ctex) and the import
# checksums, none of which the Android runtime reads: what ships is what a Godot Android export of
# this project would pack.
set -eu
S=$SPIKE_DIR
W=$REPO
export PATH=<local>
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
V="$1"; OUT="$2"; shift 2
rm -rf "$S/godot-assets" && mkdir -p "$S/godot-assets"
rsync -a \
  --exclude '.godot/editor' --exclude '.godot/shader_cache' \
  --exclude '*.s3tc.ctex' --exclude '.godot/imported/*.md5' \
  --exclude 'realistic/*.glb' --exclude 'realistic/*.jpg' --exclude 'realistic/*.png' --exclude 'realistic/*.hdr' \
  "$S/godot-project/" "$S/godot-assets/"
cd "$W/apps/mobile" && corepack pnpm exec cap sync android >/dev/null
cd "$W/apps/mobile/android"
rm -f app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug -q -PgodotAssets="$S/godot-assets" -PgodotVersion="$V" -Parm64Only "$@" 2>&1 | grep -v '^Note:' || true
cp app/build/outputs/apk/debug/app-debug.apk "$S/apk/$OUT.apk"
ls -la "$S/apk/$OUT.apk"
du -sk "$S/godot-assets"
