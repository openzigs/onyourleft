# Spike 0015 — Godot beneath the Capacitor WebView, on the realistic world

- **Date**: 2026-09-26
- **Issue**: [#433](https://github.com/openzigs/onyourleft/issues/433), by the owner's ruling of
  2026-09-26 that asks for a second spike on the realistic world. It feeds the decision in
  [#434](https://github.com/openzigs/onyourleft/issues/434) and does not make it.
- **Status of this file**: ⚠️ **the kill criterion and the measurement plan below were committed
  and pushed before anything was measured** (`7497dde`, pushed 18:15 EDT; the earliest Godot frame
  of the realistic world with a committed time is `OYL-GODOT-FIRST` at epoch 1790461876464 ms,
  18:31:16 EDT, legible in the code branch's `screenshots/godot-realistic.jpg`), and their text is
  unchanged from that commit. The
  results are appended under them. Where the method departed from the plan, §"Where the method
  departed from the plan" says so.
- **The short answer**: **Godot 4.7.1 draws the committed realistic set, loaded from the CC0 files
  through its own importer, beneath the transparent WebView, and on this scene it is measurably
  lighter on the GPU than three.js**: over the pre-registered 20-minute pair it held the display
  rate with the GPU's clock **30 % lower** (494 against 708 MHz mean), about **0.7 of a core less
  CPU**, and a skin **1.8 °C cooler** at the end, drawing 96 % of three.js's triangles. How much of
  that is the engine and how much is Godot sampling compressed (ETC2) textures where three.js samples
  decoded RGBA8 was **not isolated**. That is K4's clause (a), so **K4 does not trip**, unlike on the
  stylised world in
  [spike 0014](0014-godot-beneath-the-webview.md). **Four other conditions trip as written: K3,
  K5, K6 and K8.** K3 and K5 by small margins that are set out below; K6 on the APK (+91.8 MiB,
  AGP's default packaging) and K8 on the same unruled licences as 0014. ⚠️ **The rider was not drawn
  to parity**: Godot drew the MakeHuman body standing in its A-pose at the bicycle's origin, in the
  wrong tint, and the owner, looking at the Godot build on the tablet on 2026-09-26, found it poor
  (§"What was built"). Nothing on iOS was reached.

A spike is a dated measurement that decides nothing (`CLAUDE.md` §7).

## Why a second spike

[Spike 0014](0014-godot-beneath-the-webview.md) measured Godot 4.7.1, as an Android library in a
native view beneath the transparent Capacitor WebView, on the **stylised** world, and found it not
measurably better than three.js by the criterion it set in advance: both held 60 Hz, the GPU sat
near its idle clock under both, and neither heated the tablet. Its own conclusion was that a native
renderer's case would have to rest on a scene three.js finds hard, and that the realistic world
([ADR 0026](../adr/0026-realistic-game-world.md)) is where to look: on the same tablet the realistic
three.js world drove the GPU to a mean of 695 MHz against 256 for the stylised one, and warmed the
skin by 2.5 °C in five minutes. This spike asks 0014's question of that scene. A native engine might
pull ahead on textured, physically based, triangle-heavy drawing, or it might not.

## The kill criterion, stated before measuring

The hybrid is **not worth pursuing for the realistic world** — a no-go signal for #434 — if **any
one** of these is true of the measurement this spike makes. K1–K8 are spike 0014's, carried over
where they still apply and reworded only where the scene changed. K9–K12 are new. Each threshold is
set now, before either renderer has drawn the realistic world for this spike.

**Two rules, from 0014's own review, bind every condition:**

1. **A run length stated in a condition is the run length measured.** A condition that says "over a
   20-minute run" is judged on a run of at least 20 minutes that recorded every quantity the
   condition names. A shorter run, or a long run that did not record one of the quantities, leaves
   that condition **unmeasured**.
2. **Unmeasured is not a pass.** A condition this environment cannot measure, or did not, is reported
   as unmeasured, and a result is a go-signal only if every condition passes on a measurement.

| # | Kill condition | Why this line |
|---|---|---|
| K1 | **It cannot be built from released parts.** No Godot view renders the realistic world under a transparent Capacitor WebView, with the DOM drawn on top, on Android, from the pinned stable Godot release's published Android library and its matching editor, without patching the engine's source. Public but undocumented calls are recorded, not fatal | Carried from 0014 unchanged |
| K2 | **The DOM HUD loses its input or its accessibility** while Godot draws the realistic world beneath it: a tap on a DOM control over the Godot view does not reach it (3 taps with `adb shell input tap`), or, with TalkBack on, the WebView's DOM nodes are absent from `uiautomator dump`'s tree, or a Godot node is in that tree or holds input focus with 0014's two container lines in place. The tree dumps are committed this time | Carried from 0014. Its tree dumps were not committed, which its review recorded; they are this time |
| K3 | **The bridge cannot carry the simulation's steps.** Over **one run of at least 20 minutes** of the Godot realistic world: the step's latency from TypeScript to the Godot frame that reads it has **p95 > 50 ms**, or **more than 1 % of the run's steps** arrive at Godot more than 50 ms after they were sent, or any step is lost | Carried from 0014. 0014's 20-minute run did not record the late share and left K3 unmeasured; this run records it from the start |
| K4 | **It is not measurably better.** Over the **20-minute pair** (below), Godot does **none** of: (a) a **GPU DVFS mean at least 25 % lower** than three.js's (`/sys/class/misc/mali0/device/cur_freq`, once a second — the engine-neutral instrument, because 0014 found the two engines' own GPU times are different measures); (b) a **lower maximum thermal status, or a skin temperature at the end of the run at least 2 °C cooler**, from starts within 0.5 °C of each other; (c) an app-process **`Graphics` figure in `dumpsys meminfo` at least 25 % lower**, read half-way through each run. **CPU is deliberately not a clause**: 0014 showed its saving is structural (three.js builds a whole frame at 60 Hz on the WebView's thread, the hybrid at 20 Hz), not the engine's | #433: *"a renderer that is not measurably better is not worth a second implementation."* (c) is new: memory is where ADR 0026's own soak found the realistic world's cost (310 MiB under `GL mtrack`), and Godot compresses textures on import where three.js uploads decoded JPEGs |
| K5 | **It is worse where a rider feels it.** Over the 20-minute pair, Godot's share of SurfaceFlinger present intervals over 20 ms is **higher** than three.js's, or Godot reaches a **higher thermal status** than three.js does | Carried from 0014 unchanged |
| K6 | **The cost is out of proportion.** The arm64 debug APK, AGP's default packaging, grows by **more than 60 MiB** over the same build without Godot; or the app's total PSS half-way through the 20-minute Godot run exceeds three.js's by **more than 400 MiB**; or the median cold start to the first Godot frame with the realistic world in it is **more than 3 s later** than the median cold start to three.js's first realistic frame (n = 5 each, both timed from the page's `performance.timeOrigin`) | Carried from 0014. The cold-start comparison is against three.js's first **realistic** frame rather than the page's first paint, because both engines now load 30 MiB of assets before drawing; that is a change from 0014 and is said here so it is not argued later |
| K7 | **A patch release breaks it.** Moving the pinned version to the next patch release (only the Maven version string) fails to build, fails to render the realistic world over a run of at least 2 minutes, or needs a code change | Carried from 0014 unchanged |
| K8 | **A licence in the shipped library is not admissible**: any component of the Godot Android library that ships in the APK carries a licence ADR 0015's *distributed, `apps/`* column does not admit **on `main` on the day of measuring**, or a copyleft one `DEP002` forbids | Carried from 0014 unchanged |
| K9 | **Godot cannot draw the committed realistic assets.** Each of these six classes is drawn by Godot **from the committed CC0 file in `apps/web/public/realistic/`**, through Godot's own importer or a conversion that is scripted and recorded, never re-authored by hand: (1) the HDR sky, as the background **and** as image-based light; (2) the photographic road and ground surfaces, colour and normal; (3) the near vegetation models (both tree species' `.glb`s, both shrubs, the boulder) with their own materials; (4) the far trees' impostor strips; (5) the structures' photographic surfaces, on the geometry `buildings.ts` builds (which crosses the bridge, as the road does); (6) the rider model. A class that is not drawn, or is drawn only from something a person made by hand, trips it | #433's owner ruling: the same assets, loaded. A comparison in which Godot draws something lighter is not the realistic world |
| K10 | **The comparison is not like-for-like** — a validity condition: over the 20-minute pair, Godot's own count of primitives submitted per frame (median of its 30-second windows) is **less than 80 %** of the triangles three.js submits per frame (counted at the WebGL draw calls on the page, median of its windows). If K10 trips, **K4 cannot pass**, whatever its clauses show, because a lighter scene is not "better" | 0014's Godot scene was lighter than three.js's in shading, and that was stated but not bounded. Here it is bounded |
| K11 | **The realistic set does not fit ADR 0026 D-6's texture ceiling in Godot**: Godot's own `RENDER_TEXTURE_MEM_USED` counter, read half-way through the 20-minute Godot run, exceeds **160 MiB** (`REALISTIC_TEXTURE_MEMORY_BYTES`) | D-6 says a native renderer's numbers are its own; this spike uses three.js's ceiling as the line because it is the only one stated, and says so now |
| K12 | **The realistic set costs too much to ship in Godot's form**: the bytes Godot's import adds to the APK for the realistic assets alone (its `.godot/imported` files for them, measured in the APK) exceed **40 MiB** (`REALISTIC_BUILD_BYTES`). This is where the KTX2/Basis question lands for Godot: it compresses to ETC2/ASTC at import, so the cost is bytes in the APK rather than a transcoder at run time | ADR 0026 D-6 and D-8 |

**What does not kill it, said now so it cannot be argued later**: iOS not being reached; Godot's
drawing looking **different** from three.js's (tone mapping, fog, the water shader, the far hills and
the rider's pedalling pose are each named in the result if they differ), as long as K9 and K10 hold;
the hybrid's CPU figure, either way; and undocumented-but-public calls.

## The measurement plan, stated before measuring

- **Device and build**: the owner's Pixel Tablet (2560 × 1600, 60 Hz, landscape, on charge,
  brightness as found), one debug APK holding both renderers, as in 0014, built from `main` at the
  time of measuring plus the spike's patch. Godot **4.7.1-stable**, Forward Mobile on Vulkan (the
  default), no MSAA, no real-time shadows; the patch bump is 4.7.2.
- **The control**: the product's own `three-renderer.ts` drawing the realistic world through
  `realistic.html?world=realistic&panel=0&ladder=0` — the realistic top rung, held — the page
  validation 0002 Part Z's soak used. The page's draw-call counter is extended to count triangles
  submitted, and to publish the time of its first realistic frame; nothing else in the product
  changes.
- **The Godot side**: `godot.html?world=realistic`, driving the same `rideFrame` at the same rung's
  scenery budget, with **a render delay of 100 ms** (0014 §3a's measured recommendation) and a
  geometry window every 25 m (0014's as-built rate). Godot chooses near meshes and impostors by the
  same counts as `realistic-budget.ts` §`REALISTIC_NEAR_MESHES`.
- **The same ride for both**: `realistic/route.ts` from 2 550 m at 9 m/s, looping as the page loops,
  at 2560 × 1600.
- **The pair**: one **20-minute** run of each, after the tablet has cooled on the launcher to a skin
  temperature of **26 °C or less**, three.js first. Sampled exactly as 0014 sampled
  (`oyl-sampler.sh`): SurfaceFlinger present intervals every 0.5 s, GPU DVFS once a second, thermal
  and `top` every 30 s (the renderer process included), `dumpsys meminfo` half-way, the engine's own
  numbers every 30 s.
- **Further runs, which inform and do not decide**: shorter runs of Godot with real-time sun shadows,
  and anything else found worth measuring, labelled with their length.
- **Cold start**: five cold starts of each, timed from the page's time origin.
- **APK**: the arm64 debug APK with and without the Godot library and project, and the realistic
  set's imported bytes, read from the APK.
- **Nothing here touches the trainer**; nobody rides.

## What was built

Spike 0014's route, unchanged: **Godot 4.7.1-stable's Android library** (`org.godotengine:godot`,
from Maven Central) in a `GodotFragment` beneath the transparent Capacitor WebView, reached through
the same `GodotWorld` Capacitor plugin and `WorldBridge` Godot plugin, with the same two
accessibility lines on the container. No engine source was patched and no undocumented call was
needed. What is new is the realistic world on both sides of the bridge.

**The TypeScript side** (`godot-realistic.html`) runs the product's own `rideFrame` at the realistic
top rung's budgets (`worldRung({ realistic: true, level 0 })`) and sends, as 0014 did, a **step** at
20 Hz (`cameraRig`'s eye and target, the riders, and the camera pose the cull needs) and a
**window** every 25 m (road, ground, water, bridges, every scenery and structure placement, the far
hills' relief). It also sends, once, the geometry the product **builds from numbers rather than
reads from a file**: each structure kind's triangles per surface (`realisticStructureGeometry`, the
same triangles three.js's realistic belts draw) and the realistic bicycle (`realisticBicycle`,
`realisticCrankset`, made exportable for the spike). The three numbers `realistic-light.ts` reads off
the HDR at load (its upward radiance, its sun's column and its skyline band) were computed once on
the Mac by the product's own functions (`spike-0015/scripts/zz-sky.test.ts`), rather than by loading
6 MB of HDR into the WebView being measured.

**The Godot side** (`world.gd`) draws, from its import of the committed files:

| Class (K9) | How Godot draws it | Where it follows three.js, and where not |
|---|---|---|
| 1. HDR sky | `PanoramaSkyMaterial` on `farm_field_2k.hdr` as the background **and** the ambient and reflected light (radiance 256, processed once), at `environmentIntensity`'s strength | The turn that puts the photograph's sun at the world's sun uses Godot's panorama convention, worked out rather than checked, so it may be off by a constant |
| 2. Road and ground | A spatial shader, world-planar UVs (3 m and 4 m), the photograph's colour and normal maps | The road: the gradient tint times the photograph's luminance clamped to ±15 %, lit as facing up, a quarter of the sheen. The ground: the landform colour times the photograph over its own mean, with the second, larger sample in the distance. **Not ported**: the ground's field pattern (`withSurfaceDetail`) |
| 3. Near vegetation | The seven `.glb` files, their materials rebuilt as `prepareRealisticShape` rebuilds them (the file's colour, colour and normal maps; roughness 0.85; both faces; foliage cut at 0.5), instanced; the **nearest 3 / 3 / 8 / 12** in view of each kind, re-chosen every step | Same counts and the same view cone (`lateralReachMetres`, sampled every 5 m). **Godot's mesh LODs were turned off** so the triangles drawn are the files' own |
| 4. Far trees | The four impostor strips on instanced quads, the frame chosen in the vertex shader as three.js's is | Same |
| 5. Structures | The product's triangles, each surface wearing its photograph and the finish three.js gives it (roughness, metalness, tint) | Tangents generated by Godot for the normal maps |
| 6. Rider | `rider.glb`, skinned, three of them, each scaled to the bicycle's leg, with the product's bicycle geometry beside it | ⚠️ **Not at parity with three.js, in four ways.** (1) **The body is not seated**: it stands in the MakeHuman **A-pose** (arms straight out, hands nowhere near the bar, hips not on the saddle) at the bicycle's origin, because nothing aims its bones. three.js aims every bone each frame (`RealisticRiderBelt`, `bicycle.ts` §`riderJoints`) to put the hips on the saddle, the hands on the hoods and the feet on turning pedals. (2) **The tints are not three.js's**: `world.gd` multiplies red into the rider and blue into the bot, where `three-renderer.ts` §`RIDER_TINTS` draws the rider untinted (white) and the bot orange. (3) **One lean for body and bicycle together**, with no split (`bicycle.ts` §`bicycleRoll`, #546). (4) **No contact shadow** (below). The owner, looking at the Godot build on the tablet on 2026-09-26, found the rider poor. §"What does not kill it" lets the pose differ, which is why K9 stands |
| 7. Contact shadows | **Not drawn** | three.js draws `ContactShadowBelt` under the rider and the pacer (visible in `screenshots/threejs-realistic.jpg`); Godot draws nothing there. One cheap instanced transparent draw in three.js, left out of Godot's frame |

The far hills (`HorizonRing`, with #544's lift) are drawn; the water is a plain physically based
surface, not #459's shader. Screenshots of both renderers at about the same point of the ride are
in the code branch's `spike-0015/screenshots/`.

**The conversion** (`spike-0015/scripts/convert.sh`) copies the 31 committed files unchanged into
the Godot project, writes each one's import settings, and runs the pinned 4.7.1 editor headless.
Photographs and impostor strips are **VRAM-compressed** (ETC2 on this tablet, with the normal-map
flag on normal maps), which is what the editor's own "detect 3D" chooses for a texture a 3D material
uses; a headless import never sees that use, so it is written down instead. ⚠️ **This is a
difference between the two sides of the comparison, not only a detail of the conversion**: three.js
samples the same photographs as decoded RGBA8 (ADR 0026 D-8 left KTX2 to be measured and it has not
been adopted), and a compressed texture costs a Mali less memory bandwidth per sample. So part of
the GPU difference in §1 may be the texture format rather than the engine. three.js can sample
compressed textures too (KTX2/Basis, D-8); that configuration was not run. The HDR is kept at half
float, as three.js uploads it. The textures the importer extracts from each `.glb` are given the
same compression and the whole set is imported again from nothing. What ships is the importer's
output only (122 files; their SHA-256 are in `results/godot-assets-sha256.txt`); the source copies,
the editor's desktop (S3TC) variants and the import checksums are left out of the APK, as a Godot
Android export would leave them out. **Nothing was re-authored by hand.** Every file is CC0-1.0 by
`ASSETS.toml`, so the conversion carries no licence obligation. The converted binaries are not
committed anywhere; the script makes them again.

**One piece of engineering changed a result before the measured runs, and it is recorded here.**
Choosing the nearest meshes and filling the instance buffers in GDScript on Godot's main thread cost
4–9 ms every step, and a 60-second trial showed Godot's own frame p99 at 33 ms and 2.6 % of present
intervals over 20 ms. ⚠️ **Those three figures are untraceable**: that trial's directory was
overwritten by the next one and nothing of it is committed. The work was moved to a
`WorkerThreadPool` job whose buffers the main thread hands over (3.99 ms p50, 11.6 ms p99, off the
main thread, in the measured run). The second 60-second trial, after that change, still showed
**2.36 %** of present intervals over 20 ms (`results/smoke-godot.json`, `results/raw/smoke-godot/`);
the 20-minute run showed 0.19 %, and **0.42 %** in its first minute (`results/per-minute.txt`). Both
trials were the **first launch after an install**, so a pipeline cache being filled is a likely
cause, but it was not established.

## Versions and device

As 0014: the owner's Pixel Tablet (Tensor G2 / Mali-G710, Android 17, 2560 × 1600 at 60 Hz,
landscape, on charge), WebView 153.0.8010.36, Godot **4.7.1-stable** (Forward Mobile on Vulkan), the
patch bump **4.7.2-stable**, three.js 0.185.1, Capacitor 8.5.2, one debug APK (`applicationId
dev.openzigs.onyourleft.godotspike`, arm64 only) holding both renderers, built from `main` at
`46c80c9` plus the spike's patch. Both draw at 2560 × 1600: three.js's drawing buffer reads
`[2560, 1600]` and Godot's viewport the same. The control is
`realistic.html?world=realistic&panel=0&ladder=0` (every one of its 19 soak minutes on the
`realistic` rung); the Godot page is `godot-realistic.html` with a 100 ms render delay and a window
every 25 m, as planned. Both ride `realistic/route.ts` from 2 550 m at 9 m/s.

## Where the method departed from the plan

- **The cool-downs turned the screen off.** On charge with the screen on, the tablet's skin settled
  at about 26.5 °C and did not reach the plan's 26 °C. Part-way through the first cool-down (before
  the three.js run) the screen was put to sleep by hand; the second (before the Godot run) ran with
  the screen off throughout, and the script woke it for each run. **Which start temperature is meant
  matters**: the reading each run took as it started, with the screen just woken, was **25.57 °C**
  (three.js) and **25.87 °C** (Godot), 0.3 °C apart (`results/raw/*/before.txt`, and the cool-down
  logs `results/raw/chain1.log`); the first reading each run's sampler took, 20 s later with the
  scene drawing, was **27.2 °C** and **28.1 °C**, 0.9 °C apart and Godot warmer. `VIRTUAL-SKIN`
  jumped 1.6–2.2 °C across the wake in both runs, which suggests it reacts to the screen. By the
  second pair of readings, K4(b)'s condition that the starts be within 0.5 °C is not met. K4(b) is "not met" on the end temperatures either way, and
  a warmer Godot start can only favour three.js there, so no verdict turns on it.
- **The pages are not like-for-like in their DOM.** The three.js control ran `panel=0`, with nothing
  over its canvas. The Godot page drew four HUD panels **and** a debug log (`<pre id="log">`,
  updated as report lines arrived) over the scene throughout G20, so the WebView composited and
  repainted DOM over Godot's surface where three.js had none. K5 trips by 0.07 of a point, so this is
  written down; its effect was not measured.
- **Sampling ran slower than planned.** The plan says thermal and `top` every 30 s and GPU DVFS once
  a second; the sampler's own `dumpsys` calls stretched those to about 37 s (33 thermal samples in
  each 20-minute run) and to 965 (Godot) and 972 (three.js) DVFS samples in 1 200 s.
- **K11 is read as a median, not half-way.** The plan says Godot's `RENDER_TEXTURE_MEM_USED` "read
  half-way"; `analyse.py` reports the median over the run's windows. It was 81.035 MiB in every
  window of every run, so the two are the same number.
- **The page's name.** The plan says `godot.html?world=realistic`; the page built is
  `godot-realistic.html`, with the same meaning.
- **K2's full (not compressed) TalkBack dump caught TalkBack's own notification-permission
  dialog** rather than the app, so it is committed under a name that says so and is not evidence.
  The compressed dump is, and it was taken with the app in front.

## Results

Raw and summarised results are on the code branch `spike/issue-433-godot-realistic-code` under
`spike-0015/results/`: the summaries (`T20-three-realistic.json`, `G20-godot-realistic.json` and the
rest; `runs.txt` is one line per run), and under `results/raw/` each run's own files (SurfaceFlinger
latency, DVFS, thermal and `top`, `meminfo`, the page's reports, the run-start thermal dump), the
cool-down logs, and `per-minute.txt` from `scripts/per_minute.py`. The full logcat stream is not
committed (it holds other apps' logging); `oyl.txt` in each run is its spike lines.

### 1. The pre-registered 20-minute pair

| | three.js realistic (`T20`) | Godot realistic (`G20`) |
|---|--:|--:|
| Length | 1 200.6 s | 1 200.5 s |
| fps (SurfaceFlinger) | 59.57 | 59.51 |
| Present p50 / p90 / p99 | 16.63 / 16.66 / 16.75 ms | 16.63 / 16.67 / 16.76 ms |
| Present intervals > 20 ms / > 50 ms | **0.12 %** / 0.008 % | **0.19 %** / 0.006 % |
| GPU DVFS mean (p50 / p90) | **707.8 MHz** (701 / 848) | **493.9 MHz** (471 / 510) |
| Skin at run start → first sample → end (max) | 25.57 → 27.2 → **32.8** (32.8) °C | 25.87 → 28.1 → **31.0** (31.3) °C |
| G3D sensor mean | 56.2 °C | 48.6 °C |
| Thermal status, max | 0 | 0 |
| CPU, app + WebView renderer (% of a core) | 87.8 + 74.9 = **163** | 67.2 + 26.7 = **94** |
| App PSS, half-way | **538 MiB** | **777 MiB** (+238) |
| App `Graphics` (`dumpsys meminfo`), half-way | **419 MiB** | **440 MiB** (+5 %) |
| Triangles per frame | 266 742 (median of 19 minutes, counted at the WebGL draw calls) | 255 548 (median of 40 windows, Godot's primitive counter): **95.8 %** |
| Draw calls per frame | 32–37 | 62 |
| Engine's own GPU time p50 / p90 / p99 | `gfxinfo` "GPU" 5 / 9 / 13 ms (HWUI's composite, not WebGL's work) | 11.81 / 13.11 / 14.63 ms (Godot's GPU timestamp) |
| Engine's own frame p50 / p90 / p99 | rAF 16.6 / 16.7 / 16.8 ms | 16.65 / 17.40 / 19.14 ms |
| Texture memory | not measured on the device; `realistic-budget.ts` estimates 136 MiB for the set | **81.0 MiB** (Godot's `RENDER_TEXTURE_MEM_USED`); 104.7 MiB of video memory in all |

**Both hold the display rate. Godot does it with the GPU clocked 30 % lower**, which is the
difference 0014 did not find on the stylised world (5 % there). ⚠️ **DVFS is the governor's choice
of clock, not a measure of work**: it is the one engine-neutral GPU instrument this build allows (the
utilisation counters are permission-denied), and a lower clock that still makes every vsync is
evidence of less GPU work per frame, not a count of it. ⚠️ **Nor was the gap attributed**: Godot
samples ETC2-compressed textures and three.js decoded RGBA8 (§"What was built"), and how much of the
30 % that difference accounts for was not isolated, so the 30 % is a measurement of these two
configurations and not a property of either engine. The skin ended 1.8 °C cooler and the GPU sensor
averaged 7.6 °C cooler; the runs started 0.3 °C apart by the run-start reading and 0.9 °C apart,
Godot warmer, by the first sampled reading (§"Where the method departed from the plan"). Thermal
status stayed 0 for both, so the tablet never got hot enough to throttle either.

⚠️ **The 0.7-of-a-core CPU saving is structural, as 0014 found**: the three.js path builds a whole
frame at 60 Hz on the WebView's thread (its renderer process alone is 75 % of a core), the hybrid a
step at 20 Hz. K4 deliberately does not count it.

⚠️ **Memory goes the other way.** Godot holds the realistic textures in 81 MiB, compressed, where
three.js decodes JPEGs to RGBA8; yet the app's `Graphics` figure is 5 % **higher** with Godot and
its total PSS 238 MiB higher. The Godot library's native heap (208 MiB against 46) is most of the
difference. ADR 0026's soak finding, that the driver holds far more than the texture estimate, is
not answered by switching renderer on this measurement.

### 2. The bridge, over the 20-minute Godot run

24 072 steps, **0 lost**. Medians over forty 30-second windows:

| | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|
| TS → Java (Capacitor) | 2.7 ms | 5.0 ms | 38.5 ms | 74.8 ms |
| TS → the Godot frame that reads it | 11.5 ms | **20.0 ms** | 55.3 ms | 91.5 ms |
| Interval between arrivals at Java | 50.0 ms | 61.0 ms | 97.5 ms | 134 ms |

**Steps more than 50 ms late at Godot: 399 of 24 072, 1.66 %** of the run (0.70 % at Java). The
first window, which holds Godot's start and the one-off transfer of the structure models (windows of
up to 1.7 MB of JSON until Godot acknowledges them), has 116 of them; **without it the share is
1.21 %**, still over the line. At the 100 ms render delay, 0.34 % of frames held the last pose.
Serialising a geometry window still costs the WebView's main thread 44 ms at p50 (58 ms p99) every
25 m; Godot builds its meshes from it in 7.8 ms p50 (12.7 ms p99).

### 3. Runs that inform and do not decide

| Run | Length | fps | > 20 ms | GPU DVFS mean | Skin start → end | Godot primitives | Godot GPU p50 | PSS |
|---|---|--:|--:|--:|---|--:|--:|--:|
| Godot, **real-time sun shadows** over the scene (`G5-godot-shadows`) | 5 min | 59.50 | 0.20 % | 656.9 MHz | 28.3 → 31.4 °C | 951 046 | 12.6 ms | 772 MiB |
| Godot **4.7.2**, version string only (`V2-godot-4.7.2`) | 2 min | 59.29 | 0.20 % | 497.0 MHz | 28.1 → 30.0 °C | 261 291 | 11.78 ms | 801 MiB |

With whole-scene sun shadows (the shadow pass takes the primitives to 3.7 times) Godot still held
60 Hz, at 657 MHz, still under three.js's unshadowed 708. three.js has no configuration that casts
the scenery's shadows (ADR 0026 D-9 leaves it to #457), so this is not a comparison.

### 4. Cold start, APK, textures (K6, K11, K12)

| | Measured |
|---|---|
| Cold start to the first realistic frame, from the page's time origin, n = 5 | three.js **1 577–1 872 ms, median 1 712**; Godot **3 457–3 777 ms, median 3 720** (4.7.2: 3 703 and 3 713). **Godot is 2.0 s later** |
| APK, arm64, AGP's default packaging | baseline 74 900 734 B; with Godot 171 194 862 B: **+96.3 MB (+91.8 MiB)**. `libgodot_android.so` is 71.1 MB stored uncompressed, `libc++_shared.so` 1.4 MB |
| APK with compressed native libraries (`useLegacyPackaging`) | 125 596 158 B: **+50.7 MB (+48.3 MiB)** |
| The realistic set as Godot ships it | **32.4 MB uncompressed (30.9 MiB), 23.5 MB in the APK (22.4 MiB)**, against 30.8 MiB for the committed web set it was made from |
| Godot's texture memory for the scene | **81.0 MiB** |

Both APKs still carry the web build's copy of the realistic set (and the staged harness's second
copy), so the delta is the hybrid's cost on top of today's APK, not what a Godot-only realistic world
would ship.

### 5. Touch and TalkBack (K2)

With Godot drawing the realistic world, **3 of 3** `adb shell input tap`s on the DOM *Tap test*
button reached its handler (`results/taps.txt`). With TalkBack on and the app in front, the
compressed accessibility tree is **exactly the DOM** (the four HUD panels, their labels and values,
the button), with no Godot `SurfaceView` and no Godot `EditText`, and the one focused node is the DOM
button (`results/a11y-godot-realistic-talkback-compressed.{txt,xml}`, committed this time). TalkBack
was turned off afterwards.

### 6. Version fragility (K7)

`-PgodotVersion=4.7.2.stable` alone: built, installed, reported `4.7.2-stable`, drew the realistic
world for 2 minutes, no script errors, cold start unchanged. Frame, GPU, DVFS and triangle figures
are within noise of 4.7.1 (§3). **The bridge's are not**: 7.46 % of steps reached Godot more than
50 ms late (against G20's 1.66 %), 1.08 % at Java, and the worst step took 197 ms (against 91.5).
163 of its 187 late steps (of 2 507) fall in the first window (`results/per-minute.txt`), which holds
the start-up and the one-off transfer of the structure models, and in a 2-minute run that window is
a quarter of the run, so this is probably start-up rather than a regression. K7's condition is about
building and rendering, and does not turn on the bridge.

### 7. Licences (K8)

The library is the same `org.godotengine:godot:4.7.1.stable` AAR spike 0014 inventoried
(`spike-0014/results/licences.json` on `spike/issue-433-godot-code`). On `main` on 2026-09-26,
ADR 0015's tables and `check-dependency-licences.mjs` §`POLICY` still admit none of Zlib, FTL,
BSL-1.0, OFL-1.1, IJG, Unicode, HarfBuzz, glslang or X11, and the Godot logo (CC-BY-4.0) is still in
the library whether or not it is shown (this spike turns the boot splash off). No GPL, LGPL or AGPL
component.

## The kill criterion, measured

| # | Verdict | The number or the breakage |
|---|---|---|
| K1 | **Not tripped** | Built from the published 4.7.1 library and editor, no engine patch, public API only (§"What was built") |
| K2 | **Not tripped** | Touch 3/3; with TalkBack on, the tree is the DOM and nothing of Godot's, and focus is the DOM's (§5). Evidence committed |
| K3 | **Tripped** | Over the 20-minute run, p95 20.0 ms (under 50) and 0 steps lost, but **1.66 %** of steps reached Godot more than 50 ms after they were sent, over the 1 % line; 1.21 % even without the start-up window (§2) |
| K4 | **Not tripped**: clause (a) met | (a) **GPU DVFS mean 30.2 % lower** (493.9 against 707.8 MHz), over the 25 % line. (b) not met: 1.8 °C cooler at the end, under the 2 °C line, and thermal status 0 for both. (c) not met: `Graphics` 5 % **higher**. Valid only with K10, which holds. ⚠️ DVFS is the governor's clock, not a count of work, and how much of the gap is Godot's compressed textures rather than the engine was not isolated (§1) |
| K5 | **Tripped** | Present intervals over 20 ms: **0.19 %** (Godot) against **0.12 %** (three.js), higher, as written. Thermal status equal (0). The difference is 0.07 of a percentage point, about 50 frames in 72 000; the condition has no tolerance and none is applied |
| K6 | **Tripped on the APK** | **+91.8 MiB** arm64 with AGP's default packaging, over the 60 MiB line (+48.3 MiB with compressed native libraries). PSS +238 MiB passes the 400 MiB line; cold start +2.0 s passes the 3 s line |
| K7 | **Not tripped** | 4.7.1 → 4.7.2 by version string: builds and renders, the same frame and GPU figures; the bridge's late share was higher in its 2-minute run, probably start-up (§6) |
| K8 | **Tripped, as written** | The same nine licences ADR 0015 has not ruled on, and the CC-BY-4.0 logo in the library (§7). No copyleft |
| K9 | **Not tripped** | All six classes drawn from the committed files, through Godot's importer and a recorded script; nothing re-authored. ⚠️ The rider is drawn **standing in an A-pose at the bicycle's origin, not seated and not holding the bar, in the wrong tint, with one lean for body and bicycle**, which §"What does not kill it" allows ("the rider's pedalling pose"). The owner found it poor on the tablet (§"What was built") |
| K10 | **Not tripped** | Godot 255 548 primitives per frame against three.js's 266 742 triangles: **95.8 %**, over the 80 % line |
| K11 | **Not tripped** | 81.0 MiB of textures, against D-6's 160 MiB |
| K12 | **Not tripped** | 30.9 MiB uncompressed and 22.4 MiB in the APK, against 40 MiB |

## What this answers for #434, and what it does not decide

**This spike decides nothing.** Against the question it was asked, whether a native engine pulls
ahead on the realistic world:

- **On the GPU, yes, on this tablet.** The realistic world is where three.js drives the Mali to
  700 MHz, and Godot drew 96 % of the same triangles, from the same files, at 494 MHz and ended the
  20 minutes cooler. That is the difference 0014 did not find on the stylised world. ⚠️ It is a
  difference between these two configurations, one sampling compressed textures and one decoded
  ones, and the share of it that is the engine was not isolated. It does not
  show as frames: three.js also holds 60 Hz here, so on this device the saving is headroom (heat,
  and room for shadows), not smoothness. Whether that headroom decides anything on a slower phone,
  ADR 0008 D-4's 3 GB floor, was not measured, and that is where it would matter.
- **Four conditions trip as written, and they are not alike.** K8 is a licence ruling, unchanged
  since 0014. K6 is the library's size; the realistic set itself is smaller in Godot's form than the
  web set. K3 is the bridge's tail, 1.2–1.7 % of steps late against a 1 % line, which 0014 also
  found and for which a separate channel for geometry (not built) is the named remedy. K5 is 0.19 %
  against 0.12 % of frames over 20 ms, about 50 frames in 20 minutes, which the pre-registered
  condition counts as worse because it has no tolerance.
- **Memory is not where Godot wins.** Its compressed textures are smaller than three.js's decoded
  ones, but the process is 238 MiB larger and its `Graphics` figure no smaller.
- **What would have to change to clear the tripped conditions**, named and not assumed: a geometry
  channel off the step queue (K3); whatever makes Godot's present-interval tail no higher than
  three.js's, which this spike did not isolate (K5); compressed native libraries, still over the line
  at +48.3 MiB (K6); an ADR 0015 ruling (K8).

## What was not measured, and why

- **iOS**, entirely.
- **A slower device**, and ADR 0008 D-4's 3 GB floor in particular: the one place a 30 % GPU margin
  would decide something.
- **Power**: no rail or energy counter is readable without root.
- **A hot device**: both runs stayed at thermal status 0, so what either does when throttled is not
  shown.
- **A rider at parity in Godot.** The Godot rider stood in its A-pose at the bicycle's origin, in
  the wrong tint, with no contact shadow and one lean for body and bicycle (§"What was built"), and
  the owner, looking at the tablet on 2026-09-26, found it poor. Bringing it to parity means
  porting `bicycle.ts`'s procedural rider and its animation (the bones aimed every frame from
  `riderJoints`, the pedalling, `bicycleRoll`'s split lean) and the contact shadows to Godot, or
  sending the posed bones over the bridge; **that cost was not measured**, and neither was what a
  posed rider costs Godot's frame.
- The ground's field pattern and #459's water shader in Godot. The sky's turn is Godot's convention
  worked out, not checked against the photograph's sun.
- **three.js with compressed (KTX2) textures**, which is what would separate the texture format's
  share of the GPU difference from the engine's.
- **The effect of the Godot page's DOM panels and debug log** on its present-interval tail.
- **Whole-scene shadows in three.js**, which has no configuration for them.
- **A live BLE connection** during the runs; nobody rode.
- **The cause of the two trial runs' 2.4 % of frames over 20 ms** (§"What was built"), and of the
  0.07-point difference K5 turns on.
- **A release build**, and a Godot minor-version bump (4.8).

## Reproduce

The code is on the branch `spike/issue-433-godot-realistic-code` under `spike-0015/`, beside 0014's
`spike-0014/`: the patch against `apps/` (`apps.patch`, which adds `godot-realistic.html` and its
harness, a triangle count and a first-frame time on `realistic-harness.ts`, and two exports on
`three-renderer.ts`), the Godot project (`project.godot`, `main.tscn`, `world.gd`), and the scripts
(`convert.sh` makes the imported set, `build.sh` and `baseline.sh` the APKs, `chain1.sh` the
20-minute pair, `chain2.sh` the rest, `analyse.py` every summary). **It is not merged and must not
be.** The spike APK was uninstalled afterwards, `main`'s debug build of the app was reinstalled, and
the tablet's rotation, stay-awake and accessibility settings were put back as they were found.
