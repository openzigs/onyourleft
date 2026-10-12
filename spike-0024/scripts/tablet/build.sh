#!/bin/bash
# Spike 0024: build the spike APK. Its applicationId is dev.openzigs.onyourleft.webgpuspike, so it
# installs BESIDE the owner's app and shares nothing with it.
#   /            main's product build            (from $OYL_MAIN, nothing of the spike in it)
#   /harness/    main's harness pages, the control realistic.html among them (from $OYL_MAIN)
#   /harness-webgpu/  the spike's page           (this worktree)
source "$(dirname "$0")/env.sh"
set -eu
: "${OYL_MAIN:?a checkout of main}"
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
(cd "$OYL_MAIN" && pnpm run build 2>&1 | tail -2 && pnpm --filter @onyourleft/web run realistic:stage 2>&1 | tail -1)
rm -rf "$REPO/apps/web/dist"
cp -R "$OYL_MAIN/apps/web/dist" "$REPO/apps/web/dist"
(cd "$REPO/apps/web" && pnpm exec vite build --config vite.webgpu.config.ts --base /harness-webgpu/ --outDir "$REPO/apps/web/dist/harness-webgpu" --emptyOutDir 2>&1 | tail -1)
(cd "$REPO/apps/mobile" && pnpm exec cap sync android 2>&1 | tail -2)
cd "$REPO/apps/mobile/android"
rm -f app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug -q 2>&1 | grep -v '^Note:' | tail -20 || true
mkdir -p "$REPO/spike-0024/apk"
cp app/build/outputs/apk/debug/app-debug.apk "$REPO/spike-0024/apk/webgpuspike.apk"
ls -la "$REPO/spike-0024/apk/webgpuspike.apk"
"$ANDROID_HOME"/build-tools/*/aapt2 dump badging "$REPO/spike-0024/apk/webgpuspike.apk" 2>/dev/null | head -2 | tr ' ' '\n' | grep -m1 "name="
