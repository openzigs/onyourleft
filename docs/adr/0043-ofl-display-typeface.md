# ADR 0043: Admit the SIL Open Font License 1.1 for a bundled display typeface, and choose Barlow

- **Status**: Accepted
- **Date**: 2026-10-02
- **Deciders**: **the owner, on recording an ADR to admit a display face's licence** — Phase 2 of
  [#935](https://github.com/openzigs/onyourleft/issues/935), ruling 2 of 2026-10-02, quoted in
  Context. The author chose the face against the candidates
  [#991](https://github.com/openzigs/onyourleft/issues/991) names, on the measurements in D-6, and
  wrote the conditions (D-1 to D-5) from the licence's own text
- **Issue**: [#991](https://github.com/openzigs/onyourleft/issues/991), parent epic
  [#935](https://github.com/openzigs/onyourleft/issues/935)
- **Number**: **0043**, read from [`docs/architecture.md`](../architecture.md)'s ownership table —
  the check `CLAUDE.md` §7 asks for — on 2026-10-02, and checked against every open pull request:
  none adds an ADR above 0042
- **Amends**: nothing. **Extends**: [ADR 0015](0015-dependency-licences.md) D-2's table as it is
  applied to a committed file by `ASSET004` (CLAUDE.md §4a), by one row for one file class.
  **Reverses**: [#935](https://github.com/openzigs/onyourleft/issues/935)'s D-5 of 2026-09-30
  (*"`system-ui` at heavier weights … and no font file"*), on the owner's Phase 2 ruling
- **Supersedes**: nothing

## Context

### What the owner ruled

> **Owner rulings** [Phase 2, 2026-10-02]: … 2. **A bundled display typeface:** record an ADR
> admitting the font's licence (most free display faces are OFL-1.1, which no licence list here
> admits yet).

— owner, on #935, 2026-10-02, after a screen-by-screen review on a Pixel 8 and the Pixel Tablet that
still found the menus "too back office". The relayed reply to the questions that produced #991 was
*"yes, record adr"*.

### Why the question needed an ADR at all

Nothing in this repository could admit a display face under the SIL Open Font License:

- **`ASSET004`** (`scripts/check-repo-rules.sh`) judges a committed file's licence against where it
  lands: permissive anywhere, the weak set (`CC0-1.0`, `MPL-2.0`, `BlueOak-1.0.0`, `MIT-0`, `0BSD`,
  `Unlicense`) and `CC-BY-4.0` under `apps/` only, and **everything else refused**. `OFL-1.1` was in
  no set, so a committed font file under it was a red build.
- **ADR 0015**'s dependency tables name no OFL either, so `DEP001` refuses a font package
  (`@fontsource/*`) under it in any closure.
- The one face this repository already commits — the map's Roboto, `apps/web/tools/glyphs/` (#578)
  — is **pinned at v2.138 for exactly this reason**: Roboto moved to OFL-1.1 at v3.0, and `CLAUDE.md`
  §2 records that *"a newer Roboto is a licence change, not an upgrade"*.

And the display faces worth having are OFL: every one of the six #991 names is (D-6's table), and
Google Fonts, where all six are published, keeps its far larger OFL collection under `ofl/` beside a
small `apache/` one. The owner chose to admit the licence rather than to restrict the choice to that
small set or to have no display face.

### What the SIL Open Font License 1.1 says

Read on 2026-10-02 from the text Barlow ships (`apps/web/tools/fonts/barlow/OFL.txt`, SHA-256
`186d750e…6b716b`, from `google/fonts` at commit `9710da1e…`), which is the canonical OFL 1.1 of
26 February 2007 under Barlow's copyright line. The parts this ADR turns on:

- **Permission**: to *"use, study, copy, merge, embed, modify, redistribute, and sell modified and
  unmodified copies of the Font Software"*, subject to five conditions.
- **Condition 1**: *"Neither the Font Software nor any of its individual components, in Original or
  Modified Versions, may be sold by itself."*
- **Condition 2**: *"Original or Modified Versions of the Font Software may be bundled, redistributed
  and/or sold with any software, provided that each copy contains the above copyright notice and
  this license. These can be included either as stand-alone text files, human-readable headers or in
  the appropriate machine-readable metadata fields within text or binary files as long as those
  fields can be easily viewed by the user."*
- **Condition 3**: *"No Modified Version of the Font Software may use the Reserved Font Name(s)
  unless explicit written permission is granted by the corresponding Copyright Holder."*
- **Condition 4**: the authors' names may not be used to promote a Modified Version without
  permission.
- **Condition 5**: the Font Software *"must be distributed entirely under this license, and must not
  be distributed under any other license. The requirement for fonts to remain under this license
  does not apply to any document created using the Font Software."*

## Decision

### D-1 — `OFL-1.1` is admitted for a **font file** under `apps/`, and for nothing else

`ASSET004` admits `OFL-1.1` for a committed file under `apps/` whose last extension is `woff2`,
`woff`, `ttf` or `otf` (`ASSET_LICENCES_FONT` and `ASSET_FONT_FILES` in
`scripts/check-repo-rules.sh`). Everything else stays refused, and `check-repo-rules.test.sh` has a
red case for each:

- **a non-font file** under OFL — a picture whose name merely contains `.woff2` included;
- **a font under `packages/`**, for ADR 0015 D-2's reason: an Apache-2.0 leaf package exists to be
  dropped into somebody else's project, and condition 5's "entirely under this license" is an
  obligation its own `LICENSE` does not describe;
- **`OFL-1.1-RFN`**, matched by equality like every identifier there (D-3).

**Not a dependency.** `DEP001`'s tables are unchanged: no OFL package is admitted in any closure. A
font package (`@fontsource/barlow` and the like) is a font *and* JavaScript and CSS under whatever
its manifest says, its own files are not reviewed by this repository, and it is not needed — D-5
commits the face instead. A future font package is its own amendment to ADR 0015.

**Not the code licence.** CLAUDE.md §3's path rule is about the code this repository writes. A
committed asset under `apps/` keeps its own licence — the Kenney models are CC0, the brand art
CC-BY-4.0 — and so does a font: the subsets stay `OFL-1.1` in `ASSETS.toml`, which condition 5
requires, and are never relicensed `AGPL-3.0-or-later`.

### D-2 — How each condition is met

| Condition | How it is met | What holds it |
|---|---|---|
| 1 — never sold by itself | The face ships inside the app, which is free, and is not offered as a download of its own. A web font's URL is reachable, as every web font's is; it is not sold, and nothing here sells anything | This ADR. ⚠️ A paid build, or a paid font pack, would need this re-read |
| 2 — the copyright notice and the licence in each copy | **Three places**, any one of which the condition accepts: (a) each WOFF2 keeps its `name` records 0 (copyright), 13 and 14 (licence and its URL) — machine-readable metadata, as condition 2 names; (b) the Credits screen lists the face in its *licence-copy* section with the copyright notice as its creator and links `licences/OFL-1.1.txt`, the licence's text shipped in `dist` and precached; (c) the third-party notices' new **Part 5** reproduces the upstream `OFL.txt` verbatim, copyright line and all | `tools/fonts/fonts.test.ts` reads records 0, 13 and 14 out of each committed WOFF2; `credits.test.ts` holds `OFL-1.1.txt` equal to the upstream licence's text; `CreditsView.test.tsx` renders the credit and its link; `check:notices` (NOT005) and its suite, Part 5 |
| 3 — no Reserved Font Name on a modified version | Subsetting is a modification (the OFL FAQ says so of a subset), so a face that declares a Reserved Font Name would have to be renamed. Barlow declares none, so the subset keeps the family name `Barlow` | `fonts.test.ts` fails if the upstream licence's header declares one; D-3 |
| 4 — no promotion in the authors' names | The credit names them as the authors of the face, which is attribution, not promotion | This ADR |
| 5 — the font stays OFL | The subsets are recorded `OFL-1.1` in `ASSETS.toml`; a page rendered in the face is a "document created using the Font Software", which the condition expressly frees | `ASSET004`; `fonts.test.ts` §ASSETS.toml |

### D-3 — A face that declares a Reserved Font Name is not admitted by this ADR

Many OFL faces declare one (*"with Reserved Font Name 'X'"* under their copyright line). A subset of
such a face may not be called X, which means renaming it in the font's own `name` table and in CSS,
and trusting that nobody later swaps the original back under the old name. That is a real cost with
nothing to gain while faces without a Reserved Font Name exist. So:

- the identifier `OFL-1.1-RFN` is refused by `ASSET004` (equality, not a prefix);
- a face recorded as plain `OFL-1.1` is checked by `fonts.test.ts`: the header of its committed
  `OFL.txt` must not declare a Reserved Font Name;
- a face that does is a new decision, appended here as an amendment, with the renaming written
  down.

### D-4 — The face is served from the app's own origin, never from a font CDN

A face linked from Google Fonts or any other CDN would put every rider's address, and the page that
asked, in somebody else's log on every cold start, and would make the app's own type depend on a
service it does not run — ADR 0024's offline posture and ADR 0036 D-3.a's single sanctioned egress
broken by a line of CSS. So:

- the WOFF2 files are committed beside `theme.css` and named by a **relative** `url()`, so Vite
  hashes them into `dist/assets/`, the service worker precaches them (ADR 0024 D-2's derived
  precache needs no edit), and the Android shell serves them from the APK;
- `privacy/stylesheet-origins.test.ts` reads every stylesheet under `apps/web/src`: an `@import` is
  refused, every `url()` must be relative and name a committed file, and every `@font-face` must load
  one committed WOFF2 from `./fonts/` with no `local()` (a `local()` face draws differently per
  device);
- `browser/shell.browser.spec.ts` §"#991" reads the network in the real engine: every font the page
  requests is same-origin, the 800 subset is among them, and the face that **loaded** is Barlow — with
  every `.woff2` refused as the control, under which the face must not load.

### D-5 — How a face is committed: upstream bytes in, a pinned subsetter, WOFF2 out

| Step | What | Where |
|---|---|---|
| Input | The upstream static weights, **unmodified**, with the upstream `OFL.txt` beside them; each binary has an `ASSETS.toml` row (`OFL-1.1`, the URL at the pinned commit, its SHA-256) and no `creator`, because it ships in nothing | `apps/web/tools/fonts/barlow/` |
| Recipe | The upstream commit, every digest, the Latin range, the layout features kept, the `name` records kept, and the pinned tool, written down once | `apps/web/tools/fonts/font-recipe.ts` |
| Step | `pnpm --filter @onyourleft/web run fonts:subset` runs `fontTools.subset` per weight and writes the WOFF2s and the licence text; `--check` writes nothing and fails unless every committed file is reproduced byte for byte | `apps/web/tools/fonts/subset-fonts.ts` |
| Tool | **fontTools 4.66.1 with Brotli 1.2.0**, refused at any other version, in a Python named by `FONTTOOLS_PYTHON` — a TOOL like Blender and KTX-Software (ADR 0026 D-5): nothing in CI runs it. Measured on 2026-10-02: two runs wrote byte-identical files | `.env.example` |
| Output | One WOFF2 per weight, **Latin range only** (Google Fonts' own `latin` subset: ASCII, Latin-1, General Punctuation, €, −, ™ and a few more), unhinted, with `calt`, `case`, `ccmp`, `kern`, `liga`, `lnum`, `locl`, `mark`, `mkmk`, `pnum` and **`tnum`** kept; a derived `ASSETS.toml` row (`ASSET007`'s `input`, `inputsha256`, `script`, `tool`) with the copyright notice as its `creator` | `apps/web/src/design/fonts/` |
| CI | Without the tool, `tools/fonts/fonts.test.ts` holds the inputs to their digests, the shipped licence text to upstream's, and reads every committed WOFF2 back with this repository's own reader (`tools/fonts/woff2.ts`, which reuses `tools/glyphs/truetype.ts`' cmap reader): exactly the Latin range, the weight, the family, the copyright and licence records, `tnum` making the ten figures one width — and the default figures **not** one width, so that case can fail | the ordinary suite |

`unicode-range` in `theme.css` is the same list, so a character outside it is drawn in the system face
rather than as a missing glyph, and `font-display: swap` draws the system face until the file has
loaded rather than nothing.

### D-6 — The face is **Barlow**, at 700 and 800

#991 asks for *"a sporty display face, readable as numerals at a distance, with tabular figures, and
OFL or more permissive"*, compared across six candidates on legibility, tabular numerals, the weights
needed and file size. Measured on 2026-10-02 from `google/fonts` at commit `9710da1e…`, each instanced
at weight 700 (variable fonts at width 100), subset to the Latin range above with the D-5 flags, by
fontTools 4.66.1:

| Face (licence) | Shape | `tnum` | Ten figures under `tnum`, em | WOFF2, Latin, unhinted | 0 / O told apart at 13 px | Notes |
|---|---|---|--:|--:|---|---|
| **Barlow** (OFL-1.1) | grotesk drawn from California highway signage, slightly rounded, low contrast | ✅ one width | **0.544** | **13.6 KB** (800: 13.6 KB) | ✅ the zero is narrow, the O round | static weights released by the designer; 3, 6, 8, 9 open |
| Barlow Condensed (OFL-1.1) | the same, condensed | ✅ one width | 0.498 | 12.9 KB | ✅ | the sportiest heading; the narrowest figures, the worst at a distance |
| Saira (OFL-1.1) | squared, "technical" | ✅ one width | 0.620 | 11.6 KB | ❌ the squared zero and O are near-identical | variable |
| Archivo (OFL-1.1) | grotesk | ✅ (default figures already near-tabular) | 0.598 | 12.6 KB | ✅ | reads as a body face, not a sporting one |
| Exo 2 (OFL-1.1) | squared, futuristic | ⚠️ **two widths** (618 and 620 units) | 0.620 | 15.1 KB | partly | `tnum` is not quite tabular: a figure 2 units wider jitters a ticking number |
| Rajdhani (OFL-1.1) | squared, condensed | ❌ **no `tnum` feature** | — | 9.2 KB | ❌ | fails #991's tabular-figures requirement outright |

Barlow is chosen: it is the only candidate that is **both** a sporting display face and the most
legible set of figures of the ones whose `tnum` is true — its signage lineage is legibility at a
distance, which is #991's own criterion — and its zero and O, its 3 and 8 and its 1 and 7 stay
distinct at 13 px where Saira's and Rajdhani's squared forms run together. Saira's wider figures and
smaller file do not outweigh a zero that reads as an O; Barlow Condensed is kept in reserve for a
heading that needs to be narrow. No candidate declares a Reserved Font Name (D-3).

**Weights.** 800 is the display step (`theme.css` §`.oyl-display`, the Home hero's title); 700 is the
big numerals Phase 1's bold type scale asks for (#992). Each is about 13.6 KB, both are precached,
and a browser downloads a weight only when a rule asks for it. Hinting is dropped: it is a third of
each file (20.6 KB hinted against 13.6 KB for Barlow Bold) and is for small sizes on a rasteriser the
app does not target.

### D-7 — The token, and the fallback

`--oyl-font-family-display` (`tokens.ts` §`FONT_FAMILY_TOKENS`, Tailwind's `tw:font-display`) is
`'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif`: the face, then the same system stack
`body` uses. Today it is read by the display step only; `theme.a11y.test.ts` holds `theme.css` and
`tokens.ts` to each other and requires a rule to read it, as for every other token. Body text stays
in the system face — a display face is for display — and the ride HUD and every ride-time control
are untouched (#935's "What does NOT change").

## Consequences

### What this enables

- A display face for the menus, which the owner asked for twice, and big tabular numerals for #992.
- The next OFL face is a recipe entry, two `ASSETS.toml` rows per weight and a credit — not a
  licence decision — provided it declares no Reserved Font Name.

### What this costs, stated plainly

- **27 KB** in `dist` and in the precache for two weights, and about 13.6 KB on a first visit to a
  screen that draws the display step.
- **A pinned tool nobody runs in CI.** `fonts:subset --check` is by hand, exactly like
  `realistic:process --check`. The ordinary suite proves what each WOFF2 *holds*; it cannot prove the
  bytes are what the tool would write today.
- **A second committed font, and the first under OFL.** A newer Barlow is a change to the recipe's
  digests and to D-6's table, and a face that adds a Reserved Font Name stops being admitted.
- A short swap on a cold load: `font-display: swap` shows the system face until the file arrives.
  The display step is one line per screen, so what moves is one heading.

### What would make this ADR wrong

- A store or a reviewer treating a bundled OFL font as a copyleft obligation over the app. It is not
  one: OFL binds the **font**, condition 2 expressly permits bundling it *"with any software"*, and
  condition 5 expressly frees *"any document created using the Font Software"*. That is also why this
  ADR does not touch [ADR 0025](0025-app-store-additional-permission.md): that permission exists
  because the **AGPL**'s "no further restrictions" clause meets the app stores' terms, and a
  permission this project grants cannot reach a third party's copyleft (`DEP002`). The OFL has no
  such clause, so there is nothing for an additional permission to waive, and Barlow's authors'
  terms are met as they stand wherever the app is distributed, a store included.
- A paid build, or selling the face in any form: condition 1 would need re-reading.

## What was read, and when

- The SIL Open Font License 1.1, as `ofl/barlow/OFL.txt` in `google/fonts` at commit
  `9710da1eacb3be272583c3224dcb70f9da6eadbb`, read 2026-10-02, and each candidate's own `OFL.txt` in
  the same commit (none declares a Reserved Font Name).
- Barlow 1.408's `name` table, read with fontTools 4.66.1: copyright *"Copyright 2017 The Barlow
  Project Authors (https://github.com/jpt/barlow)"*, licence description and URL records present.
- `ofl/barlow/METADATA.pb` at the same commit: designer Jeremy Tribby, licence OFL; the static
  weights last changed there in commit `89f5431ff0db41bd2fe3f7ba21a723a01622428b`, 2018-12-05.
