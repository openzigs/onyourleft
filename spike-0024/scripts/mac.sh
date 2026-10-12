#!/bin/bash
# Spike 0024: the whole Mac set, in one sitting, in the plan's order. Run through serve.sh:
#   OYL_MAIN=... OYL_SCRATCH=... OYL_SHOTS=~/Development/oyl-spike-0024-screenshots serve.sh spike-0024/scripts/mac.sh
# Results: spike-0024/results/mac/*.json. Screenshots: $OYL_SHOTS, outside the repository.
set -u
: "${OYL_SHOTS:?where the screenshots go, outside the repository}"
OUT=spike-0024/results/mac
mkdir -p "$OUT" "$OYL_SHOTS"
R="node spike-0024/scripts/run.mjs"
{ date -u +%FT%TZ; uptime; sw_vers; sysctl -n machdep.cpu.brand_string; pmset -g batt | tail -1;
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version;
  echo "-- busiest"; ps -axo %cpu=,command= | sort -rn | head -12 | cut -c1-160; } > "$OUT/machine-before.txt" 2>&1

# label | page | port | query
CONFIGS=(
  "control|/realistic.html|4332|world=realistic&panel=0&ladder=0"
  "classic|/webgpu.html|4331|backend=webglrenderer"
  "webgpu|/webgpu.html|4331|backend=webgpu"
  "webgl2|/webgpu.html|4331|backend=webgl2"
  "traa|/webgpu.html|4331|backend=webgpu&traa=1"
  "ao|/webgpu.html|4331|backend=webgpu&ao=1&aon=depth"
  "aofull|/webgpu.html|4331|backend=webgpu&ao=1&aon=depth&aos=1"
  "wind|/webgpu.html|4331|backend=webgpu&wind=1"
)
for each in "${CONFIGS[@]}"; do
  IFS='|' read -r L P PORT Q <<< "$each"
  A="--page=$P --port=$PORT --out=$OUT"
  $R "$L-capped" "$Q&seconds=60" $A
  for i in 1 2 3; do $R "$L-uncapped-$i" "$Q&seconds=60" $A --uncapped; done
  for i in 1 2 3 4 5; do $R "$L-first-$i" "$Q&seconds=60" $A --first; done
  for at in 2550 1600 2000; do $R "$L-shot-$at" "$Q&at=$at" $A --shot="$OYL_SHOTS/$L-at$at.png"; done
done
$R webgpu-dump "backend=webgpu&at=2550" --page=/webgpu.html --port=4331 --out=$OUT --shot="$OYL_SHOTS/.dump.png" --dump
rm -f "$OYL_SHOTS/.dump.png"
{ date -u +%FT%TZ; uptime; echo "-- busiest"; ps -axo %cpu=,command= | sort -rn | head -12 | cut -c1-160; } > "$OUT/machine-after.txt" 2>&1
echo MAC-DONE
