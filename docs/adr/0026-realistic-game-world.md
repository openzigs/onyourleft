# ADR 0026: The trainer game's world goes realistic — what is drawn changes, the engine and the placement do not

- **Status**: Accepted
- **Date**: 2026-09-21
- **Deciders**: the repository owner, who ruled on
  [#430](https://github.com/openzigs/onyourleft/issues/430) on 2026-09-20 — *"I want to go
  realistic"* — and reaffirmed it on 2026-09-21: *"for 431 go realistic, I would like to do that."*
  The ruling is the owner's because it reverses three decisions of
  [ADR 0022](0022-game-scenery-model-pack.md), and because `CLAUDE.md` §3 makes a licence question
  answerable before the code is written. Everything below the ruling — how the two worlds relate,
  what is precached, which sources are in, the order of replacement — is the author's, following
  from it and from the sources in §"What was read, and when"
- **Issue**: [#431](https://github.com/openzigs/onyourleft/issues/431), under epic
  [#429](https://github.com/openzigs/onyourleft/issues/429)
- **Number**: **0026**. 0021 remains a live reservation held by
  [#330](https://github.com/openzigs/onyourleft/issues/330) and still unwritten; 0025 was taken by
  [#432](https://github.com/openzigs/onyourleft/issues/432).
  [`docs/architecture.md`](../architecture.md)'s reservation table is the check `CLAUDE.md` §7 asks
  for, and it said 0026 was free on 2026-09-21. No open issue or pull request claimed it — the one
  issue whose text names 0026 ([#395](https://github.com/openzigs/onyourleft/issues/395)) names it as
  the next free number, not as a claim
- **Supersedes**: [ADR 0022](0022-game-scenery-model-pack.md) **D-1** and **D-2** in full, and
  **D-7**'s second bullet in its *means* but not its *end* — see D-11. ADR 0022's D-3, D-4's list,
  D-5 and D-6 stand. ADR 0022 carries a dated amendment recording this; its body and its `Status`
  line are unedited, because [ADR 0013](0013-adr-amendments.md) D-2 says `Status` is part of the
  body and an amendment does not change it
- **Narrows**: [ADR 0024](0024-offline-and-caching-posture.md) **D-2** — *"the whole asset graph is
  precached"* — to the **stylised** world (D-7 below). ADR 0024 carries a dated amendment
- **Relates to**: [ADR 0008](0008-mobile-client-architecture.md) D-1, D-3, D-4 (the engine, the
  foreclosures and the device floor, all unchanged); [ADR 0009](0009-clean-room-posture.md) L1 and L2
  (unchanged, and newly load-bearing); [ADR 0023](0023-cc-by-assets-and-attribution.md) (the licence
  a realistic bicycle is most likely to carry); [#433](https://github.com/openzigs/onyourleft/issues/433)
  and [#434](https://github.com/openzigs/onyourleft/issues/434) (an optional native renderer, **not
  decided here**)

---

## Context

The owner rode a commercial indoor-cycling app on the Pixel Tablet on 2026-09-20 and asked how this
project's trainer game gets into that league (#429). #430 set out the two honest answers — *"stay
stylised, get richer"* or *"go realistic"* — and the owner chose the second.

That reverses the posture ADR 0022 built, which is why this is an ADR and not a pull request.
ADR 0022 made three decisions that realism cannot live with:

| ADR 0022 | What it decided | Why realism breaks it |
|---|---|---|
| **D-1** | the shapes come from **Kenney.nl**, committed *"verbatim and unconverted"*, so `ASSETS.toml`'s `source` and `sha256` describe the same file | every realistic source is too heavy to ship as published — a *"hyperreal"* Poly Haven scan is scan-density geometry with maps up to 8K (#430) — so the committed file is necessarily a **derived** one |
| **D-2** | **one author, one house style** | no single author publishes a realistic set covering trees, ground, sky, buildings and a rider |
| **D-7** (second bullet) | every model wears this repository's own `MeshLambertMaterial` and colour; since #366, a pack's colour baked into vertices and **no texture reaching the GPU** | realism is mostly **surface**, and surface is textures |

ADR 0013 D-3 is explicit that reversing a decision needs a superseding ADR rather than an
amendment, so this is that ADR, and ADR 0022 receives an amendment only to point here.

### What "realistic" does not mean, stated first because it is the likeliest misreading

The app the owner photographed is built on Unreal Engine (#429). **Realistic does not mean Unreal.**
ADR 0008 forecloses Unreal on its EULA's *Non-Compatible Licenses* clause against this project's
AGPL, *"and nothing this project can do cures it"*; Unity is closed permanently (ADR 0008 D-3);
relicensing to reach either was raised and rejected on 2026-09-20 (#434). The renderer is three.js
0.185.1 in a WebView. **The honest ceiling is a good-looking mobile game**, not a desktop title, and
every budget below is set against that ceiling rather than against the photographs.

### What is known about the device, and what is not

From #457's issue body, read over adb on 2026-09-21: the owner's Pixel Tablet is a Mali-G710 on
Android WebView 151, WebGL2 with `WEBGL_compressed_texture_astc` and `_etc`, a WebGPU adapter
present, an 800 × 1280 CSS viewport at DPR 2. **The only device ride ever measured** used a
**13 ms frame and 6 ms GPU at the 50th percentile** ([validation 0002](../validation/0002-android-shell-and-game.md) Part H §"The baseline, and where it actually lives"). ADR 0008
D-4's floor is Android 9, 3 GB, OpenGL ES 3.0, 30 fps, 720p.

⚠️ **Nothing about realistic content has been measured on any device.** #457 is the spike that
measures it — HDRI lighting, photographic surfaces, real trees, a real rider, each a toggle, on the
tablet, for twenty minutes — and it is running in parallel as a never-merged draft. This ADR does
**not** wait for it and does **not** invent its numbers. Where a question needs the device, the
decision below says *"measured by #457 before deciding"* and names what may not happen until it is.

---

## Decision

### D-1 — The art direction is realistic, and the ceiling is a good-looking mobile game

The trainer game's world is to look realistic: photographic ground and road surfaces, a sky that
lights the scene, photoscanned vegetation and buildings, and a rider with a real body on a real
bicycle. It is **a quality bar, not a look to reproduce**:

- ⚠️ **ADR 0009 L1 and L2 bind harder under this decision, not less.** *"No image, texture, 3D
  model … or world geometry derived from either product — including 'for reference'"* covers the
  owner's photographs of the commercial app in #429. They motivated the ruling; they are **not** a
  reference image, not a target for a visual gate, and not something an asset is matched against.
  L1's trade-dress limb — *do not reproduce their screen layout, colour palette and icon set as a
  set* — applies to the world's palette as much as to the HUD's.
- "Realistic" is judged on this project's own screenshots of its own renderer, which #457 commits
  and the owner looks at. That is a picture of our work, which L2 does not reach.

### D-2 — What does NOT change

Stated as a list so nobody re-derives any of it:

- **The engine.** three.js, pinned at 0.185.1, in the same Capacitor/WebView app (ADR 0008 D-1).
  No Unreal, no Unity (ADR 0008 D-3).
- **The renderer.** `apps/web/src/game/three-renderer.ts` stays the one file that names three,
  behind `port.ts` §`GameRenderer`, and `three-seam.test.ts` is unchanged (D-9 says why it needs no
  change).
- **The placement.** `scatter.ts` still decides where scenery stands, from the rider's own route —
  and so do the systems #468 added: `landform.ts`, `waterways.ts` and `settlements.ts` (#458, #459,
  #460). ADR 0022 D-4's list stands in full, and `arrangement-unchanged.test.ts`' digest is the
  test: **only what is drawn at a place changes, never the place.** A rider riding the same route in
  either world rides past the same village.
- **The HUD** stays opaque DOM panels over the world (#423).
- **The licence gates.** `CC0-1.0` and `CC-BY-4.0` under `apps/` only; `ASSET001`–`ASSET006`
  unchanged by this ADR (D-5 names the one addition #430 owes).
- **The rider's cadence rule.** `bicycle.ts`: the rider's cranks turn exactly when the HUD shows a
  cadence number, at exactly that number. A realistic rider is posed from the same crank angle.
- **The road's colour is information.** `terrain.ts` tints the surface by signed gradient against
  `MINIMUM_TINT_CONTRAST_RATIO`, and the lines share its vertex buffer. A photographic road
  **modulates** that tint and never replaces it (#425's second point), and the road stays one draw
  call.

⚠️ **The optional native renderer is not decided here.** #433 (the spike) and #434 (the ADR) ask
whether Godot should render the world beneath the WebView on Android and iOS. This ADR decides the
**art direction** and the **asset posture**, which hold whichever renderer draws them; the
three.js-specific parts (the numbers in D-6, D-8's format, D-9's lighting technique) are *per
renderer*, and #434 may make the three.js realistic path unnecessary. Nothing here presumes its
outcome in either direction.

### D-3 — Two worlds, each coherent. The stylised set is kept as the low rung, never deleted

A photoscanned rock beside a flat-shaded Kenney house looks worse than either alone (#430, and
ADR 0022 D-1(b)'s own finding). So the rule is **coherence per rung**, not per asset:

- **The stylised world** is today's: the Kenney models, #366's vertex-colour path, the
  `MeshLambertMaterial` / flat pair, the procedural surface detail. It is `quality.ts`'s
  `QUALITY_LADDER` exactly as it stands, and it is **kept, not deleted** — it is the fallback, the
  device floor's world, and the world that is precached (D-7).
- **The realistic world** is a second set of rungs above it. It is **chosen by the rider**, in the
  shape `quality.ts` §`RIDER_SHADOW_MAP_RUNG` already established for the one rung a rider must ask
  for, and — like that rung — it is never entered by the thermal logic on its own.
- **Stepping down is by whole world.** Under thermal pressure the realistic rungs reduce within
  themselves, and the realistic ladder's floor steps to the stylised ladder's **top** — every kind
  at once. No rung ever draws a stylised kind beside a realistic one.
- **The default is the stylised world on every device**, until a measurement taken with #457's
  procedure shows a device class holding the realistic top rung for twenty minutes with the headroom
  #457 states. Changing a default cites that measurement. **ADR 0008 D-4's floor device is never
  defaulted to realism.**

This is #431's second question answered in the shape it proposed, and it is also the answer #434
would need if the native renderer goes ahead: *the stylised world is the browser's world and the
fallback.*

### D-4 — Sources: what is in, what is out, and how a new one is added

**In**, each verified per asset at download time with the page, the date and the grant recorded in
`ASSETS.toml`:

| Source | Licence | For |
|---|---|---|
| **Poly Haven** | `CC0-1.0` — *"All assets (HDRIs, textures and 3D models) on this site are licensed as CC0"* | HDRI skies, ground and road materials, photoscanned vegetation and rocks |
| **ambientCG** | `CC0-1.0` — *"All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License"* | PBR materials |
| **MakeHuman**, exports only | `CC0-1.0` for exports (#430, read 2026-09-20) | the rider's body |
| **Kenney**, **Quaternius** | `CC0-1.0` | the stylised world; Kenney stays its source |
| An individual model under `CC-BY-4.0`, verified per asset | `CC-BY-4.0`, under ADR 0023 | chiefly a road bicycle (#369) |

**Out**, whatever the convenience: **Mixamo** (Adobe forbids distributing the raw character and
animation files, and a public repository is distribution); **Quixel Megascans / Fab** (not an open
licence); anything **`-NC`** or **`-SA`**; Sketchfab's **"Free Standard"**; and anything **marked or
known to be AI-generated**. #369's rejection table is the longer record.

⚠️ **ADR 0022 D-2's author boundary is replaced by this list**, and the list is the new boundary: a
source not in it is a change to this ADR — a superseding ADR, because admitting a source is a
decision — and never a pull-request judgement. `ASSETS.toml`'s `source` column is still what makes a
new author visible in review.

⚠️ **For a CC-BY asset, ADR 0023 binds in full**: `creator`, `url` and `modified` (`ASSET006`),
and the in-app credits screen generated from them (#358, which has landed, so ADR 0023 D-7's
precondition is met). Decimation, re-texturing, rescaling and merging are modifications under
ADR 0023 D-4, and `modified` says which in words.

### D-5 — A derived asset is reproducible from a recorded input by a committed script

This **replaces ADR 0022 D-1's "verbatim and unconverted"** for the realistic world, and it keeps
the property D-1 was protecting rather than abandoning it. D-1 required that `source` and `sha256`
describe the same file; a derived file breaks that by construction, so the property is restated for
one:

- `ASSETS.toml` records the **upstream URL and digest of the input**, the **script** that produced
  the output, the **pinned tool version**, and the **output digest**.
- The script is committed and deterministic, and re-running it reproduces the committed output.
  If Blender's exporter turns out not to be byte-stable, that is #430's finding to record, and the
  fallback is a digest over geometry and attributes rather than a pretended byte match.
- **[#430](https://github.com/openzigs/onyourleft/issues/430) owns the pipeline and the manifest
  keys.** ⚠️ `ASSET005` refuses an unrecognised key rather than ignoring it, so **no derived asset
  can be committed until #430 teaches the checker the new keys** — which is the sequencing this ADR
  wants, and it is enforced rather than hoped for.
- **Blender is a tool, never a dependency.** Its GPL does not reach its output. Scripts that
  `import bpy` live under `apps/` (`AGPL-3.0-or-later`, GPL-3.0-compatible), never under
  `packages/` without an ADR — #430 records the reasoning.

The stylised world's Kenney files are untouched by this: they remain upstream bytes, and ADR 0022
D-5's row-before-commit rule applies to both worlds.

### D-6 — The budget is stated before the first import: its shape here, its numbers from #457

Question 1. Three things are decided now; the rest is **measured by #457 before deciding**.

**Decided now:**

- **The budget's dimensions**, per asset class (ground and road surfaces, sky/environment,
  vegetation, rocks, structures, riders): triangles per asset, texture dimension and format per
  asset, total GPU texture memory for the rung, and the build's added bytes.
- **A hard ceiling on texture size: 2048 px on a side**, whatever the source publishes. 4K and 8K
  source maps are downsized in D-5's pipeline and never committed at source resolution.
- **The realistic world never enters a first visit's download in a browser** — that is D-7.

**Measured by #457 before deciding**: the triangle budget per class, the texture-memory ceiling,
which of #457's six items fit together inside a frame with headroom for twenty minutes and at what
render scale, and the APK size the realistic set may add. These are written into source beside
`quality.ts` as constants with a test — the posture `SCATTER_MAX_ITEMS` and
`MAXIMUM_SCENERY_VARIANTS` already take — **by the issue that lands the first realistic asset, and
that issue may not merge without them.** A budget in a comment is not a budget.

⚠️ Per #431's comment of 2026-09-20: these are **three.js** numbers. If #434 adopts a native
renderer, its numbers are its own and are not inherited from these.

### D-7 — The precache holds the stylised world only. Realism is fetched when the rider asks for it

Question 3, and the collision with ADR 0024 D-2 — *"the whole asset graph is precached"*, 27 files
and 3.09 MiB uncompressed as #418 measured it — which cannot stay implicit.

- **In a browser, the stylised world stays precached**, exactly as ADR 0024 D-2 built it. A rider
  in a basement still opens the app with the network off and rides, in the stylised world.
- **The realistic set is excluded from the precache**, by a **rule** that selects it by where it
  lives in the build — an entry in `apps/web/tools/precache/precache.ts` §`PRECACHE_EXCLUSIONS` —
  and **never** by a list of file names, which would fail open against adding an asset
  (#142's defect, ADR 0024 D-2's own argument). The same pull request adds a gate in both directions:
  every stylised asset is precached, and no realistic one is.
- **It is fetched when the rider chooses the realistic world** (D-3), from the same origin as the
  app. That is static files beside the bundle, not a service: owner decision D6 is untouched.
- **The worker does not hold it for offline use.** A rider-initiated "keep the realistic world on
  this device" would be a second cache strategy, which ADR 0024 names as the signal that its own
  choice has gone wrong. It is **not decided here**; it is its own issue, if riders ask.
- **Offline with the realistic world chosen, the game falls back to the stylised world and says
  so.** A silent downgrade is a rider wondering whether the setting broke.
- **Inside the Android shell** nothing is downloaded: `capacitor.config.ts` copies `apps/web/dist`
  into the APK, so the realistic set ships inside it and ADR 0024 D-4's no-worker rule is unchanged.
  The cost moves to the APK's size, which is D-6's budget. (If #434 adopts a native renderer, its
  realistic assets ship inside the APK/IPA in its own format and this bullet holds unchanged.)

### D-8 — Texture format: plain images first, KTX2 when #457 says memory forces it

Question 4. The first realistic layer ships **tiled PNG/JPEG with mipmaps**, which is #425's
position and costs no new binary. **Whether to adopt KTX2/Basis is measured by #457 before
deciding**: a 2048² RGBA texture is 16 MiB of GPU memory uncompressed before mipmaps, and the
tablet exposes ASTC and ETC, so the answer is likely to be yes for the realistic set — but "likely"
is not a measurement.

So that the decision, when it comes, does not also have to be a licence ruling, the facts were read
on 2026-09-21 from the installed tree: `three@0.185.1` (MIT) already ships `KTX2Loader.js` under
`examples/jsm/loaders/` and the transcoder as `examples/jsm/libs/basis/basis_transcoder.js` and
`basis_transcoder.wasm` (527 333 bytes), whose README gives **Apache-2.0** (Binomial's
basis_universal). ⚠️ `DEP001` reads the package's declared licence, which is MIT, and **cannot see
the vendored Apache-2.0 file inside it** — so the issue that adopts KTX2 checks that file's notice
obligations by hand, and if it copies the transcoder into the tree rather than serving it from the
package it needs an `ASSETS.toml` row like any other binary.

### D-9 — Lighting: `three-seam.test.ts`'s two light classes stand

Question 5. **Yes, they stand**, because the realistic world's lighting needs no new light class:

- **Image-based lighting** from a CC0 HDRI is an environment map — `PMREMGenerator` into
  `scene.environment` — not a light. It lights the physically based materials D-10 gives the
  realistic world and leaves the stylised world's Lambert materials alone.
- **Baked lighting and ambient occlusion** are texture or vertex data produced by D-5's pipeline.
  *"Essentially free at render time"* (#426's source) and no class at all.
- The one `DirectionalLight` stays the sun — `world.ts`'s single direction, which #426's contact
  shadows already read — so the realistic world has one sun, not a second one.

⚠️ `three-seam.test.ts` matches any capitalised `Light` in the renderer's source, so a light probe
or a spot light is a red test, which is the intended answer: **adopting either is a change to this
decision, not to the test.** Real-time shadow maps add no class and stay #426's business — the
rider-only map is already an opt-in rung; **a shadow map over the scenery is measured by #457
before deciding**.

### D-10 — Two renderer paths, and which rung uses which

Question 7.

| | Stylised rungs | Realistic rungs |
|---|---|---|
| Materials | `MeshLambertMaterial` / `MeshBasicMaterial` (`shading: 'flat'`) | physically based, textured |
| Colour | #366's vertex colours, `scenery-palette.ts` §`SCENERY_PALETTE` as the gate | the asset's own textures |
| Surfaces | `surfaceDetail`'s procedural grain and mottle | photographic tiled materials, modulating the gradient tint |
| Lighting | the sun and the ambient | the sun, the ambient and the environment map |

**Both exist, in `three-renderer.ts`**, and #366's path is not retired. ⚠️ `SCENERY_PALETTE`
enumerates the stylised world's colours and asserts them; the realistic path needs its own
statement of what it can clip under tone mapping, and **the issue that lands the first realistic
surface owes it** — the palette gate does not cover a texture and must not be read as though it did.

### D-11 — A loader-built material still never reaches the scene unasserted

ADR 0022 D-7 had two bullets. **The first stands** — one file names three. **The second is
superseded in its means and kept in its end.** Its means were *"every model wears our Lambert
material and our colour, and nothing is sampled"*; realism reverses that. Its end was the reason it
existed: *"a `MeshStandardMaterial` constructed by `GLTFLoader` from a glTF's own material block is
not in any source file … and would change how the whole scene is shaded without a single gate going
red."* That remains true and remains forbidden. The realistic path reads a glTF's textures and
factors and applies them to materials **`three-renderer.ts` constructs**, and a test asserts the
material class actually on each mesh — the same discharge #341 gave ADR 0022 D-7.

### D-12 — The order of replacement, and when a rider is offered the result

Question 6. A half-replaced world looks worse than either, so the realistic rungs are built in
layers and **offered to riders only when the world is whole**:

1. **Ground, road surface, sky and environment lighting**, together — they are most of the frame,
   and the environment map is what makes every later layer look right. #425's photographic half
   lands here.
2. **Vegetation and rocks** — `tree-broadleaf`, `tree-conifer`, `shrub`, `rock`, with far-band
   impostors if #457 shows the need — and water surfaces.
3. **Structures** — every `StructureKind` #460 introduced, buildings first.
4. **Riders** — a MakeHuman body on a CC0 or verified CC-BY-4.0 road bicycle (#369), posed from
   `bicycle.ts`'s crank angle; the bot and the ghost wear the same model, told apart as #368 tells
   them apart today.

**The realistic world is reachable only from a harness or a debug build until layers 1–3 have
landed.** Layer 4 may follow them: the rider is this repository's own `bicycle.ts` geometry rather
than a pack asset, so a realistic world with the procedural rider in it is a stated, temporary
incoherence rather than a mixed pack — and #369 is the issue that ends it. ADR 0022 D-3's `post`
stays procedural in both worlds for the reason D-3 gave, and a new kind still arrives as its own
issue.

---

## Consequences

### What this enables

- A world that can compete on looks with a mobile game, without changing the engine, the app, the
  placement or a single leaf package.
- The existing investment is kept rather than written off: the stylised world is the fallback, the
  device floor's world and the offline world.
- The realistic world costs a first-time browser visitor **nothing** until they ask for it, and
  ADR 0024's offline promise survives intact for the world that is precached.
- Every decision about sources, derivation and coherence holds if #434 later moves the drawing to a
  native renderer.

### What this costs, stated plainly

- **Two worlds is two sets of assets, two material paths and two sets of gates**, for as long as
  both exist — which is for ever, because the stylised world is the floor. That is the price of
  coherence per rung, and it is paid knowingly.
- **The asset pipeline becomes a dependency of the art.** Until #430 lands, no realistic asset can be
  committed at all (D-5), and every asset after it is a script run rather than a download.
- **The APK grows** by whatever D-6's measured budget admits, on every install, whether or not the
  rider ever chooses the realistic world.
- **The browser's realistic world does not work offline.** A rider who wants realism in a basement
  gets the stylised world and is told so.
- **Frame cost is unmeasured.** ADR 0008 D-2's gate was waived rather than passed, #247's sixty-minute
  run on the floor has never been done, and #457 measures the tablet — not the floor. D-3's
  stylised default is what keeps that from being a rider's problem.
- **More CC-BY is likely**, and with it a continuing obligation per asset (ADR 0023).

### Constraints this places on other work

| Work | What binds |
|---|---|
| Any realistic asset | Blocked until this ADR merges, until #430's manifest keys exist (D-5), and — for the first one — until D-6's budget constants exist |
| [#430](https://github.com/openzigs/onyourleft/issues/430) | D-5: recorded input, committed script, pinned tool, output digest; scripts under `apps/`; the `ASSET005` key change |
| [#457](https://github.com/openzigs/onyourleft/issues/457) | Supplies D-6's numbers, D-8's KTX2 answer, D-9's scenery shadow-map answer, and D-3's default-change measurement. Its assets stay off `main` |
| [#425](https://github.com/openzigs/onyourleft/issues/425) | Its photographic half is D-12 layer 1, and it modulates the gradient tint (D-2) |
| [#426](https://github.com/openzigs/onyourleft/issues/426) | Unchanged: contact shadows on every rung, the rider shadow map an opt-in rung |
| [#369](https://github.com/openzigs/onyourleft/issues/369) | D-12 layer 4; D-4's source list; ADR 0023 for a CC-BY bicycle |
| [#433](https://github.com/openzigs/onyourleft/issues/433), [#434](https://github.com/openzigs/onyourleft/issues/434) | Not decided here. If a native renderer is adopted, D-1, D-3, D-4, D-5 and D-12 carry over; D-6, D-8 and D-9's techniques are per renderer |
| [#418](https://github.com/openzigs/onyourleft/issues/418) | Its measured first visit stands, because the realistic set is never in it (D-7) |
| The precache (`apps/web/tools/precache/`) | D-7's rule-based exclusion and its two-way gate, landed with the first realistic asset |
| Placement — `scatter.ts`, `landform.ts`, `waterways.ts`, `settlements.ts` | Unchanged by any realistic asset. `arrangement-unchanged.test.ts`' digest does not move |

### What would make this ADR wrong

- **#457 shows the tablet cannot hold even layer 1 with headroom for twenty minutes.** Then the
  realistic world is not offered on that device class at all, D-3's stylised default becomes
  permanent there, and the realistic path's value rests on desktop browsers — which is worth
  re-asking the owner about rather than building anyway.
- **#434 adopts a native renderer.** Then the three.js realistic path may be unnecessary, and the
  right move is to stop building it rather than to finish it for symmetry; the art direction,
  sources, pipeline and coherence rule carry over unchanged.
- **The pipeline is not reproducible** (#430). Then D-5 falls back to digests over geometry and
  attributes, and if even those are unstable, derived assets lose the property ADR 0022 D-1 was
  protecting — which would be a reason to reopen this ADR, not to commit unverifiable bytes.
- **Coherence per rung proves too strict** — layer 1 alone looks better than the stylised world and
  riders want it before layer 3. That is a judgement from our own screenshots, and it would amend
  D-12's offering rule by a superseding decision, never by quietly shipping a mixed rung.
- **A source's licence changes or turns out to be wrong.** CC0 and CC-BY are irrevocable grants by
  someone who must have held the rights; `ASSETS.toml` makes each claim discoverable, not true.
- **CC-BY through an app store turns out to carry an obligation ADR 0023 did not anticipate.** It is
  ADR 0023's and ADR 0025's question, not re-argued here, but realism is what makes CC-BY assets
  likely enough for it to matter.

---

## What was read, and when

| Source | Read | What it established |
|---|---|---|
| [#431](https://github.com/openzigs/onyourleft/issues/431) and its comment of 2026-09-20 | 2026-09-21 | the ruling, the seven questions, the "what does not change" list, and that questions 1–5 are per renderer |
| [#430](https://github.com/openzigs/onyourleft/issues/430) | 2026-09-21 | the source table, the rejections, the headless-Blender measurement and the derived-asset rule; the MakeHuman CC0-exports reading of 2026-09-20 |
| [#433](https://github.com/openzigs/onyourleft/issues/433), [#434](https://github.com/openzigs/onyourleft/issues/434), [#457](https://github.com/openzigs/onyourleft/issues/457), [#425](https://github.com/openzigs/onyourleft/issues/425), [#426](https://github.com/openzigs/onyourleft/issues/426), [#429](https://github.com/openzigs/onyourleft/issues/429) | 2026-09-21 | the native-renderer question, the device facts, the spike's scope, the texture and shadow positions |
| `polyhaven.com/license` | 2026-09-21 | *"All assets (HDRIs, textures and 3D models) on this site are licensed as CC0"* |
| `docs.ambientcg.com/license/` (redirected from `ambientcg.com/license`) | 2026-09-21 | *"All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License."* |
| `makehumancommunity.org/content/license.html` | 2026-09-21 — **connection refused**; relied on #430's reading of 2026-09-20 | CC0 for exports; **re-read before the first MakeHuman asset is committed** |
| Installed tree, `three@0.185.1` | 2026-09-21 | `KTX2Loader.js`, `HDRLoader.js`, `EXRLoader.js`; `libs/basis/basis_transcoder.wasm` 527 333 bytes, README licence Apache-2.0; package licence MIT |
| `apps/web/src/game/quality.ts` | 2026-09-21 | the four-rung `QUALITY_LADDER`, `surfaceDetail` (#425's no-asset half), and `RIDER_SHADOW_MAP_RUNG` as the precedent for a rung a rider asks for |
| `apps/web/src/game/three-seam.test.ts` | 2026-09-21 | exactly `AmbientLight` and `DirectionalLight`, matched anywhere in the renderer's source |
| `apps/web/tools/precache/precache.ts` | 2026-09-21 | the precache is the build's output less `PRECACHE_EXCLUSIONS`, a list of patterns |
| [ADR 0022](0022-game-scenery-model-pack.md), [ADR 0024](0024-offline-and-caching-posture.md) and its 2026-09-21 amendment, [ADR 0008](0008-mobile-client-architecture.md), [ADR 0009](0009-clean-room-posture.md), [ADR 0013](0013-adr-amendments.md), [ADR 0023](0023-cc-by-assets-and-attribution.md) | 2026-09-21 | what is superseded, what is narrowed, and what stands |

⚠️ **No competitor's product, asset, screenshot or source was consulted**, and no asset was
downloaded, converted or committed in the course of writing this. ADR 0009 L2 and R2 are untouched.
