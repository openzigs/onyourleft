#!/bin/bash
cd "$(dirname "$0")"
set -x
./cool.sh 26 20
./run.sh G20-godot "/harness/godot.html" 1200 godot
./cool.sh 26 20
./run.sh T5-three-stylised-cpu "/harness/realistic.html?world=stylised&panel=0&ladder=0&seconds=30&soak=6" 300 three
./cool.sh 26 15
./coldstart.sh 5 > ../coldstart-4.7.1.txt
./adbt install -r ../apk/godot-4.7.2-arm64.apk
./cool.sh 26 15
./run.sh V2-godot-4.7.2 "/harness/godot.html" 120 godot
./coldstart.sh 2 > ../coldstart-4.7.2.txt
./adbt install -r ../apk/godot-4.7.1-arm64.apk
echo CHAIN2-DONE
