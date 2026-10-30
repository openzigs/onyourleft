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

---

Everything below was appended on 2026-10-12, after the measurements. The text above is the commit
`6e377de9`, unchanged: committed at 20:24:39 EDT on 2026-10-11 and pushed one second later
(GitHub's activity log for the branch: `2026-10-12T00:24:40Z branch_creation 6e377de9`). The
earliest frame either renderer drew for this spike was a trial at `00:28:09Z`, three and a half
minutes after the push; that trial and everything else taken before the harness was finished was
thrown away. The first frame that counts is the tablet baseline's, at `01:57:58Z`.

## The short answer

**On this tablet, today, `WebGPURenderer` buys the realistic world nothing that was measured, and
the kill criterion trips.** Over the pre-registered 20-minute runs the WebGPU backend drew the same
scene at the same 60 Hz with the GPU's clock **1.3 % lower** (785.2 against 795.3 MHz; two runs of
`WebGLRenderer` alone differed by 0.2 %), **the same CPU** (175 % of a core against 174 %), and a
skin that ended **warmer**, not cooler. None of W3's three clauses is met, so **W3 trips: it is not
measurably better**. It was not worse while riding either (W4's frame clauses hold), with one
exception found along the way: **the first picture reaches the screen about 1.5 s later** on the
tablet, which the page's own first-frame mark does not see.

What it does buy is not speed. It **works**: the shell's WebView 154 hands the page a real Mali
adapter (W1 holds, which answers [#680](https://github.com/openzigs/onyourleft/issues/680)), and
released `three@0.185.1`, unpatched, draws all six classes of the committed realistic set on both
backends once nine of the product's shaders are rewritten in TSL (W2 holds). Its WebGL 2 fallback is
no regression (W5 holds) and it costs 105 KiB of gzipped JavaScript and 8 % more graphics memory
(W7 holds). And it opens three's node post-processing and compute, of which **only compute is
affordable here**: wind worked out by a compute pass cost nothing measurable, while temporal
anti-aliasing took the tablet from 59 to 48 frames a second and ambient occlusion to 40, both with
the GPU's clock pinned at its top step.

The cost of moving is counted in §"What a real move would cost": 14 shader patches (482 lines) and
4 `ShaderMaterial`s in `three-renderer.ts`, 34 GLSL literals (548 lines), the tests that assert on
that GLSL, a synchronous `GameRenderer.create` that `WebGPURenderer` cannot honour, and a browser
gate whose pinned Chromium gives `WebGPURenderer` no adapter and so would silently test only the
fallback.

**This decides nothing.** ADR 0026 D-2 stands. By this file's own rule the result is not a
go-signal: one condition trips on a measurement.

## What was built

On `spike/issue-1273-webgpu-code` (final commit `2f8ea2a1`, never merged; its `spike-0024/README.md`
lists every file):

- **The page**, `apps/web/browser/webgpu.html`, runs the product's own `three-renderer.ts`
  (`threeGameRenderer.create`, `loadRealisticWorld`, `rideFrame`, the realistic top rung) with `three`
  aliased to a shim. `?backend=webgpu` makes a `WebGPURenderer`, `?backend=webgl2` makes one with
  `forceWebGL`, and `?backend=webglrenderer` makes the installed build's `WebGLRenderer` through the
  same shim, which is a second control. The package in `node_modules` is untouched.
- **The renderer is made and initialised by the page**, before the view exists, because
  `WebGPURenderer` cannot draw or build a PMREM before `await renderer.init()` and the product's view
  builds its world in a constructor.
- **The ports**, `apps/web/src/game/spike-0024-nodes.ts` (812 lines of TSL), called from the top of
  the function each stands in for (135 added lines in `three-renderer.ts`).
- **The tablet build** is the Capacitor shell with one change, its application id
  (`dev.openzigs.onyourleft.webgpuspike`), so it installed **beside** the owner's app and shared
  nothing with it. It holds `main`'s product build, `main`'s harness pages under `/harness/` (the
  control, built from a checkout with nothing of the spike in it) and the spike's page under
  `/harness-webgpu/`.

### What was ported, and what was left out

The product has 14 `onBeforeCompile` patches and 4 `ShaderMaterial`s. Neither runs under
`WebGPURenderer`, on either backend: a node material ignores `onBeforeCompile`, and a
`ShaderMaterial`'s GLSL is not compiled.

| Site in `three-renderer.ts` | In the spike | What the picture loses |
|---|---|---|
| `photographicRoadMaterial` (72 lines) | Ported: world-planar UV, the photograph as grain, the normal map, #628's wear | The wheel tracks' flattened normal, the 0.25 sheen, the front-face rule. The road reads slightly lighter and less blue |
| `photographicGroundMaterial` (55) | Ported: planar UV, the far sample, #624's verge and rock blend, colour and normal | #619's LOD bias (0 at the rung measured) |
| `withMaterialLayers` (54) | Ported: one material, several layers, a branch to one layer's textures | #619's LOD bias. ⚠️ The layer attribute had to become floats: WebGL converts a `Uint32Array` read as `float`, WebGPU does not (the trees drew black and white) |
| `withInstanceChannels` (38) | Ported whole: #621's tint and #617's dither | Nothing |
| `withFoliageSwayOf` (32) | Ported | A tree's sway phase is seeded from its tint code, not from where it stands: three 0.185.1 does not hand a material the instance matrix |
| `riderBodyMaterial` (25) | Ported whole: #623's kit colour | Nothing |
| `withGroundBlobShading` (31) | Ported: the falloff and strength | The two clip lines that stop a blob at a bridge's edge |
| `impostorMaterial` (`ShaderMaterial`) | Ported: frame choice, the turned quad, breeze, cut, dither, #630's relighting, tint | #622's air; three's fog stands in. The instance matrices are uploaded twice a frame |
| `RiderSilhouetteBelt` (`ShaderMaterial`) | Ported whole: the 32 taps | Nothing |
| `withAtmosphere` (39) | **Left out** | #622's directional air and valley haze. three's own fog stands in, and the distance is greyer and flatter |
| `reflectingWaterMaterial` (`ShaderMaterial`) | **Left out**; a plain physically based surface stands in | #629's ripples and reflection: the lake is a smooth pale mirror |
| `WaterBelt`'s stylised `ShaderMaterial` | **Left out** | Nothing in the realistic world (it is constructed, never drawn) |
| `withTextureLodBias` (11) | **Left out** | Nothing at the rung measured (the bias is 0) |
| `stoneBridgeMaterial` (6) | **Left out** | The bridge's stone is not tiled by the world; not inspected |
| `withSurfaceDetail` (31), `withKitPerInstance` (20) | **Left out** | Nothing in the realistic world: both are the stylised world's |
| `bannerMaterial` (37), `logoMaterial` (31) | **Left out** | A banner or a wordmark board would draw without its lettering. None is on the ride measured |

Seven of the fourteen patches and two of the four `ShaderMaterial`s were ported, some in part. **The
stylised world was not ported at all** and was not drawn.

## Versions and devices

- three.js **0.185.1**, the installed package, unpatched. Capacitor 8.5.2. Code at `main` `ed1fd9f4`.
- **The tablet**: the owner's Pixel Tablet (Tensor G2 / Mali-G710, Android 17 `CP2A.260705.006`,
  2560 × 1600 at 60 Hz, landscape, on AC power), **Android System WebView 154.0.8037.106**. Both
  pages draw a 2560 × 1600 buffer. Brightness was left on automatic and read 3 of 255 before and
  after every run (a dark room, at night).
- **The Mac**: MacBook Pro, Apple M4 Pro, macOS 26.6.2, Google Chrome 154.0.8037.98, headed, a
  throwaway profile per run, a 1280 × 800 window at a device pixel ratio of 2 (a 2560 × 1600
  buffer), a 120 Hz display, on charge.

## Where the method departed from the plan

1. **The Mac was never idle.** Two other agents were working in this repository and others in a
   second project; one unrelated process held a core at 99 % all night. **The first sitting was
   thrown away**: from its fourth configuration on, the one-minute load average was between 9 and
   22 (a browser test suite). **The set was run again in one sitting** (02:03 to 02:55 UTC) by a
   script that waited, before each configuration, for the load to fall under 5 with no test browser
   running; it waited 30 s, 0, 0, 0, 465 s, 15 s, 120 s and 255 s. Load at the start of each run is
   in the table. Two of the ambient-occlusion runs still started at 9.6 and 15.0. **The tablet set
   was running over adb throughout that sitting** (a sleep loop and a log stream on the Mac).
   ⚠️ **So the order is not the plan's "on the Mac first"**: the sitting thrown away did run first
   (01:15 to 01:53 UTC), but the sitting kept began at 02:03 UTC, five minutes after the tablet's
   baseline run began (01:58 UTC). What the plan wanted from the order, a harness shown to work
   before the tablet was asked anything, was had from the first sitting and the smoke runs before it.
2. **One frame counter, outside the page, for the control; the page's own for the spike's page.** A
   wrapper on `requestAnimationFrame`, installed before the page's scripts, gave the unchanged
   control the p95 it does not publish. It cannot be used on `WebGPURenderer`: **the renderer keeps
   a `requestAnimationFrame` loop of its own from `init()`**, so every frame has two callbacks and
   the wrapper counted 240 a second. The spike's page times its own frames. The two agree where
   both are valid: `WebGLRenderer` through the spike's page reads 120.0 frames a second and a p95 of
   9.5 ms by its own count, against the control's 120.0 and 9.6 ms by the wrapper.
3. **Main-thread time inside `view.render` (the plan's iii) is not published by the control**, and
   the control was not changed to publish it. It is reported from `?backend=webglrenderer` on the
   spike's page, whose screenshots are **byte-identical** to the control's at all three cameras.
4. **The cool-downs turned the screen off**, as spike 0015's did, and **cooled to 24.0 °C, not
   26 °C**: the tablet idles near 21 °C in this room, so 26 °C was no constraint. Every run's start
   is in the table, by both readings 0015 distinguished (the last cool-down reading with the screen
   off, and the sampler's first with the scene drawing).
5. **The first baseline started from a tablet that had sat cold**; the other two 20-minute runs
   started 10 and 14 minutes after a 20-minute run. So the baseline was **run a second time**, last,
   after two hours of work (`T20b`). It is not in the plan. It is reported beside the first, the
   conditions are judged on the first as planned, and where the two would give different verdicts
   the text says so.
6. **Sampling ran slower than planned**, as in 0015: 976 to 984 GPU clock samples in 1 200 s, and
   33 thermal and `top` samples (one every 37 s).
7. **Frame gaps over 100 ms on the tablet** are counted by the same `requestAnimationFrame` wrapper,
   put into each page through the debugger 12 s after navigation (after the first frame, so it is
   "after the warm-up"), and taught to ignore the renderer's own second callback. SurfaceFlinger's
   count is the row beneath it in the table; it cannot tell a long frame from a hole in its own
   sampling.
8. **Time to the first realistic frame has two readings**, and the plan names neither: W4 and the
   plan's (vii) give the quantity and its origin (the page's `performance.timeOrigin`) and no
   instrument. The page's mark (`performance.now()` when the first `view.render` returns) is the
   instrument the harness had, as the control page has. The browser's **first contentful paint**
   was read as well, and on the tablet the two are 1.7 s apart under the
   WebGPU backend. Both are reported and W4 is judged on both.
9. **Ambient occlusion's normals come from depth**, not from a normal target: with the scene's own
   view normals the foliage drew black (two-sided leaves and turned impostor quads have no normal
   that faces the camera). It was measured at half resolution, 16 samples; a **full-resolution** run
   was added. A 5-minute run of the WebGPU backend with every layer off (`L5-base`) was added as the
   layers' own baseline.
10. **Texture bytes are two different counts.** The realistic set's own compressed bytes
    (`realisticTextureReport`) are the same files under every renderer. What a renderer **holds** is
    `WebGPURenderer`'s `info.memory.texturesSize`; `WebGLRenderer` keeps no such figure, so on the
    Mac that row is "not measured" for it and the tablet's `dumpsys meminfo` stands in.
11. **Screenshots are not committed** (the owner's ruling of 2026-10-12 on #1273). They are on the
    Mac at `~/Development/oyl-spike-0024-screenshots/`, taken at three cameras rather than one
    (2 550 m as planned, 1 600 m for the water and 2 000 m for a stone wall), and seven more were
    taken on the tablet. §"The screenshots" names each with its SHA-256.
12. **Small ones.** The spike's page is `webgpu.html`, not a switch on `realistic.html`. The tablet
    runs' status bar is visible in both pages (the shell as it is). Mac CPU is `ps` CPU seconds over
    a 60 s wait beginning 3 s after the first frame, not over the page's own window.

## Results

Raw files are on the code branch under `spike-0024/results/`: `mac/` (one JSON a run, and
`table.txt`), `tablet/` (one directory a run with SurfaceFlinger's present times, the GPU clock,
thermal and `top`, `meminfo`, the page's own numbers and a `summary.json`; `runs.txt` is the table),
`js-size.txt`, `gate-probe.txt`, `count-move.txt`.

### 1. W1 and #680: does the shell's WebView give it a GPU?

Yes. In the shell (`https://localhost/`, a secure context), through
`apps/mobile/tools/webview-probe.mjs`, on **WebView 154.0.8037.106**:

| Expression | Result |
|---|---|
| `'gpu' in navigator` | `true` |
| `await navigator.gpu.requestAdapter()` | not `null` |
| `adapter.info` | vendor `arm`, architecture `valhall`, device and description empty |
| `adapter.isFallbackAdapter` | `false` |
| `adapter.requestDevice()` | resolved |
| `adapter.features` (20) | `bgra8unorm-storage`, `core-features-and-limits`, `depth-clip-control`, `depth32float-stencil8`, `dual-source-blending`, `float32-blendable`, `float32-filterable`, `indirect-first-instance`, `primitive-index`, `rg11b10ufloat-renderable`, `shader-f16`, `subgroup-size-control`, `subgroups`, `texture-component-swizzle`, `texture-compression-astc`, `texture-compression-astc-sliced-3d`, `texture-compression-etc2`, `texture-formats-tier1`, `texture-formats-tier2`, `timestamp-query` |
| Limits | `maxTextureDimension2D` 16 384, `maxTextureArrayLayers` 2 048, `maxBindGroups` 4, `maxSampledTexturesPerShaderStage` 48, `maxSamplersPerShaderStage` 16, `maxStorageBuffersPerShaderStage` 16, `maxUniformBufferBindingSize` 65 536, `maxStorageBufferBindingSize` 2 147 483 644, `maxBufferSize` 4 294 967 292, `maxComputeWorkgroupStorageSize` 32 768, `maxComputeInvocationsPerWorkgroup` 1 024, `maxVertexAttributes` 30, `maxColorAttachments` 8 |
| `navigator.gpu.getPreferredCanvasFormat()` | `rgba8unorm` |
| `WebGPURenderer` asked for WebGPU | `backend.isWebGPUBackend === true`, not compatibility mode, in every tablet run |

No BC texture compression (expected on Mali); ASTC and ETC2 are there, which is what the committed
set is encoded in. **Chrome on the same tablet was not probed**: that row is #680's own.

### 2. W2: the six classes

All six are drawn by both backends, on the Mac and on the tablet, from the committed files:

| Class | Drawn | How it was checked |
|---|---|---|
| 1. The HDR sky, background and image-based light | Yes | `scene.background` and `scene.environment` are both textures; the sky is in every screenshot and the scenery is lit by it |
| 2. The photographic road and ground, colour and normal | Yes, through the ports | Both meshes carry a 1 024 px map and a normal map; screenshots |
| 3. The near vegetation with its own materials | Yes, through the layer, tint, dither and sway ports | `tree_small_02`, `fir_sapling_medium_a` and `_b`, `shrub_02`, `boulder_01` in the scene dump with their own maps |
| 4. The far trees' impostor strips | Yes, through the impostor port | Four impostor meshes, 10 to 67 instances each, in the dump; the far tree line in the screenshots |
| 5. The structures' photographic surfaces | Yes, **with no port**: plain `MeshStandardMaterial` | Fence rails, a hedge and a dry-stone wall in the screenshots at 2 550, 1 600 and 2 000 m |
| 6. The rider, posed as the product poses it | Yes | Five `SkinnedMesh` riders; seated, hands on the bar, pedalling, in the kit colour, with the thrown silhouette shadow |

No class is absent, black, or throws; `errors` was empty in every run. What each class loses is the
table in §"What was ported". The water is not one of the six: it was left out and a stand-in drawn.

### 3. The tablet's 20-minute runs (W3, W4, W5, W6, W7)

`T20` is the control (`realistic.html?world=realistic&panel=0&ladder=0`, `WebGLRenderer`), `G20`
`WebGPURenderer` on its WebGPU backend, `F20` `WebGPURenderer` forced to WebGL 2, `T20b` the control
again (departure 5). Run in that order on 2026-10-11/12, 21:57 to 00:54 EDT. Thermal status was 0
throughout all four.

| | `T20` WebGLRenderer | `G20` WebGPU backend | `F20` WebGL 2 backend | `T20b` WebGLRenderer again |
|---|---|---|---|---|
| **GPU DVFS mean, MHz** (median 762 in all) | **795.3** | **785.2** (−1.3 %) | **778.4** (−2.1 %) | 796.7 |
| by five minutes | 795 / 801 / 793 / 792 | 784 / 787 / 786 / 784 (and one sample at 1 200 s, 848, left out of this row and inside the mean) | 772 / 784 / 775 / 782 | 797 / 803 / 793 / 795 |
| **CPU, % of a core** (app + renderer process, mean of 33) | **174.2** (88.4 + 85.7) | **175.2** (89.0 + 86.2) | **179.4** (94.2 + 85.2) | 167.3 (86.8 + 80.5) |
| Skin at the cool-down's last reading, °C | 23.67 | 23.92 | 23.94 | 23.93 |
| Skin at the sampler's first reading, °C | 25.67 | 26.25 | 26.17 | 26.58 |
| **Skin at the end, °C** | **32.59** | **34.00** | **33.86** | 33.37 |
| GPU sensor mean, °C | 59.9 | 63.2 | 63.0 | 61.5 |
| Present interval p50 / p90 / p95 / p99, ms | 16.63 / 16.65 / 16.66 / 16.73 | 16.63 / 16.66 / 16.68 / 16.73 | 16.63 / 16.65 / 16.67 / 16.74 | 16.63 / 16.65 / 16.66 / 16.73 |
| Presents a second | 59.55 | 59.45 | 59.25 | 59.59 |
| **Present intervals over 20 ms** | **0.236 %** (169) | **0.314 %** (224) | **0.464 %** (330) | 0.204 % (146) |
| Page frame gaps over 20 ms / over 100 ms (longest) | 5 / **2** (183 ms) | 19 / **2** (133 ms) | 46 / **7** (499 ms) | 2 / 0 (83 ms) |
| SurfaceFlinger present intervals of 100 to 250 ms / holes of 250 ms or more | 14 / 21 | 13 / 25 | 14 / 27 | 16 / 17 |
| **Triangles a frame** (median of windows) | **196 050** | **198 994** (101.5 %) | 198 994 (101.5 %) | 196 051 |
| Draw calls a frame | 29 | 30 | 30 | 29 |
| Main-thread time in `view.render`, p50 / p99 ms | not published | 7.3 / 10.3 | 7.5 / 10.4 | not published |
| **`Graphics`, app process, half-way, MiB** | **358.9** | **386.1** (+7.6 %) | **423.2** (+17.9 %) | 354.3 |
| App process total PSS, MiB | 512.6 | 698.8 | 584.9 | 499.8 |
| Renderer process PSS, MiB | 311.2 | 343.2 | 324.7 | 302.6 |
| Textures the renderer holds, MiB | not counted by three | 91.6 (68 textures) | 91.6 | not counted |
| The realistic set's own texture bytes | 30 869 160 | 30 869 160 | 30 869 160 | 30 869 160 |

Reading it:

- **The GPU works as hard either way.** 785.2 against 795.3 MHz is 1.3 % lower, and against the
  repeat (796.7) 1.4 %. Two runs of `WebGLRenderer` alone are 0.2 % apart, so the 1.3 % is probably
  real and it is a twelfth of the 15 % W3 asks for. The median is the same clock step in all four.
- **The CPU is the same**: 175.2 against 174.2 and 167.3. The case usually made for WebGPU, less
  driver overhead on the CPU, **does not show on this scene**, which is 30 draw calls a frame. The
  two baselines are 7 points apart, which is the size of difference this instrument cannot see.
- **It ends warmer, and that is not only the start.** Against the first baseline WebGPU ended
  1.4 °C warmer, but that baseline began from a colder tablet. Against the repeat, started as the
  WebGPU run was, it ended **0.6 °C warmer** with the GPU sensor 1.7 °C higher. Nothing here says
  why; the app process holds 186 MiB more.
- **Frames are as steady**: the same percentiles, 0.08 of a point more intervals over 20 ms, and
  two gaps over 100 ms in 20 minutes, as the control had. The fallback is a little rougher (0.46 %,
  and seven gaps of which one was half a second).
- **Memory**: 8 % more `Graphics` and 36 % more process memory on the WebGPU backend.

### 4. Start-up on the tablet (W4)

Five cold starts of each (the app force-stopped, then started and navigated), from the page's own
time origin, after cooling to 26 °C:

| | Page's first-frame mark, ms | First contentful paint, ms |
|---|---|---|
| `WebGLRenderer` | 2 287, 2 229, 2 363, 2 208, 2 398; **median 2 287** | 2 316, 2 260, 2 384, 2 252, 2 412; **median 2 316** |
| WebGPU backend | 2 205, 2 063, 2 094, 2 091, 2 172; **median 2 094** | 3 872, 3 728, 3 768, 3 796, 3 844; **median 3 796** |
| WebGL 2 backend | 2 637, 3 045, 3 124, 2 557, 2 995; **median 2 995** | 2 656, 3 072, 3 152, 2 580, 3 028; **median 3 028** |

⚠️ **Under the WebGPU backend the first `render` returns 1.7 s before anything is on the screen.**
With `WebGLRenderer`, and with `WebGPURenderer`'s own WebGL 2 backend, the page paints about 30 ms
after the call returns. The likely reason, which was not measured: a WebGL draw waits for its
program, while a WebGPU `render` hands the frame to the GPU process and returns, and the picture
arrives when the pipelines have compiled. So by the page's own mark, WebGPU starts **193 ms earlier** than `WebGLRenderer`; by first
contentful paint, which this file takes as when the rider first sees the world, **1 480 ms later**. The page has nothing but the canvas, so first
contentful paint is the canvas's first frame. The five starts are alike (3.73 to 3.87 s), so no
cache made a later start faster. The fallback is 0.7 s later than `WebGLRenderer` by either reading.

On the Mac the two readings are 15 to 46 ms apart for all three renderers (§6), so this is the
tablet's, not three's alone.

### 5. The optional layers on the tablet, 5 minutes each

Each on the WebGPU backend, each alone, after cooling to 26 °C, against `L5-base` (no layer):

| | `L5-base` | `?traa=1` | `?ao=1` half resolution | `?ao=1` full resolution | `?wind=1` |
|---|---|---|---|---|---|
| Presents a second | 59.35 | **47.77** | **40.34** | **21.13** | 59.29 |
| Present intervals over 20 ms | 0.29 % | 23.7 % | 41.8 % | 98.3 % | 0.37 % |
| Present p50 / p90 / p99, ms | 16.63 / 16.66 / 16.73 | 16.64 / 33.28 / 49.91 | 16.65 / 33.30 / 49.94 | 49.90 / 49.96 / 99.82 | 16.63 / 16.66 / 16.73 |
| GPU DVFS mean, MHz (the top step is 848) | 785.2 | **848.0** | **847.3** | **847.6** | 785.4 |
| CPU, % of a core | 171.3 | 164.7 | 134.4 | 89.8 | 175.2 |
| Skin at the end, °C (from 25.9 to 26.0) | 33.08 | **35.94** | 34.27 | 33.52 | 32.89 |
| GPU sensor mean, °C | 63.0 | 75.4 | 68.7 | 66.5 | 62.9 |
| `Graphics`, MiB | 399.4 | 566.1 | 427.4 | 421.5 | 402.2 |
| Textures the renderer holds, MiB | 91.6 | 169.7 | 92.6 | 95.5 | 91.6 |

- **Temporal anti-aliasing (`TRAANode`) is not affordable here**: the GPU sits at its top clock
  step and still misses one frame in four; 167 MiB more graphics memory for its extra render
  targets; the skin 2.9 °C warmer after five minutes.
- **Ambient occlusion (`GTAONode`) is not affordable here either**: 40 frames a second at half
  resolution and 21 at full, the clock pinned both times. ⚠️ The CPU falls because fewer frames are
  drawn, not because it is cheaper.
- **Compute-driven wind is free at this size**: a compute pass that writes the breeze's wave into a
  4 096-entry buffer the near trees read cost nothing this run can see (785.4 against 785.2 MHz).
  That is one small pass; it shows compute works on this tablet and does not show what a large one
  costs. It was not measured on the WebGL 2 backend.

### 6. The Mac, which proves the harness and decides nothing (rule 3)

One sitting, 2026-10-12 02:03 to 02:55 UTC. `control` is `realistic.html`; `classic` is
`WebGLRenderer` through the spike's page. Capped is one 60 s run at the display's 120 Hz; the
throughput is three 60 s runs with the frame-rate limit off.

| | `control` | `classic` | WebGPU backend | WebGL 2 backend | `traa` | `ao` half | `ao` full | `wind` |
|---|---|---|---|---|---|---|---|---|
| Capped: frames a second | 120.0 | 120.0 | 120.0 | 120.0 | 120.0 | 120.0 | 120.0 | 120.0 |
| Capped: gap p50 / p90 / p95 / p99, ms | 8.3 / 8.9 / 9.6 / 10.3 | 8.3 / 9.1 / 9.5 / 10.1 | 8.3 / 9.5 / 9.9 / 10.3 | 8.3 / 9.1 / 9.5 / 10.2 | 8.3 / 9.4 / 9.9 / 10.3 | 8.3 / 9.6 / 9.9 / 10.2 | 8.3 / 9.6 / 9.9 / 10.2 | 8.3 / 9.5 / 9.9 / 10.3 |
| Capped: gaps over 100 ms | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Capped: `view.render` p50 / p99, ms | not published | 0.9 / 1.2 | 1.4 / 2.1 | 1.1 / 2.4 | 1.7 / 2.1 | 1.5 / 1.9 | 1.5 / 2.2 | 1.5 / 2.0 |
| Capped: CPU, renderer + GPU process, cores | 0.20 + 0.07 | 0.19 + 0.07 | 0.30 + 0.15 | 0.25 + 0.11 | 0.33 + 0.18 | 0.32 + 0.17 | 0.31 + 0.15 | 0.31 + 0.17 |
| **Uncapped: frames a second**, median of 3 | **584.8** | 580.9 | **618.9** | 570.7 | 504.9 | 437.8 | 248.1 | 589.1 |
| the three runs | 587.0, 583.1, 584.8 | 582.2, 580.9, 580.6 | 643.5, 586.7, 618.9 | 570.7, 574.2, 478.8 | 510.7, 504.9, 469.3 | 472.5, 396.3, 437.8 | 250.6, 248.1, 246.4 | 622.4, 589.1, 566.8 |
| Uncapped: CPU, renderer + GPU process, cores, median of 3 | 0.97 + 1.15 | 0.96 + 1.24 | 1.12 + 0.52 | 1.08 + 1.02 | 1.07 + 1.36 | 1.10 + 0.99 | 0.55 + 1.23 | 1.13 + 0.58 |
| Uncapped: longest gap in the three runs, ms | 92.5 | 90.5 | 18.0 | 74.3 | 19.7 | 19.3 | 41.3 | 13.5 |
| Triangles a frame / draw calls (capped run) | 198 935 / 30 | 198 929 / 30 | 200 903 / 31 | 200 902 / 31 | 200 904 / 32 | 200 901 / 32 | 200 903 / 32 | 200 901 / 31 |
| First-frame mark, median of 5, ms | 691 | 782 | 687 | 1 369 | 735 | 1 064 | 1 022 | 686 |
| Load average at the start of each run | 4.4 to 5.1 | 4.3 to 5.7 | 3.6 to 5.9 | 4.4 to 5.1 | 3.4 to 5.0 | 3.9 to 15.0 | 4.5 to 6.0 | 3.3 to 4.3 |
| Textures the renderer holds, MiB | not counted | not counted | 91.6 | 91.6 | not read | not read | not read | not read |

Reading it, as what the Mac measured: the WebGPU backend draws about **6 % more frames a second**
with the limit off (618.9 against 584.8, the three runs spanning 587 to 644) and the WebGL 2 backend
about 2 % fewer. With the limit off the page is held by its own main thread (about one core in
every column), and what changes is **the GPU process, which uses half the CPU under WebGPU** (0.52
against 1.15 cores). At the display's rate the saving is not there: `WebGPURenderer` used **more**
CPU in both processes (0.45 against 0.27 cores), part of it a second animation callback a frame.
With the limit off `WebGLRenderer` has a 90 ms pause in every run and the WebGPU backend has none
over 18 ms. A follow-up of five starts each read first contentful paint 15 to 48 ms after the page's
mark for all three renderers (`results/mac-first-paint/`).

The first sitting, thrown away (departure 1), had the same ordering under load: 565, 549, 584 and
535 frames a second. ⚠️ **Only its console survives** (`results/mac/sitting-1-discarded.txt`): its
JSON files were overwritten by the second sitting. The console holds the wrapper's count for every
run, so 565 and 549 (the control and `classic`, medians of 565.2 and 548.7) read straight from it,
and 584 and 535 are **half** of the 1 168.8 and 1 069.0 it shows for the two `WebGPURenderer`
backends, which the wrapper counts twice (departure 2). The page's own counts for that sitting were
not kept.

### 7. JavaScript (W7)

The spike's page built twice, each with one renderer, and the JavaScript each **loaded** (until the
first frame and 5 s after), gzipped at level 9:

| Build | JavaScript files | Bytes | Gzipped |
|---|---|---|---|
| The page on `WebGLRenderer` alone (no `three/webgpu`, no TSL, no ports, no layers) | 2 | 964 570 | **275 340** (268.9 KiB) |
| The page on `WebGPURenderer` alone (both backends, the ports, the three layers) | 2 | 1 304 483 | **383 038** (374.1 KiB) |
| For scale: the control, `realistic.html` | 16 | 1 027 920 | 300 841 (293.8 KiB) |

**+107 698 bytes, 105.2 KiB gzipped.** ⚠️ The WebGPU build still carries the GLSL of every patch it
no longer runs, so a real move would be a little smaller than this, and it carries the spike's
three layers, which a move might not ship. The basis transcoder's 247 535 gzipped bytes of
WebAssembly are the same in all three.

## The screenshots

At `~/Development/oyl-spike-0024-screenshots/` on the Mac that made them, **outside the repository
and in no branch**. Every file is a 2560 × 1600 PNG. The Mac's are Chrome's own capture of the page
with the clock stopped (`?at=`); the tablet's are `adb exec-out screencap` 14 s after navigation, so
they include the status bar.

**What the eye finds.** `classic-*` is byte-identical to `control-*`. The WebGPU and WebGL 2 backends
are within 0.1 of a level of each other (mean absolute difference per channel, of 255) and about 4
to 5 levels from the control, and the differences are the ones the ports table predicts:

- **2 550 m** (the plan's camera): the same road, verge, fence, trees, far tree line, rider and
  thrown shadow, in the same places. The far hills and the end of the road are **greyer and
  flatter** under `WebGPURenderer` (three's fog in place of #622's air), and the road is slightly
  lighter and less blue.
- **1 600 m** (the lake on the left, a hedge on the right): the control's water is the product's
  rippled, reflecting surface, with a repeating pattern in the reflection; under `WebGPURenderer`
  it is **a smooth pale sheet with no ripples** (the stand-in). The hedge and trees match.
- **2 000 m** (a dry-stone wall on the right): the wall's photographic stone matches; the road is
  lighter under `WebGPURenderer`.
- **`traa-*`**: the WebGPU picture, softer. The bare tree's thin branches are thinner and paler
  against the sky and lose their stair-steps; the fence and the road's edge are unchanged. With the
  clock stopped it shows the filter and not its behaviour in motion.
- **`ao-*`** (half resolution): the WebGPU picture with little a rider would call an improvement at
  this camera, and ⚠️ **two artefacts**: blocks of short dark vertical bars across the far
  hillsides, and a faint cross-hatch on the grass. `aofull-*` (full resolution) has no bars; it
  darkens the far hillside in a band behind the trees and keeps the faint cross-hatch. Neither was
  tuned.
- **`wind-*`**: the WebGPU picture. With the clock stopped the wave is at its start, so at 1 600 and
  2 000 m the file is byte-identical to `webgpu-*`; it is here to show nothing breaks.

| File | SHA-256 |
|---|---|
| `control-at2550.png`, `classic-at2550.png` | `dd3def4e0fb642783f6da12959e8ab1ec0fd6307967e7dd2c7ae3e274cc7a0fb` |
| `control-at1600.png`, `classic-at1600.png` | `7a337cbc85da587a1af7855304cc622505fbe84a1c5acb4df9c4dc806945b818` |
| `control-at2000.png`, `classic-at2000.png` | `8898b5b1f331b8db2338c0f8db980fb2fa9be89544b9732f45f7d45993d86a27` |
| `webgpu-at2550.png` | `73a14ed9b7d1934fc9ea39d176e8b2f50d796a08a67723125601bf59e9fb4d4d` |
| `webgpu-at1600.png`, `wind-at1600.png` | `0eab709f6c0f8caa00c6e5899bb2e5e00029ac986e669ce91794184d6ae327d4` |
| `webgpu-at2000.png`, `wind-at2000.png` | `236888ebe16b3f30fe9bd52203b78762846293ffd3ca999ba3826c9089e704f9` |
| `webgl2-at2550.png` | `7397a3e63c9b51929802ef4f0d066dbc18fb98f6421ca1350b2f2c8070d04d54` |
| `webgl2-at1600.png` | `a8fa2b4087ad6c72612e20bcb916e56f667b49d854f09f4beb975f15e9db8f4e` |
| `webgl2-at2000.png` | `2204a3520492f3897e3e60cd1f6741794b79e097c6cf188f481092025d8420db` |
| `traa-at2550.png` | `53024b1271c2be91d21e0afa8b83c5d47d3b9213d0025099c01b26e75dac443d` |
| `traa-at1600.png` | `5e520a65f143e34a17b235c249f359fcf9e1d762d2cce515035acf3e7db03482` |
| `traa-at2000.png` | `16a2240447eda86d4d0b36fa2992b9ef448b83d9ad81d4fe486e3158a5642657` |
| `ao-at2550.png` | `303f6a77e0a3a34d7cb33315c8144aaa2c35f67588f2303cbbc41cbd580762f2` |
| `ao-at1600.png` | `1b855932c8f54c9accb901a1e97225ce5ab6fb19bc55bddcc04cd6da27e68600` |
| `ao-at2000.png` | `1d11dcec64cd60d45701c89bacd475ba92ae85ee33e1d71ca740e15306fdacb0` |
| `aofull-at2550.png` | `789476542a306dd5f23636e4aacaacb901645dc543a94259e227fd01da3e7e22` |
| `aofull-at1600.png` | `6d03f6fd3c605b763cdc6f8b2eb53166a609c3863424c645db8b9139330b8eb6` |
| `aofull-at2000.png` | `b9bda06c9d64402362f9804010139beb66926fe003eea4782a8e4ea7bc47dfee` |
| `wind-at2550.png` | `e11939dac8210dfe0b071d93194ddd84fe3178f6077fe2a29a84ad5a2076c963` |
| `tablet/tablet-webglrenderer-at2550.png` | `beb2fb80551ce8939e0adee6259f202f3c37527bde285afc98eea5bbae2dd49a` |
| `tablet/tablet-webgpu-at2550.png` | `b5ee0693734117e98c03f68ee98bd97283b5572e479644dc754ce33a99c05381` |
| `tablet/tablet-webgl2-at2550.png` | `d0f6ee0c657fd332c4199dd3bf96f83222c034e90415d425771d25ca50f5578f` |
| `tablet/tablet-traa-at2550.png` | `3b3b916b5ea3d8afc92084e8d13026c60dcdc295ab4c70e2864618ac61badf97` |
| `tablet/tablet-ao-at2550.png` | `02406a979f3c182fee4c31bd14798643d78a32997bbb154701feffe25fafd1e8` |
| `tablet/tablet-aofull-at2550.png` | `0601a1190867f77530128b7c97946b04bf0972cf0c4edd993f3508c3b59c4e88` |
| `tablet/tablet-wind-at2550.png` | `c6f81c7a86e7c4b2ebf6fc33ab6ead5ad234466b6dc0e1bb3f8001c018000af4` |

The tablet's seven show the same things as the Mac's at 2 550 m, the half-resolution bars included.

## The kill criterion, measured

| # | Verdict | The measurement |
|---|---|---|
| W1 | **Not tripped** | In the shell on WebView 154.0.8037.106: `navigator.gpu` present, an `arm` / `valhall` adapter, `isFallbackAdapter` `false`, `requestDevice()` resolved, and `WebGPURenderer` drew on its WebGPU backend in every run (§1) |
| W2 | **Not tripped** | All six classes drawn by the WebGPU backend from the committed files with `three@0.185.1` unpatched, the rider posed as the product poses it (§2). Seven shader patches and two `ShaderMaterial`s were left out and each loss is listed; the water, which is not one of the six, is a stand-in |
| W3 | **TRIPPED** | (a) GPU DVFS mean **1.3 % lower** (785.2 against 795.3 MHz), against the 15 % asked. (b) Thermal status 0 for both, so no lower maximum. On the planned pair the skin ended **1.4 °C warmer** (34.00 against 32.59), but those starts were 0.25 °C apart by the cool-down reading and **0.58 °C apart by the sampler's first**, outside the 0.5 °C the clause requires: by rules 1 and 2 the temperature half of (b) is **unmeasured on the planned pair**. It is measured on the repeat baseline, which is not the planned pair: `T20b` and `G20` started 0.01 °C apart by the cool-down reading and 0.33 °C by the sampler's first, both inside 0.5 °C, and there WebGPU ended **0.63 °C warmer** (34.00 against 33.37), where the clause needs 2 °C cooler. (c) CPU **1.0 point of a core higher** (175.2 against 174.2), against the 25 lower asked. (a) and (c) are measured on the planned pair and neither is met; (b) is not met where it is measured. Against the repeat baseline (a) and (c) read the same way: 1.4 % lower, 7.9 points higher. W6 holds, so the pair is valid |
| W4 | **Tripped on one clause as a rider would feel it; not by the page's own mark** | Present intervals over 20 ms: 0.314 % against 0.236 %, **+0.08 of a point** (line: 0.5). Thermal status: 0 and 0. Frame gaps over 100 ms after the warm-up: **2 and 2** (the repeat baseline had 0, so this clause rests on two events). **Start-up**: the condition names the quantity (time to the first realistic frame from the page's `performance.timeOrigin`) and no instrument. By the page's first-frame mark, the instrument the harness had, WebGPU is 193 ms **earlier** (2 094 against 2 287 ms) and the clause holds; by first contentful paint it is **1 480 ms later** (3 796 against 2 316 ms), over the 1 s line. The mark is shown not to measure what the clause names under WebGPU (§4), so this file reads the clause as tripped and says so plainly rather than taking the pass. ⚠️ First contentful paint was not checked against the screen itself (§"What was not measured") |
| W5 | **Not tripped** | The WebGL 2 backend over 20 minutes: GPU DVFS mean 2.1 % **lower** (778.4; line: 10 % higher); present intervals over 20 ms 0.464 % against 0.236 %, **+0.23 of a point** (line: 0.5; +0.26 against the repeat); all six classes drawn on the tablet. ⚠️ Not in the condition: it had seven frame gaps over 100 ms to the control's two, one of 499 ms, and its first picture is 0.7 s later |
| W6 | **Holds** | 198 994 triangles a frame against 196 050: **101.5 %**, inside 90 to 110 % (the Mac: 101.0 %). Where the 1.5 % comes from was not traced |
| W7 | **Not tripped** | Textures held: **91.6 MiB** (line: 160). `Graphics` half-way: 386.1 against 358.9 MiB, **+7.6 %** (line: 25 %). JavaScript: **+105.2 KiB** gzipped (line: 250). ⚠️ Not in the condition: the app process's total memory is 186 MiB (36 %) larger |

**One condition trips on a measurement (W3), and a second (W4) trips on the reading this file takes
of it. By rule 2 the result is not a go-signal.** No condition is unmeasured.

## What a real move would cost

Counted from `apps/web/src/game/three-renderer.ts` at `ed1fd9f4` (13 278 lines by `wc -l`; `count-move.txt` says 13 279 because it counts the empty string after the last newline) by
`spike-0024/scripts/count-move.py`; the full list with line numbers is `results/count-move.txt`.

| What | Count |
|---|---|
| Material construction sites (`new …Material(`) | **37**: 16 `MeshStandardMaterial`, 12 `MeshBasicMaterial`, 4 `MeshLambertMaterial`, 4 `ShaderMaterial`, 1 `ShadowMaterial` |
| `ShaderMaterial`s, whose GLSL is not compiled at all | **4**: `RiderSilhouetteBelt`, `WaterBelt`, `reflectingWaterMaterial`, `impostorMaterial` |
| `onBeforeCompile` patches, which a node material ignores | **14**, holding **482 lines**: `photographicRoadMaterial` 72, `photographicGroundMaterial` 55, `withMaterialLayers` 54, `withAtmosphere` 39, `withInstanceChannels` 38, `bannerMaterial` 37, `withFoliageSwayOf` 32, `withGroundBlobShading` 31, `withSurfaceDetail` 31, `logoMaterial` 31, `riderBodyMaterial` 25, `withKitPerInstance` 20, `withTextureLodBias` 11, `stoneBridgeMaterial` 6 |
| GLSL template literals those patches and materials splice in | **34**, **548 lines** |
| Lines naming a three shader chunk to anchor a splice (`#include <…>`) | 108 |
| `customProgramCacheKey` lines (no meaning to a node material) | 19 |
| `ShaderChunk` / `UniformsLib` / `UniformsUtils` lines (not in `three/webgpu`) | 7 / 4 / 4 |
| Calls only `WebGLRenderer` has | `new WebGLRenderer` (1), `capabilities.getMaxAnisotropy` (1), `compile` (1), `getContext` (2), `info.programs` (1), `forceContextLoss` (1), the `KTX2Loader.detectSupport` cast (1), and `programsLinked` and `gpuFinished`, which wait on a WebGL context (10 `gl.` lines) |
| The materials that carry no patch | A plain `MeshStandard`, `MeshBasic`, `MeshLambert` or `Shadow` material becomes a node material by class name alone: the spike's shim did that in four lines, and class 5 drew with no port |

What the spike wrote to get **half** of that drawn in **one** of the two worlds: 812 lines of TSL
for seven patches and two `ShaderMaterial`s, and 135 lines of hooks. A move rewrites all 14 and all
4, for both worlds, at parity, and the three things below as well.

**Things a count of lines does not show**, each met while building the harness:

- **`GameRenderer.create` is synchronous and `WebGPURenderer` is not.** It cannot draw, or build the
  sky's PMREM, before `await renderer.init()`. `port.ts` §`GameRenderer.create` returns a view at
  once and the view builds its world in its constructor. Either the port changes, or the first
  frames are held somewhere new.
- **`prepare` (#547's shader warm-up) is written against a WebGL context** (`compile`, then
  `KHR_parallel_shader_compile` and a fence). The harness never called it. §4's 1.5 s is what a
  first frame costs without one.
- **`WebGPURenderer` starts a `requestAnimationFrame` loop of its own at `init()`**, beside the
  product's `FramePacer`.
- **Attribute types are checked.** A `Uint32Array` attribute read as a `float` drew wrongly on the
  WebGPU backend and vanished on the WebGL 2 one until the data itself was changed.
- **The spike found no node in three 0.185.1 that hands a material its instance matrix**, which the
  impostors, the ground blobs' clip lines and the sway's phase all want. It built its own and
  uploads the matrices twice.
- **Context loss**: the product calls `forceContextLoss` before `dispose` (a browser's limit on
  WebGL contexts). The harness stubbed it. What a lost WebGPU device does to a ride, and what a
  second ride in a session needs, were not looked at.

**The tests.** Six test files read a patch's or a material's GLSL and assert on it, in 74 lines
naming a vertex or fragment shader, 34 of them `expect(` lines (counted over every `*.test.ts`,
`*.test.tsx` and `*.spec.ts` under `apps/` and `packages/` at `ed1fd9f4`):
`realistic-renderer.test.ts` (39 lines, 17 of them `expect(`), `terrain-belt.test.ts` (14, 7),
`ground-blend.test.ts` (10, 5), `three-renderer.test.ts` (6, 3), `road-wear.test.ts` (4, 2),
`realistic-water.test.ts` (1, 0). They would be rewritten against nodes. ⚠️ The largest was missed
by this file's first count and found in review: `realistic-renderer.test.ts` holds a NUL byte, so
`grep` took it for a binary file and reported no match. The count now reads each file as text. `three-seam.test.ts` allows `three` in one file: `three/webgpu`
and `three/tsl` match its pattern only **inside** `three-renderer.ts`, and on the code branch, where
the ports are a second file, **four of its six cases fail** (run: `pnpm exec vitest run
src/game/three-seam.test.ts`, "4 failed | 2 passed").

**The browser gate.** Run as `spike-0024/scripts/gate-probe.mjs`, in the pinned Playwright Chromium
(153.0.8010.12, headless) with `playwright.config.ts`'s three SwiftShader flags:

- `navigator.gpu` is there and **`requestAdapter()` resolves `null`**. `WebGPURenderer` asked for
  WebGPU then draws with **its WebGL 2 backend and says nothing**. As configured, the gate would
  exercise the fallback and never the WebGPU backend, and would stay green.
- With `--enable-unsafe-webgpu` added it gets a SwiftShader adapter (`isFallbackAdapter` `true`) and
  the WebGPU backend runs. The picture it drew was not inspected.
- The gate's instruments are WebGL's. `browser/game-harness.ts` names `WebGL2RenderingContext` 52
  times, `getContext('webgl…')` 28 and `readPixels` 11 (a WebGPU canvas has no `readPixels`);
  `browser/realistic/draws.ts` counts triangles by wrapping the WebGL context's draw calls;
  `browser/harness.ts`, `loop-harness.ts` and `bend-harness.ts` read pixels the same way;
  `browser/realistic/layers.ts` names `ShaderMaterial` five times. On the WebGL 2 backend the
  context-based ones keep working, because the canvas still has a WebGL 2 context. On the WebGPU
  backend each needs a replacement.

**The wiring gate.** No rule in `scripts/check-wiring.mjs` names a renderer, and a move inside
`three-renderer.ts` changes no export. It bites only if the TSL moves to a new module under
`src/game/`, which is watched (`WIRE001`, `WIRE002`), or a new export there has no production
reader.

**Not a cost**: no dependency changes (`three/webgpu` and `three/tsl` are in the installed package),
so the licence gates do not move.

## What this answers, and what it does not decide

- **#680**: the shell's WebView on this tablet exposes WebGPU with a real adapter, on WebView 154.
- **The renderer's API is not what limits this scene on this tablet.** A reading, not a
  measurement: thirty draw calls a frame leave little driver overhead for a new API to remove, and
  the GPU's work is the same fragments either way. This run gives no sign that the graphics API is
  where spike 0015's 30 % for Godot came from.
- **A move would be bought for features, not speed**, and of the three features tried only compute
  fits this tablet's budget. Temporal anti-aliasing and ambient occlusion each cost more than the
  whole margin the realistic world has.
- **It does not decide**: adopting WebGPU, any change to ADR 0026 D-2, or whether a later three
  release, a different scene (many more draw calls, or instancing that compute could cull), or a
  different device would read differently.

## What was not measured, and why

- **iOS**, entirely, and any device but this one tablet. It never left thermal status 0.
- **Power**: no rail is readable without root.
- **The stylised world** under `WebGPURenderer`: none of its shaders was ported.
- **Parity.** Seven patches and the water were left out. What the missing air and water would cost
  the WebGPU frame once ported was not measured; each adds fragment work, so the 1.3 % is, if
  anything, flattering.
- **What the 1.5 s before the first picture is made of**, and whether three's `compileAsync` or a
  warm-up frame removes it.
- **First contentful paint against the screen itself.** That it is when the world appears was not
  checked with a present that has content in it (SurfaceFlinger's first frame, or a screen
  recording), so nothing here rules out the WebView reporting a WebGPU canvas's paint late, or on a
  cleared frame. The evidence is indirect: on the tablet the paint follows the page's mark by 14 to
  44 ms in all ten starts of `WebGLRenderer` and the WebGL 2 backend (medians 29 and 27 ms) and by
  1 665 to 1 705 ms in all five of the WebGPU backend; on the Mac it follows by 15 to 48 ms in all
  twenty starts (medians 19, 15, 46 and 21 ms for the control, `classic`, the WebGPU backend and
  the WebGL 2 backend).
- **Why the WebGPU runs end warmer**, and what the 186 MiB of extra process memory is.
- **Chrome on the same tablet** (#680's second row), and the WebGPU backend in **compatibility
  mode**.
- **Compute at a size that matters** (culling, or skinning many riders), and the compute wind on the
  tablet's WebGL 2 backend.
- **A lost device**, a second ride in one session, and the product's `prepare` warm-up.
- **Graphics memory on the Mac**, and the textures `WebGLRenderer` holds as a byte count.
- **A live BLE connection** during the runs; nobody rode, and nothing was sent to a trainer.
- **A release build**, and any three release but 0.185.1.

## The tablet, as it was left

The owner's app (`dev.openzigs.onyourleft`) was never installed over, stopped, cleared or opened
during the measurements. Its `lastUpdateTime` is unchanged (2026-10-04 19:00:02), and **no file in
its data directory changed between the first install of the spike app and the end of the last run**
(`find -newermt`, through `run-as`). It was then launched once, as the last step, and came up on its
Home screen; that launch rewrote its WebView code cache and its databases' logs, as any launch does.

Installed and **left installed**: the spike's own app, *OYL spike 0024*
(`dev.openzigs.onyourleft.webgpuspike`, a debug build, 117 MB). It can be removed from the launcher,
or with `adb uninstall dev.openzigs.onyourleft.webgpuspike`; that command names the spike's package
and not the app's, and it was not run here. Put back: `stay_on_while_plugged_in` (set to 7 for the
runs, back to 2), `user_rotation` (found at 1, read 0 afterwards, set back to 1), the sampler script
and its output under `/data/local/tmp`, and the adb forward on port 9224.

## Reproduce

On `spike/issue-1273-webgpu-code` at `2f8ea2a1`, with a second checkout of `main` for the control:

```bash
export OYL_MAIN=<a checkout of main> OYL_SCRATCH=<a directory outside the repository>
export OYL_SHOTS=~/Development/oyl-spike-0024-screenshots
spike-0024/scripts/serve.sh spike-0024/scripts/mac.sh      # the Mac set; opens Chrome windows
python3 -I spike-0024/scripts/mac-table.py spike-0024/results/mac
spike-0024/scripts/tablet/build.sh                         # the spike APK, its own application id
adb install spike-0024/apk/webgpuspike.apk                 # beside the app, never over it
spike-0024/scripts/tablet/chain.sh                         # about three hours
spike-0024/scripts/tablet/chain2.sh                        # the repeat baseline
```

**It is not merged and must not be.**
