import json,sys,os
for r in sys.argv[1:]:
    p=os.path.join(r,'summary.json')
    if not os.path.exists(p): continue
    d=json.load(open(p)); t=d.get('thermal',[]); ts=d.get('thermalSummary',{}); pr=d.get('present',{}); g=d.get('gpuFreqMHz',{}); m=d.get('memMiB',{}); raf=d.get('raf') or {}
    pg=d.get('spikePage') or d.get('threePage') or {}
    print(f"{d['run']:18s} skin0={d.get('skinBefore'):.2f} first={ts.get('skinFirst')} last={ts.get('skinLast')} max={ts.get('skinMax')} st={ts.get('maxStatus')} | dvfs={g.get('mean')} p50={g.get('p50')} n={g.get('samples')} per5={g.get('meanPer5Min')} | cpu app={ts.get('appCpuPctMean')} ren={ts.get('rendererCpuPctMean')} sum={ts.get('appPlusRendererCpuPctMean')} g3d={ts.get('g3dMean')}")
    print(f"   present fps={pr.get('fps')} p50={pr.get('p50')} p90={pr.get('p90')} p95={pr.get('p95')} p99={pr.get('p99')} >20={pr.get('over20msShare')}% ({pr.get('over20ms')}) >100={pr.get('over100msUnder250')} holes={pr.get('holesOver250ms')} | raf frames={raf.get('frames')} >20={raf.get('over20')} >50={raf.get('over50')} >100={raf.get('over100')} max={raf.get('max')}")
    print(f"   mem graphics={m.get('graphics')} gl={m.get('glMtrack')} egl={m.get('egl')} pss={m.get('totalPss')} all={d.get('memAllMiB')}")
    print(f"   page tri={pg.get('trianglesPerFrameMedian')} calls={pg.get('drawCallsPerFrameMedian', pg.get('drawCallsMedian'))} first={pg.get('firstFrameMs')} renderMs={pg.get('renderMsP50Median')}/{pg.get('renderMsP99Median')} gaps100={pg.get('gapsOver100Ms')} tex={pg.get('texturesSizeMiB')} errors={pg.get('errors')} backend={(pg.get('drawing') or {})} windows={pg.get('windows', pg.get('soakMinutes'))} bright={d.get('brightnessBefore')}/{d.get('brightnessAfter')}")
