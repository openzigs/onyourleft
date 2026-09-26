#!/usr/bin/env python3
"""Summarise one run directory made by run.sh. Prints one JSON object."""
import json, re, sys, statistics, os

d = sys.argv[1]
out = {"run": os.path.basename(d.rstrip('/'))}

def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[max(0, min(len(s) - 1, -(-len(s) * p // 100) - 1))]

# SurfaceFlinger present times (column 2), de-duplicated across overlapping dumps.
presents = set()
for line in open(os.path.join(d, 'latency.txt')):
    parts = line.split()
    if len(parts) != 3:
        continue
    actual = int(parts[1])
    if actual <= 0 or actual >= 2**62:
        continue
    presents.add(actual)
p = sorted(presents)
gaps = [(b - a) / 1e6 for a, b in zip(p, p[1:])]
# A gap longer than 250 ms is a hole in the sampling or a pause, not a frame.
frames = [g for g in gaps if g < 250]
span = (p[-1] - p[0]) / 1e9 if len(p) > 1 else 0
out["present"] = {
    "frames": len(p), "seconds": round(span, 1),
    "fps": round(len(p) / span, 2) if span else None,
    "p50": round(pct(frames, 50), 2), "p90": round(pct(frames, 90), 2),
    "p99": round(pct(frames, 99), 2), "max": round(max(frames), 1),
    "over20msShare": round(sum(g > 20 for g in frames) / len(frames) * 100, 2),
    "over50msShare": round(sum(g > 50 for g in frames) / len(frames) * 100, 3),
    "holesOver250ms": sum(g >= 250 for g in gaps),
}

gpu = [int(l.split()[1]) for l in open(os.path.join(d, 'gpu.txt')) if len(l.split()) == 2]
out["gpuFreqMHz"] = {"mean": round(statistics.mean(gpu) / 1000, 1), "p50": pct(gpu, 50) / 1000,
                     "p90": pct(gpu, 90) / 1000, "samples": len(gpu)}

therm = open(os.path.join(d, 'thermal.txt')).read().split('== ')[1:]
def temp(block, name):
    # The dump lists 'Cached temperatures' (stale) first and the HAL's current ones after: take the last.
    m = re.findall(r'mValue=([0-9.]+), mType=[-0-9]+, mName=' + name + ',', block)
    return round(float(m[-1]), 1) if m else None
def status(block):
    m = re.search(r'Thermal Status: (\d+)', block)
    return int(m.group(1)) if m else None
def cpu(block):
    head = block.split('-- top')[0].strip().split('\n')
    f = head[-1].split()
    return float(f[8]) if len(f) > 9 else None
def renderer_cpu(block):
    if '-- top' not in block:
        return None
    total = 0.0
    for l in block.split('-- top')[1].strip().split('\n'):
        f = l.split()
        if len(f) >= 4 and 'sandboxed_process' in l:
            total += float(f[1])
    return total
out["thermal"] = [{"t": b.split('\n')[0], "status": status(b), "skin": temp(b, 'VIRTUAL-SKIN'),
                   "g3d": temp(b, 'G3D'), "big": temp(b, 'BIG'), "cpuPct": cpu(b), "rendererCpuPct": renderer_cpu(b)} for b in therm]
t = out["thermal"]
out["thermalSummary"] = {"maxStatus": max(x["status"] or 0 for x in t),
                         "skinFirst": t[0]["skin"], "skinLast": t[-1]["skin"], "skinMax": max(x["skin"] or 0 for x in t),
                         "g3dMean": round(statistics.mean(x["g3d"] for x in t if x["g3d"]), 1),
                         "cpuPctMean": round(statistics.mean(x["cpuPct"] for x in t if x["cpuPct"] is not None), 1),
                         "rendererCpuPctMean": round(statistics.mean(x["rendererCpuPct"] for x in t if x["rendererCpuPct"] is not None), 1) if any(x["rendererCpuPct"] is not None for x in t) else None}

mi = open(os.path.join(d, 'meminfo.txt')).read()
def mem(label):
    m = re.search(r'^\s*' + re.escape(label) + r'\s+(\d+)', mi, re.M)
    return round(int(m.group(1)) / 1024, 1) if m else None
m = re.search(r'TOTAL PSS:\s+(\d+)', mi)
out["memMiB"] = {"totalPss": round(int(m.group(1)) / 1024, 1) if m else None,
                 "graphics": mem('Graphics:'), "nativeHeap": mem('Native Heap:'), "code": mem('Code:')}

g = open(os.path.join(d, 'gfxinfo.txt')).read()
def gi(label):
    m = re.search(re.escape(label) + r'\s*(\S+)', g)
    return m.group(1) if m else None
out["gfxinfo"] = {k: gi(k + ':') for k in ["Total frames rendered", "50th percentile", "90th percentile", "99th percentile",
                                              "50th gpu percentile", "90th gpu percentile", "99th gpu percentile"]}
m = re.search(r'Janky frames: (\d+) \(([0-9.]+)%\)', g)
out["gfxinfo"]["janky"] = m.group(2) if m else None

def page_json():
    try:
        return json.loads(json.loads(open(os.path.join(d, 'page.json')).read().split('\n', 1)[1]))
    except Exception:  # noqa: BLE001
        return {}
PAGE = page_json()
godot = [json.loads(l.split(' ', 1)[1]) for l in (PAGE.get('godot') or []) if l.startswith('OYL-GODOT {')]
if godot:
    def agg(key, sub):
        return round(statistics.median(x[key][sub] for x in godot if x[key][sub] is not None), 2)
    tot = lambda k: sum(x[k] for x in godot)
    out["godot"] = {
        "windows": len(godot),
        "frameMs": {s: agg("frameMs", s) for s in ["p50", "p90", "p99"]},
        "gpuMs": {s: agg("gpuMs", s) for s in ["p50", "p90", "p99"]},
        "cpuMs": {s: agg("cpuMs", s) for s in ["p50", "p90", "p99"]},
        "jsToJavaMs": {s: agg("jsToJavaMs", s) for s in ["p50", "p95", "p99", "max"]},
        "jsToGodotMs": {s: agg("jsToGodotMs", s) for s in ["p50", "p95", "p99", "max"]},
        "arrivalGapMs": {s: agg("arrivalGapMs", s) for s in ["p50", "p95", "p99", "max"]},
        "worldBuildMs": {s: agg("worldBuildMs", s) for s in ["p50", "p99", "max"]},
        "steps": tot("steps"), "lostSteps": tot("lostSteps"),
        "starvedFrames": tot("starvedFrames"), "frames": tot("frames"),
        "starvedShare": round(tot("starvedFrames") / tot("frames") * 100, 2),
        "over20": tot("over20"),
        "late50GodotShare": round(tot("late50Godot") / tot("steps") * 100, 2) if "late50Godot" in godot[0] else None,
        "late50JavaShare": round(tot("late50Java") / tot("steps") * 100, 2) if "late50Java" in godot[0] else None,
        "drawCalls": statistics.median(x["drawCalls"] for x in godot),
        "primitives": statistics.median(x["primitives"] for x in godot),
        "videoMemMiB": round(statistics.median(x["videoMemMiB"] for x in godot), 1),
        "worldBytesPerWindow": round(statistics.median(x["worldBytes"] / max(1, x["worlds"]) for x in godot)),
    }
    # The worst step latency over the whole run, from every window's max.
    out["godot"]["jsToJavaMaxAll"] = max(x["jsToJavaMs"]["max"] for x in godot)
try:
    page = PAGE
    if page.get("three"):
        r = page["three"]
        out["threePage"] = {"result": r.get("result"), "soakMinutes": len(r.get("soak") or []),
                            "soakFrameP50": [s["frameMs"]["p50"] for s in r.get("soak") or []],
                            "soakFrameP99": [s["frameMs"]["p99"] for s in r.get("soak") or []],
                            "rungs": sorted({s["rung"] for s in r.get("soak") or []})}
    if page.get("godot"):
        lines = [json.loads(l.split(' ', 1)[1]) for l in page["godot"] if l.startswith('OYL-GODOT-PAGE ')]
        if lines:
            out["godotPage"] = {
                "stepBuildMs": {s: round(statistics.median(x["stepBuildMs"][s] for x in lines), 2) for s in ["p50", "p90", "p99"]},
                "windowSerialiseMs": {s: round(statistics.median(x["windowSerialiseMs"][s] for x in lines), 2) for s in ["p50", "p90", "p99"]},
                "windowJsonBytes": round(statistics.median(x["windowJsonBytes"]["p50"] for x in lines)),
                "javaDecodeMs": round(statistics.median(x["javaDecodeMs"]["p50"] for x in lines), 2),
                "webviewRafMs": {s: round(statistics.median(x["webviewRafMs"][s] for x in lines), 2) for s in ["p50", "p90", "p99"]},
            }
except Exception as e:  # noqa: BLE001
    out["pageError"] = str(e)[:200]
try:
    out["memAllMiB"] = {}
    for l in open(os.path.join(d, 'meminfo-all.txt')):
        m = re.match(r'\s*([0-9,]+)K: (\S+)', l)
        if m:
            out["memAllMiB"][m.group(2)[:60]] = round(int(m.group(1).replace(',', '')) / 1024, 1)
except FileNotFoundError:
    pass
print(json.dumps(out, indent=1))
