# Spike 0013 — Godot beneath the Capacitor WebView, measured on the Pixel Tablet

- **Date**: 2026-09-26
- **Issue**: [#433](https://github.com/openzigs/onyourleft/issues/433). It feeds the decision in
  [#434](https://github.com/openzigs/onyourleft/issues/434) and does not make it.
- **Status of this file**: ⚠️ **the kill criterion below was committed before anything was
  measured**, as #433's second acceptance criterion asks, so that the result cannot be rationalised.
  Git history is the record of that ordering. Everything after the kill criterion is filled in by
  later commits.

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
