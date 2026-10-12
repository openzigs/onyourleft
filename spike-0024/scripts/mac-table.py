#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Spike 0024: one line per Mac run, and the medians the write-up quotes. usage: python3 -I mac-table.py <results dir>"""
import json, glob, os, statistics, sys
d = sys.argv[1]
order = ['control', 'classic', 'webgpu', 'webgl2', 'traa', 'ao', 'aofull', 'wind']
def load(name):
    p = os.path.join(d, name + '.json')
    return json.load(open(p)) if os.path.exists(p) else None
def r1(x): return None if x is None else round(x, 1)
def r2(x): return None if x is None else round(x, 2)
print('label              when     load1  fps    p50   p90   p95   p99   max  >100  render p50/p99  cpu r/g per s   tri    calls')
for L in order:
    for kind in ['capped', 'uncapped-1', 'uncapped-2', 'uncapped-3']:
        j = load(f'{L}-{kind}')
        if not j: continue
        own = (j['published'] or {}).get('result') or {}
        ext = j.get('external') or {}
        if L == 'control':
            f = dict(fps=ext.get('fps'), p50=ext.get('p50'), p90=ext.get('p90'), p95=ext.get('p95'), p99=ext.get('p99'), max=ext.get('max'), o=ext.get('over100Ms'))
            tri = own.get('trianglesPerFrame'); calls = own.get('drawCalls'); rm = {}
        else:
            fm = own.get('frameMs') or {}
            f = dict(fps=own.get('fps'), p50=fm.get('p50'), p90=fm.get('p90'), p95=fm.get('p95'), p99=fm.get('p99'), max=fm.get('max'), o=own.get('gapsOver100Ms'))
            w = (j['published'] or {}).get('windows') or []
            tri = statistics.median([x['trianglesPerFrame'] for x in w]) if w else None
            calls = statistics.median([x['drawCallsPerFrame'] for x in w]) if w else None
            rm = own.get('renderMs') or {}
        c = j.get('cpuSeconds') or {}; ws = j.get('wallSeconds') or 1
        print(f"{L+'-'+kind:18s} {j['when'][11:19]} {j['loadAverageBefore'][0]:5.1f} {r1(f['fps'])!s:>6} {r2(f['p50'])!s:>5} {r2(f['p90'])!s:>5} {r2(f['p95'])!s:>5} {r2(f['p99'])!s:>5} {r1(f['max'])!s:>5} {f['o']!s:>4}  {r2(rm.get('p50'))!s:>5}/{r2(rm.get('p99'))!s:<5}  {r2(c.get('renderer',0)/ws)!s:>5}/{r2(c.get('gpu',0)/ws)!s:<5}  {tri!s:>7} {calls!s:>5} err={len((j['published'] or {}).get('errors') or [])}")
    firsts = [load(f'{L}-first-{i}') for i in range(1, 6)]
    firsts = [x['firstFrameMs'] for x in firsts if x]
    if firsts: print(f"{L+'-first':18s} n={len(firsts)} median={statistics.median(firsts):.0f} ms  all={[round(x) for x in firsts]}")
    un = [load(f'{L}-uncapped-{i}') for i in (1, 2, 3)]
    fps = []
    for j in un:
        if not j: continue
        fps.append(j['external']['fps'] if L == 'control' else j['published']['result']['fps'])
    if fps: print(f"{L+'-uncapped':18s} fps median={statistics.median(fps):.1f} all={[round(x,1) for x in fps]}")
j = load('webgpu-capped')
if j:
    r = j['published']['result']
    print('webgpu memory', json.dumps(r.get('memory')), 'textures', json.dumps(r.get('textures')), 'buffer', r.get('drawingBuffer'))
for L in ('classic', 'webgl2', 'control'):
    j = load(L + '-capped')
    if j:
        r = j['published'].get('result') or {}
        print(L, 'memory', json.dumps(r.get('memory')), 'textures', json.dumps(r.get('textures') or j['published'].get('textures'))[:300], 'buffer', r.get('drawingBuffer'))
