#!/usr/bin/env python3
"""Spike 0015: per minute of a run, the share of SurfaceFlinger present intervals over 20 ms
(the same de-duplication and 250 ms hole rule as analyse.py), and for a Godot run the late steps
in each 30-second window. Usage: per_minute.py <run directory>..."""
import json, sys

for d in sys.argv[1:]:
    p = set()
    for line in open(d + '/latency.txt'):
        x = line.split()
        if len(x) == 3 and 0 < int(x[1]) < 2**62:
            p.add(int(x[1]))
    p = sorted(p)
    bins = {}
    for a, b in zip(p, p[1:]):
        g = (b - a) / 1e6
        if g >= 250:
            continue
        m = int((b - p[0]) / 60e9)
        n, o = bins.get(m, (0, 0))
        bins[m] = (n + 1, o + (g > 20))
    print(d.rstrip('/').split('/')[-1], 'over-20 ms % by minute:', [round(o / n * 100, 2) for _, (n, o) in sorted(bins.items())])
    try:
        page = json.loads(json.loads(open(d + '/page.json').read().split('\n', 1)[1]))
        w = [json.loads(l.split(' ', 1)[1]) for l in (page.get('godot') or []) if l.startswith('OYL-GODOT {')]
        if w and 'late50Godot' in w[0]:
            print('  late steps per 30 s window:', [x['late50Godot'] for x in w], 'steps:', sum(x['steps'] for x in w))
    except (FileNotFoundError, IndexError, ValueError):
        pass
