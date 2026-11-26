# ADR 0099: Model sources for modern buildings, trees and railway track, and what a new model owes

- **Status**: **Accepted, 2026-11-26**, by the owner, 2026-11-26, on its pull request
  [#3256](https://github.com/openzigs/onyourleft/pull/3256)
  ([comment](https://github.com/openzigs/onyourleft/pull/3256#issuecomment-7201681825), quoted in
  Context): approved as proposed, the sources (D-1) and the budget rule (D-4). It was **Proposed**
  earlier the same day, and that wording was only ever on the pull request's branch. **No model is
  added by this ADR**: each adoption is its own issue under
  [#3249](https://github.com/openzigs/onyourleft/issues/3249)
- **Date**: 2026-11-26
- **Deciders**: **the owner**, in the ruling above. **The author** read each source's own pages on
  2026-11-26, wrote the survey and the wording, and marks each point the ruling accepted from the
  author as *the author's proposal, approved*
- **Issue**: [#3250](https://github.com/openzigs/onyourleft/issues/3250), under epic
  [#3249](https://github.com/openzigs/onyourleft/issues/3249). The models themselves are
  [#3251](https://github.com/openzigs/onyourleft/issues/3251) (modern buildings),
  [#3252](https://github.com/openzigs/onyourleft/issues/3252) (trees and scenery) and
  [#3253](https://github.com/openzigs/onyourleft/issues/3253) (railway track). **No model is added
  by this ADR**
- **Number**: **0099**. `docs/agents/conventions.md` §7 said on 2026-11-26 that the next free
  number was 0098, and that was stale: the open pull request
  [#2966](https://github.com/openzigs/onyourleft/pull/2966) adds an ADR numbered 0098, on the
  ridden-block cache keeping street names on the device. This ADR was first written as 0098 and
  renumbered before its pull request opened. Checked that day against every open pull request's
  files and every open issue: none adds or names an ADR 0099
- **Why a new ADR and not an amendment to ADR 0022**: #3250 asks for *"a dated Amendment to ADR
  0022, or a superseding ADR if D-1 is reversed"*. [ADR 0022](0022-game-scenery-model-pack.md) D-1
  was superseded on 2026-09-21 by [ADR 0026](0026-realistic-game-world.md) D-4, whose source list
  ADR 0049 D-10 replaced whole on 2026-10-11 and ADR 0085 added one row to on 2026-11-19. ADR 0022's
  own amendment of 2026-09-21 already records that. ADR 0049 D-11 says adding a source *"is a
  superseding ADR"*, and [ADR 0013](0013-adr-amendments.md) D-3 says an amendment records a fact
  and never a decision. So this is a new ADR, and ADR 0022 gains no entry: nothing in it has become
  newly false
- **Supersedes, in part**: ADR 0049 **D-10's In table**. D-1 below adds two rows to it, after
  ADR 0085's, and nothing else in D-10 changes. ADR 0049 gains one dated `## Amendments` entry
  pointing here, and its body is not edited (ADR 0013)
- **Leaves standing**: ADR 0049 D-2 (what "AI-generated" means), D-9 and D-10's **Out** table, and
  D-11 (how the list is held and what an adoption owes); ADR 0085;
  [ADR 0023](0023-cc-by-assets-and-attribution.md) in full; ADR 0026 D-3 (no rung mixes the two
  worlds), D-5 (a derived asset is reproducible) and D-6 (the budget); ADR 0022 D-5 (a row in
  `ASSETS.toml` before the file is committed)
- **Changes no licence rule**: every source admitted is `CC0-1.0` or `CC-BY-4.0`, which
  [ADR 0015](0015-dependency-licences.md), ADR 0023 and `ASSET004` already admit under `apps/`

## Context

On 2026-11-26 the owner asked for three things in the realistic world (epic #3249): houses and
buildings that look modern except on farms and rural roads, better trees and scenery, and railway
track that looks real. Today the realistic world's houses are thirteen traditional models from two
Sketchfab authors under `CC-BY-4.0`, its trees are generated (ADR 0049 D-1) or scanned (Poly Haven),
and nothing draws track.

#3250 was written against ADR 0022 D-1, *"one CC0 source, Kenney.nl"*. That has not been the rule
since 2026-09-21. The rule today is ADR 0049 D-10's list as ADR 0085 extended it: Poly Haven,
ambientCG, MakeHuman's own files, Kenney (the stylised world only), **an individual model under
`CC-BY-4.0`**, EZ-Tree's output, The Base Mesh, Blender Studio's Human Base Meshes, MakeHuman
community cyclist poses and GGBotNet's PSX Style Cars. A source not on that list is not used, and
`realistic:fetch` refuses its host before a request is made.

So the question #3250 really puts is narrower than its title: **which sources, beyond those ten
rows, do #3251 to #3253 need, and what must a new model hold to?** Three parts of the answer are
already decided and are restated below with where they were decided (D-2, D-3 and most of D-4).
Two are new: the sources (D-1) and the rule about raising a ceiling (D-4).

Both were put to the owner as proposals on pull request #3256. The ruling, verbatim, as the
maintainer session recorded it there on 2026-11-26:

> **Owner, 2026-11-26:** ADR 0099 is approved as proposed: the sources (D-1) and the budget rule
> (D-4). Make the accepting change on this PR (D-7). Relayed by the maintainer session.

### What the survey found

Every page was fetched on 2026-11-26 by `curl` and read as text. Quotations are verbatim. A figure
with no page behind it says where it came from. "Read from this repository" means a committed file
was measured, not a page.

| Source | Licence, as its own page states it | Format | Triangles | Modern houses and commercial buildings | Varied trees | Railway track |
|---|---|---|---|---|---|---|
| **Kenney** | *"Yes, all game assets on the asset pages are public domain licensed (CC0). You’re free to use them, even in commercial projects. For full details, see the included license file or visit the asset page."* (`https://kenney.nl/support`). The licence field of each kit page read says *"Creative Commons CC0"* | The pages state none. Read from this repository: the eleven committed Kenney files are GLB, taken unconverted from the archives' `Models/GLTF format/` (`ASSETS.toml`) | The pages state none. Read from this repository: the eleven committed files are 32 to 1 024 triangles; the three buildings are 770, 800 and 1 024 | City Kit (Suburban), 40 files, 2020; City Kit (Commercial), 50 files, 2021, tagged `skyscraper`; City Kit (Industrial), 40 files, 2025; Modular Buildings, 100 files, 2016. Low-poly and stylised: this is the style the stylised world already draws | Nature Kit, 330 files, tagged `tree`, `rock`, `foliage`. Stylised | Train Kit, 100 files, 2024, tagged `track`, `railroad`, `rail`. The archive was not opened, so which files are track is **not verified** |
| **Quaternius** | Per kit. *"each kit uses either CC0 or the QAL License. The only difference is that QAL does not allow direct reselling."* and *"Each kit's license is listed in the details panel on the right of its page, and it's also included as a .txt file in the download."* (`https://quaternius.com/faq.html`). The licence field of all twelve kit pages read says *"CC0"* | FBX, OBJ and Blend on most kits; **glTF** as well on the Downtown City MegaKit, the Stylized Nature MegaKit and the Ultimate Stylized Nature Pack. A kit with no glTF needs conversion | The pages state none. Poly Pizza's copies of two Quaternius models state 1 420 (*Railway Track Straight*) and 41 780 (*Town House*) | Downtown City MegaKit, 315 models, *"modular environment pieces for building full Boston/NYC style city blocks"*; Ultimate Buildings Pack, 76; Buildings Pack, 9; Simple Buildings Pack, 10; Farm Buildings Pack, 13. Stylised, more detailed than Kenney | Ultimate Nature Pack, 150 models; Stylized Nature MegaKit, 116, *"40 trees, 35 plants and flowers, 27 rocks"*, *"Ghibli-inspired"*; Stylized Tree Pack, 45; Ultimate Stylized Nature Pack, 63 | Modular Train Pack, 15 models. Poly Pizza lists *Railway Track Straight*, *Railway Track Curve* and *Rail Corner* by Quaternius under CC0 1.0; which kit they come from is **not verified** |
| **Poly Pizza** | Per model, and it is an aggregator. Its terms: *"By downloading User Content made available by other Users, you agree to adhere to the terms of the Creative Commons license that applies at the time of download."* (`https://poly.pizza/docs/tos`). Two searches returned 64 models each: 36 and 38 under **`CC-BY 3.0`**, 28 and 26 under `CC0 1.0`. No model read was under CC BY 4.0 | A model page reads *"FBX/GLTF format"* and links a `.glb` | Stated on each model's page. The four read: 1 420, 1 620, 5 940 and 41 780 | Yes, by search, and mixed: the CC0 results are copies of Kenney, Quaternius and Kay Lousberg models; the rest are `CC-BY 3.0`, many from Google's closed Poly | Not searched | Yes, by search: the three Quaternius pieces above under CC0 1.0, and others under `CC-BY 3.0` |
| **Poly Haven** | *"Our assets are all licensed as CC0, which is effectively Public Domain even in jurisdictions that do not support the Public Domain."* and *"You can redistribute them, share them around, include them when sharing your own work, or even in a product you sell."* (`https://polyhaven.com/license`) | glTF (a `.gltf` with its buffers and pictures beside it), Blend, FBX and USD, each at 1K to 8K textures (`https://api.polyhaven.com/files/fir_tree_01`). Not GLB | Its API states a polygon count for each of its 522 models: 182 at least, a median of 11 234, an upper quartile of 28 848, and 17 427 094 at most. Scans, so every one is decimated by the pipeline | **No.** Its `buildings` category holds 13 models: shutters, gates, a gutter, a fort, and two façades (`modular_urban_apartments_facade`, 118 215; `modular_factory_facade`, 175 014). No whole house | 20 in `trees`, photoscanned, from 33 706 to 17 427 094 polygons. This repository already draws several | **No.** No model is named or tagged for rail or track |
| **Sketchfab** | Per model, and the site's own licence is out. Its API lists the licences a model may carry (`https://api.sketchfab.com/v3/licenses`): `cc0`, labelled *"CC0 Public Domain"*, *"Credit is not mandatory. Commercial use is allowed."*, pointing at CC0 1.0; `by`, labelled *"CC Attribution"*, *"Author must be credited. Commercial use is allowed."*, pointing at **CC BY 4.0**; and `by-sa`, `by-nd`, three `by-nc` kinds, `free-st`, `st` and `ed`, all of which stay out | A download needs an account, so no script fetches one. No Sketchfab page stating the format could be read by a script on the day (**not verified**). Read from this repository: each of the thirteen archives the owner downloaded on 2026-10-23 holds a `scene.gltf` (`sources.ts` §`HOUSE_MODEL_SOURCES`) | Stated per model by the API (`faceCount`). The 24 most-liked downloadable results of each search: `by`, *modern house*, 7 042 to 1 314 982, median 76 622, most of them interiors; `by`, *apartment building low poly*, 12 to 236 397, median 7 562; `by`, *railway track*, up to 1 907 390, median 49 491; `cc0`, *tree*, 15 526 to 1 389 056, median 311 938. Read from this repository: the thirteen committed house models are 1 116 to 2 946 triangles after the pipeline | Yes under `by`, per model and per author; the searches for *modern house* and *railway track* under `cc0` returned nothing | Under `cc0` mostly scans, and museum objects and animals among them | Under `by` only, in the searches made |
| **ambientCG** | *"All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License."* and *"You can include the raw files in your project, for example a video game."* (`https://docs.ambientcg.com/license/`) | Pictures in an archive, which the pipeline already reads. A texture source here; it was not surveyed for models | Not applicable | Not applicable: wall, roof, glass and concrete materials | Not applicable: bark and leaf atlases, already used | `Rails001`, a photogrammetry material of rails set in concrete, and 66 results for *gravel*, which is what ballast is |

**Is each licence irrevocable?** The answer is a property of the licence, not of the site, so it is
read from the two legal codes (`https://creativecommons.org/publicdomain/zero/1.0/legalcode.en` and
`https://creativecommons.org/licenses/by/4.0/legalcode.en`, both 2026-11-26):

- **CC0 1.0: yes, and unconditionally.** §2: *"Affirmer hereby overtly, fully, permanently,
  irrevocably and unconditionally waives, abandons, and surrenders all of Affirmer's Copyright and
  Related Rights"*. Where a waiver is not effective, §3 grants *"a royalty-free, non transferable,
  non sublicensable, non exclusive, irrevocable and unconditional license"*.
- **CC BY 4.0: yes, on a condition.** §2(a)(1) grants *"a worldwide, royalty-free,
  non-sublicensable, non-exclusive, irrevocable license"*. §6(a): *"if You fail to comply with this
  Public License, then Your rights under this Public License terminate automatically."* §6(c): the
  licensor may *"stop distributing the Licensed Material at any time; however, doing so will not
  terminate this Public License."* So an author cannot take the grant back, and a build that drops
  the credit loses it. That is why ADR 0023 puts the credit in the app.
- **A site can change its terms for later downloads, and that does not reach a copy already
  taken.** That is what the recorded page, sentence and date are for (ADR 0049 D-11).
- **Quaternius's QAL is not either licence and is not admitted.** QAL v1.0 (*"Last updated:
  8/28/2026"*, `https://quaternius.com/license.html`) §3(a): *"You may not extract, repackage,
  sublicense, sell, or otherwise redistribute the Assets (in original or modified form) as a
  standalone asset, asset pack, stock file, template, or similar product, whether for free or for
  payment"*. A public repository holding the file is exactly that. Its §5 reads *"This License is
  perpetual and cannot be revoked, except that it will automatically terminate if you materially
  breach Section 3"*.
- **CC BY 3.0 is not CC BY 4.0.** ADR 0023 D-1 admits `CC-BY-4.0` alone, because 3.0 is a
  different text nobody here has read. Most of Poly Pizza's attribution models are 3.0.

Two more things the pages said that bear on rules already in force. Quaternius: *"none of the
assets have any AI usage at all, this is all handmade by a human using Blender"*. Sketchfab's own
navigation has an *"AI Generated"* category beside *"Human Created"*, so ADR 0049 D-2 has to be
asked of every Sketchfab model on its own page. Poly Pizza's terms forbid a script: *"scrape the
Services, scrape Content from the Services, or use automated means, including spiders, robots,
crawlers, data mining tools, or the like to download data from the Services"*.

## Decision

D-1 and D-4 are the two decisions the owner approved. D-2 and D-3 restate rules already decided,
so that #3251 to #3253 find them in one place. D-5 is a gate, which enforces rules already
decided. D-6 is what stays out. D-7 is what acceptance changed.

### D-1 — Two rows are added to the list, and nothing else

*The author's proposal, approved.* These rows are added to ADR 0049 D-10's **In** table, after
ADR 0085's. They are the whole of what D-10 gains:

| Source | Licence | Decided by | For |
|---|---|---|---|
| **Quaternius, a kit whose own page states CC0** | `CC0-1.0` | ADR 0099 D-1 | urban building pieces (#3251) and railway track pieces (#3253), per kit, each kit named in the pull request that takes it |
| **An individual model under CC0-1.0** | `CC0-1.0` | ADR 0099 D-1 | one model, verified per asset on its author's own page or public record, as the `CC-BY-4.0` row already allows |

- **Quaternius is the only source surveyed with whole modern buildings and track under CC0.** The
  row admits a kit whose own page was read on the day and states CC0. **Never a kit under QAL.**
  The pipeline's addresses for it are the kit pages, `https://quaternius.com/packs/`, where each
  kit's licence line is. No archive address is admitted: an adoption adds the one it downloaded
  from, or pins an archive the owner placed (ADR 0049 D-11).
- **The individual CC0 row closes a gap.** The list admitted an individual model under `CC-BY-4.0`
  and not under the licence that asks for less. It is the row a CC0 house on Sketchfab needs. It
  has no address yet: Sketchfab's record and page addresses belong to the `CC-BY-4.0` row, and an
  adoption adds the page it read (ADR 0049 D-11).

What the decision leaves as it is, with the reason:

- **The individual `CC-BY-4.0` model row already covers Sketchfab.** The thirteen committed houses
  came in under it. A modern house by a Sketchfab author under `by` needs no new row: it needs the
  model's public record read on the day, the archive the owner downloads pinned by digest, and the
  credit (D-3). This is the most likely source of the modern suburban houses #3251 asks for.
- **Kenney stays the stylised world's alone.** Its kits have the buildings and the track, and the
  realistic world drew its Car Kit for a week before ADR 0085 replaced it because the cars *"read
  as a toy"*. ADR 0026 D-3 says no rung mixes the two worlds.
- **Poly Haven and ambientCG are already admitted** and need nothing. Poly Haven has no house and
  no track. ambientCG has the materials track is made of.
- **Trees stay with the generator and the scans.** #3252 asks for more species and a spread of
  sizes. EZ-Tree's output (ADR 0049 D-1) makes a tree to a triangle budget from committed numbers,
  which no downloaded pack does; the stylised packs surveyed would not sit beside photoscanned
  ground. If #3252 finds a species the generator cannot make, an individual model under either
  licence is the row for it.
- **Track is better built than downloaded.** #3253's own acceptance criterion is one draw call a
  belt, and its dependency note says procedural rails and sleepers need no ADR. Rails and sleepers
  extruded along the mapped line, wearing ambientCG's gravel, steel and timber, need no new source
  at all. A Quaternius track piece is the fallback if that does not look real.

Whether a stylised Quaternius building looks right in the realistic world is not a licence
question and is not answered here. It is answered on the tablet, by the owner, in #3251.

### D-2 — Licences: `CC0-1.0` and `CC-BY-4.0`, and nothing else, for a model

Already decided: ADR 0023 D-1 and D-2, ADR 0049 D-9 and D-10 (*"an asset is `CC0-1.0` or
`CC-BY-4.0` and nothing else"*). Restated for a model:

- A model is under `CC0-1.0` or `CC-BY-4.0`. **Never** a non-commercial licence, a no-derivatives
  or share-alike one, CC BY 3.0 or earlier, a site's own "standard" or "free" licence, or QAL.
- The licence is read on the **asset's own page or public record** on the day it is taken. An
  aggregator's label is not the author's grant.
- Nothing AI-generated (ADR 0049 D-2).

### D-3 — A `CC-BY-4.0` model's credit: where it is recorded and where a rider reads it

Already decided by ADR 0023 D-3 and D-4, and stated here because #3250 and #3249 both say the
credit goes *"into `third-party-notices.json` and the Credits screen"*. Half of that is not how
this repository works, and a child issue that followed it would put the credit where nothing
reads it:

- **The credit is recorded in `ASSETS.toml`**, on the model's own row: `creator`, `url` and
  `modified`, which `ASSET006` requires of every `CC-BY-4.0` entry. Decimating, re-texturing,
  rescaling and merging are modifications, and `modified` says which in words.
- **A rider reads it on the Credits screen**, which is generated from those keys at build time
  (`apps/web/src/credits/credits.ts`). There is no second copy to keep in step.
- **`apps/web/third-party-notices.json` is not where a model's credit goes.** That file is the
  reviewed record behind the licence texts of **npm packages** shipped in the bundle
  (`check:notices`). A model is in no package.
- A model's bundled pictures are admitted on the model's own grant and credited as the model is
  (ADR 0049's amendment of 2026-10-23).

### D-4 — The budget a new model holds, and the ceilings it may not raise

The numbers are `apps/web/src/game/realistic-budget.ts`'s, read on 2026-11-26, and
`realistic-budget.test.ts` reads every committed realistic file back off disk against them
(ADR 0026 D-6). They are restated, not set, here; the file is the authority and it moves.

**Per model, in triangles** (`REALISTIC_TRIANGLES`): a broadleaf tree 28 000, a conifer 24 000, a
tree's middle level 6 000, a shrub 6 500, a rock 2 500, a rider 9 000, a roadside model 240, a
chain-link panel 180, a procedural structure 640. The downloaded house models are not held to 640
each: they pool `MAPPED_BUILDING_TRIANGLES`, 23 040 a frame, and are 1 116 to 2 946 each today.

**Per texture**: no side over 2048 px, whatever the source publishes (ADR 0026 D-6); 512 px for a
map inside a model or on a structure, 1024 px for a town's surfaces (`REALISTIC_TEXTURE_PIXELS`);
KTX2, never a JPEG or PNG (ADR 0026's amendment of 2026-09-27). The house models share one atlas,
inside 11 MiB on the GPU and 3 MiB in the build (`REALISTIC_HOUSE_MODEL_SURFACES`).

**For the whole world**: `REALISTIC_FRAME_TRIANGLES` 300 000, `REALISTIC_REMOTE_TRIANGLES` 64 726,
`REALISTIC_TEXTURE_MEMORY_BYTES` 160 MiB, `REALISTIC_BUILD_BYTES` 47 MiB, and the draw-call
ceilings beside them.

*The author's proposal, approved*, the rule #3250 asks for:

1. **A new model takes a class that exists and holds that class's ceiling.** A model for which no
   class fits gets a class and a ceiling in `realistic-budget.ts`, with a test, in the pull request
   that adds it. ADR 0026 D-6 already says a budget in a comment is not a budget.
2. **A new building model is at most 3 000 triangles**, which is no heavier than the heaviest
   house committed today (2 946), and it draws from the same pooled 23 040.
3. **A new model may replace a model or add a variant inside the ceilings. It may not raise one.**
   None of the whole-world ceilings above, and no draw-call ceiling, is raised to make a new model
   fit without **a tablet measurement recorded first**: the frame time of a moving ride on the
   owner's tablet, in `docs/validation/0002-android-shell-and-game.md` or on the issue, with the
   decision written beside the constant.
4. **`REALISTIC_REMOTE_TRIANGLES` is named because it is where the temptation lands.** It is what
   the worst frame leaves under `REALISTIC_FRAME_TRIANGLES` for a room's other riders. A heavier
   building or tree makes the worst frame heavier, the remote riders no longer fit, and the test
   that goes red is theirs. Raising that constant is the one-line fix, and it spends the frame's
   headroom without anybody having looked at a frame. Its one raise, by 500 for #2688, followed a
   ride on the tablet that held 60 fps, and its comment says so. That is the form.

### D-5 — Provenance: every model has a row, a licence of the two, and an address

ADR 0022 D-5 already requires an `ASSETS.toml` row before a file is committed, and
`check:repo` already enforced most of it for a model: an unnamed binary is `ASSET001`, a row with
no `source` or no `read` date is `ASSET005`, a row with no licence or a forbidden one is
`ASSET004`, a wrong digest is `ASSET003`, and a `CC-BY-4.0` row without its credit is `ASSET006`.

Three things it did not hold, which this change adds as **`ASSET009`**
(`scripts/check-repo-rules.sh`), for a 3D model under `apps/` or `packages/`:

- **A model in a text format was not seen at all.** `ASSET001` finds a binary by its content, and
  a `.gltf` with its buffers beside it, or an `.obj`, is text. Poly Haven and Sketchfab both ship
  `.gltf`. An unnamed one is now a red build.
- **A model under a licence the list does not admit passed.** `ASSET004` admits a committed file
  under any licence ADR 0015 admits for a dependency, so a model under MIT was clean. Under `apps/`
  a model's row is now `CC0-1.0` or `CC-BY-4.0`. Under `packages/` `ASSET004` already admits a
  permissive licence alone, so none of these sources' models can land there.
- **A source of bare prose passed.** A model's row now carries an `https` link in its `source`,
  `url` or `input`, so where it came from can be opened and read again.

`apps/web/src/credits/model-credits.test.ts` holds the other half through the code the Credits
screen runs: every model row in the committed manifest is under one of the two licences, and every
`CC-BY-4.0` model is in the list of credits the screen is obliged to show, with its creator, its
link and what was changed.

What `ASSET009` does not do: it knows a model by its file extension, so a format it does not name
is not a model to it; it does not hold a **texture** to the two licences; and it cannot tell
whether the address on a row is the page the file really came from. ADR 0049 D-11's adoption rules
and a reviewer cover those.

### D-6 — What stays out

Unchanged from ADR 0049 D-9 and D-10, and named here because the survey met them:

- **Poly Pizza, as a source.** It is an aggregator. Its `CC-BY 3.0` models are out by D-2. Its CC0
  models are copies of work whose authors have their own pages, and the author's page is where a
  grant is read. It may be used to **find** a model. *The author's proposal, approved with D-1.*
- **Any Quaternius kit under QAL**, and any kit whose page was not read on the day.
- **Sketchfab's Standard, Free Standard and Editorial licences**, and every Creative Commons
  licence there other than `cc0` and `by`.
- **Kenney in the realistic world** (D-1).

### D-7 — What acceptance changed

This ADR was opened as Proposed, with `sources.ts` untouched, so that a row in code could not come
before the owner's ruling. On the ruling, the same pull request:

1. set this file's `Status` to Accepted, with the date and the ruling quoted;
2. appended a dated pointer to ADR 0049's `## Amendments`, as ADR 0085 did;
3. added the two rows to `sources.ts` §`ADMITTED_SOURCES`, last, with Quaternius's kit pages as
   its address, and had `admitted-sources.test.ts` read this ADR's table after ADR 0085's;
4. updated the index row in `docs/architecture.md`.

## Consequences

### What this enables

- #3251 to #3253 have one place that says where a model may come from, under which licence, how it
  is credited and what it may cost.
- A model in a text format, a model under a licence the list does not admit, and a model whose
  origin is prose alone each fail `check:repo` before review.

### What this costs, stated plainly

- **Admitted is not adopted.** No kit and no model is taken by this ADR. Each is its own pull
  request under #3251 to #3253, with its page read on the day and the tablet rows before it stays.
- **The modern suburban house is not found.** The survey found urban blocks under CC0
  (Quaternius) and no modern detached house under CC0 anywhere. #3251 will most likely take
  `CC-BY-4.0` models from Sketchfab authors, each downloaded by the owner, and each a credit this
  app owes for as long as it ships.
- **`ASSET009` is an extension list**, which `ASSET001` exists to avoid. It fails open against a
  model format it does not name.
- **The figures in the survey are a day's reading.** A catalogue grows, a search ranks
  differently tomorrow, and a kit's licence line can change. An adoption reads its own asset's
  page again on its own day (ADR 0049 D-11).

### What was not verified

- Which files in Kenney's Train Kit are track, and which Quaternius kit the track pieces on Poly
  Pizza come from: no archive was opened.
- Quaternius's triangle counts, other than the two Poly Pizza states for its copies.
- Which Quaternius kits are under QAL: none of the twelve read is.
- The format a Sketchfab download arrives in, from a Sketchfab page.
- Whether ambientCG publishes models: it was read as a texture source.
- Whether any source's models look right in the realistic world. That is the owner's, on the
  tablet.

### What would make this ADR wrong

- A source changes its licence for new downloads. The row then admits only what was taken and
  recorded before the change.
- The owner refuses stylised buildings in the realistic world on sight, in #3251. D-1's first row
  then admits nothing #3251 can use, and the individual-model rows carry the whole of it.
- Procedural track does not look real. #3253 then needs a downloaded piece, which D-1's first row
  allows.

## What was read, and when

All on 2026-11-26, each returning HTTP 200 unless it says otherwise.

| Page | What it was read for |
|---|---|
| `https://kenney.nl/support` | Kenney's licence sentence |
| `https://kenney.nl/assets/city-kit-suburban`, `/city-kit-commercial`, `/city-kit-industrial`, `/modular-buildings`, `/train-kit`, `/nature-kit` | each kit's licence line, file count, year and tags |
| `https://quaternius.com/faq.html` | the two licences, attribution, the AI statement |
| `https://quaternius.com/license.html` | QAL v1.0 |
| `https://quaternius.com/index.html` and twelve pages under `/packs/` (`downtowncitymegakit`, `buildings`, `simplebuildings`, `ultimatetexturedbuildings`, `farmbuildings`, `modulartrain`, `modularstreets`, `ultimatenature`, `stylizednaturemegakit`, `stylizedtree`, `ultimatestylizednature`, `simplenature`) | each kit's licence line, formats and model count |
| `https://poly.pizza/docs/tos` | the licence sentence and the ban on automated download |
| `https://poly.pizza/search/railway%20track`, `https://poly.pizza/search/modern%20house` | the licence of each of 64 results |
| `https://poly.pizza/m/5JTOJuMHJw`, `/m/huCpr8nhu0`, `/m/imVkxz7oZD`, `/m/d_k2teZePG6` | a model page's licence, format and triangle count |
| `https://polyhaven.com/license` | Poly Haven's licence sentences |
| `https://api.polyhaven.com/assets?t=models`, `https://api.polyhaven.com/files/fir_tree_01` | categories, polygon counts, formats |
| `https://api.sketchfab.com/v3/licenses` | the licences a Sketchfab model may carry |
| `https://sketchfab.com/licenses` | Sketchfab's own Standard and Editorial licence |
| `https://api.sketchfab.com/v3/search`, six queries with `downloadable=true` and `license=cc0` or `by` | face counts by licence |
| `https://api.sketchfab.com/v3/models/70436f6bde1b43c8a8fe2e630f0fa4d0` | that a committed model's record still reads `by`, CC BY 4.0 |
| `https://sketchfab.com/developers/download-api` | HTTP 202 and an empty body: **not read** |
| `https://docs.ambientcg.com/license/` | ambientCG's licence sentences |
| `https://ambientcg.com/api/v2/full_json`, queries *rail* and *gravel* | `Rails001` and the gravel materials |
| `https://creativecommons.org/publicdomain/zero/1.0/legalcode.en` | CC0 1.0 §2 and §3 |
| `https://creativecommons.org/licenses/by/4.0/legalcode.en` | CC BY 4.0 §2(a)(1) and §6 |
