# ADR 0063: The design system direction — Hi-Vis: palette, zones, dark first, type, motion, sound, and no new runtime dependency

- **Status**: **Proposed**, 2026-11-03. It becomes Accepted when the owner accepts it in a comment on
  [#2036](https://github.com/openzigs/onyourleft/issues/2036) or on the pull request that writes it, and
  that comment is then cited here by an appended `## Amendments` entry (ADR 0013). Until then a build
  issue may rely on what it records only where the owner's own rulings, quoted below, already say it
- **Date**: 2026-11-03
- **Deciders**: **the owner**. Every decision below rests on an owner ruling, each quoted with its date
  in Context. Where a line goes beyond a ruling it says **author's reading**
- **Issue**: [#2036](https://github.com/openzigs/onyourleft/issues/2036), under the design-system epic
  [#2030](https://github.com/openzigs/onyourleft/issues/2030), under
  [#429](https://github.com/openzigs/onyourleft/issues/429)
- **Number**: **0063**. On 2026-11-03 `main` holds no `docs/adr/` file numbered 0063, no open pull
  request adds one, and the only issue naming 0063 is #2036 itself, by its title. **0057 is claimed by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and 0058 by
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)**, both by their titles and both
  unwritten, and are left alone as ADR 0059 to ADR 0062 left them
- **Supersedes**: no ADR. It replaces two rules that were never ADRs: the HUD's light-palette pin
  from the review of pull request [#744](https://github.com/openzigs/onyourleft/pull/744) (D-2), and,
  **for music only**, epic [#935](https://github.com/openzigs/onyourleft/issues/935)'s principle 5,
  *"Sound is off until the rider turns it on"* (D-8)
- **Extends**: [ADR 0043](0043-ofl-display-typeface.md) D-6 (*"The face is Barlow, at 700
  and 800"*) by one weight, 600 (D-5). ADR 0043's body is not edited; a dated entry appended to its
  `## Amendments` section points here and does nothing else
- **Relates to**: [ADR 0009](0009-clean-room-posture.md) L1 (our own design system, D-9);
  [ADR 0034](0034-lucide-icons.md) D-5 (no runtime UI dependency without an ADR, D-6);
  [ADR 0041](0041-motion-for-menu-animation.md) D-5 (nothing runs longer than 200 ms, D-7);
  [ADR 0013](0013-adr-amendments.md) (amendments are appended)

## Context

### What the owner asked for, and ruled

> *"I am not happy with the color scheme or layout. It does not compare to other cycling apps. Seems
> like we should have a splash screen and some background music. The overall design looks generic.
> The home screen has a generic image that takes up a lot of real estate."*
> — the owner, 2026-11-03, quoted on [#2030](https://github.com/openzigs/onyourleft/issues/2030)

The rulings this ADR rests on, in the order they were made:

1. **2026-11-03, ruling 1 on #2030 — the palette is replaced, not tuned.** *"I don't like the current
   color scheme I want it revamped."* Zone colours drop the teal-to-plum ramp and use the common grey,
   blue, green, yellow, orange, red order, with the zone number and name always shown.
2. **2026-11-03, ruling 2 on #2030 — music.** *"Music on by default in menus off during ride."*
3. **2026-11-03, ruling 3 on #2030 — dark screens.** *"Dark screens."* Ride and HUD screens go dark,
   superseding the HUD's light pin from the review of #744.
4. **2026-11-03, on [#2030](https://github.com/openzigs/onyourleft/issues/2030#issuecomment-6602320889)
   and on [#2039](https://github.com/openzigs/onyourleft/issues/2039#issuecomment-6602323550)** —
   *"Take the recommendations."* Zone 7 (Sprint) is **purple above red**, and heart-rate zones reuse
   the first five power colours by position. The launch intro stays inside the 200 ms cap (#2030's
   open question 2).
5. **2026-11-03, on [#2032](https://github.com/openzigs/onyourleft/issues/2032#issuecomment-6602322056)**
   — *"Take the recommendations"*, with the splash recorded as **the official plugin,
   `@capacitor/splash-screen` 8.0.2**, not a native change.
6. **2026-11-03, the choice on
   [#2035](https://github.com/openzigs/onyourleft/issues/2035#issuecomment-6619125271)** — *"A:
   Hi-Vis."* Direction A, graphite with a fluorescent lime accent, chosen after the owner saw the Home
   tablet screen, the ride HUD and the colour and type sheets of all three directions in spike 0034
   (pull request [#2105](https://github.com/openzigs/onyourleft/pull/2105)). The same comment carries
   the spike's proposals into the build: the 1.25 type scale with Barlow 600 added; an adjacent-surface
   floor of 1.15:1 with `MAXIMUM_ELEVATION_STEP` at 1.3; an adjacent-zone floor of 1.20:1 under each
   simulated vision; dark zone colours on the HUD whatever the page theme; `accent` split into a fill
   token and a text token; and the HUD secondary numeral at 2.45rem or more.

### Why these need an ADR rather than a pull request each

The redesign changes rules that earlier decisions set: the palette and its source (`tokens.ts`'s
header records the teal as *"chosen to clear WCAG AA … and for no other reason"*), the zone ramp's
monotone lightness (`BAND_DIRECTION`, held by `tokens.test.ts`), the HUD's light pin, the font weights
ADR 0043 D-6 names, and #935's sound default. Eleven build issues across five epics (#2030 to #2034)
paint with what is decided here. Decided once, a reviewer checks each of them against one page.

### What exists on `main` (audit of 2026-11-03, on #2030)

- One desaturated teal on grey-green neutrals. Text contrast is high (dark ink on canvas 14.9:1), but
  **every adjacent surface step is about 1.1:1** (dark 1.09 / 1.13 / 1.15) and a raised card on the
  dark canvas is **1.23:1**, so cards read as flat slabs. Primary buttons are pastel teal.
- `BAND_TOKENS` is a seven-step teal, slate, brick and plum ramp, monotone in lightness.
- Barlow 700/800 sets `h1` only; metric numbers and `h2` are `system-ui` 700.
- Dark is the default since [#992](https://github.com/openzigs/onyourleft/issues/992); `theme.css`
  §`.oyl-hud` restates every page colour token at its light value.

## Decision

### D-1 — The palette is direction A, Hi-Vis, in both themes

Graphite neutrals with no hue, and one fluorescent lime for the primary action, the focus ring, the
current navigation item and the data a rider is meant to see first. **The accent's source** is the
fluorescent yellow-green of high-visibility cycling clothing, the background-material class of EN ISO
20471 (a public safety standard, not a brand), pushed toward green so that it reads as lime and not as
any product's yellow. In light, a lime cannot carry text on white, so `accent` is a deep olive and the
lime survives as `selected`.

| Token | Dark | Light |
|---|---|---|
| `canvas` | `#101215` | `#ffffff` |
| `surface` | `#242729` | `#ebeef0` |
| `surfaceRaised` | `#333639` | `#dbdde0` |
| `surfaceOverlay` | `#414447` | `#cbcdd0` |
| `ink` | `#edeef1` | `#131415` |
| `inkMuted` | `#b3b7ba` | `#515355` |
| `border` | `#93969a` | `#6a6c6e` |
| `accent` | `#aff13c` | `#405e00` |
| `accentHover` | `#c7fd7b` | `#2c4300` |
| `accentInk` | `#121809` | `#ffffff` |
| `selected` | `#304216` | `#cdf39c` |
| `focus` | `#aff13c` | `#131415` |
| `link` | `#aade5b` | `#3d5b00` |
| `linkVisited` | `#c5acf2` | `#5e3a91` |
| `linkHover` | `#cdf39c` | `#2c4300` |
| `linkActive` | `#e6fad0` | `#1b2b00` |
| `infoSurface` / `infoInk` / `infoBorder` | `#142b3d` / `#93cbfc` / `#1e72ac` | `#dceeff` / `#004876` / `#328bcd` |
| `successSurface` / `successInk` / `successBorder` | `#162e1b` / `#99d3a4` / `#287b42` | `#dbf2df` / `#005122` / `#3b9655` |
| `warningSurface` / `warningInk` / `warningBorder` | `#35260d` / `#e5c182` / `#906500` | `#f9ebd3` / `#5d4000` / `#ae7c00` |
| `dangerSurface` / `dangerInk` / `dangerBorder` | `#3e211e` / `#ffb2ac` / `#ac514c` | `#ffe7e4` / `#792b29` / `#cc6660` |
| `dangerAction` / `dangerActionInk` | `#fb8981` / `#321312` | `#a21a21` / `#ffffff` |
| `illoSky` / `illoSun` | `#102239` / `#897626` | `#c6d9f2` / `#e0c24b` |
| `illoHillFar` / `illoHillNear` / `illoRoad` | `#263a22` / `#304f2a` / `#53595e` | `#adcca7` / `#8fb686` / `#91969c` |
| `hudSurface` / `hudInk` / `hudInkMuted` | `#101215` / `#f4f7f9` / `#9da3a8` | the same (theme-independent) |
| `hudBorder` / `hudStaleInk` | `#787c82` / `#f1af48` | the same (theme-independent) |

The zone colours are D-4's.

**Contrast.** Every pair `CONTRAST_REQUIREMENTS` declared on 2026-11-03 (99 distinct foreground,
background and minimum triples) passes in both themes, computed with `apps/web/src/design/contrast.ts`
itself; the full table is in the [option A comment on
#2035](https://github.com/openzigs/onyourleft/issues/2035) and in spike 0034 (#2105). The pairs that
matter most, re-computed for this ADR with the same `contrastRatio`:

| Pair | Minimum | Dark | Light |
|---|--:|--:|--:|
| `ink` on `canvas` | 4.5 | 16.17 | 18.44 |
| `ink` on `surfaceRaised` (a primary numeral on a metric card) | 4.5 (target 7) | 10.48 | 13.55 |
| `inkMuted` on `surfaceOverlay` (the tightest muted text) | 4.5 | 4.85 | 4.85 |
| `accent` on `surfaceOverlay` (the tightest accent text) | 4.5 | 7.22 | 4.68 |
| `accentInk` on `accent` (a primary button's label) | 4.5 | 13.33 | 7.45 |
| `hudInk` on `hudSurface` (a primary HUD numeral) | 4.5 (target 7) | 17.44 | 17.44 |
| `hudInkMuted` on `hudSurface` (a HUD field label) | 4.5 | 7.36 | 7.36 |
| `hudBorder` on `hudSurface` (a HUD control's edge) | 3 | 4.47 | 4.47 |

The authority is the gate, not this table: #2037 writes the values into `tokens.ts` and `theme.css`,
and `contrast.a11y.test.ts` re-measures every declared pair and records each `measured` margin. A
value here that the gate cannot pass is changed in a dated amendment, never by lowering a minimum.

**`accent` is split into a fill token and a text token** (the owner's ruling of 2026-11-03 on #2035,
carrying spike 0034's proposal). Today one token is both a primary button's fill and text on all four
surfaces, which is what forced the old teal to be a pastel. With direction A's values the two are
equal in each theme (`#aff13c` dark, `#405e00` light), so the split moves no pixel. **Author's
reading:** the split is therefore its own follow-up rather than part of #2037's value swap, so that the
pull request that changes every colour does not also rename every accent rule.

### D-2 — Dark first; ride and HUD screens are dark

- **Dark stays the default** (#992), and light stays available and gated: every pair passes in both
  palettes, and the shell's first frame matches the palette the page starts in (#672).
- **Ride and HUD screens are dark whatever the page theme** (ruling 3). `theme.css` §`.oyl-hud` stops
  restating the page tokens at their light values; a ride route is dark even when the rider chose
  light for the menus. This supersedes the light pin from the review of #744.
- **The HUD takes the dark zone colours** (D-4's dark row) whatever the page theme, because a light
  page's ochre "yellow" on a near-black HUD panel is the wrong colour on the wrong surface.
- The HUD's panels stay **opaque** (`hudSurface`, #94, #423); that is what makes its contrast
  checkable at all.

### D-3 — Surfaces: elevation is a colour step, with a floor

- Elevation stays a **surface colour step**, never a shadow: a `box-shadow` is invisible to every gate
  here ([#307](https://github.com/openzigs/onyourleft/issues/307)).
- **The floor between adjacent levels is 1.15:1**, in both palettes, for every pair of neighbours on
  `ELEVATION_SURFACES` (canvas, surface, raised, overlay). **`MAXIMUM_ELEVATION_STEP` rises from 1.2
  to 1.3**, because direction A steps about 1.24 in dark. Measured for A: dark 1.25 / 1.24 / 1.24,
  light 1.17 / 1.17 / 1.17, and a raised card on the canvas 1.54 dark and 1.36 light. #2038 gates the
  floor inside the a11y gate, reading the levels from `tokens.ts`.
- **No card outline.** Direction A's cards have no edge and lift by the surface step alone. A control's
  edge stays `border`, which is also what survives `forced-colors`. **Author's reading:** #2036's draft
  named "an outline token" for this decision; the owner then chose the direction whose cards have none,
  so no token is added. One added later needs its own declared pair.

### D-4 — Zones: grey, blue, green, yellow, orange, red, purple, always numbered and named

| Zone | Name | Dark | Light |
|---|---|---|---|
| 1 | Recovery | `#949aa1` | `#6c7278` |
| 2 | Endurance | `#2d74ca` | `#00468c` |
| 3 | Tempo | `#5fc372` | `#007d30` |
| 4 | Threshold | `#f9df5d` | `#968200` |
| 5 | VO₂ | `#f59441` | `#8f4c00` |
| 6 | Anaerobic | `#cb574d` | `#820b0f` |
| 7 | Sprint | `#cf91f3` | `#7e439f` |

- **The order is a shared functional convention**, grey to red with purple above for the seventh
  power zone; the hues are this project's own (D-9). Heart-rate zones (five) reuse zones 1 to 5 by
  position.
- **A zone is never told by colour alone** (WCAG 2.2 SC 1.4.1): wherever a zone colour is painted,
  the zone's number and name are in the DOM beside it, or in the existing table fallback.
- Each zone colour declares its pair against every surface it is drawn on, at 3:1 (SC 1.4.11).
- **Neighbours are told apart by lightness, under simulated colour-vision deficiency.** The floor is
  **1.20:1** (WCAG luminance ratio between adjacent zones) under normal vision and under simulated
  deuteranopia, protanopia and tritanopia (Machado, Oliveira and Fernandes, 2009, severity 1.0, in
  linear sRGB). The smallest measured step for A is 1.22, light, Tempo to Threshold, under protanopia.
- **The ramp is not monotone in lightness, on purpose.** In this hue order a monotone ramp makes the
  dark theme's yellow brown or the light theme's purple pale pink, so the lightness zig-zags and the
  floor above holds neighbours apart instead. `BAND_DIRECTION`'s monotone test is replaced by the
  floor in #2039. In light, "yellow" is a dark ochre, because zone 4 must reach 3:1 on a light surface;
  it is still labelled "4 Threshold" everywhere.

### D-5 — Type: Barlow kept, 600 added, tabular numerals

- **Barlow stays** (ADR 0043), and **one weight is added, 600**, through the existing
  `fonts:subset` pipeline (ADR 0043 D-5), from the same pinned upstream commit, same origin only
  (ADR 0043 D-4). This extends ADR 0043 D-6's *"at 700 and 800"*; a dated entry is appended to ADR
  0043's `## Amendments` section (ADR 0013).
- **The ratio stays 1.25** (`TYPE_SCALE_RATIO`). Headings 1 and 2 at 800 and 700; heading 3 and
  labels at 600; body text stays `system-ui` at 400.
- **Every metric numeral is Barlow with `font-variant-numeric: tabular-nums`**, so digits do not
  jitter as a number changes: a Home figure at 1.953rem, a HUD secondary numeral at **2.45rem or
  more**, and the HUD primary numeral at 3.815rem, all at 700.
- **The legibility floor**: 16 arc-minutes at a 1 m mount is 4.65 mm of cap height. Barlow's cap is
  0.700 em. On a 10.1-inch 1280×800 tablet one CSS px is taken as 0.1700 mm — an **assumption**, since
  the owner's tablet was not measured — so **a primary ride numeral's rendered cap height is at least
  27.4 CSS px at 1280×800**. 3.815rem gives 42.7 px (7.26 mm). The HUD secondary numeral's 2.45rem
  gives 4.66 mm; the old `display` step, 2.441rem, misses by 0.008 mm, which is why the floor is
  2.45rem.

### D-6 — No new runtime UI dependency; the splash is the one native plugin

- **Transitions**: React 19.3's `<ViewTransition>` and **Motion 14.3.0** under ADR 0041 (menu
  routes only, lazily loaded, never in the entry chunk, never on a ride or game route).
- **Charts and gauges stay hand-rolled SVG.** uPlot 1.6.32 is rejected: canvas is opaque to a screen
  reader, and ADR 0034 D-5 would require an ADR and a lazy chunk.
- **Audio stays Web Audio** in `apps/web/src/game/web-audio.ts`. howler.js 2.2.4 is rejected: it adds
  nothing the repository lacks.
- **`@formkit/auto-animate` is rejected**: Motion already covers a list's enter and leave.
- **The splash is `@capacitor/splash-screen` 8.0.2** (ruling 5), a native plugin in `apps/mobile`,
  admitted through the gates every dependency passes: licence and notices, the 24-hour release age,
  `native-closure.json`. It holds the Android splash until first paint and is not a runtime UI
  dependency of `apps/web`.

### D-7 — Motion: the 200 ms cap stays, and the intro fits inside it

Nothing runs longer than `MOTION_DURATION_MS.medium`, 200 ms (ADR 0041 D-5, epic #935 principle 4),
the launch intro included (ruling 4). Reduced motion and `update: slow` collapse it as they collapse
every transition. A longer intro is an amendment to ADR 0041, not an exception written at a call site.

### D-8 — Music: on by default in menus, after the first tap, never on a ride route

Ruling 2. Music plays by default on menu routes, starting only after the rider's first tap (browser
autoplay rules, and WCAG 2.2 SC 1.4.2), with a visible mute, and never on a ride or game route.
**This changes #935's principle 5 for music only**: sound effects and the ride's own cues (#400) keep
their defaults, off until the rider turns them on.

### D-9 — How a reviewer checks a visual change against ADR 0009 L1

A visual pull request in the redesign epics:

1. **States where every new colour came from**, as D-1 does for the accent, and none is another
   product's identity colour. The identity colours looked up only to be avoided are recorded in spike
   0034 (Strava's oranges `#FC5200` and `#CC4200`, Rouvy's yellow `#FCCD00`, and the oranges, reds and
   blues of other trainer and cycling apps).
2. **Copies no other product's screen layout, colour palette and icon set as a set.** Concepts are
   free — a dark background, large tabular numerals, a bottom bar and a side rail, the grey-to-red
   zone order — and each is named as the convention it is.
3. **Was not built with another product's screenshot open beside the editor**, and says so.
4. **Carries owner-approved before/after screenshots** (tablet 1280×800 landscape and phone 412×915,
   dark and light) before merge.
5. Passes L1's grep for product names, which this ADR does not change.

## Consequences

### What this enables

- Eleven build issues paint with one recorded palette, ramp and type scale, and a reviewer has one page
  to check each against.
- Cards read as cards: the 1.15 floor is gated, so a later palette cannot collapse the levels again.
- Zones are readable by riders with a colour-vision deficiency, by lightness and by label.

### What this costs, stated plainly

- **The two themes look like two brands in their accent.** Lime cannot carry text on white, so light
  uses an olive; the lime survives only as `selected`. That is spike 0034's named risk for A, and the
  owner chose it knowing so.
- **A zone ramp that is not monotone** loses the greyscale reading the old ramp had; the labels carry
  it instead.
- **Every screen changes at once**, so the screenshot review is the real gate on taste; the a11y gate
  checks contrast, not beauty.
- **One more font file** (about 13 to 14 KB of WOFF2) and **one more native plugin** for the splash.

### What would make this ADR wrong

- A gate (`contrast.a11y.test.ts`, the surface floor, the zone floor) that cannot pass with the values
  recorded here. The remedy is a dated amendment to the value, never a lowered minimum.
- The owner's tablet measuring well off 0.1700 mm per CSS px: D-5's 27.4 px floor scales with it.
- An accent that turns out to be another product's identity colour: D-9 then fails and D-1 changes.
