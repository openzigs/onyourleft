#!/bin/bash
# Spike 0024: the tablet set. The three 20-minute runs (WebGLRenderer first), each after cooling
# with the screen off; then the 5-minute layer runs; then the cold starts; then one screenshot each.
source "$(dirname "$0")/env.sh"
cd "$(dirname "$0")"
: "${OYL_SHOTS:?where the screenshots go, outside the repository}"
C="/harness/realistic.html?world=realistic&panel=0&ladder=0"
W="/harness-webgpu/webgpu.html"
set -x
date
mkdir -p "$RUNS"
./cool.sh "${OYL_COOL_20:-24.0}" 60 > "$RUNS/cool-T20.log"; tail -1 "$RUNS/cool-T20.log"
./run.sh T20-webglrenderer "$C&seconds=30&soak=21" 1200
./cool.sh "${OYL_COOL_20:-24.0}" 60 > "$RUNS/cool-G20.log"; tail -1 "$RUNS/cool-G20.log"
./run.sh G20-webgpu "$W?backend=webgpu&seconds=1200" 1200
./cool.sh "${OYL_COOL_20:-24.0}" 60 > "$RUNS/cool-F20.log"; tail -1 "$RUNS/cool-F20.log"
./run.sh F20-webgl2 "$W?backend=webgl2&seconds=1200" 1200
for each in "L5-base|backend=webgpu" "L5-traa|backend=webgpu&traa=1" "L5-ao|backend=webgpu&ao=1&aon=depth" "L5-wind|backend=webgpu&wind=1" "L5-aofull|backend=webgpu&ao=1&aon=depth&aos=1"; do
  L=${each%%|*}; Q=${each#*|}
  ./cool.sh 26.0 40 > "$RUNS/cool-$L.log"; tail -1 "$RUNS/cool-$L.log"
  ./run.sh "$L" "$W?$Q&seconds=300" 300
done
./cool.sh 26.0 40 > "$RUNS/cool-coldstart.log"
./coldstart.sh 5 "$C&seconds=30" > "$RUNS/coldstart-webglrenderer.txt"
./coldstart.sh 5 "$W?backend=webgpu&seconds=30" > "$RUNS/coldstart-webgpu.txt"
./coldstart.sh 5 "$W?backend=webgl2&seconds=30" > "$RUNS/coldstart-webgl2.txt"
mkdir -p "$OYL_SHOTS/tablet"
for each in "webglrenderer|$C&at=2550" "webgpu|$W?backend=webgpu&at=2550" "webgl2|$W?backend=webgl2&at=2550" "traa|$W?backend=webgpu&traa=1&at=2550" "ao|$W?backend=webgpu&ao=1&aon=depth&at=2550" "aofull|$W?backend=webgpu&ao=1&aon=depth&aos=1&at=2550" "wind|$W?backend=webgpu&wind=1&at=2550"; do
  L=${each%%|*}; U=${each#*|}
  ./open.sh "$U" >/dev/null; sleep 14
  adbt exec-out screencap -p > "$OYL_SHOTS/tablet/tablet-$L-at2550.png"
done
adbt shell am force-stop "$PKG"
adbt shell input keyevent KEYCODE_HOME
date
echo CHAIN-DONE
