# Spike 0014 — Godot beneath the Capacitor WebView, measured on the Pixel Tablet

- **Date**: 2026-09-26
- **Issue**: [#433](https://github.com/openzigs/onyourleft/issues/433). It feeds the decision in
  [#434](https://github.com/openzigs/onyourleft/issues/434) and does not make it.
- **Status of this file**: ⚠️ **the kill criterion below was committed and pushed before anything
  was measured**, as #433's second acceptance criterion asks, so that the result cannot be
  rationalised. It was committed at 14:19 EDT (first pushed as `333e81f`, under the number 0013), and
  the first Godot frame on the tablet was at 14:32. Its text below is unchanged from that commit:
  only the spike's number moved, to 0014, because #591 took 0013 first (`SPIKE001`, `CLAUDE.md` §7).
- **The short answer**: **Godot 4.7.1 does render the world in a native view beneath a transparent
  Capacitor WebView, driven from TypeScript, with the DOM HUD on top and still receiving touches**,
  built from released parts with no engine patch. **On this scene it is not measurably better than
  three.js, by the criterion set in advance.** Both hold 60 Hz with the same present-interval
  percentiles, the GPU sits near its idle clock under both, and neither heats the tablet. The one
  clear difference, about 0.57 of a core less CPU, is structural rather than the engine's. **Four of
  the eight pre-registered kill conditions trip as written: K3, K4, K6 and K8.** Two of those
  (K3 and K6) are properties of this spike's build choices, and the tables below say which change
  would move them. Nothing on iOS was reached.

A spike is a dated measurement that decides nothing (`CLAUDE.md` §7).

## The kill criterion, stated before measuring

The hybrid is **not worth pursuing** — a no-go for #434 — if **any one** of these is true of the
measurement this spike makes. Each is written against a number or a breakage that can be observed,
and the threshold is set now, before either renderer has been run.

| # | Kill condition | Why this line |
|---|---|---|
| K1 | **It cannot be built from released parts.** No Godot view renders under a transparent Capacitor WebView, with the DOM drawn on top, on Android, from a **pinned stable Godot release's published Android library**, without patching the engine's source. Calls that are public but undocumented are recorded, not fatal; a patched engine is fatal | A fork of the engine is a second product to maintain, which is what godot-proposals #14435 warns the embedding path turns into |
| K2 | **The DOM HUD loses its input or its accessibility.** A tap on a DOM control over the Godot view does not reach the control, or the WebView's DOM nodes are absent from the accessibility tree while Godot is drawing beneath it | #392's whole reason for a DOM HUD, and §4e's gate, both rest on it |
| K3 | **The bridge cannot carry the simulation's steps.** At the simulation's 20 Hz, over at least ten minutes: the step's latency from TypeScript to the Godot side has **p95 > 50 ms**, or **more than 1 % of steps** arrive more than one step interval (50 ms) late or not at all | #323 draws between the last two steps; a step later than one interval means the native side is extrapolating, and a rider sees a hitch the design exists to prevent |
| K4 | **It is not measurably better.** On the same tablet, the same route, the same scenery placement and the same resolution, Godot does **none** of: (a) a GPU time per frame at p50 **at least 25 % lower** than three.js's; (b) a **lower thermal status, or ≥ 2 °C cooler skin**, at the end of a sustained run of equal length; (c) holding the display rate (frame p90 ≤ 17.5 ms) with **real-time shadows on**, where three.js's shadow configuration on the same scene does not | #433: *"A renderer that is not measurably better is not worth a second implementation."* Three.js already holds 60 Hz at its top rung on this tablet (validation 0002 Part Z), so "better" has to show in cost or in headroom, not in a p50 both sit on |
| K5 | **It is worse where a rider feels it.** Over a sustained run, the Godot variant's share of present intervals over 20 ms is **higher** than three.js's on the same scene, or it reaches a higher thermal status than three.js does | A faster renderer that stutters or runs hotter is not better |
| K6 | **The cost is out of proportion.** The arm64 APK grows by **more than 60 MiB**, or the process's total PSS while riding exceeds three.js's by **more than 400 MiB**, or a cold start to the first drawn Godot frame takes **more than 3 s longer** than the WebView's first paint | ADR 0008 D-4's floor is a 3 GB phone; the APK is sideloaded and downloaded by riders |
| K7 | **A patch release breaks it.** Moving the pinned version to the **next patch release** (only the dependency version changed) fails to build, fails to render, or needs a code change in the embedding | Minor-version breakage is expected (#14435); a patch release that breaks it makes any upgrade policy untenable |
| K8 | **A licence in the shipped library is not admissible.** Any component of the Godot Android library that ships in the APK carries a licence ADR 0015's *distributed, `apps/`* column does not admit, or a copyleft one `DEP002` forbids | ADR 0025 D-5 |

**What does not kill it, said now so it cannot be argued later**: iOS not being reached (#433 says
it may not be, and ADR 0018 D-4 applies); a renderer that draws a *different-looking* scene, as long
as the placement is the same; and undocumented-but-public calls, which are recorded for #434's
version-pin question rather than counted as a failure.

**A result is only a go-signal if it passes K1–K8 on measurements, not on reasoning.** Any criterion
that this environment cannot measure is reported as **unmeasured**, and an unmeasured criterion is
not a pass.

## What was built, and which route it is

**Godot 4.7.1 as an Android library, in a native view beneath the Capacitor WebView.** It is not
LibGodot's C API. #433 names LibGodot, but on Android the documented and published embedding route is
the **Godot Android library**: `org.godotengine:godot:4.7.1.stable` on Maven Central, the AAR the
release page also publishes (SHA-512 checked against `SHA512-SUMS.txt`). Its `GodotFragment` hosts the
engine in any `FragmentActivity`, and Capacitor's `BridgeActivity` is one. The route is taken from the
engine's own sample (`m4gr3d/Godot-Android-Samples`, `apps/gltf_viewer`, MIT). LibGodot's host-surface
patches (#14435) were not needed and were not tried. **iOS was not reached**, so ADR 0018 D-4's rule
applies: nothing here says the hybrid works on iOS.

```
┌──────────────────────── MainActivity (Capacitor BridgeActivity, implements GodotHost) ──┐
│  WebView, background TRANSPARENT ── godot.html: the DOM HUD, the tap test, and the     │
│  │                                  product's own TypeScript (rideFrame, cameraRig)     │
│  │  Capacitor plugin "GodotWorld" ── step() 20 Hz, world() every 25 m (base64 in JSON) │
│  ▼                                                                                      │
│  WorldBridgePlugin (GodotPlugin) ── a lock and three queues; GDScript polls once a frame │
│  FrameLayout at index 0, BENEATH the WebView ── GodotFragment ── SurfaceView (Vulkan)   │
│                                                   world.gd: meshes from TS arrays,       │
│                                                   interpolation, and the measurements   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**What had to be done, every step of it** (#433 measurement 1: *"record every undocumented call"*):

1. `app/build.gradle`: the Maven dependency; a second `assets` source directory holding the Godot
   project (headless-imported, so `.godot/imported` travels with it); and an `ignoreAssetsPattern`
   without the leading `.*`, because Capacitor's pattern drops the hidden `.godot/` directory and
   Godot then cannot load an imported resource.
2. `AndroidManifest.xml`: `tools:replace="android:resource"` on our `FileProvider`'s `<meta-data>`.
   The library declares a `FileProvider` with the same authority (`${applicationId}.fileprovider`)
   and its own paths file, so the merge **fails** without it. Keeping ours drops Godot's
   `godot_provider_paths`, which only Godot's own file-sharing uses.
3. `MainActivity implements GodotHost`: `getActivity`, `getGodot`, `getHostPlugins` and
   `getCommandLine`, all **public** API in `org.godotengine.godot`. On the page's request it adds a
   `FrameLayout` at index 0 of the WebView's parent, commits a `GodotFragment` into it, and sets the
   WebView's background to `Color.TRANSPARENT`.
4. **Two more lines are needed for accessibility** (Results §2): `setImportantForAccessibility(NO_HIDE_DESCENDANTS)`
   and `setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS)` on that container.
5. GDScript reaches Java through `Engine.get_singleton("WorldBridge")` and `@UsedByGodot` methods,
   also public API. `PackedByteArray.to_vector3_array()` / `to_color_array()` / `to_int32_array()`
   turn the bridge's bytes into mesh arrays with no per-vertex loop.

**No undocumented call was needed, and no engine source was patched.** The one surprise with a
cost was **winding**: three.js's front faces are anticlockwise and Godot's are clockwise. So the
indices are reversed in TypeScript before they cross, and the unlit road and the water are drawn with
culling off. Until then the road was culled, and the sky showed through it, unnoticed until a
screenshot was compared with three.js's.

**What crosses the bridge** (#434's question 3): TypeScript runs the product's own `rideFrame` (the
function `realistic-harness.ts` renders through three.js) once per 50 ms simulation step. Each
**step** carries `cameraRig`'s eye and target and the riders' markers, stamped with
`performance.timeOrigin + performance.now()`. Every 25 m of riding, a **window** carries that frame's
road, ground and water arrays and every scenery placement: about 257 KB of binary as about 374 KB of
JSON. Godot renders at *now − delay*, interpolating between the two steps whose sent times bracket
it. Sender and receiver share one device clock, so the latency is a subtraction, not an estimate.
**Placement stays single-sourced** (#434's question 4): Godot decides nothing about where anything
is. It turns arrays into meshes, and places the same Kenney CC0 `.glb` files the stylised world uses
at the positions `scatter.ts` and `settlements.ts` computed.

**What the Godot scene is NOT**, so the comparison is read at the right strength: the road, ground,
water and scatter/structure *placements* are the product's own, byte for byte. The *drawing* is
not: no sky dome or horizon relief, no road detail shader or water shader, the five
buildings-from-numbers kinds (`buildings.ts`) are single boxes of their `STRUCTURE_FOOTPRINTS`, and
the riders are a capsule on a bar rather than `bicycle.ts`'s bicycle. It is somewhat lighter than
the stylised three.js world in shading (38 000 primitives and 18–20 draw calls in Godot's own
counters, against three.js's 21 draw calls), and roughly the same in geometry. Screenshots of both, at
2 640 m (Godot) and 2 760 m (three.js) on the same route, are on the spike branch.

## Versions and device

| | |
|---|---|
| Device | Pixel Tablet (Tensor G2 / GS201, Mali-G710), Android 17 build `CP2A.260705.006`, 2560 × 1600 at 60 Hz, landscape, on charge, brightness unchanged |
| WebView | 153.0.8010.36 |
| Godot | **4.7.1-stable** (`a13da4feb`), `org.godotengine:godot:4.7.1.stable`; the patch bump is **4.7.2-stable** |
| Godot renderer | Forward Mobile on **Vulkan 1.4.343** (the default); GL Compatibility also run (§4) |
| three.js | 0.185.1, the product's `three-renderer.ts` on `main` at `47a8e99`, via `realistic.html` |
| Capacitor | 8.5.2; AGP 8.13.0; JDK 21 (Temurin); Node 24.20.0 |
| Spike APK | `applicationId dev.openzigs.onyourleft.godotspike`, debug build, `loggingBehavior: 'none'` (a debug build otherwise logs every plugin call's whole payload, megabytes of base64) |

Both renderers ran **from the same APK**. The three.js baseline is `realistic.html?world=stylised&ladder=0`,
the page validation 0002 Part Z uses, which renders the product's renderer at the stylised top rung.
The Godot path is `godot.html`. The same route, `realistic/route.ts`, is ridden from 2 550 m at 9 m/s
by both. Both draw at **2560 × 1600**: three.js's drawing buffer, read from the page, is `[2560, 1600]`
at DPR 2, and Godot's viewport is the same. The owner's installed app and its data were not touched. The spike APK
was uninstalled afterwards, and the tablet's rotation, stay-awake and accessibility settings were put
back as they were found.

## Method

Each run cold-starts the app, navigates the WebView over DevTools, waits 20 s, then samples for the
stated time. Before every run the tablet sat on the launcher until its skin sensor read ≤ 26 °C. What
is sampled, and why the engines' own numbers are not the headline:

- **Present intervals from SurfaceFlinger**: `dumpsys SurfaceFlinger --latency <layer>` every 0.5 s,
  de-duplicated on the actual-present timestamp. The layer is the WebView's window (`VRI-…`) for
  three.js and the Godot `SurfaceView` for Godot. **This is the one frame-time measure that is the
  same instrument for both engines.** `--timestats` would have been better and is disabled on this
  build (`totalFrames = 0`). Sampling holes of ≥ 250 ms (5–28 a run, during the thermal dumps) are
  excluded from the percentiles and counted.
- **GPU load by DVFS**: `/sys/class/misc/mali0/device/cur_freq` once a second. `utilization` and
  `time_in_state` are permission-denied to the shell user, and no power rail is readable.
- **Thermal**: `dumpsys thermalservice`'s *current* HAL values every 30 s. ⚠️ The dump lists a stale
  *Cached temperatures* block first, and the first version of the parser read G3D from it (a
  constant 46 °C). The figures here are from the current block.
- **CPU**: `top` per 30 s, for the app process and the WebView's sandboxed renderer. ⚠️ The first
  runs sorted `top` by name and missed the renderer, so three.js's stylised CPU is from a separate
  5-minute run.
- **Memory**: `dumpsys meminfo` at the run's half-way point.
- **The engines' own numbers**: Godot's `viewport_get_measured_render_time_gpu/cpu`, draw calls and
  primitives; three.js's page rAF percentiles and draw calls; `gfxinfo`. ⚠️ **GPU time is not
  comparable across the two**, and K4(a) is written against a comparison this environment cannot
  make. Godot's is a GPU timestamp query on its own render. For the WebView, `gfxinfo`'s *GPU* column
  times HWUI's frame, which composites the page. It is not WebGL's draw cost, and the realistic page
  publishes no GPU time of its own for three.js.

## Results

### 1. Can it be built at all? — **yes, from released parts**

Built, installed and drawing on the first day, with the DOM HUD on top (screenshots in the spike
branch). The five steps in §"What was built" are the whole cost, and every call is
public API. Godot's engine initialisation, from the fragment's commit to `Godot Engine v4.7.1` in
logcat, takes about 0.13 s.

### 2. Touch and focus, and TalkBack

- **Touch: yes.** `adb shell input tap` on the DOM *Tap test* button over the Godot view: **3 of 3
  taps** reached the button's handler. The WebView is on top, so it sees every touch first.
- **Accessibility: the DOM is exposed, and Godot adds two nodes that must be hidden.** uiautomator
  sees no WebView content without an accessibility service, and that is equally true with no Godot
  at all, so TalkBack was enabled for the check and disabled afterwards. With TalkBack on, the tree
  (`uiautomator dump --compressed`) holds every HUD node (four panels, their labels and values, the
  button). Out of the box it **also** holds Godot's `SurfaceView`, which **has input focus**, and an
  unlabelled, clickable `EditText` (Godot's hidden keyboard field, reported `NAF`). With the two
  container lines in §"What was built", the tree of important nodes is **exactly the DOM**, and focus
  is the WebView's.
- **Not done**: a person navigating the HUD with TalkBack by ear. Validation 0003 is where that
  lives.

### 3. The bridge

20 Hz steps through `Capacitor.nativePromise` (not awaited), polled by GDScript once a frame. From
the 20-minute run (24 023 steps, **0 lost** by sequence number):

| | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| TS → Java (Capacitor bridge) | 2.5 ms | 4.8 ms | 33.2 ms | 77.5 ms |
| TS → Godot frame that reads it | 11.7 ms | 19.8 ms | 51.5 ms | 97.7 ms |
| Interval between arrivals at Java | 50.0 ms | 61.0 ms | 89.0 ms | 138 ms |

(p50–p99 are the median, over forty 30-second windows, of each window's percentile. *Max* is the
median window's max. The worst single step of the run was 131 ms TS → Java.)

What that does to the picture:

| Render delay | Frames with no newer step (motion held) | Run |
|---|--:|---|
| 50 ms (one step) | **5.5 %** | 20 min |
| 100 ms (two steps) | **0.3 %** | 5 min |

- **The p99 tail is the page's own work, not the bridge's transport**: see §3a.
- Serialising a geometry window costs the WebView's main thread **40–45 ms at p50** (up to 65 ms)
  every 25 m, about every 2.8 s. That is base64 over JSON: `btoa` over 257 KB. Java decodes it in
  about 11 ms and Godot builds the meshes in 8.5 ms p50 (16.5 ms p99) on its render thread. **That
  build is one missed vsync every 2.8 s**, visible in Godot's own frame p99 of 19.5 ms and not in
  SurfaceFlinger's p99, because it is under 1 % of frames.
- Building the frame for each step (`rideFrame`, the whole `SceneFrame`) costs 6.0 / 13.0 / 17.0 ms
  (p50 / p90 / p99) of WebView main thread, twenty times a second.

### 3a. Is the tail the bridge, or the page?

**Mostly the page: specifically, the geometry window, and it goes away when that is moved.** The same
5-minute run twice, differing only in how often a geometry window is sent:

| Geometry window every | TS → Java p99 / max | TS → Godot p95 / p99 | Steps later than 50 ms at Godot / at Java | Arrival gap p99 | Frames held at 50 ms delay |
|---|---|---|---|--:|--:|
| **25 m, as built** (about every 2.8 s) | 35.3 / 81.3 ms | 19.6 / 49.3 ms | **1.76 %** / 0.50 % | 90 ms | 5.39 % |
| 250 m (about every 28 s) | **5.7** / 38.5 ms | 19.1 / **21.2** ms | **0.88 %** / 0.12 % | 64 ms | 4.08 % |

- **Capacitor's bridge itself is fast and lossless**: with the geometry out of the way, TS → Java is
  2.4 / 4.4 / 5.7 ms at p50 / p95 / p99.
- **What remains over 50 ms (0.88 %)** is the wait for Godot's next frame (it polls once a frame)
  on top of the WebView's own rAF cadence, which is when the page emits steps.
- **Frames held at a 50 ms render delay do not fall with the window rate (5.4 % → 4.1 %), and that
  is arithmetic, not jitter.** A step is 50 ms after the last one and takes about 12 ms to reach Godot,
  so the newest step is up to about 62 ms old. One step of delay cannot cover that. Two steps can:
  **0.3 % held at 100 ms**. #323's in-browser design draws between the last two steps, which is the
  same trade, so a native side needs to render **about 60–100 ms behind** the simulation, not 50.

### 4. Frame timing against three.js, same route, same resolution

| Run (all 2560 × 1600, display 60 Hz) | Length | fps (SurfaceFlinger) | Present p50 / p90 / p99 | > 20 ms | > 50 ms | Engine's own frame p50 / p90 / p99 | Engine's own GPU p50 / p90 / p99 |
|---|---|--:|---|--:|--:|---|---|
| **three.js, stylised top rung** | 20 min | 59.45 | 16.63 / 16.66 / 16.79 | 0.34 % | 0.007 % | rAF 16.6 / 16.7 / 16.8 | gfxinfo "GPU" 11 / 15 / 22 (not the same measure) |
| **Godot, Mobile/Vulkan, no shadows** | 20 min | 59.57 | 16.63 / 16.67 / 16.76 | 0.11 % | 0.007 % | 16.64 / 17.49 / 19.54 | 8.43 / 9.72 / 10.79 |
| Godot, **real-time sun shadows + MSAA 2×** | 5 min | 59.58 | 16.63 / 16.68 / 16.81 | 0.21 % | 0.02 % | 16.65 / 17.48 / 19.7 | 9.44 / 11.01 / 12.32 |
| Godot, **real-time sun shadows** (whole scene within 120 m) | 5 min | 59.56 | 16.63 / 16.67 / 16.77 | 0.20 % | 0.011 % | 16.64 / 17.38 / 19.57 | 9.48 / 11.17 / 12.47 |
| three.js, stylised, **rider shadow map** (`RIDER_SHADOW_MAP_RUNG`, the riders only) | 5 min | 59.41 | 16.63 / 16.66 / 16.75 | 0.36 % | 0.011 % | rAF 16.6 / 16.7 / 16.7 | gfxinfo "GPU" 11 / 15 / 22 |
| Godot, GL Compatibility (OpenGL ES 3) | 5 min | 59.55 | 16.63 / 16.68 / 16.80 | 0.06 % | 0.02 % | 16.64 / 19.23 / 22.33 | not reported |
| three.js, **realistic** world (for scale) | 5 min | 59.59 | 16.63 / 16.66 / 16.74 | 0.09 % | 0.02 % | rAF 16.6 / 16.7 / 16.8 | gfxinfo "GPU" 10 / 19 / 23 |
| Godot **4.7.2** (patch bump) | 2 min | 59.49 | 16.63 / 16.67 / 16.76 | 0.15 % | — | 16.63 / 17.46 / 19.53 | 8.30 / 9.64 / 10.75 |

**Both renderers hold the display rate on this scene, shadows included, and neither is measurably
ahead on frame time.** Every present-interval percentile agrees to within 0.05 ms. The share of intervals over
20 ms is small for both (0.11 % against 0.34 %).

### 5. Thermals, GPU load and CPU over a sustained run

| Run | GPU DVFS mean (p50 / p90) | Skin °C start → end (max) | G3D °C mean | Thermal status max | CPU, app + renderer (% of a core) |
|---|---|---|--:|--:|---|
| three.js stylised, 20 min | 256 MHz (251 / 302) | 25.5 → 25.5 (25.9) | 34.4 | 0 | 81 + — (not captured) |
| three.js stylised, 5 min (CPU run) | 255 MHz (251 / 302) | 25.5 → 25.9 (26.2) | 35.0 | 0 | **74 + 65 = 139** |
| Godot Mobile, 20 min | 242 MHz (202 / 302) | 25.4 → 26.4 (26.5) | 35.9 | 0 | **53 + 29 = 82** |
| Godot sun shadows, 5 min | 276 MHz (251 / 351) | 26.2 → 26.6 (26.8) | 37.0 | 0 | 50 + 26 = 76 |
| three.js rider shadow map, 5 min | 314 MHz (302 / 351) | 26.0 → 26.4 (26.5) | 36.0 | 0 | 85 + 59 = 144 |
| Godot shadows + MSAA 2×, 5 min | 282 MHz (251 / 351) | 26.7 → 25.9 | 35.3 | 0 | 58 + — (not captured) |
| three.js realistic, 5 min | **695 MHz** (701 / 848) | 27.2 → 29.7 (30.0) | 53.1 | 0 | 86 + 71 = 157 |

- **Neither stylised run heated the tablet.** Thermal status stayed 0 throughout and skin moved by
  about 1 °C in twenty minutes. The Godot run ended **about 1 °C warmer** than the three.js run
  (26.4 against 25.5 °C, having read 1.3 °C cooler just before its run began) and its G3D sensor about 1.5 °C warmer. So on
  this scene Godot is **not cooler**. #247's question, what a *hot* device does, is not answered by
  either run: this scene never makes the tablet hot.
- **GPU load is at the bottom of the DVFS range for both** (the idle frequency is 202 MHz, and the
  realistic world drives it to 695). Godot's mean is 5 % lower, which is inside what the sampling can
  distinguish.
- **CPU is the one clear difference: about 0.57 of a core less with Godot.** ⚠️ It is structural
  rather than the engine being faster. The three.js path builds a whole `SceneFrame` at 60 Hz on the
  WebView's JS thread and hands it to WebGL, where the Godot path builds one at 20 Hz and the native
  side interpolates. A three.js renderer fed 20 Hz steps with interpolation would recover part of it.

### 6. APK size, cold start, memory

| | Measured |
|---|---|
| **APK delta, arm64 only, default packaging** | **+72.96 MB (69.6 MiB)**. `libgodot_android.so` is 71.1 MB stored uncompressed, because AGP stores native libraries uncompressed for API 23+ |
| APK delta, arm64 only, `useLegacyPackaging = true` | **+27.35 MB (26.1 MiB)**; the library deflates to 26.4 MB and is extracted to 71 MB on install |
| APK delta, all four ABIs (what the Maven dependency gives by default) | **+310.5 MB** |
| Cold start: page first contentful paint → Godot's first frame with the world in it | first paint 52–236 ms (median 148); Godot's first frame 946–1 283 ms (median 1 267) after the page's time origin; **about 1.1 s later**, n = 5 (4.7.2: 1 036 and 1 305 ms, n = 2) |
| Memory, app process PSS, half-way through | three.js stylised **280 MiB**; Godot Mobile **581 MiB (+301)**; Godot shadows + MSAA 2× **950 MiB (+670)**; Godot GL Compatibility 405 MiB (+125); three.js realistic 570 MiB. The WebView renderer is 18 MiB in every case |
| Godot's own video memory counter | 57.7 MiB (shadows + MSAA: 208 MiB) |

### 7. Version fragility — 4.7.1 → 4.7.2

Changing **only** the Maven version (`-PgodotVersion=4.7.2.stable`) built, installed, started and
rendered, with the project imported by the **4.7.1** editor left as it was. The frame, GPU and bridge
figures are within noise of 4.7.1 (table in §4), and cold start is unchanged. Logcat errors are
identical to 4.7.1's (two benign startup lines: no `project.binary`, and an unknown `xr/shaders`
setting). **A minor bump (4.8) was not tried.** 4.8 is at `dev6` on 2026-09-26, and #14435's warning
is about minor versions.

### 8. Licence inventory

Godot is **MIT** (Expat). The engine's own compiled-in copyright table (`Engine.get_copyright_info()`,
read from the 4.7.1 editor) names 101 third-party components. ⚠️ That table is embedded in the Android
library too, so a `strings` search finds every name in it and cannot show which components are
actually linked. The list below is the table's, which is what a credits screen would reproduce:

| Licence | Components (examples) | ADR 0015, distributed closure under `apps/` |
|---|---|---|
| Expat (MIT) | Godot itself, Jolt, ThorVG, meshoptimizer, volk, VMA, ENet, AccessKit, … (40) | permissive: admitted |
| BSD-3-Clause / BSD-2-Clause | Zstandard, WebP, PCRE2, Ogg Vorbis/Theora, etcpak, ANGLE, … (18) | admitted |
| Apache-2.0 | Mbed TLS, Basis Universal, OpenXR loader, Swappy, KTX, Embree, SPIRV-Reflect, … (16) | admitted |
| MPL-2.0 | the CA certificate bundle | weak: admitted under `apps/` |
| CC0-1.0, MIT-0, Unlicense (alternatives) | AppStream metadata, glad, dr_libs, stb, SMOL-V, r128 | weak: admitted |
| **Zlib** | zlib, libpng, MiniZip, Recast, SDL, Bullet (with Expat) | ⚠️ **not in ADR 0015's tables: fails closed** |
| **FTL** | FreeType | ⚠️ not in the tables |
| **BSL-1.0** | Clipper2 | ⚠️ not in the tables |
| **OFL-1.1** | fonts (Open Sans, Noto Sans, …) | ⚠️ not in the tables (a font licence) |
| **IJG** (with BSD-3) | libjpeg-turbo | ⚠️ not in the tables |
| **Unicode** | ICU | ⚠️ not in the tables |
| **HarfBuzz** (old MIT variant), **glslang** (a BSD/MIT set), **X11** | HarfBuzz, glslang, Mesa Wayland protocols | ⚠️ not in the tables |
| **CC-BY-4.0** | **the Godot logo**, shown by the default boot splash | ADR 0023 admits CC-BY for a committed **asset** with attribution; as part of a *dependency* it is not ruled on |

**No GPL, LGPL or AGPL component appears, so DEP002 is not engaged.** Several licences are ones ADR
0015 has not ruled on. `DEP001` fails closed on those, as it did for `Unlicense` before ADR 0016. And
`DEP001` would not see any of them: the dependency is Gradle, not npm, which is the gap ADR 0025's
Consequences already name. The library is a **fetched** binary from Maven Central, not a committed
one, so `ASSETS.toml` has nothing to say about it unless it is vendored.

## The kill criterion, measured

| # | Verdict | The number or the breakage |
|---|---|---|
| K1 | **Not tripped** | Built from the published 4.7.1 library, no engine patch, public API only |
| K2 | **Not tripped, with a required fix** | Touch 3/3. The DOM is in the accessibility tree; Godot's focus and its unlabelled `EditText` must be hidden by the host (two lines, measured) |
| K3 | **Tripped, as built** | TS → Godot p95 is 19.8 ms (under the 50 ms line), but **1.76 % of steps** reached Godot more than 50 ms after they were sent (1.96 % with shadows), over the 1 % line. With the geometry windows moved out of the steps' way, it is 0.88 % and the p99 is 21 ms (§3a). And at a one-step render delay, 5.5 % of frames hold the last pose; that is the delay's arithmetic, not the bridge |
| K4 | **Tripped** | (a) Not measurable as written: the two engines' GPU times are different instruments. The engine-neutral proxy, GPU DVFS, is 242 against 256 MHz, 5 % and not 25 %. (b) Not cooler: Godot ended about 1 °C warmer. (c) Godot holds 60 Hz with sun shadows and with shadows + MSAA 2×, **but three.js's shadow configuration holds 60 Hz too** (59.41 fps, p99 16.75 ms), so (c) is not met. The CPU saving (§5) is outside K4's three clauses and is not counted as a pass |
| K5 | **Not tripped** | Over-20 ms share 0.11 % (Godot) against 0.34 % (three.js). Thermal status 0 for both, though Godot ended about 1 °C warmer |
| K6 | **Tripped on APK size, as written** | +69.6 MiB for arm64 with AGP's default packaging, against a 60 MiB line (+26.1 MiB compressed, +296 MiB for all ABIs). Memory +301 MiB passes the 400 MiB line; with shadows + MSAA 2× it is +670 MiB and does not. Cold start +1.1 s passes the 3 s line |
| K7 | **Not tripped** | 4.7.1 → 4.7.2 by version string alone: builds, renders, same numbers |
| K8 | **Tripped, as written** | No copyleft, but Zlib, FTL, BSL-1.0, OFL-1.1, IJG, Unicode, HarfBuzz, glslang and X11 are licences ADR 0015 does not admit today. Every one is permissive in kind, and admitting them is an ADR 0015 ruling, which is #434's to ask for, not this spike's to assume |

## What this answers for #434, and what it does not decide

**This spike decides nothing.** Read against #434's list:

1. **Go or no-go**: **by the criterion set before measuring, this is a no-go signal on
   this scene.** K3, K4, K6 and K8 trip as written. It is not this spike's to decide which of them
   #434 treats as fatal, but the four are not alike, and that is the useful part:
   - **K4 is the substantive one.** On the stylised world, the one both renderers can draw, Godot is
     not better in frame time, GPU load or heat. A native renderer's case would have to rest on a
     scene three.js *cannot* hold. The realistic three.js world (695 MHz, +2.5 °C in 5 minutes) is
     where to look, and it was not drawn in Godot.
   - **K3 and K6 follow from this spike's choices.** Moving the geometry off the step path brings K3
     under its line (0.88 %). Compressed native libraries bring K6's APK delta to 26 MiB, at the cost
     of a 71 MB extraction on install.
   - **K8 is a ruling, not a defect.** Every licence named is permissive in kind; what trips is that
     ADR 0015 has not ruled on them.
2. **The port's new shape**: measured, not designed. A native renderer needs no canvas and no GL
   context in the page: the page produces steps and windows and nothing else. `GameRenderer.create(canvas, …)`
   would need a variant that takes a *native surface handle*, or none, since the surface lives in the
   shell.
3. **What crosses the bridge**: steps at 20 Hz carrying the *camera rig and the markers* (not the
   distance alone), plus a geometry window every 25 m. Capacitor's JSON bridge carries the steps with
   no loss and a p95 of about 5 ms. The geometry window as base64-in-JSON is the expensive half:
   40–45 ms of the WebView's JS thread every 2.8 s, which is also where the BLE notifications land
   (ADR 0008 D-2's note).
   The measured recommendation for the transport is in §3a: render about 60–100 ms behind, and send
   geometry some way other than as base64 in the same queue as the steps.
4. **Two renderers, one placement**: shown to work. Godot drew the product's own arrays and placements
   and computed none of its own.
5. **Which world each renderer draws**: not measured. Only the stylised world was drawn in Godot.
   Whether Godot's headroom buys the realistic world is the next measurement. The realistic three.js
   world is the heavy case on this tablet (695 MHz GPU mean, and +2.5 °C skin in 5 minutes).
6. **Version pin and upgrade policy**: a patch bump is a version string (K7). A minor bump was not
   tried.
7. **The gates**: a native renderer is invisible to the browser gate, exactly as #434 warns. This
   spike's own measurement is a set of adb scripts (on the spike branch), not a gate.
8. **Licences and notices**: §8. Nine licences need a ruling, and the Godot logo is CC-BY-4.0 in the
   default splash.
9. **Who can build it**: an agent did all of this headless: the project is text, and the editor
   imports and exports with `--headless`. What needed eyes was **looking at a screenshot**. That is
   how the culled road was found; no number showed it.

## What was not measured, and why

- **iOS**, entirely: no Xcode project was generated and no device was used.
- **LibGodot's C API** as distinct from the Android library, since the library route needed none of it.
- **A live BLE connection during the runs** (ADR 0008 D-2's configuration); the owner was not riding.
- **Power**: no rail or energy consumer is readable without root on this build.
- **The realistic world in Godot**, and any visual comparison beyond screenshots.
- **A person using TalkBack.**
- **A release build** of the app; the Godot library is its release template in both builds.
- **A Godot minor-version bump** (4.8 is a dev snapshot).

## Reproduce

The spike code is on the branch `spike/issue-433-godot-code` under `spike-0014/`: the patch against
`apps/` (the Capacitor plugin, the `GodotHost` activity, the Gradle and manifest changes, the page),
the Godot project (`project.godot`, `main.tscn`, `world.gd`), and the adb scripts that produced every
number here (`run.sh`, `oyl-sampler.sh`, `analyse.py`, `coldstart.sh`). **It is not merged and must
not be**; #433 names `packages/matching` as the precedent.
