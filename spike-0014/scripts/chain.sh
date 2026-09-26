#!/bin/bash
# The measured runs, in order, each after a cool-down to the same skin temperature.
cd "$(dirname "$0")"
set -x
./cool.sh 26 15
./run.sh T20-three-stylised "/harness/realistic.html?world=stylised&panel=0&ladder=0&seconds=30&soak=21" 1200 three
./cool.sh 26 20
./run.sh G20-godot "/harness/godot.html" 1200 godot
./cool.sh 26 20
./run.sh G5-godot-shadows-msaa2 "/harness/godot.html?shadows=1&msaa=2" 300 godot
./cool.sh 26 15
./run.sh T5-three-realistic "/harness/realistic.html?world=realistic&panel=0&ladder=0&seconds=30&soak=6" 300 three
./cool.sh 26 15
./run.sh G5-godot-delay100 "/harness/godot.html?delay=100" 300 godot
./cool.sh 26 15
./run.sh G5-godot-compat "/harness/godot.html?renderer=compat" 300 godot
echo CHAIN-DONE
