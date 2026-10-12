# Spike 0024: sourced by every tablet script.
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SERIAL=${ANDROID_SERIAL:-3822105H80BY3Z}
export PATH=~/.nvm/versions/node/v24.20.0/bin:$PATH
# ⚠️ The SPIKE's own package, installed beside the owner's app. Nothing here ever names
# dev.openzigs.onyourleft itself except state.sh (which only reads) and the final launch.
export PKG=dev.openzigs.onyourleft.webgpuspike
export ACTIVITY=dev.openzigs.onyourleft.MainActivity
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REPO="$(cd "$HERE/../../.." && pwd)"
export RUNS="$REPO/spike-0024/results/tablet"
export PROBE="$REPO/apps/mobile/tools/webview-probe.mjs"
adbt() { "$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" "$@"; }
skin() { adbt shell dumpsys thermalservice | grep -A 30 "Current temperatures" | grep -m1 "VIRTUAL-SKIN" | sed -E 's/.*mValue=([0-9.]+).*/\1/'; }
