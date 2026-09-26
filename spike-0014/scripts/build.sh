#!/bin/bash
# Build the spike APK. $1 = godot maven version (e.g. 4.7.1.stable), $2 = output name, $3.. extra gradle args.
set -eu
S=$SPIKE_DIR
W=$REPO
export PATH=~/.nvm/versions/node/v24.20.0/bin:$PATH
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
V="$1"; OUT="$2"; shift 2
rm -rf "$S/godot-assets" && mkdir -p "$S/godot-assets"
rsync -a --exclude '.godot/editor' --exclude '.godot/shader_cache' "$S/godot-project/" "$S/godot-assets/"
cd "$W/apps/mobile" && corepack pnpm exec cap sync android >/dev/null
cd "$W/apps/mobile/android"
./gradlew assembleDebug -q -PgodotAssets="$S/godot-assets" -PgodotVersion="$V" "$@" 2>&1 | grep -v '^Note:' || true
cp app/build/outputs/apk/debug/app-debug.apk "$S/apk/$OUT.apk"
ls -la "$S/apk/$OUT.apk"
