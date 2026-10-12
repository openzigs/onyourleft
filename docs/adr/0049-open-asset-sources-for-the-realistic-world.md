# ADR 0049: More open asset sources for the realistic world — a tree generator, The Base Mesh, Blender Studio's base meshes — and what "AI-generated" means

- **Status**: **Accepted, 2026-10-11**, on the owner's ruling on
  [#1275](https://github.com/openzigs/onyourleft/issues/1275)
  ([comment](https://github.com/openzigs/onyourleft/issues/1275#issuecomment-6115702198), quoted in
  Context), which accepts all eight of the issue's recommendations as written. **No asset is added
  by this ADR**: each adoption is its own issue under
  [#615](https://github.com/openzigs/onyourleft/issues/615), measured on the tablet before it stays
- **Date**: 2026-10-11. The ruling's own heading reads *"2026-10-12"*: it was posted at
  2026-10-12T00:39Z, which was the evening of 2026-10-11 where this was written
- **Deciders**: **the owner**, in the ruling above. The author wrote the wording, read each source's
  own page, and decided the engineering content the ruling does not settle; each such point is
  marked *the author's choice*
- **Issue**: [#1275](https://github.com/openzigs/onyourleft/issues/1275). Parent epic
  [#615](https://github.com/openzigs/onyourleft/issues/615)
- **Number**: **0049**, read from [`docs/architecture.md`](../architecture.md)'s ownership table on
  2026-10-11, when it said the next free number was 0049, and checked that day against every open
  pull request and every open issue: none names 0049. Spike 0024, in flight on
  [#1273](https://github.com/openzigs/onyourleft/issues/1273), is a spike and takes no ADR number
- **Supersedes**: [ADR 0026](0026-realistic-game-world.md) **D-4's source list** — its **In** table
  and its **Out** sentence — which D-10 below replaces whole. **The rest of D-4 stands**: the list
  is the boundary, a source not on it is a superseding ADR and never a pull-request judgement, and
  [ADR 0023](0023-cc-by-assets-and-attribution.md) binds in full for a CC-BY asset. ADR 0026
  carries a dated amendment pointing here; its body and its `Status` line are unedited
  ([ADR 0013](0013-adr-amendments.md))
- **Changes no licence rule**: every source below is `CC0-1.0`, `MIT` or `CC-BY-4.0`, which
  [ADR 0015](0015-dependency-licences.md), ADR 0023 and the asset rules (`ASSET004`) already admit
  under `apps/`
- **Related, and not superseded**: ADR 0026 D-3 (no rung mixes the two worlds), D-5 (a derived
  asset is reproducible from a recorded input), D-6 (the budget) and its 2026-09-28 amendment;
  [ADR 0009](0009-clean-room-posture.md) (trade dress);
  [ADR 0024](0024-offline-and-caching-posture.md) D-5 (this repository's own drawings are dedicated
  `CC0-1.0`)

## Context

### Why the question needed an ADR at all

ADR 0026 D-4 makes its list of sources the boundary: *"a source not in it is a change to this ADR —
a superseding ADR, because admitting a source is a decision — and never a pull-request judgement."*
So a better source cannot be used, even at `CC0-1.0`, until an ADR admits it. That rule is kept
here; this ADR is the mechanism it names being used for the first time.

The asset survey of 2026-10-11
([comment on #615](https://github.com/openzigs/onyourleft/issues/615#issuecomment-6115651121)) found
five sources worth admitting, three texture hosts that are not needed yet, and no bicycle worth
downloading. It also found that D-4 bars *"anything marked or known to be AI-generated"* without
saying what that is, at the moment a procedural generator was being proposed.

### What the owner ruled

[#1275](https://github.com/openzigs/onyourleft/issues/1275) put eight questions, each with a
recommendation. They are quoted here because the ruling accepts them by reference:

> | # | Question | Recommendation |
> |---|---|---|
> | 1 | Admit **EZ-Tree** (MIT) output: procedural trees generated to budget with LODs, bark from ambientCG | **Yes.** The generator version, seed and parameters are committed, so every tree is reproducible |
> | 2 | Is a procedurally generated asset "AI-generated" under D-4? | **No.** Define the term: the output of a trained generative model is barred; a deterministic tool run from committed parameters is not |
> | 3 | Admit **The Base Mesh** (CC0): signs, barriers, guardrails, lamp posts, fences, gates | **Yes**, per file, with its page's CC0 statement recorded and a pinned download |
> | 4 | Admit **Blender Studio Human Base Meshes** (CC0) as a sculpt and bake source for the rider | **Yes** |
> | 5 | **Cyclist motion capture** (Zenodo 10668611, CC BY 4.0, recorded from consenting people) | **Reference only**: use it to set #625's amplitudes by hand, commit none of its data. Pedalling is already computed from crank angle, and the consent's scope has not been read |
> | 6 | **MakeHuman community authors** (cyclist poses CC0; time-trial helmet and cycling shoes "CC-BY", version unstated) | **Poses: yes, per asset. Helmet and shoes: only once the grant is read as CC BY 4.0.** Nothing trademark-named, ever |
> | 7 | More site-wide CC0 texture hosts (cgbookcase, TextureCan, 3dtextures.me) | **Not now.** ambientCG and Poly Haven are not exhausted (see the sibling issue) |
> | 8 | A downloaded **bicycle** | **No.** Nothing in budget and unbranded was found; #369's parametric bicycle stands and #624 improves its surfaces |
>
> Stay out, as today: Fab Standard, Sketchfab Standard, Mixamo, non-commercial mocap sets, anything
> `-SA` or `-NC`, MB-Lab characters, anything AI-generated.

The ruling, verbatim:

> **Owner ruling, 2026-10-12:** all eight recommendations in the table are accepted as written.
> Write the ADR on that basis.

## Decision

D-1 to D-8 are the eight questions in the issue's order. D-9 is what stays out, D-10 is the list
whole, and D-11 is how the list is held and what an adoption owes.

### D-1 — EZ-Tree's output is admitted: trees generated to budget, reproducible from committed numbers

**[EZ-Tree](https://github.com/dgreenheck/ez-tree)** is a procedural tree generator for three.js,
under the MIT licence. A tree it writes may be committed as a realistic asset **when the generator's
version, the seed and every parameter are committed beside the script that runs it**, so that the
tree is reproducible in ADR 0026 D-5's sense: the recorded input is those numbers, where for a
Poly Haven tree it is a downloaded file's digest.

- **The generator is a pinned tool, like Blender** (D-5). The pull request that adopts it pins one
  release and records it the way `PINNED_BLENDER` is recorded; `realistic:process --check` must reproduce
  each tree byte for byte, or by D-5's stated fallback, before the tree is committed. 1.1.0 is the
  release that was read (see "What was read"); the pin is the adopting issue's.
- **What it writes is this repository's own work.** *The author's choice*: a generated tree is
  recorded as the bicycle maps are — drawn here by a committed script from committed numbers,
  dedicated `CC0-1.0` (ADR 0024 D-5) — and its record names the generator and its version. The MIT
  licence is the tool's, and its notice is carried wherever the tool itself is distributed
  (ADR 0015).
- **Bark and leaves come from ambientCG**, as the recommendation says. *The author's choice*: the
  bark and leaf images inside EZ-Tree's own repository are **not** taken. Its README, read
  2026-10-11, does not say where those images came from, and a file whose origin is not stated on
  its own page is not a grant (ADR 0026 D-4, #369).
- **To budget**: a generated tree is held to `realistic-budget.ts` like any other, and replaces a
  decimated scan only where the tablet measurement says it should.

### D-2 — "AI-generated" is defined: the output of a trained generative model

ADR 0026 D-4 bars *"anything marked or known to be AI-generated"* and does not define it. It is
defined here, and the bar is kept:

> **An asset is AI-generated when any part of its geometry, texture, motion or sound is the output
> of a trained generative model** — a model whose behaviour was learned from a body of other works,
> whatever the vendor calls it and whatever licence the output is offered under.

**A deterministic tool run from committed parameters is not AI-generated.** A procedural generator
(D-1), a decimator, a baker, a texture encoder, this repository's own arithmetic
(`draw-bicycle-maps.ts`, `bicycle.ts`) and Blender itself compute their output from their inputs by
rules a person wrote; the same inputs give the same output, and the inputs are in the repository.

What this means in practice:

- **The test is how the asset was made, not what its page calls it.** A source page that says
  *"generated"*, *"approximated"* or *"synthesised"* is read until it is known which kind it is,
  and an asset whose making cannot be established is treated as barred. *The author's choice*: that
  default follows D-4's *"marked or known"* — the pull request shows the making, the reviewer does
  not have to disprove it.
- **A reproducibility test is necessary and not sufficient.** A generative model run with a fixed
  seed is repeatable and is still barred: what bars it is the learned model, not the randomness.
- **Photogrammetry and scanning are not AI-generated**: a scan records an object that exists. A
  scan *cleaned or upscaled* by a generative model is.
- **A marketplace carries no reliable flag.** The survey found Sketchfab's API has no AI field, so
  the asset's own page is read by a person.

### D-3 — The Base Mesh is admitted, per file

**[The Base Mesh](https://www.thebasemesh.com/)** publishes untextured base meshes under `CC0-1.0`.
It is admitted for **roadside furniture — signs, barriers, guardrails, bollards, lamp posts, fences
and gates** — that wears the surfaces the realistic world already ships.

- **Per file.** The asset's own page is read at download time, its CC0 statement recorded with the
  date, and the download pinned by digest in `inputs.lock.json` (ADR 0026 D-5). The site's
  front-page statement is not the grant for a file: its FAQ says community members submit models,
  so each file has its own author, and `ASSETS.toml` records that author.
- **Derived, never verbatim**: decimated and textured by the committed pipeline, like every
  realistic asset.
- **The site's request is noted and met.** Its FAQ asks, as a request and not a condition, that the
  meshes not be put *"behind a paywall unless you have altered them in a significant way"*. The app
  is free and its source is public, so nothing here goes against it.

### D-4 — Blender Studio's Human Base Meshes are admitted, as a sculpt and bake source for the rider

**Human Base Meshes**, published by Blender Studio on blender.org under `CC0-1.0`, are admitted as
an **input**: a body to sculpt and bake normal and ambient-occlusion maps from, for the rider the
realistic world already draws (#623). The bundle is pinned by digest and the bake is a committed
script (D-5).

- **The shipped rider's mesh, skeleton and weights stay MakeHuman's** unless a later issue changes
  that and measures it. *The author's choice*: the recommendation's words are *"a sculpt and bake
  source"*, so this decision admits the bundle as the source of baked maps and of nothing else.
- The bundle's page credits *"Blender Studio and community contributions"*, so the record names
  that, not Blender Studio alone.

### D-5 — The cyclist motion capture set is a reference to read, and none of its data is committed

*"Dataset of Motion Capture of Cyclists"* (Zenodo record 10668611, `CC-BY-4.0`) may be **read** to
set [#625](https://github.com/openzigs/onyourleft/issues/625)'s amplitudes by hand. **None of its
data is fetched by the pipeline, committed, derived from or shipped** — no BVH file, no curve
fitted to one, no table of its samples.

- **Why reference only.** Pedalling is already computed from crank angle, so a capture would add
  only what #625 already specifies as functions of crank angle and ride clock. And it is data
  recorded from people: its page says informed consent was obtained and does not say what the
  participants consented *to*, so whether redistribution inside a public repository and an app is
  within it has not been read.
- **What "by hand" means.** A person reads a figure — how far a torso rocks at a cadence — and
  writes a constant, citing the record. *The author's choice*: a number chosen that way is not a
  copy of the data, and a constant fitted by script to its files would be, so the second is out.
- **The pipeline refuses the host**, so the rule does not rest on memory (D-11).

### D-6 — MakeHuman community authors: the cyclist poses per asset; the helmet and shoes not yet

ADR 0026's 2026-09-28 amendment records that MakeHuman's own CC0 packs fall under D-4's MakeHuman
row because they are by *the same author*, and that a community author's pack *"would be the
superseding ADR this section's own D-4 names"*. This is that decision, for one kind of asset:

- **The cyclist poses in MakeHuman's *Poses 02* pack are admitted, per asset.** Each pose is taken
  only if **its own row** on the pack's page reads `CC0`, and its author is recorded from that row.
  The check is `systemAssetVerdict`'s, with the author requirement replaced by the row's own
  licence: one asset's CC0 row never vouches for another's.
- **The time-trial helmet and the cycling shoes are not admitted.** The survey read their grant as
  *"CC-BY"* with no version, and `CC-BY-4.0` is the only attribution licence the asset rules admit
  (ADR 0023). Either becomes admissible **only once its own page is read as CC BY 4.0**, and that
  reading is recorded in the pull request that takes it; until then the pipeline refuses them as
  not on the list. No other community asset is admitted by this decision.
- **Nothing trademark-named, ever**, from any author under any licence: an open copyright licence
  grants nothing in a trade mark, and ADR 0009's trade-dress limb applies to any recognisable
  product. An asset named after a brand, a team, a product or a character is refused on its name.

### D-7 — No further texture hosts now

cgbookcase, TextureCan and 3dtextures.me are **not admitted**. Nothing was found wrong with them;
ambientCG and Poly Haven are already admitted and the pipeline has used a small part of one and
none of the other ([#1274](https://github.com/openzigs/onyourleft/issues/1274)). A host is admitted
when something is needed from it, by a superseding ADR, as D-4 has always required.

### D-8 — No downloaded bicycle

The survey found no road bicycle that is unbranded, inside the triangle budget and fetchable with a
digest. [#369](https://github.com/openzigs/onyourleft/issues/369)'s parametric bicycle stands, and
[#624](https://github.com/openzigs/onyourleft/issues/624) improves its surfaces. ADR 0026 D-4's
row for *an individual model under `CC-BY-4.0`* stays on the list for other things; the bicycle is
no longer what it is chiefly for.

### D-9 — What stays out

As before this ADR, and unchanged by it: **Mixamo**; **Quixel Megascans and anything under the Fab
Standard licence**; **Sketchfab's Standard licence**; anything **`-NC`**, **`-ND`** or **`-SA`**;
and **anything AI-generated**, as D-2 defines it. Named here for the first time, because the survey
met them: **non-commercial motion capture sets** (AMASS, LaFAN1 and the Bandai Namco Research set
are the ones it read) and **MB-Lab characters**, including those CharMorph distributes — the survey
read their output as AGPL, and an asset is `CC0-1.0` or `CC-BY-4.0`. Two near-misses it found are
out by the same rule and are not listed, because the rule already refuses them: ShareTextures
(*"custom CC0-based license"*) and FreePBR (non-commercial).

`-ND` is written beside the other two because the pipeline has always refused it
(`sources.ts` §`licenceVerdict`) and ADR 0023 admits `CC-BY-4.0` alone.

### D-10 — The list, whole

This table **replaces ADR 0026 D-4's**. A source is on it or it is not used.

**In**, each verified per asset at download time, with the page, the date and the grant recorded:

| Source | Licence | Decided by | For |
|---|---|---|---|
| **Poly Haven** | `CC0-1.0` | ADR 0026 D-4 | HDRI skies, ground and road materials, photoscanned vegetation and rocks, roadside models |
| **ambientCG** | `CC0-1.0` | ADR 0026 D-4 | PBR materials, leaf atlases, decals |
| **MakeHuman's own files** | `CC0-1.0` | ADR 0026 D-4 | the rider's body, and MakeHuman's own system assets pack (the 2026-09-28 amendment) |
| **Kenney** | `CC0-1.0` | ADR 0026 D-4 | the stylised world, which stays Kenney's alone in its scenery |
| **An individual model under CC-BY-4.0** | `CC-BY-4.0` | ADR 0026 D-4 | one model, verified per asset under ADR 0023 |
| **EZ-Tree's output** | `MIT` | ADR 0049 D-1 | trees generated to budget; the licence is the generator's, and the output is this repository's |
| **The Base Mesh** | `CC0-1.0` | ADR 0049 D-3 | signs, barriers, guardrails, bollards, lamp posts, fences, gates |
| **Blender Studio Human Base Meshes** | `CC0-1.0` | ADR 0049 D-4 | a sculpt and bake source for the rider |
| **MakeHuman community cyclist poses** | `CC0-1.0` | ADR 0049 D-6 | poses, per asset, each on its own CC0 row |

**Out**, whatever the convenience:

| What | Decided by | Why |
|---|---|---|
| **Mixamo** | ADR 0026 D-4 | Adobe forbids distributing the raw files, and a public repository is distribution |
| **Quixel Megascans and the Fab Standard licence** | ADR 0026 D-4 | not an open licence |
| **Sketchfab's Standard licence** | ADR 0026 D-4 | not an open licence |
| **Anything non-commercial, no-derivatives or share-alike** | ADR 0026 D-4 | an asset is `CC0-1.0` or `CC-BY-4.0` and nothing else |
| **Non-commercial motion capture sets** | ADR 0049 D-9 | a non-commercial grant, whatever the data |
| **MB-Lab characters** | ADR 0049 D-9 | neither `CC0-1.0` nor `CC-BY-4.0` |
| **Anything AI-generated** | ADR 0049 D-2 | the output of a trained generative model |
| **The cyclist motion capture set's data** | ADR 0049 D-5 | a reference to read; none of it is fetched or committed |
| **A downloaded bicycle** | ADR 0049 D-8 | the bicycle is built from numbers |

Everything on neither table — the three texture hosts of D-7, the helmet and shoes of D-6, and
every source nobody has proposed — is **not admitted**, which the pipeline treats exactly as out.

### D-11 — How the list is held, and what an adoption owes

- **The list is in code, and a test holds it to this ADR.** `apps/web/tools/realistic/sources.ts`
  carries D-10's two tables as `ADMITTED_SOURCES` and `BARRED_SOURCES`, and
  `admitted-sources.test.ts` reads this file and fails if a row is in one and not the other, or if
  a licence or a deciding ADR differs. Until now the *In* list existed in code only as a pattern in
  a test and a sentence in a comment.
- **The pipeline refuses what the list does not name.** `realistic:fetch` asks
  `admission` of every address it requests — each licence page and each file, including the files
  Poly Haven's API names at run time (on `dl.polyhaven.org`, a host of that row) — before the
  request is made, and `licenceVerdict` asks it of the addresses a source declares. A barred host
  is refused with that host's own reason, and an address that is not in the form `fetch` would
  request (`..`, `%2e%2e`) is refused. A generator's row admits its licence page and no file. Only
  the address requested is checked: a redirect is followed.
  A term no host identifies (D-2, the Standard licences) is still a reviewer's reading of the
  asset's own page.
- **An admitted source's addresses are facts.** *The author's choice*: `sources.ts` records where
  each source's pages and files were read from. The pull request that adopts an asset may add the
  address it actually downloaded from — a mirror, an API — when the admitted source's own page
  links to it, and says so. Adding a **source** is never that: it is a superseding ADR.
- **An adoption owes**, in its own issue under #615: the asset's own page read on the day, with the
  sentence and the date recorded; the input pinned by digest (`ASSET007`), or for a
  generator its version, seed and parameters committed; the output reproduced by
  `realistic:process --check`; the budget classes of `realistic-budget.ts` held; and the tablet
  rows before it stays (#733).

## Consequences

### What this enables

- Trees made to a triangle budget with their own LODs, in place of scans decimated to fit.
- Roadside furniture — the largest gap between the realistic world and a dressed road — from a
  CC0 library, wearing surfaces already shipped.
- Baked detail on the rider from a scan-based body, with the mesh, rig and budget unchanged.
- A definition of AI-generated that a pull request can be held to, in place of a word.

### What this costs, stated plainly

- **The list is longer**, and each source on it is a page somebody has to read again per asset.
  That work is the adoption's, and D-11 says what it owes.
- **Two of the new sources carry community contributions** (The Base Mesh, Blender Studio's
  bundle), so *"the site says CC0"* is weaker evidence than it is for Poly Haven. D-3 and D-4 make
  the check per file for that reason.
- **The pipeline now refuses an address it does not know**, where before only a test did. An
  adoption that downloads from a mirror has to say so in `sources.ts` first.
- **No model file was downloaded for this ADR**, so mesh quality, texture coordinates and whether a
  given mesh is usable are unknown. Admitting a source says its licence is acceptable and nothing
  about whether its files are good.

### Constraints this places on other work

| Issue | What binds it |
|---|---|
| [#1274](https://github.com/openzigs/onyourleft/issues/1274) | Nothing new: ambientCG and Poly Haven were already admitted. Its ambientCG origin's addresses must be ones `ADMITTED_SOURCES` names; D-2 is the rule for ambientCG's *"approximated"* assets |
| [#625](https://github.com/openzigs/onyourleft/issues/625) | D-5: amplitudes by hand, cited, with no file of the set in the tree |
| [#623](https://github.com/openzigs/onyourleft/issues/623), [#624](https://github.com/openzigs/onyourleft/issues/624) | D-4 for a bake source; D-6's trade-mark rule for anything the rider wears; D-8 for the bicycle |
| Any adoption under [#615](https://github.com/openzigs/onyourleft/issues/615) | D-11's last bullet |

### What would make this ADR wrong

- **A source changes its terms.** The grant is read per asset at download time for that reason, and
  the lock records the date. A source that stops saying CC0 stops being fetched; files already
  taken under the recorded grant stay.
- **The Zenodo record's consent turns out to cover redistribution**, and a capture turns out to be
  worth more than #625's functions. Then D-5 is reversed by a superseding ADR, with the consent
  wording quoted.
- **A generator's output turns out not to be reproducible** across machines. Then D-1's condition
  is not met for that generator and its trees are not committed; D-2 is unaffected.
- **A useful tool appears that is partly learned** — a denoiser, an upscaler. D-2 bars its output
  as written. If that proves too blunt, the answer is a superseding ADR that says where the line
  is, not a reading of D-2 that lets it through.

## What was read, and when

Every page below was read on **2026-10-11**, and each quotation is from the source's own page.
Pages were fetched over HTTPS and their text extracted; nothing was downloaded beyond the pages and
EZ-Tree's licence, README and `package.json`.

| Source | Page | What it says |
|---|---|---|
| EZ-Tree | `github.com/dgreenheck/ez-tree`, tag `v1.1.0` (commit `89083a033a354856acae05f8856bf37c6ebcfa9b`), file `LICENSE`, SHA-256 `20e4afadfb10c67952b3d73cd2982d21d165ab4ae82b0dd9e4d6f2166ee349b6` | *"MIT License"*, *"Copyright (c) 2024 Daniel Greenheck"*, *"Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction"*. Its `package.json` reads `"version": "1.1.0"` and `"license": "MIT"`. GitHub's API reports the release `v1.1.0` published 2026-01-15 |
| The Base Mesh | `www.thebasemesh.com` | *"1250+ Base Meshes 100% Free. CC0 License."* |
| The Base Mesh | `www.thebasemesh.com/faq` | *"You certainly can as these models are under the CC0 licence. This license gives you the freedom to use the Assets as you see fit. There are no restrictions in how you use the Assets."* Of submissions: *"By submitting models here, you are releasing them under the CC0 license."* The request D-3 notes: *"I would however, ask you to use the meshes in the spirit in which they are created, and not to put them behind a paywall unless you have altered them in a significant way."* |
| Blender Studio Human Base Meshes | `www.blender.org/download/demo-files/`, under *Asset Bundles* | *"Human Base Meshes v1.4.1 by Blender Studio and community contributions."* and, on the same entry, *"49 MB – CC0"*, *"Updated: Jan 20, 2025"*, *"Requires Blender 4.2 LTS or newer"*. The pipeline's pinned Blender is 4.4.3. The entry links the bundle at `www.blender.org/download/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip`, which was not downloaded |
| Cyclist motion capture | `zenodo.org/records/10668611` — *"Dataset of Motion Capture of Cyclists"*, Kyriakou, Chrysanthou and Kyriakou, v1, published 2024-02-15, DOI `10.5281/zenodo.10668611` | Licence: *"Creative Commons Attribution 4.0 International"*. Consent: *"Informed consent was obtained, ensuring understanding and agreement and a pre-session questionnaire collected demographic and health information."* No sentence on the page says what the consent covers, and none names an ethics review. One file, `Dataset_cycing_mocap.zip`, 497.4 MB, not downloaded. ⚠️ A plain request for this page was answered `403`; it was read through a fetching tool that returns the page's text, so these two quotations are that tool's transcription and were not checked against the page's bytes |
| MakeHuman asset packs | `static.makehumancommunity.org/assets/assetpacks.html` | *"Pose assets shared under CC0: Poses 01, Various sitting poses Poses 02, Various sports poses"* |
| MakeHuman *Poses 02* | `static.makehumancommunity.org/assets/assetpacks/poses02.html` | A table of *Asset type, Thumbnail, Asset name, Author, Source, License*. Seven rows name a cyclist, each reading source *asset repo* and licence *CC0*: `henny_cyclist_2`, `henny_cyclist_normal`, `henny_cyclist_normal_tough`, `henny_cyclist_talking`, `henny_cyclist_waving` and `henny_pose_for_a_race_bicycle` by Henny, and `punkduck_cyclist01` by punkduck. The survey counted six; D-6 is per asset, so the count decides nothing. The pack's archive is linked at `files.makehumancommunity.org/asset_packs/poses02/poses02_cc0.zip` and a second mirror, and was not downloaded |
| MakeHuman licence | `static.makehumancommunity.org/about/license.html` | *"All core assets are shared under Creative Commons, CC0."* |
| ambientCG, for D-1's bark | `docs.ambientcg.com/license/` | *"All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License."* |

**Could not be confirmed**, and nothing above rests on it:

- **The community helmet's and shoes' grant.** Their pages were not found on 2026-10-11 from the
  community site's clothes listing, so the version of their *"CC-BY"* is still unread. D-6 leaves
  them out for exactly that reason.
- **MB-Lab's and the non-commercial motion capture sets' terms**, and Fab's and Sketchfab's
  Standard licences, were not re-read for this ADR: the survey's reading of 2026-10-11 and ADR 0026
  D-4 are what D-9 rests on, and all of them stay out, so an error there admits nothing.
- **Whether EZ-Tree's output is byte-stable** across machines and Node versions. D-1 makes that a
  condition of committing a tree, to be measured by the adopting issue.
- **The scope of the Zenodo participants' consent** — the reason for D-5.
