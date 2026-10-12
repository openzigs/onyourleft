#!/bin/bash
# Spike 0024, NOT in the plan: the WebGLRenderer 20-minute run a second time, after the tablet has
# been worked for two hours, as the WebGPU and WebGL 2 runs were (the first baseline started from a
# tablet that had sat cold). It shows how far two runs of ONE configuration differ.
source "$(dirname "$0")/env.sh"
cd "$(dirname "$0")"
set -x
date
./cool.sh 24.0 60 > "$RUNS/cool-T20b.log"; tail -1 "$RUNS/cool-T20b.log"
./run.sh T20b-webglrenderer-repeat "/harness/realistic.html?world=realistic&panel=0&ladder=0&seconds=30&soak=21" 1200
adbt shell am force-stop "$PKG"
adbt shell input keyevent KEYCODE_HOME
date
echo CHAIN2-DONE
