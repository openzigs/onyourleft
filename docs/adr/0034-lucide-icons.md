# ADR 0034: Icons come from Lucide — named imports only, decoration beside words, and no other UI dependency

- **Status**: Accepted
- **Date**: 2026-09-29
- **Deciders**: **the owner, on adopting Lucide** — ruling 5 on
  [#654](https://github.com/openzigs/onyourleft/issues/654), 2026-09-27, quoted in Context. The
  author decided the engineering rules (D-2 to D-5) and wrote the wording
- **Issue**: [#673](https://github.com/openzigs/onyourleft/issues/673), bundled with
  [#674](https://github.com/openzigs/onyourleft/issues/674) in
  [#857](https://github.com/openzigs/onyourleft/issues/857). Parent epic
  [#654](https://github.com/openzigs/onyourleft/issues/654)
- **Number**: **0034**, read from [`docs/architecture.md`](../architecture.md)'s ownership table
  — the check `CLAUDE.md` §7 asks for — on 2026-09-29. It had been **reserved for #673** since
  [ADR 0035](0035-model-written-ride-write-ups.md) left it alone on 2026-09-28, and no other branch
  had written a file under that number. The next free number stays 0040
- **Reverses**: two recorded choices, neither of them an ADR —
  `apps/web/src/shell/NavIcon.tsx`'s header, *"Why they are drawn here and not installed"*, and
  `CLAUDE.md` §2's *"the icons, authored here as inline SVG rather than installed — no icon set is a
  dependency"*. Both are rewritten in the same pull request to point here
- **Supersedes**: nothing

## Context

### What the owner ruled

> **Icons: adopt Lucide** (ISC), shipping only the icons used. It is a new runtime dependency, so it
> goes through `check:licences` and is recorded in an ADR, or an amendment, as the stack decision
> requires.

— owner ruling 5 on #654, 2026-09-27.

[ADR 0013](0013-adr-amendments.md)'s amendments record a statement of fact that became false; this
records a new decision that reverses a recorded one, so it is an ADR.

### What was there before

Five navigation icons were inline SVG authored in `NavIcon.tsx` (#427, #428), and that file's
header argued an icon set would be a licence question in `DEP001` and `DEP002` and a bundle cost,
for five shapes. The argument was sound for five shapes. It stops being sound the moment the next
screens want icons (#654's re-review lists the segmented control of #668 and card icons), because
each would be drawn by hand, reviewed as artwork, and would look like nobody's set rather than one
set.

### What was measured, and read

Re-review of #654 (issuecomment-5856862949 §3), 2026-09-27, confirmed while writing this ADR
against the installed `lucide-react@1.48.0`:

- **`lucide-react`**, not `lucide`. Zero runtime dependencies, one peer (`react`),
  `sideEffects: false`. `lucide` is the framework-free package and builds DOM outside React.
- **Cost**: 5 icons 2,337 B gzip, 20 icons 3,751 B gzip (esbuild, React external, gzip -9).
- **`lucide-react/dynamic`** exports `DynamicIcon` and `dynamicIconImports`, which map every icon
  to a lazy import. One use puts the whole set in the build. Measured for this ADR: importing
  `dynamicIconImports` into the product build puts **1,854** icon modules in it, where the source
  names 5. The precache is derived from the build (#406), so every one of them would be in every
  rider's first download.
- **The package has no `exports` map**, so every file under it is importable by path
  (`lucide-react/dist/esm/DynamicIcon.mjs`), not only the documented subpaths.
- **Accessibility.** v1 renders `aria-hidden="true"` unless the icon is given children, an `aria-*`
  prop, `role` or `title`. It does not set `focusable="false"`, which only legacy Edge and IE read.
- **Aliases.** Several names are aliases of one icon: in 1.48.0 `History` is an alias of
  `RotateCcwClock` (the rendered class is `lucide-rotate-ccw-clock`).
- **Licence.** The manifest says `ISC`. The shipped `LICENSE` is ISC **and** MIT, the second for
  about 120 icons derived from Feather, © Cole Bemis. `ISC` is in ADR 0015's permissive row and in
  `POLICY.permissive`, so `DEP001` and `DEP002` admit the package in `apps/web`'s distributed
  closure. The **notice** is #664's gate (`check:notices`), which copies the `LICENSE` file
  verbatim, so both licences travel.

## Decision

### D-1 — Icons in `apps/web` come from `lucide-react`, pinned exactly

`lucide-react` **1.48.0** is a runtime dependency of `apps/web`, pinned to an exact version at
least 24 hours old (CLAUDE.md §8; no `minimumReleaseAgeExclude`). A bump is a dependency change
like any other: `check:licences`, `check:notices` regenerated and its diff read, and the build's
icon count (D-2) re-run.

### D-2 — Named imports from the package root, and nothing else

An icon is imported by name from `'lucide-react'`. **No subpath of the package may be imported,
and neither may `DynamicIcon`, `dynamicIconImports` or `iconNames`**, however spelled.
`eslint.config.js` enforces it for every file under `apps/web`.

The lint rule is the fast half. **The build is the half that cannot be argued with**:
`apps/web/tools/bundle/icon-modules.ts` fails `pnpm run build` when the number of Lucide icon
modules in the bundle differs from the number of distinct icons the bundled source imports, and
refuses a namespace or default import of the package outright. An icon imported under two of its
aliases is therefore a build failure; import each icon by **one** name, and prefer the canonical
one, because an alias is the name a major release is most likely to drop.

### D-3 — The artwork is Lucide's and stays in the package

An icon's paths are **never copied** into this repository. A copied path would put ISC and MIT
artwork under an `AGPL-3.0-or-later` header, which is the misdeclaration CLAUDE.md §3a describes;
the notice travels in the third-party notices document instead (#664).

### D-4 — An icon is decoration beside a visible word

Every icon sits beside visible text that names the control, and is `aria-hidden="true"` — set
explicitly at the call site rather than left to Lucide's default, so a release that changed the
default could not change what a screen reader hears. **An icon-only control carries `aria-label`
on the CONTROL, never a `<title>` inside the SVG**: a `<title>` is exposed inconsistently across
browser and screen-reader pairs, and it would switch off Lucide's own `aria-hidden`.

### D-5 — This admits one package and nothing else

This ADR admits `lucide-react` for icons. **It admits no other runtime UI dependency.** A headless
component library, which the owner accepted in principle on #654 (ruling 4), needs its own spike and
its own ADR when a control the platform lacks is first needed, and must arrive in a lazily loaded
chunk (#674).

## Consequences

- **`NavIcon.tsx`** keeps its component, its `oyl-nav-icon` class, `currentColor` and one shared
  stroke width, and maps each `NavIconName` to a Lucide component: `ride → Bike`,
  `history → RotateCcwClock` (the canonical name of #673's `History`), `routes → Route`,
  `home → House`, `more → Ellipsis`. Its header is rewritten to point here.
- **The bundle** carries Lucide's shared `Icon`/`createLucideIcon` code once and one module per icon
  used. The five navigation icons are in the entry chunk because the navigation is.
- **The notices document** (`apps/web/public/licences/third-party.txt`) gains `lucide-react` with
  both its ISC text and the Feather MIT text, and `apps/web/src/credits/notices.test.ts` asserts
  the MIT paragraph is there — because a notice built from the manifest's `license` field would say
  ISC and drop it.
- **ADR 0009 L1** (no competitor's icon set, as a set) is not engaged: Lucide is nobody's product
  get-up, and this app draws it beside its own words and tokens.
- **A later screen that wants an icon** imports it by name and gets it; the build's count moves with
  the import and nothing else needs editing.

## What would make this ADR wrong

- **Lucide changes its licence**, or a release adds artwork under terms outside ADR 0015's tables.
  `check:licences` reads the manifest field and `check:notices` the files; a licence change in
  either stops the build, and this ADR is then re-opened rather than the gate widened.
- **The icons stop being decoration** — an icon-only control becomes the pattern rather than the
  exception. D-4 would then need to say how each is named and tested, not only that it is.
- **The count rule becomes noise** — for instance if the app needs Lucide's context provider or its
  base `Icon` for drawn icons of its own. `NOT_ICONS` in `tools/bundle/icon-modules.ts` is where
  such an export is named, deliberately, rather than the rule being loosened.
