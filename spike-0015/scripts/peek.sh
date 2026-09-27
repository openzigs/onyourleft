#!/bin/bash
# Print the latest OYL-GODOT report the page holds (or the three page's result), summarised.
cd "$(dirname "$0")"
node $REPO/apps/mobile/tools/webview-probe.mjs "JSON.stringify({g: (window.__oylGodotPage||[]).filter(l => l.startsWith('OYL-GODOT {')).slice(-1)[0], t: window.__oylRealistic && window.__oylRealistic.result, s: window.__oylRealistic && window.__oylRealistic.soak})" 2>/dev/null | tail -1 | python3 -c "
import sys, json
o = json.loads(json.loads(sys.stdin.read()))
if o.get('g'):
    d = json.loads(o['g'].split(' ', 1)[1])
    keys = ['minute','frameMs','gpuMs','placeMs','drawCalls','primitives','primitivesP90','videoMemMiB','textureMemMiB','bufferMemMiB','drawnNear','drawnFar','drawnStructures','jsToGodotMs','late50Godot','steps','starvedFrames','frames']
    for k in keys: print(k, d.get(k))
if o.get('t'): print('three', json.dumps(o['t'])[:600])
if o.get('s'): print('soak', json.dumps(o['s'][-1])[:600])
"
