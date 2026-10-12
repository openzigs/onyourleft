# Spike 0024: what three.js's `WebGPURenderer` buys the realistic world, and what moving to it would cost

- **Date**: 2026-10-11
- **Issue**: [#1273](https://github.com/openzigs/onyourleft/issues/1273), by the owner's ruling
  quoted at the top of that issue: run the spike, change no licence, and decide nothing about
  adopting WebGPU. Parent epic [#615](https://github.com/openzigs/onyourleft/issues/615). Related:
  [#680](https://github.com/openzigs/onyourleft/issues/680) (does the shell's WebView expose WebGPU
  at all), [#457](https://github.com/openzigs/onyourleft/issues/457),
  [spike 0014](0014-godot-beneath-the-webview.md) and
  [spike 0015](0015-godot-realistic-world.md).
- **Status of this file**: the kill criterion and the measurement plan below are committed and
  pushed **before anything is measured**, and their text is not changed afterwards. The results are
  appended under them.

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7).
[ADR 0026](../adr/0026-realistic-game-world.md) D-2 pins `WebGLRenderer` and three 0.185.1, and a
move would be its own ADR.

## The question

On the owner's Pixel Tablet (Mali-G710), what does three.js's `WebGPURenderer` buy the realistic
world, and what would moving to it cost? Measured, not argued.

`WebGPURenderer` is two renderers behind one class: a **WebGPU backend**, and a **WebGL 2 backend**
it falls back to where the page has no WebGPU. They share the node material system and differ in
everything beneath it. A device without WebGPU gets the second, so a move is a move to both, and
both are measured against today's `WebGLRenderer`.

## The kill criterion, stated before measuring

Moving the realistic world to `WebGPURenderer` is **not worth an ADR** if **any one** of these is
true of the measurement this spike makes. Each threshold is set now, before either backend has drawn
the realistic world for this spike.

**Three rules bind every condition.** The first two are spike 0015's:

1. **A run length stated in a condition is the run length measured.** A condition that says "over
   the 20-minute pair" is judged on runs of at least 20 minutes that recorded every quantity the
   condition names. A shorter run leaves it **unmeasured**.
2. **Unmeasured is not a pass.** A condition this environment cannot measure, or did not, is reported
   as unmeasured, and the result is a go-signal only if every condition passes on a measurement.
3. **A Mac figure never decides a tablet condition.** W1, W3, W4 and W5 are about the tablet. What
   the Mac measures is reported beside them as what the Mac measured, and each of those conditions
   stays unmeasured until the tablet has run it.

| # | Kill condition | Why this line |
|---|---|---|
| W1 | **The shell's WebView does not give it a GPU.** On the tablet's current Android System WebView, inside the shell: `navigator.gpu` is absent, or `requestAdapter()` resolves `null`, or the adapter's `isFallbackAdapter` is `true`, or `requestDevice()` rejects, or `WebGPURenderer` asked for its WebGPU backend reports that it is drawing with WebGL 2 | #680's question. A renderer whose better half the product's own shell cannot reach is a renderer the product does not have |
| W2 | **It cannot draw the committed realistic set from released parts.** With the installed `three@0.185.1` and nothing patched in it, the **WebGPU backend** fails to draw any one of spike 0015 K9's six classes from the committed files in `apps/web/public/realistic/`: (1) the HDR sky, as the background **and** as image-based light; (2) the photographic road and ground surfaces, colour and normal; (3) the near vegetation models with their own materials; (4) the far trees' impostor strips; (5) the structures' photographic surfaces on the geometry `buildings.ts` builds; (6) the rider model, **posed as the product poses it**. A class drawn without one of its shader patches counts as drawn, and what the picture loses for it is listed; a class that is absent, black, or throws trips it | The issue asks for the same committed set. Class 6 is stricter than 0015's because this is the product's own posing code on the product's own engine, so "standing in the A-pose" would be a failure here, not a difference |
| W3 | **It is not measurably better.** Over the **20-minute pair** on the tablet (below), against `WebGLRenderer` run the same day, the WebGPU backend does **none** of: (a) a **GPU DVFS mean at least 15 % lower** (`/sys/class/misc/mali0/device/cur_freq`, once a second); (b) a **skin temperature at the end of the run at least 2 °C cooler, or a lower maximum thermal status**, from starts within 0.5 °C of each other; (c) **CPU at least 25 % of a core lower**, the app process and its renderer and GPU processes summed (`top`, every 30 s, mean) | #433's line, carried: a renderer that is not measurably better is not worth a rewrite. (a) is 15 % rather than 0015's 25 % because the cost here is a rewrite of one file, not a second engine. (c) **is** a clause here, where 0015 left CPU out: both renderers build the same frame at the same rate on the same thread, so a difference is the renderer's own, and lower driver overhead is the case usually made for WebGPU |
| W4 | **It is worse where a rider feels it.** Over the 20-minute pair on the tablet, the WebGPU backend's share of SurfaceFlinger present intervals over 20 ms is **more than 0.5 percentage points higher** than `WebGLRenderer`'s; or it reaches a **higher thermal status**; or its median time to the first realistic frame (n = 5 each, from the page's `performance.timeOrigin`) is **more than 1 s later**; or, after the warm-up, it has **more frame gaps over 100 ms** than `WebGLRenderer` has over the same ride | 0015's K5, plus the two places a new shader pipeline usually hurts: start-up, and a compile hitch the first time something comes into view |
| W5 | **The fallback is a regression.** Over a 20-minute run on the tablet, `WebGPURenderer` **forced to its WebGL 2 backend** has a GPU DVFS mean **more than 10 % higher** than `WebGLRenderer`'s, or a share of present intervals over 20 ms more than 0.5 percentage points higher, or fails to draw one of W2's six classes | A device without WebGPU gets this backend, and the iOS WebView may be one. A move that makes those riders' world slower or emptier is paid for by the riders with the least to spare |
| W6 | **The comparison is not like-for-like** (a validity condition). Over any pair compared, the triangles `WebGPURenderer` submits per frame (its own `info.render.triangles`, median of the 30-second windows) are **outside 90 % to 110 %** of the triangles `WebGLRenderer` submits on the same ride (the page's own counter). If W6 trips for a pair, **W3 cannot pass on that pair**, whatever its clauses show | 0015's K10, tightened from 80 % because this is the same scene graph built by the same code, so there is no importer to explain a gap |
| W7 | **The realistic set costs more to hold or to ship.** The textures `WebGPURenderer` holds for the loaded realistic world exceed **160 MiB** (`REALISTIC_TEXTURE_MEMORY_BYTES`, ADR 0026 D-6), or its app-process `Graphics` figure in `dumpsys meminfo`, half-way through the 20-minute run, exceeds `WebGLRenderer`'s by **more than 25 %**; or the JavaScript the harness page loads grows by **more than 250 KiB gzipped** over the same page built on `WebGLRenderer` | D-6's ceiling is the only one stated. The JavaScript line is there because `three.webgpu.js` is a second, larger build of three and the product is an offline-first page on a phone |

**What does not kill it, said now so it cannot be argued later**:

- the picture differing from `WebGLRenderer`'s in tone, fog or a shader patch left unported, as long
  as W2 holds and each difference is listed;
- an optional layer (below) costing more than the tablet can afford: each is measured alone and
  reported, and none is part of W3 or W4;
- the pinned Playwright Chromium being unable to run the WebGPU backend headless: what that would
  mean for the browser gate is recorded as a cost of moving, not as a kill;
- iOS not being reached;
- the count of materials and lines a real move would rewrite: it is counted and reported for the
  ADR that would weigh it, and no threshold is set on it here.

## The measurement plan, stated before measuring

- **What is built**: a branch that is never merged, `spike/issue-1273-webgpu-code`. On it, a harness
  page beside `realistic.html` drives the product's own `three-renderer.ts` with its one
  `WebGLRenderer` swapped for `WebGPURenderer` from the installed package's `three/webgpu` build, so
  the scene graph, the belts, the budgets, the assets and the ride are the product's own and not a
  reconstruction. `?backend=webgpu` asks for the WebGPU backend and `?backend=webgl2` forces the
  fallback (`forceWebGL`). Only as much is ported to TSL as that scene needs; every `ShaderMaterial`
  and `onBeforeCompile` site is listed as ported or left out, with what the picture loses.
- **The control**: `realistic.html?world=realistic&panel=0&ladder=0`, unchanged, on `main`'s
  `WebGLRenderer`: the page behind epic #615's baseline row `T20-three-realistic`.
- **The same ride for all three**: `realistic/route.ts` from 2 550 m at 9 m/s, looping as the page
  loops, the realistic top rung held (`ladder=0`), a 2560 × 1600 drawing buffer.
- **Three optional layers, each behind its own switch, each measured alone** on the WebGPU backend:
  `?traa=1` temporal anti-aliasing (three's `TRAANode`), `?ao=1` screen-space ambient occlusion
  (three's `GTAONode`), `?wind=1` one compute-driven effect (wind in the foliage). Each is reported
  as its cost over the WebGPU backend with all three off, with a screenshot from the same camera.
- **On the Mac first, to prove the harness** (an Apple M4 Pro MacBook Pro, the installed Google
  Chrome, a 1280 × 800 CSS-pixel window at a device pixel ratio of 2). The Mac has no GPU clock a
  page or an unprivileged process can read, so its instruments are: (i) the time between drawn
  frames at the display's rate (p50/p90/p95/p99 over 60 s after a 3 s warm-up); (ii) **frames per
  second with the frame-rate limit off** (`--disable-frame-rate-limit --disable-gpu-vsync`), over
  60 s, three runs each, as the throughput figure; (iii) main-thread time inside `view.render`, per
  frame; (iv) CPU seconds of the renderer process and the GPU process over the run (`ps`); (v)
  triangles and draw calls from each renderer's own counters; (vi) texture bytes; (vii) time to the
  first realistic frame, n = 5, and the count of frame gaps over 100 ms after warm-up; (viii) one
  screenshot of each configuration at `?at=2550` with the clock stopped. The order is `WebGLRenderer`,
  WebGPU backend, WebGL 2 backend, then each layer. Rule 3 above applies to all of it.
- **Then on the tablet**, with spike 0015's procedure unchanged: #680's expressions through
  `apps/mobile/tools/webview-probe.mjs` first (W1); then one **20-minute** run each of
  `WebGLRenderer`, the WebGPU backend and the WebGL 2 backend, after the tablet has cooled on the
  launcher to a skin temperature of 26 °C or less, `WebGLRenderer` first, on charge, brightness as
  found, sampled by 0015's `oyl-sampler.sh` (SurfaceFlinger present intervals every 0.5 s, GPU DVFS
  once a second, thermal and `top` every 30 s, `dumpsys meminfo` half-way, the page's own numbers
  every 30 s); a 5-minute run of each optional layer; five cold starts of each of the three.
- **A tablet step this environment cannot run is not run by proxy.** It is listed on
  [#733](https://github.com/openzigs/onyourleft/issues/733) with the exact command, and its rows
  here read "not measured" with the reason.
- **The cost of a real move is counted** from `three-renderer.ts` on `main` at the commit measured:
  each material construction site, each `ShaderMaterial`, each `onBeforeCompile` patch and the lines
  inside it, each use of a `WebGLRenderer`-only call, and each browser-gate and wiring-gate file
  that names something `WebGPURenderer` does not have.
- **Nothing here touches the trainer**; nobody rides. **Nothing under `apps/web/src` on `main`
  changes**: this write-up, and any measuring tool worth keeping, are all that merge.
