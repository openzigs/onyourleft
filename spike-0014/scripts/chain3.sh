#!/bin/bash
cd "$(dirname "$0")"
set -x
until grep -q CHAIN2-DONE ../chain2.log; do sleep 20; done
./adbt install -r ../apk/godot-4.7.1-arm64-b.apk
./cool.sh 26 15
./run.sh B5-bridge-every25 "/harness/godot.html" 300 godot
./cool.sh 26 15
./run.sh B5-bridge-every250 "/harness/godot.html?every=250" 300 godot
./cool.sh 26 15
./run.sh T5-three-shadowmap "/harness/realistic.html?world=stylised&panel=0&ladder=0&seconds=30&soak=6#shadowmap" 300 three
./cool.sh 26 15
./run.sh G5-godot-shadows "/harness/godot.html?shadows=1" 300 godot
echo CHAIN3-DONE
