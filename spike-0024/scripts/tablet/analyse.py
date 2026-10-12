#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Spike 0024: summarise one tablet run directory made by run.sh (spike 0015's analyse.py, less Godot). Prints one JSON object."""
import json, re, sys, statistics, os

d = sys.argv[1]
out = {"run": os.path.basename(d.rstrip('/'))}

def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[max(0, min(len(s) - 1, -(-len(s) * p // 100) - 1))]

def read(name):
    # latency.txt is committed gzipped (it is most of a run's bytes).
    import gzip
    try:
        return open(os.path.join(d, name)).read()
    except FileNotFoundError:
        try:
            return gzip.open(os.path.join(d, name + '.gz'), 'rt').read()
        except FileNotFoundError:
            return ''

for name in ('before.txt', 'after.txt'):
    m = re.search(r'^skin ([0-9.]+)', read(name), re.M)
    out['skin' + name.split('.')[0].capitalize()] = float(m.group(1)) if m else None
    m = re.search(r'^brightness (\d+)', read(name), re.M)
    out['brightness' + name.split('.')[0].capitalize()] = int(m.group(1)) if m else None
    m = re.search(r'load averages?: ([0-9. ]+)', read(name))
    out['macLoad' + name.split('.')[0].capitalize()] = m.group(1).strip() if m else None
out['layer'] = read('layer.txt').strip()

# SurfaceFlinger present times (column 2), de-duplicated across overlapping dumps.
presents = set()
for line in read('latency.txt').split('\n'):
    parts = line.split()
    if len(parts) != 3:
        continue
    actual = int(parts[1])
    if actual <= 0 or actual >= 2**62:
        continue
    presents.add(actual)
p = sorted(presents)
if len(p) > 2:
    gaps = [(b - a) / 1e6 for a, b in zip(p, p[1:])]
    # A gap of 250 ms or more is a hole in the sampling or a pause, not a frame (0015's rule).
    frames = [g for g in gaps if g < 250]
    span = (p[-1] - p[0]) / 1e9
    out["present"] = {
        "frames": len(p), "seconds": round(span, 1), "fps": round(len(p) / span, 2),
        "p50": round(pct(frames, 50), 2), "p90": round(pct(frames, 90), 2), "p95": round(pct(frames, 95), 2),
        "p99": round(pct(frames, 99), 2), "max": round(max(frames), 1),
        "over20msShare": round(sum(g > 20 for g in frames) / len(frames) * 100, 3),
        "over20ms": sum(g > 20 for g in frames),
        "over50msShare": round(sum(g > 50 for g in frames) / len(frames) * 100, 3),
        "over100msUnder250": sum(g > 100 for g in frames),
        "holesOver250ms": sum(g >= 250 for g in gaps),
    }

gpu = [int(l.split()[1]) for l in read('gpu.txt').split('\n') if len(l.split()) == 2]
if gpu:
    out["gpuFreqMHz"] = {"mean": round(statistics.mean(gpu) / 1000, 1), "p50": pct(gpu, 50) / 1000,
                         "p90": pct(gpu, 90) / 1000, "min": min(gpu) / 1000, "max": max(gpu) / 1000, "samples": len(gpu)}
    # Per five minutes, to show drift.
    t0 = int(read('gpu.txt').split('\n')[0].split()[0])
    buckets = {}
    for l in read('gpu.txt').split('\n'):
        f = l.split()
        if len(f) == 2:
            buckets.setdefault((int(f[0]) - t0) // 300, []).append(int(f[1]))
    out["gpuFreqMHz"]["meanPer5Min"] = [round(statistics.mean(v) / 1000, 1) for _, v in sorted(buckets.items())]

therm = read('thermal.txt').split('== ')[1:]
def temp(block, name):
    # 'Cached temperatures' (stale) come first and the HAL's current ones after: take the last.
    m = re.findall(r'mValue=([0-9.]+), mType=[-0-9]+, mName=' + name + ',', block)
    return round(float(m[-1]), 2) if m else None
def status(block):
    m = re.search(r'Thermal Status: (\d+)', block)
    return int(m.group(1)) if m else None
def cpu(block):
    head = block.split('-- top')[0].strip().split('\n')
    f = head[-1].split()
    try:
        return float(f[8]) if len(f) > 9 else None
    except ValueError:
        return None
def renderer_cpu(block):
    if '-- top' not in block:
        return None
    total = 0.0
    for l in block.split('-- top')[1].strip().split('\n'):
        f = l.split()
        if len(f) >= 4 and 'sandboxed_process' in l:
            total += float(f[1])
    return total
t = [{"t": b.split('\n')[0], "status": status(b), "skin": temp(b, 'VIRTUAL-SKIN'), "g3d": temp(b, 'G3D'),
      "big": temp(b, 'BIG'), "cpuPct": cpu(b), "rendererCpuPct": renderer_cpu(b)} for b in therm]
out["thermal"] = t
if t:
    app = [x["cpuPct"] for x in t if x["cpuPct"] is not None]
    ren = [x["rendererCpuPct"] for x in t if x["rendererCpuPct"] is not None]
    both = [x["cpuPct"] + x["rendererCpuPct"] for x in t if x["cpuPct"] is not None and x["rendererCpuPct"] is not None]
    out["thermalSummary"] = {
        "samples": len(t), "maxStatus": max(x["status"] or 0 for x in t),
        "skinFirst": t[0]["skin"], "skinLast": t[-1]["skin"], "skinMax": max(x["skin"] or 0 for x in t),
        "g3dMean": round(statistics.mean(x["g3d"] for x in t if x["g3d"]), 1),
        "appCpuPctMean": round(statistics.mean(app), 1) if app else None,
        "rendererCpuPctMean": round(statistics.mean(ren), 1) if ren else None,
        "appPlusRendererCpuPctMean": round(statistics.mean(both), 1) if both else None,
    }

mi = read('meminfo.txt')
def mem(label):
    m = re.search(r'^\s*' + re.escape(label) + r'\s+(\d+)', mi, re.M)
    return round(int(m.group(1)) / 1024, 1) if m else None
m = re.search(r'TOTAL PSS:\s+(\d+)', mi)
out["memMiB"] = {"totalPss": round(int(m.group(1)) / 1024, 1) if m else None, "graphics": mem('Graphics:'),
                 "nativeHeap": mem('Native Heap:'), "glMtrack": mem('GL mtrack'), "egl": mem('EGL mtrack'), "gfxDev": mem('Gfx dev')}
out["memAllMiB"] = {}
for l in read('meminfo-all.txt').split('\n'):
    m = re.match(r'\s*([0-9,]+)K: (\S+)', l)
    if m:
        out["memAllMiB"].setdefault(m.group(2)[:60], round(int(m.group(1).replace(',', '')) / 1024, 1))

try:
    raw = read('page.json').strip().split('\n')[-1]
    page = json.loads(json.loads(raw))
except Exception as e:  # noqa: BLE001
    page = {}
    out["pageError"] = str(e)[:200]
out["raf"] = page.get("raf")
if out["raf"]:
    r = out["raf"]
    r["over20Share"] = round(r["over20"] / max(1, r["frames"]) * 100, 3)
    r["seconds"] = round((r["last"] - r["since"]) / 1000, 1) if r.get("last") else None
med = lambda xs: statistics.median(xs) if xs else None
if page.get("spike"):
    s = page["spike"]
    w = s.get("windows") or []
    out["spikePage"] = {
        "errors": s.get("errors"), "drawing": {k: v for k, v in (s.get("drawing") or {}).items() if k in ("asked", "renderer", "webgpuBackend", "compatibilityMode")},
        "firstFrameMs": s.get("firstFrameMs"), "windows": len(w),
        "trianglesPerFrameMedian": med([x["trianglesPerFrame"] for x in w]),
        "drawCallsPerFrameMedian": med([x["drawCallsPerFrame"] for x in w]),
        "frameP50Median": med([x["frameMs"]["p50"] for x in w]), "frameP99Median": med([x["frameMs"]["p99"] for x in w]),
        "renderMsP50Median": med([x["renderMs"]["p50"] for x in w]), "renderMsP99Median": med([x["renderMs"]["p99"] for x in w]),
        "fpsMedian": med([x["fps"] for x in w]),
        "gapsOver100Ms": w[-1].get("gapsOver100Ms") if w else None,
        "texturesSizeMiB": round(w[-1]["texturesSize"] / 2**20, 1) if w and w[-1].get("texturesSize") else None,
        "textures": w[-1].get("textures") if w else None,
        "result": bool(s.get("result")),
    }
if page.get("three"):
    r = page["three"]
    soak = r.get("soak") or []
    out["threePage"] = {
        "errors": r.get("errors"), "firstFrameMs": r.get("firstFrameMs"), "textures": r.get("textures"),
        "result": r.get("result"), "soakMinutes": len(soak),
        "trianglesPerFrameMedian": med([s.get("trianglesPerFrame") for s in soak]),
        "drawCallsMedian": med([s.get("drawCalls") for s in soak]),
        "frameP50Median": med([s["frameMs"]["p50"] for s in soak]), "frameP99Median": med([s["frameMs"]["p99"] for s in soak]),
        "stalls": sum(s.get("stalls", 0) for s in soak), "rungs": sorted({s["rung"] for s in soak}),
    }
print(json.dumps(out, indent=1))
