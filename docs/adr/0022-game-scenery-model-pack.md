# ADR 0022: One CC0 model pack for the game's scenery, and what #240's procedural premise buys

- **Status**: Accepted
- **Date**: 2026-09-17
- **Deciders**: the repository owner, who ruled on
  [#302](https://github.com/openzigs/onyourleft/issues/302) on 2026-09-16 — *"adopt one CC0 pack,
  with a provenance gate first"*. The ruling is the owner's because it reverses the founding premise
  of an epic and because `CLAUDE.md` §3 makes licence questions answerable **before** the code is
  written. Everything below the ruling — which pack, which kinds, what stays procedural — is the
  author's, following from it and from the sources in §"What was read, and when"
- **Issue**: [#340](https://github.com/openzigs/onyourleft/issues/340), under epic
  [#240](https://github.com/openzigs/onyourleft/issues/240)
- **Number**: **0022**, not 0021. ⚠️ `CLAUDE.md` §7 and
  [`docs/architecture.md`](../architecture.md)'s index both said 0021 was the next free number *with
  no live reservation*, and both were **stale**:
  [#330](https://github.com/openzigs/onyourleft/issues/330) claimed 0021 for the ghost-racing ADR
  before this issue was filed, and that ADR is not yet written. Taking 0021 here would have
  collided on `ADR001` the day #330 lands. The same pull request records the reservation in both
  places and moves the next-free sentence on to 0023
- **Supersedes**: nothing
- **Applies**: [ADR 0009](0009-clean-room-posture.md) L2 and
  [ADR 0015](0015-dependency-licences.md) D-2 to a question neither had been asked — a **committed
  art asset** rather than a dependency or a competitor's file. It **changes neither**
- **Relates to**: [ADR 0008](0008-mobile-client-architecture.md) D-5, whose *"there is no world to
  design"* bullet this decision narrows to the terrain rather than falsifies — see
  §"Constraints this places on other work" for when that becomes an amendment and why it is not one
  today

---

## Context

[#240](https://github.com/openzigs/onyourleft/issues/240)'s first decision, taken up front and set
off in its own block, reads:

> *"This epic is purely procedural. It adds no data source, makes no network request, stores
> nothing, and needs no new npm dependency."*

and its overview says the world is

> *"ground, sky, depth, a road that reads as a road, and scenery that changes along the route — **all
> of it generated at runtime from the athlete's own imported route and nothing else.**"*

The owner looked at that world on a tablet on 2026-09-15 and found it reads as flat coloured
polygons. #302 is the discussion that followed, and on 2026-09-16 the ruling was to adopt art.

**That reverses the epic's founding sentence, which is why this is an ADR and not a pull request.**
#240 did not choose the procedural route because it was cheap; it chose it because — in its own
words — it is *"the option that is **structurally free of the licence question**"*, the same
argument [ADR 0012](0012-data-licence.md) D-1 made for segment geometry and
[ADR 0008](0008-mobile-client-architecture.md) D-5 made for terrain.

### What that premise actually bought, stated before it is traded away

Not "no licence problem". Something stronger and worth naming precisely, because the difference is
the whole content of this decision:

| Under #240's premise | Under this decision |
|---|---|
| There is **no asset**, so there is nothing to licence | There are assets, and each one's licence is a recorded claim |
| There is **no provenance to track** — every vertex is arithmetic in a file with an SPDX header | Provenance is a row in [`ASSETS.toml`](../../ASSETS.toml) that somebody wrote and somebody else must trust |
| There is **no third party to credit**, and no third party whose terms could change | There is one, and CC0 is irrevocable — but a *wrong* CC0 claim is not made right by being irrevocable |
| The question **does not arise** | The question is **answered**, and answering it is a standing obligation rather than a one-off |

The last row is the trade. A question that does not arise costs nothing for ever; a question that is
answered has to be answered again for every asset, by every contributor, in every review. #339's
gate is what makes that cost bounded and mechanical instead of a matter of somebody remembering.

### What has already changed since #302 asked, and is not re-litigated here

Two of #302's four objections were discharged before the ruling, and they are recorded so that a
reader does not re-open them:

- **The cheaper alternative was already taken.** #302 proposed converting scenery from
  `MeshBasicMaterial` to `MeshLambertMaterial` first and re-asking the question afterwards.
  [#286](https://github.com/openzigs/onyourleft/issues/286) had already done it —
  `apps/web/src/game/three-renderer.ts`: *"The scenery and the three markers wear a
  `MeshLambertMaterial`, because a cone, a sphere, a box and an octahedron all have a form for a
  light to find."* The lighting improvement has been had. What remains is genuinely about shape.
- **The frame-budget objection has numbers now**, and §"What this costs" says exactly how far they
  go and where they live, because they are not where #341 currently says they are.

---

## Decision

### D-1 — The scenery's **shapes** come from one CC0 source, and that source is **Kenney.nl**

Not Quaternius, not Poly Pizza, not Poly Haven. Four reasons, in the order they actually decide it.

**(a) It ships glTF, and the alternative does not.** This is the discriminator that turned out to be
checkable rather than aesthetic, and it was checked:

| Source | Formats offered | Read |
|---|---|---|
| **Kenney.nl** | *"OBJ"*, *"FBX"* and *"GLB"* — and *"The glTF file format is distributed as GLB in Kenney game assets"* | `kenney.nl/knowledge-base/game-assets-3d/importing-3d-models-into-game-engines`, 2026-09-17 |
| **Quaternius** *Ultimate Nature Pack* | *"FBX, OBJ, Blend"* — **no glTF, no GLB** | `quaternius.com/packs/ultimatenature.html`, 2026-09-17 |
| **Quaternius** *Simple Buildings* | *"FBX, OBJ, Blend"* — **no glTF, no GLB** | `quaternius.com/packs/simplebuildings.html`, 2026-09-17 |

⚠️ **The reason this decides it is not "three has no other loader" — it has three others.**
`three@0.185.1` ships `FBXLoader.js`, `OBJLoader.js` and `ColladaLoader.js` beside
`GLTFLoader.js`, all four in `examples/jsm/loaders/` and reachable through the package's own
`./addons/*` export. Verified in the installed tree, 2026-09-17. So "we could not load an FBX" would
be false.

The reason is **[#339](https://github.com/openzigs/onyourleft/issues/339)'s manifest**. A format the
upstream pack does not publish means the committed bytes are the output of somebody's conversion,
and then `ASSETS.toml`'s two strongest columns disagree with each other: `source` names a pack and a
URL, `sha256` pins bytes that pack never published, and **nothing on a bare clone can reconcile
them**. The digest still detects a substitution, which is what it is for — but the provenance claim
becomes "trust the conversion somebody ran once", which is the shape this repository has refused
three times (#299, #318, #142). Kenney publishes GLB, so the committed bytes can be the upstream
bytes and the manifest row can be true end to end.

**(b) One author, one house style, and the style is the point.** #302's own finding, and it is the
correct one: *"Mixing a photoreal model into a flat-shaded world looks worse, not better."* Poly
Haven is 100 % CC0 and photoreal, which is the wrong style for a scene of flat-shaded solids under a
single `DirectionalLight`. Poly Pizza is licence-filterable and is **many hands, many styles** —
assets from three contributors would be less consistent than the cones they replace. Kenney and
Quaternius are each one author; (a) is what separates those two.

**(c) The licence is CC0, stated by the source rather than by a summary of it.** Read 2026-09-17:

> *"Yes, all game assets on the asset pages are public domain licensed (CC0). You're free to use
> them, even in commercial projects."* — `kenney.nl/support`
>
> *"Attribution is not required, but if you choose to give credit you can do so by mentioning
> 'Kenney'."* — the same page
>
> *"Creative Commons CC0"* — `kenney.nl/assets/nature-kit` and `kenney.nl/assets/city-kit-suburban`

⚠️ **One thing on that page is a limit and not a permission**, and it is recorded because it is
exactly the sentence a reader skims past: *"their logo should not be used, as it's reserved for
official studio projects."* The **logo is not CC0**. Nothing in this decision wants it; naming it
here is what stops somebody adding an "assets by Kenney" badge in good faith and shipping a mark
this project has no licence to.

**(d) Coverage, so the decision is not re-taken in six months.** *Nature Kit* is 330 assets of trees,
rocks and plants; *City Kit (Suburban)* is 40 building variations. Both CC0, both from the same
author, both read 2026-09-17. That covers every kind D-3 replaces.

### D-2 — "One pack" means **one source and one house style**, not one zip file

⚠️ **This needs saying because it looks like a loophole and is not.** #302's ruling and #340's body
both say *"One pack, not a mixture"*. **No single Kenney kit holds all six kinds** — trees and rocks
are in *Nature Kit*, buildings are in *City Kit*. Read literally, "one zip" would forbid a building
outright; read loosely, "one pack" would permit a Quaternius tree beside a Kenney house, which is
precisely the mixture the rule exists to stop.

So the boundary is **the author, not the archive**. Assets come from `kenney.nl` and from nowhere
else. Within that, the kits this decision names are:

| Kind | Kit |
|---|---|
| `tree-broadleaf`, `tree-conifer`, `shrub`, `rock` | *Nature Kit* |
| `building` | *City Kit (Suburban)* |

⚠️ **A kit from a different author is a change to this ADR, not a pull-request decision.** That is
the whole enforcement: `ASSETS.toml`'s `source` column names the pack and the URL for every
committed binary, so a second author appears as a manifest row a reviewer can see, rather than as a
model nobody looked at twice.

### D-3 — **Five** of the six kinds are replaced. `post` stays procedural, and the set does not grow

`apps/web/src/game/scatter.ts` places exactly six kinds and
`apps/web/src/game/three-renderer.ts` §`SCATTER_STYLE` gives each one a primitive. Five get a model:

| Kind | Today | After #341 |
|---|---|---|
| `tree-broadleaf` | `SphereGeometry(2.2, 6, 4)` | model |
| `tree-conifer` | `ConeGeometry(1.3, 7, 6)` | model |
| `shrub` | `SphereGeometry(0.8, 5, 3)` | model |
| `rock` | `OctahedronGeometry(0.9, 0)` | model |
| `building` | `BoxGeometry(7, 6, 9)` | model |
| **`post`** | `CylinderGeometry(0.07, 0.07, 1.1, 5)` | ⚠️ **unchanged** |

**Why `post` is excluded, and it is a reason rather than a cost saving.** It is a marker post 1.1 m
tall and 14 cm across. At the distances this scene draws — a corridor a few hundred metres long,
fogged out well before its end — a model of a post and a five-sided cylinder are the same handful of
pixels, which is the argument `three-renderer.ts` already makes in its own comment about the
broadleaf canopy: *"at the distances fog leaves visible, a six-segment sphere and a smooth one are
the same handful of pixels."* A model would cost a manifest row, bundle bytes inside the Android
APK, and a share of #245's instance budget, and buy no silhouette. **A shape with no silhouette to
buy is not worth buying.**

⚠️ **And the set stays at six.** Having a pack of 40 000 assets available is not a reason to place a
seventh kind. A new `ScatterKind` is a `scatter.ts` change with its own placement question — what
weights it, what verge it needs, what the tree line does with it — and it arrives as its own issue,
never as a side effect of somebody browsing a kit.

### D-4 — Only the **geometry** is bought. Everything `scatter.ts` decides stays generated

This is the half of the decision that keeps #240's world honest, and it is stated as a list so that
a future reader cannot mistake its scope. **None of the following changes:**

- **Where** scenery goes — `scatter.ts` is *"a seeded, stateless hash of where you are rather than a
  walk forward"*, so the same route gives the same world.
- The **verge** that keeps a tree out of the carriageway.
- The **budget** and `§thin`, which *"thins the far view instead of truncating it"*.
- The **tree line**, read from the route's own latitude and altitude.
- The **density rung** on `QUALITY_LADDER` from #245 — 240 items at target, 60 at floor.
- The **cull** from #244, `three-renderer.ts` §`lateralReachMetres`.

⚠️ **So #240's *"a route the athlete imported is the one world"* survives, narrowed by exactly one
word: the route decides the **world**, and a pack decides the **shapes in it**.** A rider's own GPX
still determines every position, every density and every altitude band. If a route produces a
different *arrangement* of scenery after #341 lands, that is a defect and a test should say so —
#341 carries that criterion.

### D-5 — Every asset lands under `apps/`, with an `ASSETS.toml` row written **before** it is committed

[#339](https://github.com/openzigs/onyourleft/issues/339) landed on 2026-09-16 and its gate is
live: `ASSET001`–`ASSET005` in `scripts/check-repo-rules.sh`, running on a bare clone. This decision
adds nothing to it and depends on all of it.

The path is not a preference. `ASSET004` admits `CC0-1.0` as a **weak** licence — permissive
anywhere, weak **under `apps/` only** — which mirrors [ADR 0015](0015-dependency-licences.md) D-2's
distributed-closure table. A `.glb` under `packages/` would fail the build, and it *should*: an
Apache-2.0 leaf package exists to be dropped into somebody else's project, and a public-domain
dedication travelling inside one is an obligation that package's own `LICENSE` does not describe.
The game is `apps/web` (`CLAUDE.md` §4h), so the constraint costs nothing here and is real anyway.

⚠️ **What the digest does and does not establish** is already written at the top of `ASSETS.toml`
and is repeated here because this is the first decision that leans on it: it pins the committed
bytes, so a substitution is visible in review and in CI. **It does not establish that the bytes are
the upstream artefact they name** — nothing that runs without the network can. D-1(a) is what keeps
that gap as small as it can be: no conversion step sits between the published file and the committed
one.

### D-6 — ADR 0009 L2 is satisfied, and here is the reasoning rather than the conclusion

[ADR 0009](0009-clean-room-posture.md) L2 forbids, verbatim:

> *"No Strava or Zwift code, asset, map data or course geometry, by any route… No image, texture,
> 3D model, typeface, audio, avatar art, world geometry or marketing string derived from either
> product — including 'for reference' and including machine-translated or decompiler output."*

⚠️ **"We added 3D models to a trainer game" is exactly the sentence that invites the question**, so
it is answered explicitly rather than left for a reader to work out:

- The models are **general-purpose CC0 assets from a general-purpose asset library**, published for
  any game and derived from no product in L2's list.
- L2's check is *"for any file in the diff that could plausibly have come from somewhere, the PR
  body says where it came from"*. Under D-5 that is stronger than a PR sentence: it is a committed
  manifest row with a source, a URL, a licence, a date and a digest, which outlives the PR body.
- **Nothing in this decision permits looking at a competitor's world for reference.** L2's "for
  reference" clause is untouched, and #240's foreclosure list — including R2's do-not-read rule for
  `zwift-offline` and the ban on a reference screenshot for a visual-regression test — binds every
  sub-issue exactly as before.

### D-7 — The seam holds, and a glTF's own materials must not survive into the scene

Two mechanical constraints that follow, and both are places #341 can go wrong quietly:

- **`apps/web/src/game/three-renderer.ts` stays the only file that names the rendering library**,
  `GLTFLoader` included. `three-seam.test.ts` matches `['"]three(?:\/[^'"]*)?['"]` in four import
  spellings, so `three/addons/loaders/GLTFLoader.js` is caught by the existing rule with no change
  to it. A loader imported anywhere else is a red test, which is the intended answer.
- ⚠️ **A model arriving with its own PBR material is a hole the seam test cannot see.**
  `three-seam.test.ts` allows *exactly* an `AmbientLight` and a `DirectionalLight`, and it enforces
  that by matching the capitalised word `Light` **in source**. A `MeshStandardMaterial` constructed
  by `GLTFLoader` from a glTF's own material block is not in any source file, carries no `Light` in
  its name, and would change how the whole scene is shaded without a single gate going red. #341's
  criterion is `MeshLambertMaterial` on every scatter mesh; **this is the reason that criterion
  exists**, and a test that asserts the material actually on the instanced mesh is what discharges
  it.

---

## Consequences

### What this enables

- Trees look like trees, which is the whole of what #302 asked and what #341 will build.
- The scenery's shapes stop being the thing that carries the world, so the parts that already work
  — the road corridor, the gradient tint, the fog, the placement — are judged on their own.
- The pack costs **no new npm dependency**: `GLTFLoader` already ships inside the pinned
  `three@0.185.1` (MIT, zero runtime dependencies), verified in the installed tree on 2026-09-17. So
  `DEP001` is not engaged, the lockfile does not move, and `three` stays at 0.185.1 per #240's own
  warning.

### What this costs, stated plainly

- **#240's founding premise is false from today.** The epic says *"all of it generated at runtime
  from the athlete's own imported route and nothing else"* and *"this epic is purely procedural"*,
  and neither sentence survives this. A dated entry on #240 records that; it is not repaired by
  being small.
- **The licence question is now permanently open rather than absent.** Every future asset needs a
  source, a licence somebody read, a date and a digest — for ever, for every contributor. That is a
  recurring cost where there was none, and #339's gate makes it mechanical rather than removing it.
- **Bundle weight lands in the Android APK.** `apps/mobile/capacitor.config.ts` sets
  `webDir: '../web/dist'`, so anything shipped in the web build is shipped to a rider's phone. #341
  owes a stated number; this ADR does not guess one.
- ⚠️ **The frame cost is unmeasured, and the numbers #341 cites are not where it says they are.**
  This was checked rather than assumed on 2026-09-17:
  - The real post-#323 measurement is **frame time 50th 13 ms, GPU 50th 6 ms, legacy jank 0 —
    0.00 %**, on a Pixel Tablet over a 20-second `dumpsys gfxinfo` window, 2026-09-16.
  - It lives in a **comment on [#323](https://github.com/openzigs/onyourleft/issues/323)**.
    [`docs/validation/0002-android-shell-and-game.md`](../validation/0002-android-shell-and-game.md)
    Part F's *"F results"* table — the repository's own record — **is still empty**, and Part E, the
    60-minute run on the device floor, has never been run at all
    ([#247](https://github.com/openzigs/onyourleft/issues/247)).
  - So #341's *"re-measured against #246's committed baseline"* and #302's *"GPU 7 ms median"* both
    describe a baseline that is **not committed** and a figure that reads 6 ms rather than 7. The
    honest statement is: there is one good measurement, it is in an issue thread, and #341's
    re-measurement has to fill Part F in the same pull request or the comparison has no home.
  - ⚠️ **And a low GPU figure is not headroom in the way it looks.** Part F says why in its own
    words: *"A low GPU time is not good news here. 6 ms against a 16.7 ms budget is what 'the
    renderer is waiting on a simulation with nothing new to say' looks like."* Six milliseconds of
    GPU work is the measurement of a scene with six instanced primitives in it, and it is the number
    models will move.
- **[ADR 0008](0008-mobile-client-architecture.md) D-2's rendering gate is still waived rather than
  passed** (its 2026-09-08 amendment). Nothing here cancels that, and this is the third visual
  change in a row resting on it.

### Constraints this places on other work

| Work | What binds |
|---|---|
| [#341](https://github.com/openzigs/onyourleft/issues/341) | D-3's five kinds and no sixth; D-4's list is a test, not a promise; D-7's material assertion; one `InstancedMesh` per kind, so draw calls do not multiply by item count; a manifest row per asset **before** it is committed; a stated bundle number; and Part F of validation 0002 filled in the same pull request |
| [#341](https://github.com/openzigs/onyourleft/issues/341), on merge | ⚠️ **ADR 0008 D-5's bullet *"Terrain generated from the route means there is no world to design"* becomes false of the scenery**, and an appended dated `## Amendments` entry under [ADR 0013](0013-adr-amendments.md) is owed then. **It is deliberately not written today**: no asset exists yet, and an amendment recording that a statement *has become* false is not written in advance of it becoming false. The terrain half of that sentence — the road corridor from `RouteProfile` — stays true whatever #341 does |
| A **seventh** scatter kind | D-3. Its own issue, with its own placement question. Not a side effect of a kit being available |
| An asset from a **second author** | D-2. A change to this ADR, visible as an `ASSETS.toml` `source` a reviewer can read |
| [#248](https://github.com/openzigs/onyourleft/issues/248) — an external **data** source | Untouched. #302 is explicit that art and data are siblings and *"neither answer implies the other"*. This ADR rules on art only; #240's NFR-5 and `privacy/boundaries.ts` still bind anything that would fetch |
| Any new `Light`, or a material change in the scene | `three-seam.test.ts`, unchanged. D-7 records the one thing it cannot see |

### What would make this ADR wrong

- **The style ages badly against the rest of the scene.** A low-poly kit beside a procedural road
  with a signed-gradient tint and solved fog is a judgement made from screenshots, not from a
  measurement, and it is the most likely of these to happen. The fallback is cheap and is worth
  recording: `SCATTER_STYLE` is one table in one file, so reverting to primitives is a revert rather
  than a rewrite.
- **The frame cost on the device floor proves prohibitive.** Still unmeasured —
  [#247](https://github.com/openzigs/onyourleft/issues/247) — and ADR 0008 D-2's gate was waived
  rather than passed. If #341's re-measurement moves the GPU column materially at the floor, the
  answer is D-3 in reverse: fewer kinds get models, starting with the ones with least silhouette.
- **A licence claim in the pack turns out to be wrong.** CC0 is a dedication by someone who must
  have held the rights to make it. Nothing in this repository can verify that, and #339's manifest
  exists precisely to make the claim **discoverable** rather than true — a row naming a source and a
  date is what a takedown or a correction would be checked against.
- **A single Kenney kit covering all six kinds appears**, or Quaternius publishes glTF. Either would
  weaken D-1(a) or D-2's author-not-archive boundary, and neither would reverse the ruling.

---

## What was read, and when

Every external page below was read on **2026-09-17** from this environment, and the quotations are
verbatim. #240's BR-1 asks each pull request in this epic for a provenance sentence; this is this
document's.

| Source | What it established |
|---|---|
| `kenney.nl/support` | *"all game assets on the asset pages are public domain licensed (CC0)"*; attribution not required; **the logo is not included** |
| `kenney.nl/assets/nature-kit` | *"Creative Commons CC0"*, 330 assets, trees / rocks / plants |
| `kenney.nl/assets/city-kit-suburban` | *"Creative Commons CC0"*, 40 building variations |
| `kenney.nl/knowledge-base/game-assets-3d/importing-3d-models-into-game-engines` | *"OBJ"*, *"FBX"*, *"GLB"*; *"The glTF file format is distributed as GLB in Kenney game assets"* |
| `quaternius.com/packs/ultimatenature.html` | CC0; formats *"FBX, OBJ, Blend"* — **no glTF/GLB** |
| `quaternius.com/packs/simplebuildings.html` | CC0; formats *"FBX, OBJ, Blend"* — **no glTF/GLB** |
| Installed tree, `three@0.185.1` | MIT, `GLTFLoader.js`, `FBXLoader.js`, `OBJLoader.js` and `ColladaLoader.js` all present under `examples/jsm/loaders/`, reachable through the package's `./addons/*` export |
| `scripts/check-repo-rules.sh` §`ASSET_LICENCES_WEAK` | `CC0-1.0` admitted under `apps/` only, mirroring ADR 0015 D-2 |
| `apps/web/src/game/scatter.ts`, `three-renderer.ts` §`SCATTER_STYLE` | the six kinds and the primitive each carries today |
| #323's comments of 2026-09-16 | the only real device measurement: 13 ms frame 50th, 6 ms GPU 50th, 0.00 % legacy jank |
| `docs/validation/0002-android-shell-and-game.md` Parts E and F | **both result tables empty** |

⚠️ **No competitor's product, asset, screenshot or source was consulted**, and no asset was
downloaded, converted or committed in the course of writing this. ADR 0009 L2 and R2 are untouched.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-09-19** — **D-7's first argument has become false, and what replaced it is a gate.** That
  decision kept a glTF's own materials out of the scene for two reasons, and only one of them still
  holds. The one that does is unchanged and is the one that mattered: *"a `MeshStandardMaterial`
  constructed by `GLTFLoader` from a glTF's own material block is not in any source file, carries no
  `Light` in its name, and would change how the whole scene is shaded without a single gate going
  red"* — no loader-built material reaches the scene, `prepareSceneryGeometry` discards every one of
  them at load, and `three-renderer.ts` still constructs the two the belt wears.

  What has changed is D-4's *"only the **geometry** is bought"*, and with it the claim in
  `three-renderer.ts` that `LIT_COLOURS` is *"a complete statement of the scene's palette"*. It is
  not: [#366](https://github.com/openzigs/onyourleft/issues/366) bakes each part's own colour into a
  `COLOR_0` attribute at load, because the cost D-4 stated was real and visible — a Kenney tree is
  authored with a separate trunk material, so every trunk was drawn in the canopy's green, and a
  building whose whole colour lives in a texture atlas was drawn in one flat beige. ⚠️ **The palette
  is still enumerable and still asserted**, by `apps/web/src/game/scenery-palette.ts`
  §`SCENERY_PALETTE` — a table in source recording, per model, how many distinct colours it
  contributes, the brightest of them and a digest of the set, reproduced from the committed bytes by
  a reader that shares no line with the renderer. A pack swap, a re-export or an edited table is a
  red build, which is what D-7 was protecting and is strictly more than a comment could.

  Two consequences worth recording, because neither is obvious from the change:

  - **The atlas is fetched where it was refused.** `sceneryResourceUrl` used to answer
    `Textures/colormap.png` with 68 bytes of transparent PNG. The image is now committed
    (`ASSETS.toml`, CC0-1.0, the same City Kit archive) and that request is answered with **our** copy
    of it. The refusal is therefore a *redirection*, and the property it now states is stronger and
    is about the function's range: every answer it gives is a URL of this repository's own, so a
    future model declaring a host cannot reach one. No texture reaches the GPU —
    `game.browser.spec.ts` counts `gl.createTexture` against a baseline rather than taking that on
    trust.
  - **A pack's colours clip, and more of them than a spot check suggests.** Measured with
    `model-bytes-testing.ts`' own reader over the committed bytes on 2026-09-19: **13 of the 110
    distinct colours the eleven models carry, in 7 of those 11 models**, exceed the ceiling
    `three-renderer.test.ts` §"lights no colour past white" imposes, which is **0.8830**. Every
    building's atlas peaks at 0.9734; `woodBark` is 0.8863 and `stone` 0.9098. For a colour out of a
    pack there is nobody to ask for a darker one, so `scenery-palette.ts` §`tonedForTheSun` applies
    the rule instead of checking it, scaling a colour uniformly so hue and channel ratios survive
    and only lightness moves.

  D-1, D-2, D-3, D-5 and D-6 are untouched.
  ([#366](https://github.com/openzigs/onyourleft/issues/366))

- **2026-09-19** — **D-3's *"the set stays at six"* is unchanged; D-2's "one pack" now supplies
  eleven files rather than five.** [#367](https://github.com/openzigs/onyourleft/issues/367) gives
  each kind several shapes — three buildings and two of each natural kind — because every building
  in the world was the same building and so was every tree. ⚠️ **No new licence surface**: the files
  come from the same two CC0 Kenney archives `ASSETS.toml` already records, so `ASSET004` admits
  them as they are and ADR 0023's attribution obligation is not engaged. **The number of *kinds* is
  still six**, and D-3's rule that a seventh arrives as its own issue with its own placement
  question is untouched.

  What this decision did not anticipate, and what the issue is really about, is the **draw-call**
  cost: a variant is a distinct merged geometry, therefore a distinct `InstancedMesh`, therefore a
  draw call — #240's NFR-2, which `three-renderer.ts` calls *"the one thing a model is most likely
  to spend without anybody noticing"*. So the count is capped in source
  (`scenery-models.ts` §`MAXIMUM_SCENERY_VARIANTS`, three), it is a rung on the quality ladder
  (`quality.ts` §`QualitySettings.sceneryVariants`, 3 → 2 → 1 → 1) so a throttling phone draws fewer
  distinct shapes before it loses items, and what the belt actually submits is **measured in a
  driver and printed** rather than reasoned about. Measured on 2026-09-19 in the pinned Chromium:
  **12 scenery draw calls at three shapes a kind, 11 at two and 6 at one**, against a scenery-free
  scene of 5. ⚠️ That is a desktop software rasteriser and not the device floor;
  [`docs/validation/0002-android-shell-and-game.md`](../validation/0002-android-shell-and-game.md)
  Part M is the procedure for the floor and its result table is empty, exactly as Part H's was left
  by #341.

  ⚠️ **D-4's *"a different arrangement of scenery is a defect"* survives intact and was checked**:
  `arrangement-unchanged.test.ts`' digest did not move, because a variant is drawn from a hash
  stream of its own. Variants change what stands somewhere, never where.
  ([#367](https://github.com/openzigs/onyourleft/issues/367))

- **2026-09-21** — **D-1 and D-2 are superseded, and so is D-7's second bullet in its means, by
  [ADR 0026](0026-realistic-game-world.md).** On the owner's ruling of 2026-09-20 on
  [#430](https://github.com/openzigs/onyourleft/issues/430), reaffirmed on 2026-09-21, the trainer
  game's world goes realistic. That reverses three decisions above, which
  [ADR 0013](0013-adr-amendments.md) D-3 says only a superseding ADR may do, so this entry records
  the supersession and decides nothing: D-1's *"verbatim and unconverted"* and its Kenney-only
  source are replaced by ADR 0026 D-4's source list and D-5's rule that a derived asset is
  reproducible from a recorded input by a committed script; D-2's *"one author, one house style"*
  is replaced by coherence **per quality rung** (ADR 0026 D-3); and D-7's *"every model wears our
  Lambert material and colour, nothing sampled"* is reversed for the realistic world while its
  purpose — no material `GLTFLoader` builds reaches the scene unasserted — stands (ADR 0026 D-11).
  ⚠️ **The `Status` line above still reads *Accepted*, and that is ADR 0013 D-2 rather than an
  oversight**: `Status` is part of the body and an amendment does not change it. Read it as
  *superseded in part*. **D-1 and D-2 still describe the stylised world exactly** — its Kenney files
  stay upstream bytes and it is kept as the low rung, not deleted. **D-3, D-4's list, D-5 and D-6
  stand**, as does D-7's first bullet. One fact in D-3 is separately out of date: *"`scatter.ts`
  places exactly six kinds"* stopped being true with
  [#460](https://github.com/openzigs/onyourleft/issues/460), which moved `building` into a
  `StructureKind` beside eight new ones placed by `settlements.ts`; there are five scatter kinds, and
  of the fourteen kinds only the five D-3 named wear a model. D-3's rule that a new kind arrives as
  its own issue is what #460 followed, and it stands. ([#431](https://github.com/openzigs/onyourleft/issues/431))
