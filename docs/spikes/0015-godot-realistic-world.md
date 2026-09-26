# Spike 0015 — Godot beneath the Capacitor WebView, on the realistic world

- **Date**: 2026-09-26
- **Issue**: [#433](https://github.com/openzigs/onyourleft/issues/433), by the owner's ruling of
  2026-09-26 that asks for a second spike on the realistic world. It feeds the decision in
  [#434](https://github.com/openzigs/onyourleft/issues/434) and does not make it.
- **Status of this file**: ⚠️ **pre-registration only.** The kill criterion and the measurement plan
  below were committed and pushed before anything was measured, so that the result cannot be
  rationalised. Nothing has been drawn on the tablet for this spike yet. The results are appended
  under them in a later commit, and **the text of the two sections below is never edited after this
  commit**. If they turn out wrong, the result says so beside them.

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
