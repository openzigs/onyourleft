#!/usr/bin/env python3
"""Analyse every run directory and print one compact line per run."""
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
runs = os.path.join(here, '..', 'runs')
for name in sorted(os.listdir(runs)):
    d = os.path.join(runs, name)
    if name.startswith('smoke') or not os.path.exists(os.path.join(d, 'latency.txt')):
        continue
    out = subprocess.run([sys.executable, os.path.join(here, 'analyse.py'), d], capture_output=True, text=True)
    if out.returncode != 0:
        print(name, 'FAILED', out.stderr[-300:])
        continue
    open(os.path.join(d, 'summary.json'), 'w').write(out.stdout)
    s = json.loads(out.stdout)
    p, g, t, m = s['present'], s['gpuFreqMHz'], s['thermalSummary'], s['memMiB']
    line = (f"{name:28} fps {p['fps']:6} present p50/p90/p99 {p['p50']}/{p['p90']}/{p['p99']} >20ms {p['over20msShare']}% "
            f"| gpuMHz mean {g['mean']} | skin {t['skinFirst']}->{t['skinLast']} max {t['skinMax']} g3d {t['g3dMean']} status {t['maxStatus']} "
            f"| cpu app {t['cpuPctMean']} rend {t['rendererCpuPctMean']} | pss {m['totalPss']} gfx {m['graphics']}")
    if 'godot' in s:
        q = s['godot']
        line += (f"\n{'':28} godot gpuMs {q['gpuMs']} frameMs {q['frameMs']} js->java {q['jsToJavaMs']} js->godot {q['jsToGodotMs']} "
                 f"gaps {q['arrivalGapMs']} starved {q['starvedShare']}% late50 godot {q.get('late50GodotShare')}% java {q.get('late50JavaShare')}% "
                 f"lost {q['lostSteps']} steps {q['steps']} draws {q['drawCalls']} prims {q['primitives']} vmem {q['videoMemMiB']} worldBuild {q['worldBuildMs']}")
    if 'godotPage' in s:
        line += f"\n{'':28} page {json.dumps(s['godotPage'])}"
    if 'threePage' in s and s['threePage'].get('result'):
        r = s['threePage']['result']
        line += f"\n{'':28} three page frame {r['frameMs']} draws {r['drawCalls']} buffer {r['drawingBuffer']} rungs {s['threePage']['rungs']}"
    line += f"\n{'':28} gfxinfo {json.dumps(s['gfxinfo'])}"
    print(line)
