#!/bin/bash
# Spike 0015: the runs that inform and do not decide, cold starts, and the patch bump.
cd "$(dirname "$0")"
set -x
date
./cool.sh 26 40
./run.sh G5-godot-shadows "/harness/godot-realistic.html?shadows=1" 300 godot
./cool.sh 26 40
./coldstart2.sh 5 three > ../runs/coldstart-three.txt
./coldstart2.sh 5 godot > ../runs/coldstart-godot-4.7.1.txt
./adbt install -r ../apk/godot-real-4.7.2.apk
./cool.sh 26 30
./run.sh V2-godot-4.7.2 "/harness/godot-realistic.html" 120 godot
./coldstart2.sh 2 godot > ../runs/coldstart-godot-4.7.2.txt
./adbt install -r ../apk/godot-real-4.7.1.apk
for r in G5-godot-shadows V2-godot-4.7.2; do python3 analyse.py ../runs/$r > ../runs/$r/summary.json; done
date
echo CHAIN2-DONE
