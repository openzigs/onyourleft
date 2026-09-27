#!/bin/bash
# Spike 0015: the pre-registered 20-minute pair, three.js first, each after cooling to <= 26 °C.
cd "$(dirname "$0")"
set -x
date
./cool.sh 26 45
./run.sh T20-three-realistic "/harness/realistic.html?world=realistic&panel=0&ladder=0&seconds=30&soak=21" 1200 three
./cool.sh 26 45
./run.sh G20-godot-realistic "/harness/godot-realistic.html" 1200 godot
for r in T20-three-realistic G20-godot-realistic; do python3 analyse.py ../runs/$r > ../runs/$r/summary.json; done
date
echo CHAIN1-DONE
