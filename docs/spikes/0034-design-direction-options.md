# Spike 0034: Design direction — three original palette, type and Home options for the owner to choose

- **Date**: 2026-11-03
- **Issue**: [#2035](https://github.com/openzigs/onyourleft/issues/2035), under the design-system epic
  [#2030](https://github.com/openzigs/onyourleft/issues/2030) and [#429](https://github.com/openzigs/onyourleft/issues/429).
  Every build issue in the redesign epics #2030–#2034, and ADR 0063 ([#2036](https://github.com/openzigs/onyourleft/issues/2036)),
  waits for the owner's choice among these options.
- **Number**: **0034.** `docs/spikes/` holds up to 0033 on `origin/main`; 0021 is claimed by
  [#1057](https://github.com/openzigs/onyourleft/issues/1057) and 0032 by the open pull request
  [#1989](https://github.com/openzigs/onyourleft/pull/1989). This file takes 0034 so that none collides (`SPIKE001`).

A spike is a dated measurement that decides nothing (`docs/agents/conventions.md` §7). **The owner chooses**, on
#2035, in a dated comment; ADR 0063 cites that comment, not this file. No product code changes here.

## Rules this spike holds

- **Original** (ADR 0009 L1). No option was drawn with another product's screenshot open. No accent is another
  product's identity colour: identity colours were looked up only to be avoided (Strava's orange `#FC5200` and
  `#CC4200`; Rouvy's yellow `#FCCD00`; the oranges, reds and blues of other trainer and cycling apps), and each
  option states where its accent came from. Common conventions only: a dark background, large tabular numerals,
  a bottom bar on a phone, and the grey-to-red zone order the owner ruled on.
- **Dark first**, light kept and gated (#992, #672). The HUD is dark in all three (owner ruling 3 on #2030).
- **Synthetic data only.** Every number on every screen is made up; no ride, route or place of the owner's.
- **The prototype is never merged.** It lives on the branch `spike/issue-2035-design-prototype`
  (`apps/web/browser/design-2035/`). It renders each option through the shipping `src/design/theme.css`
  by overriding every `--oyl-color-*` custom property, plus `--oyl-radius` and `--oyl-radius-card`, and uses
  the real `design/Button.tsx`. So what the screenshots show is what those token values produce. The
  palettes come from `gen.ts` on that branch, and its contrast numbers come from `src/design/contrast.ts`
  itself. Screenshots of the app stay out of git; they go to the owner through the orchestrating session.

## Method

1. **The pairs.** `CONTRAST_REQUIREMENTS` was read from `tokens.ts` on `origin/main` at `aff787f3` by a
   throwaway Vitest file: 107 entries, 99 distinct foreground/background/minimum triples. Every triple is
   checked in both themes for every option. The HUD tokens are theme-independent, as they are today.
2. **The palettes.** Each colour is a hue and chroma in OKLCH with its WCAG relative luminance solved by
   bisection to a target ratio against the hardest background it is declared on (usually `surfaceOverlay`),
   plus a margin of about 5 % for hex rounding. So the numbers are designed, not found afterwards.
3. **Surface levels.** Each level is one fixed luminance ratio above (dark) or below (light) the last, which
   keeps `ELEVATION_DIRECTION` as it is.
4. **Zones.** Grey, blue, green, yellow, orange, red, purple. Lightness zig-zags so that neighbours differ.
   Colour-vision deficiency is simulated with the Machado, Oliveira and Fernandes (2009) matrices at
   severity 1.0, in linear sRGB. "Distinguishable by lightness" is measured as the WCAG luminance ratio
   between neighbouring zones after simulation.
5. **Type.** Barlow's cap height (`sCapHeight` 700 of 1000 units; digits 700–708) was read with fontTools
   from the Barlow 1.408 TTFs. 16 arc-minutes at 1 m is 4.65 mm. One CSS px is taken as 0.1700 mm, which
   is a 10.1-inch 1280×800 tablet. That size is an **assumption**: the owner's tablet was not measured.
6. **Screens.** `shoot.mjs` drives the pinned Chromium through Playwright at 1280×800 and 412×915, dark
   and light: Home, the ride HUD (1280×800, dark) and a spec board per option. That is 21 PNGs.

## Findings that hold whichever option is chosen

- **Today's surfaces are flat because every adjacent step is about 1.1:1** (dark 1.09 / 1.13 / 1.15; light
  1.10 / 1.10 / 1.10), measured on `main`. All three options use 1.16–1.28.
  **Proposed floor for #2038: 1.15:1 between each pair of adjacent levels, in both palettes**, with
  `MAXIMUM_ELEVATION_STEP` raised from 1.2 to 1.3, because options A and B step 1.24–1.28 in dark.
  Measured: A 1.25 / 1.24 / 1.24 dark and 1.17 / 1.17 / 1.17 light; B 1.26 / 1.27 / 1.28 dark and
  1.16 / 1.16 / 1.16 light; C 1.20 / 1.19 / 1.19 dark and 1.17 / 1.17 / 1.17 light.
- **A zone ramp in the ruled hue order cannot be monotone in lightness** without yellow going brown in dark, or
  purple going pale pink. Today's `BAND_DIRECTION` test asks for a monotone ramp. **For #2039 the proposal is a
  floor on adjacent zones instead: 1.20:1 luminance ratio under normal vision and under each of the three
  simulations.** Every option clears it; the smallest step anywhere is 1.22:1, which is Tempo to Threshold in
  light under protanopia.
- **In light, "yellow" is a dark ochre** (`#968200`/`#978200`), because zone 4 must reach 3:1 on a light
  `surface`. Every option shares this. It is still labelled "4 Threshold" everywhere.
- **The HUD needs dark zone colours whatever the page theme.** Bands are page tokens. A HUD panel drawn on a
  light page shows the light-theme ochre on a near-black panel (see each option's board). #2042, which makes
  the HUD dark, should give the HUD the dark ramp, or HUD-scoped zone tokens.
- **The accent token does two jobs, and in dark that forces a light accent.** `accent` is the fill of a primary
  button *and* text on all four surfaces (secondary-button labels, links, navigation). In dark, it must therefore
  clear 4.5:1 against `surfaceOverlay`, so a hue that is dark when saturated, such as violet or blue, can only
  be a pastel. Lime, the one bright hue that stays saturated at high luminance, is the exception. That is why
  the teal was pastel. If the owner wants a *saturated* violet or blue button with white text, ADR 0063 has to
  split the token into a fill and a text colour. That is a structural change, and none of these options assumes it.
- **The 16 arc-minute rule.** A primary ride numeral clears it in every option, at 1.56× to 2.29× the
  4.65 mm floor. Option A's secondary HUD numeral, at the existing `display` step of 2.441rem, has a cap of
  4.647 mm and **misses by 0.008 mm**. If A is chosen, its secondary numerals should be at least 2.45rem.

## The three options at a glance

| | A: Hi-Vis | B: Blue Hour | C: Monochrome + Zones |
|---|---|---|---|
| Neutrals | graphite, hue-free | blue-black, tinted toward indigo | true black canvas, warm greys |
| Accent (dark / light) | fluorescent lime `#aff13c` / deep olive `#405e00` | periwinkle `#bab8ff` / indigo `#5031ba` | white `#f6f6f6` / near-black `#111111` |
| Accent source | high-visibility cycling clothing (fluorescent yellow-green, EN ISO 20471), pushed toward green so it is lime, not yellow | the sky in the half hour after sunset, pushed toward violet so it is no product's blue | none: the ink is the accent, so the zones and status tones are the only colour |
| Corners (control / card) | 4 / 6 px | 12 / 20 px | 8 / 8 px, 1 px hairline card edge |
| Dark surface step | 1.24 | 1.27 | 1.20 |
| Type ratio | 1.25 (today's ladder) | 1.2 | 1.333 |
| Barlow weight added | 600 | 500 | 600 |
| HUD primary numeral | 3.815rem, 700: cap 7.26 mm | 4.3rem, 500: cap 8.19 mm | 5.61rem, 800: cap 10.68 mm |
| Character | energetic, high signal; lime is unmistakable on the ride | calmer, softer and rounder, with lighter numerals | the starkest; data first, and zones are the brightest thing on screen |
| Main risk | light theme cannot keep the lime (it becomes olive), so the two themes look like two brands | a pastel primary button, which is the complaint about the teal | can read as generic, which the owner already said of today's look |

Each option is a set: palette, type, corners and elevation. "A's palette with C's type" is a valid answer.


### Option A: Hi-Vis

Graphite neutrals with no hue, and one fluorescent lime for the primary action, the focus ring, the current
navigation item, the profile line and the week's bars. Cards have no edge and lift by surface step alone. The
corners are tight. HUD field labels are in capitals, which `label-case.test.ts` allows on the HUD and nowhere
else. **Accent source:** the fluorescent yellow-green of high-visibility cycling clothing (the background-material
class of EN ISO 20471, a public safety standard, not a brand), pushed toward green in sRGB so that it reads as lime
and not as Rouvy's yellow (`#FCCD00`, about 45° of hue away). In light the lime cannot carry text on white, so
`accent` becomes a deep olive and the lime survives only as `selected`.

#### 1. Palette, both themes

| Group | Token | Dark | Light |
|---|---|---|---|
| Canvas and the surface levels 1–3 | `canvas` | `#101215` | `#ffffff` |
| Canvas and the surface levels 1–3 | `surface` | `#242729` | `#ebeef0` |
| Canvas and the surface levels 1–3 | `surfaceRaised` | `#333639` | `#dbdde0` |
| Canvas and the surface levels 1–3 | `surfaceOverlay` | `#414447` | `#cbcdd0` |
| Ink, muted ink, border | `ink` | `#edeef1` | `#131415` |
| Ink, muted ink, border | `inkMuted` | `#b3b7ba` | `#515355` |
| Ink, muted ink, border | `border` | `#93969a` | `#6a6c6e` |
| Accent, hover, ink on the accent, selected | `accent` | `#aff13c` | `#405e00` |
| Accent, hover, ink on the accent, selected | `accentHover` | `#c7fd7b` | `#2c4300` |
| Accent, hover, ink on the accent, selected | `accentInk` | `#121809` | `#ffffff` |
| Accent, hover, ink on the accent, selected | `selected` | `#304216` | `#cdf39c` |
| Focus ring | `focus` | `#aff13c` | `#131415` |
| Links | `link` | `#aade5b` | `#3d5b00` |
| Links | `linkVisited` | `#c5acf2` | `#5e3a91` |
| Links | `linkHover` | `#cdf39c` | `#2c4300` |
| Links | `linkActive` | `#e6fad0` | `#1b2b00` |
| Info | `infoSurface` | `#142b3d` | `#dceeff` |
| Info | `infoInk` | `#93cbfc` | `#004876` |
| Info | `infoBorder` | `#1e72ac` | `#328bcd` |
| Success | `successSurface` | `#162e1b` | `#dbf2df` |
| Success | `successInk` | `#99d3a4` | `#005122` |
| Success | `successBorder` | `#287b42` | `#3b9655` |
| Warning | `warningSurface` | `#35260d` | `#f9ebd3` |
| Warning | `warningInk` | `#e5c182` | `#5d4000` |
| Warning | `warningBorder` | `#906500` | `#ae7c00` |
| Danger | `dangerSurface` | `#3e211e` | `#ffe7e4` |
| Danger | `dangerInk` | `#ffb2ac` | `#792b29` |
| Danger | `dangerBorder` | `#ac514c` | `#cc6660` |
| Danger | `dangerAction` | `#fb8981` | `#a21a21` |
| Danger | `dangerActionInk` | `#321312` | `#ffffff` |
| Illustration | `illoSky` | `#102239` | `#c6d9f2` |
| Illustration | `illoSun` | `#897626` | `#e0c24b` |
| Illustration | `illoHillFar` | `#263a22` | `#adcca7` |
| Illustration | `illoHillNear` | `#304f2a` | `#8fb686` |
| Illustration | `illoRoad` | `#53595e` | `#91969c` |
| HUD (one value in both themes) | `hudSurface` | `#101215` | `#101215` |
| HUD (one value in both themes) | `hudInk` | `#f4f7f9` | `#f4f7f9` |
| HUD (one value in both themes) | `hudInkMuted` | `#9da3a8` | `#9da3a8` |
| HUD (one value in both themes) | `hudBorder` | `#787c82` | `#787c82` |
| HUD (one value in both themes) | `hudStaleInk` | `#f1af48` | `#f1af48` |

Zone colours are in item 3.

#### 2. Contrast

Every pair `CONTRAST_REQUIREMENTS` declares on `main` (99 distinct foreground/background/minimum triples; the 107 entries repeat 8), computed with `apps/web/src/design/contrast.ts` itself. A pair under its minimum would read **FAIL**; none does.

- All 99 pass in both themes: **yes**. Tightest dark: `bandEndurance` on `surface` 3.19:1 (min 3); tightest light: `accent` on `surfaceOverlay` 4.68:1 (min 4.5).
- Primary metric numerals, AAA target 7:1:

| Numeral | Pair | Dark | Light |
|---|---|---|---|
| a primary metric numeral on a metric card | `ink` on `surfaceRaised` | 10.48 | 13.55 |
| a primary metric numeral on a panel | `ink` on `surface` | 12.95 | 15.83 |
| a primary metric numeral on a HUD panel | `hudInk` on `hudSurface` | 17.44 | 17.44 |

- Adjacent surface levels (today on `main`: dark 1.09 / 1.13 / 1.15, light 1.10 / 1.10 / 1.10; raised on canvas 1.23 dark):

| Step | Dark | Light |
|---|---|---|
| `canvas` to `surface` | 1.25 | 1.17 |
| `surface` to `surfaceRaised` | 1.24 | 1.17 |
| `surfaceRaised` to `surfaceOverlay` | 1.24 | 1.17 |
| `canvas` to `surfaceRaised` (a card on the page) | 1.54 | 1.36 |

<details><summary>All 99 declared pairs</summary>

| Foreground | Background | Where (first declaration) | Min | Dark | Light |
|---|---|---|---|---|---|
| `ink` | `canvas` | body text on the page | 4.5 | 16.17 | 18.44 |
| `ink` | `surface` | body text on a panel | 4.5 | 12.95 | 15.83 |
| `inkMuted` | `canvas` | helper and empty-state text on the page | 4.5 | 9.29 | 7.73 |
| `inkMuted` | `surface` | helper and empty-state text on a panel | 4.5 | 7.44 | 6.63 |
| `border` | `canvas` | the edge of a control on the page (WCAG 2.2 SC 1.4.11) | 3 | 6.32 | 5.27 |
| `border` | `surface` | the edge of a control on a panel (WCAG 2.2 SC 1.4.11) | 3 | 5.06 | 4.52 |
| `accentInk` | `accent` | the label of a primary button | 4.5 | 13.33 | 7.45 |
| `accentInk` | `accentHover` | the label of a primary button under a pointer | 4.5 | 15.31 | 11.00 |
| `accent` | `canvas` | the label of a secondary button, an off toggle and an unchecked segment (#668) | 4.5 | 13.82 | 7.45 |
| `accent` | `canvas` | the border of a secondary button, a toggle and a segment, on the page (#668) | 3 | 13.82 | 7.45 |
| `accentHover` | `surface` | a secondary button, an off toggle or a segment under a pointer or a press (#688) | 4.5 | 12.71 | 9.44 |
| `accentHover` | `canvas` | the border of a button under a pointer, on the page (#668, #688) | 3 | 15.87 | 11.00 |
| `accentHover` | `canvas` | the label of a tertiary (text) button under a pointer or a press, on the page (#992) | 4.5 | 15.87 | 11.00 |
| `accentHover` | `selected` | the label of an on toggle and of the checked segment (#668) | 4.5 | 9.27 | 8.85 |
| `accent` | `selected` | the doubled border of an on toggle and a checked segment, and the checked radio, on the `selected` fill (SC 1.4.1, 1.4.11, #668) | 3 | 8.07 | 5.99 |
| `accentHover` | `selected` | the doubled border of an on toggle under a pointer (#668) | 3 | 9.27 | 8.85 |
| `focus` | `selected` | the focus ring on a checked segment's radio, landing on the segment's fill (#668) | 3 | 8.07 | 14.84 |
| `hudInk` | `hudSurface` | a metric on the ride HUD, over its own opaque panel (#94) | 4.5 | 17.44 | 17.44 |
| `hudInkMuted` | `hudSurface` | a field label on the ride HUD (#94) | 4.5 | 7.36 | 7.36 |
| `hudBorder` | `hudSurface` | the edge of a HUD control (WCAG 2.2 SC 1.4.11) | 3 | 4.47 | 4.47 |
| `hudInk` | `hudSurface` | the focus ring of every HUD control, the mute, the volume and the side camera’s Stop among them, offset onto its panel (WCAG 2.2 SC 2.4.13, #748) | 3 | 17.44 | 17.44 |
| `hudStaleInk` | `hudSurface` | the mark on a HUD reading whose sensor has dropped (#94) | 4.5 | 9.80 | 9.80 |
| `accent` | `surface` | link text and the active navigation item in the header | 4.5 | 11.07 | 6.39 |
| `focus` | `canvas` | the focus ring, offset onto the page (WCAG 2.2 SC 2.4.13) | 3 | 13.82 | 18.44 |
| `focus` | `surface` | the focus ring, offset onto a panel (WCAG 2.2 SC 2.4.13) | 3 | 11.07 | 15.83 |
| `ink` | `surfaceRaised` | body text on a card resting on a panel | 4.5 | 10.48 | 13.55 |
| `inkMuted` | `surfaceRaised` | a label on a card resting on a panel | 4.5 | 6.02 | 5.68 |
| `border` | `surfaceRaised` | the edge of a control on a raised card (WCAG 2.2 SC 1.4.11) | 3 | 4.09 | 3.87 |
| `accent` | `surfaceRaised` | link text on a raised card | 4.5 | 8.96 | 5.47 |
| `focus` | `surfaceRaised` | the focus ring, offset onto a raised card (WCAG 2.2 SC 2.4.13) | 3 | 8.96 | 13.55 |
| `ink` | `surfaceOverlay` | the wordmark and the navigation, on the app header | 4.5 | 8.45 | 11.58 |
| `inkMuted` | `surfaceOverlay` | secondary text on the app header | 4.5 | 4.85 | 4.85 |
| `border` | `surfaceOverlay` | the header's own bottom rule (WCAG 2.2 SC 1.4.11) | 3 | 3.30 | 3.31 |
| `accent` | `surfaceOverlay` | a navigation link on the app header | 4.5 | 7.22 | 4.68 |
| `accent` | `surfaceOverlay` | the navigation's active indicator, against the bar and the rail (SC 1.4.11, #944) | 3 | 7.22 | 4.68 |
| `focus` | `surfaceOverlay` | the focus ring, offset onto the app header (WCAG 2.2 SC 2.4.13) | 3 | 7.22 | 11.58 |
| `infoInk` | `infoSurface` | an info message | 4.5 | 8.45 | 8.10 |
| `infoBorder` | `canvas` | the edge of an info message | 3 | 3.63 | 3.68 |
| `successInk` | `successSurface` | a success message | 4.5 | 8.47 | 8.08 |
| `successBorder` | `canvas` | the edge of a success message | 3 | 3.58 | 3.70 |
| `warningInk` | `warningSurface` | a warning message — the Chrome-on-Linux path | 4.5 | 8.56 | 8.12 |
| `warningBorder` | `canvas` | the edge of a warning message | 3 | 3.62 | 3.70 |
| `dangerInk` | `dangerSurface` | an error message — the Safari and Firefox path | 4.5 | 8.48 | 8.13 |
| `dangerBorder` | `canvas` | the edge of an error message | 3 | 3.61 | 3.73 |
| `dangerAction` | `dangerSurface` | the label of a danger button at rest (#1002) | 4.5 | 6.24 | 6.58 |
| `dangerAction` | `canvas` | the edge of a danger button, at rest and under a pointer, on the dialog (#1002) | 3 | 8.04 | 7.76 |
| `dangerActionInk` | `dangerAction` | the label of a danger button under a pointer or a press (#1002) | 4.5 | 7.27 | 7.76 |
| `focus` | `infoSurface` | the focus ring round a link in an info message (WCAG 2.2 SC 2.4.13) | 3 | 10.72 | 15.56 |
| `focus` | `successSurface` | the focus ring round a link in a success message (WCAG 2.2 SC 2.4.13) | 3 | 10.74 | 15.61 |
| `focus` | `warningSurface` | the focus ring round a link in a warning message (WCAG 2.2 SC 2.4.13) | 3 | 10.78 | 15.68 |
| `focus` | `dangerSurface` | the focus ring round a link in an error message (WCAG 2.2 SC 2.4.13) | 3 | 10.73 | 15.64 |
| `link` | `canvas` | link text on canvas | 4.5 | 11.89 | 7.79 |
| `link` | `surface` | link text on surface | 4.5 | 9.53 | 6.69 |
| `link` | `surfaceRaised` | link text on surfaceRaised | 4.5 | 7.70 | 5.73 |
| `link` | `surfaceOverlay` | link text on surfaceOverlay | 4.5 | 6.21 | 4.89 |
| `link` | `infoSurface` | link text on infoSurface | 4.5 | 9.23 | 6.57 |
| `link` | `successSurface` | link text on successSurface | 4.5 | 9.24 | 6.60 |
| `link` | `warningSurface` | link text on warningSurface | 4.5 | 9.28 | 6.62 |
| `link` | `dangerSurface` | link text on dangerSurface | 4.5 | 9.24 | 6.61 |
| `linkVisited` | `canvas` | a visited link on canvas | 4.5 | 9.43 | 8.43 |
| `linkVisited` | `surface` | a visited link on surface | 4.5 | 7.56 | 7.24 |
| `linkVisited` | `surfaceRaised` | a visited link on surfaceRaised | 4.5 | 6.11 | 6.20 |
| `linkVisited` | `surfaceOverlay` | a visited link on surfaceOverlay | 4.5 | 4.93 | 5.29 |
| `linkVisited` | `infoSurface` | a visited link on infoSurface | 4.5 | 7.32 | 7.12 |
| `linkVisited` | `successSurface` | a visited link on successSurface | 4.5 | 7.33 | 7.14 |
| `linkVisited` | `warningSurface` | a visited link on warningSurface | 4.5 | 7.36 | 7.17 |
| `linkVisited` | `dangerSurface` | a visited link on dangerSurface | 4.5 | 7.33 | 7.15 |
| `linkHover` | `canvas` | a link under a pointer or focused from the keyboard on canvas | 4.5 | 15.09 | 11.00 |
| `linkHover` | `surface` | a link under a pointer or focused from the keyboard on surface | 4.5 | 12.09 | 9.44 |
| `linkHover` | `surfaceRaised` | a link under a pointer or focused from the keyboard on surfaceRaised | 4.5 | 9.78 | 8.08 |
| `linkHover` | `surfaceOverlay` | a link under a pointer or focused from the keyboard on surfaceOverlay | 4.5 | 7.89 | 6.90 |
| `linkHover` | `infoSurface` | a link under a pointer or focused from the keyboard on infoSurface | 4.5 | 11.71 | 9.28 |
| `linkHover` | `successSurface` | a link under a pointer or focused from the keyboard on successSurface | 4.5 | 11.73 | 9.31 |
| `linkHover` | `warningSurface` | a link under a pointer or focused from the keyboard on warningSurface | 4.5 | 11.78 | 9.35 |
| `linkHover` | `dangerSurface` | a link under a pointer or focused from the keyboard on dangerSurface | 4.5 | 11.72 | 9.32 |
| `linkActive` | `canvas` | a link being pressed on canvas | 4.5 | 16.93 | 15.08 |
| `linkActive` | `surface` | a link being pressed on surface | 4.5 | 13.56 | 12.94 |
| `linkActive` | `surfaceRaised` | a link being pressed on surfaceRaised | 4.5 | 10.97 | 11.08 |
| `linkActive` | `surfaceOverlay` | a link being pressed on surfaceOverlay | 4.5 | 8.84 | 9.47 |
| `linkActive` | `infoSurface` | a link being pressed on infoSurface | 4.5 | 13.14 | 12.73 |
| `linkActive` | `successSurface` | a link being pressed on successSurface | 4.5 | 13.15 | 12.77 |
| `linkActive` | `warningSurface` | a link being pressed on warningSurface | 4.5 | 13.21 | 12.82 |
| `linkActive` | `dangerSurface` | a link being pressed on dangerSurface | 4.5 | 13.15 | 12.79 |
| `ink` | `illoSky` | a hero title drawn on the sky of a menu illustration | 4.5 | 13.82 | 12.83 |
| `inkMuted` | `illoSky` | the line under a hero title, on the sky | 4.5 | 7.94 | 5.37 |
| `ink` | `illoHillFar` | a card title where it overlaps the far hills | 4.5 | 10.58 | 10.51 |
| `accent` | `illoHillNear` | the edge of a primary button standing on the near hill (WCAG 2.2 SC 1.4.11) | 3 | 6.79 | 3.26 |
| `focus` | `illoSky` | the focus ring of a control over art, where it lands on illoSky (WCAG 2.2 SC 2.4.13) | 3 | 11.81 | 12.83 |
| `focus` | `illoSun` | the focus ring of a control over art, where it lands on illoSun (WCAG 2.2 SC 2.4.13) | 3 | 3.30 | 10.53 |
| `focus` | `illoHillFar` | the focus ring of a control over art, where it lands on illoHillFar (WCAG 2.2 SC 2.4.13) | 3 | 9.04 | 10.51 |
| `focus` | `illoHillNear` | the focus ring of a control over art, where it lands on illoHillNear (WCAG 2.2 SC 2.4.13) | 3 | 6.79 | 8.08 |
| `focus` | `illoRoad` | the focus ring of a control over art, where it lands on illoRoad (WCAG 2.2 SC 2.4.13) | 3 | 5.23 | 6.19 |
| `bandRecovery` | `surface` | a bandRecovery block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 5.29 | 4.18 |
| `bandEndurance` | `surface` | a bandEndurance block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 3.19 | 7.99 |
| `bandTempo` | `surface` | a bandTempo block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.82 | 4.53 |
| `bandThreshold` | `surface` | a bandThreshold block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 11.27 | 3.28 |
| `bandVo2` | `surface` | a bandVo2 block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.58 | 5.63 |
| `bandAnaerobic` | `surface` | a bandAnaerobic block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 3.59 | 8.99 |
| `bandSprint` | `surface` | a bandSprint block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.44 | 5.65 |

</details>

#### 3. Zone ramp, with simulated colour-vision deficiency

Grey, blue, green, yellow, orange, red, purple (owner rulings of 2026-11-03). Lightness zig-zags on purpose: a ramp in this hue order cannot also be monotone in lightness without yellow turning brown, so the neighbours differ in lightness instead. Simulation: Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear sRGB. Each cell is the colour and, from zone 2, its luminance ratio to the zone before it. "On surface" is the declared band pair (min 3:1, normal vision).

**Dark**

| Vision | 1 Recovery | 2 Endurance | 3 Tempo | 4 Threshold | 5 VO₂ | 6 Anaerobic | 7 Sprint | Smallest step |
|---|---|---|---|---|---|---|---|---|
| normal | `#949aa1` | `#2d74ca` 1.66 | `#5fc372` 2.14 | `#f9df5d` 1.65 | `#f59441` 1.71 | `#cb574d` 1.84 | `#cf91f3` 1.80 | 1.65 |
| deuteranopia | `#9699a1` | `#2c6dc8` 1.78 | `#b7ab77` 2.21 | `#fae364` 1.78 | `#c8b441` 1.61 | `#91854a` 1.78 | `#8eabf0` 1.63 | 1.61 |
| protanopia | `#989aa1` | `#497bcd` 1.49 | `#c5b46c` 2.02 | `#f3da4e` 1.48 | `#b19e37` 1.91 | `#746c4b` 1.96 | `#7ea6f7` 2.18 | 1.48 |
| tritanopia | `#919c9c` | `#008895` 1.50 | `#4cbfaf` 1.89 | `#ffd0c3` 1.61 | `#ff7f83` 1.75 | `#de4155` 1.73 | `#cc9fb7` 1.84 | 1.50 |
| on surface | 5.29 | 3.19 | 6.82 | 11.27 | 6.58 | 3.59 | 6.44 | |

**Light**

| Vision | 1 Recovery | 2 Endurance | 3 Tempo | 4 Threshold | 5 VO₂ | 6 Anaerobic | 7 Sprint | Smallest step |
|---|---|---|---|---|---|---|---|---|
| normal | `#6c7278` | `#00468c` 1.91 | `#007d30` 1.76 | `#968200` 1.38 | `#8f4c00` 1.71 | `#820b0f` 1.60 | `#7e439f` 1.59 | 1.38 |
| deuteranopia | `#6e7178` | `#00418b` 2.02 | `#726836` 1.76 | `#968512` 1.51 | `#706300` 1.63 | `#524807` 1.52 | `#3c5e9d` 1.43 | 1.43 |
| protanopia | `#707278` | `#1b4d8f` 1.74 | `#7e7128` 1.71 | `#917f00` 1.22 | `#605400` 1.89 | `#362f0d` 1.76 | `#265aa2` 1.95 | 1.22 |
| tritanopia | `#697374` | `#005762` 1.70 | `#007a6c` 1.58 | `#a3776e` 1.36 | `#9d3c40` 1.72 | `#90000f` 1.44 | `#7a536a` 1.49 | 1.36 |
| on surface | 4.18 | 7.99 | 4.53 | 3.28 | 5.63 | 8.99 | 5.65 | |

Smallest adjacent step across both themes and all four visions: **1.22:1**. Tokens: `bandRecovery`, `bandEndurance`, `bandTempo`, `bandThreshold`, `bandVo2`, `bandAnaerobic`, `bandSprint`.

#### 4. Type scale

| Step | Size | px | Weight | Face |
|---|---|---|---|---|
| Display | 2.441rem | 39.06 | 800 | Barlow |
| Heading 1 | 1.953rem | 31.25 | 800 | Barlow |
| Heading 2 | 1.563rem | 25.01 | 700 | Barlow |
| Heading 3 | 1.25rem | 20.00 | 600 | Barlow (new 600) |
| Body | 1rem | 16.00 | 400 | system-ui |
| Label | 0.8rem | 12.80 | 600 | Barlow (new 600) |
| Home metric numeral | 1.953rem | 31.25 | 700 | Barlow, tabular-nums |
| HUD secondary numeral | 2.441rem | 39.06 | 700 | Barlow, tabular-nums |
| HUD primary numeral | 3.815rem | 61.04 | 700 | Barlow, tabular-nums |

Legibility at a 1 m mount: 16 arc-minutes is 4.65 mm. Barlow's cap height is 700/1000 em (OS/2 `sCapHeight`; digits 700–708), read with fontTools 4.61 from the Barlow 1.408 TTFs (Bold and ExtraBold as committed under `apps/web/tools/fonts/barlow/`; Medium and SemiBold from the same pinned upstream commit). On a 10.1-inch 1280×800 tablet one CSS px is 0.1700 mm (assumed; the owner's tablet was not measured). Primary ride numeral: 3.815rem → cap 42.7 px → **7.26 mm** (meets, 1.56×). Secondary HUD numeral: 2.441rem → **4.65 mm** (**misses by 0.008 mm**).

#### 5. Home wireframe

The modules of #2031: ride quick-launch, BLE sensor status (the trainer, power, heart rate and cadence, each
connected or not in words and a filled or hollow mark, never by colour alone), the last ride (numbers, elevation
profile, time in zone with every zone's number and name) and the week (a labelled SVG bar chart). There is no hero
picture. Tablet uses a 7/5 two-column grid, and the phone a single column with a bottom bar.

Screenshots (kept out of git): `A-home-tablet-dark.png`, `A-home-tablet-light.png`, `A-home-phone-dark.png`,
`A-home-phone-light.png`, and `A-home-phone-dark-full.png` (the whole phone page).

#### 6. Button, card and HUD panel

The primary, secondary, tertiary and danger buttons (the real `Button`), a card with metric tiles (level 1 with
level 2 inside it), and a HUD panel, in both themes: `A-board.png`. The whole ride HUD at 1280×800 in dark:
`A-hud-tablet-dark.png`.

### Option B: Blue Hour

Blue-black neutrals tinted toward indigo, with the largest surface steps of the three (1.27 in dark), so cards
plainly sit above the page. Corners are large and soft. Numerals are Barlow Medium (500, the added weight), which
is lighter and calmer on the ride. **Accent source:** the indigo of the sky in the half hour after sunset (the blue
hour of an evening ride), pushed toward violet (OKLCH hue 285) so that it is no product's blue. In dark it has to
be a light periwinkle to clear 4.5:1 as text on `surfaceOverlay` (see "The accent token does two jobs" in spike
0034), and in light it is a saturated indigo with white text. Zone 7's purple sits at hue 312, apart from the
accent, and is always labelled.

#### 1. Palette, both themes

| Group | Token | Dark | Light |
|---|---|---|---|
| Canvas and the surface levels 1–3 | `canvas` | `#101322` | `#f9fbff` |
| Canvas and the surface levels 1–3 | `surface` | `#242838` | `#e7eaf2` |
| Canvas and the surface levels 1–3 | `surfaceRaised` | `#343949` | `#d7dae2` |
| Canvas and the surface levels 1–3 | `surfaceOverlay` | `#43495a` | `#c8cbd3` |
| Ink, muted ink, border | `ink` | `#e8ecf9` | `#141619` |
| Ink, muted ink, border | `inkMuted` | `#b8bfd3` | `#4f5159` |
| Ink, muted ink, border | `border` | `#969db0` | `#686b72` |
| Accent, hover, ink on the accent, selected | `accent` | `#bab8ff` | `#5031ba` |
| Accent, hover, ink on the accent, selected | `accentHover` | `#cdcdff` | `#3b2190` |
| Accent, hover, ink on the accent, selected | `accentInk` | `#120e2c` | `#ffffff` |
| Accent, hover, ink on the accent, selected | `selected` | `#363167` | `#dcddff` |
| Focus ring | `focus` | `#ebebfa` | `#141619` |
| Links | `link` | `#bab8ff` | `#5031ba` |
| Links | `linkVisited` | `#f0a7e8` | `#7b2776` |
| Links | `linkHover` | `#d0d0ff` | `#3b2190` |
| Links | `linkActive` | `#e2e2ff` | `#241b54` |
| Info | `infoSurface` | `#142b3d` | `#dceeff` |
| Info | `infoInk` | `#93cbfc` | `#004876` |
| Info | `infoBorder` | `#2073ae` | `#2e87c9` |
| Success | `successSurface` | `#162e1b` | `#dbf2df` |
| Success | `successInk` | `#99d3a4` | `#005122` |
| Success | `successBorder` | `#2a7c43` | `#399353` |
| Warning | `warningSurface` | `#35260d` | `#f9ebd3` |
| Warning | `warningInk` | `#e5c182` | `#5d4000` |
| Warning | `warningBorder` | `#906600` | `#ab7900` |
| Danger | `dangerSurface` | `#3e211e` | `#ffe7e4` |
| Danger | `dangerInk` | `#ffb2ac` | `#792b29` |
| Danger | `dangerBorder` | `#ad534d` | `#ca645e` |
| Danger | `dangerAction` | `#fb8981` | `#a21a21` |
| Danger | `dangerActionInk` | `#321312` | `#ffffff` |
| Illustration | `illoSky` | `#1e1f3a` | `#d2d5f2` |
| Illustration | `illoSun` | `#a37133` | `#ffb557` |
| Illustration | `illoHillFar` | `#37324f` | `#c3bfe9` |
| Illustration | `illoHillNear` | `#49426d` | `#aca6dd` |
| Illustration | `illoRoad` | `#565960` | `#94979d` |
| HUD (one value in both themes) | `hudSurface` | `#0f1322` | `#0f1322` |
| HUD (one value in both themes) | `hudInk` | `#f1f3fb` | `#f1f3fb` |
| HUD (one value in both themes) | `hudInkMuted` | `#9ea6b9` | `#9ea6b9` |
| HUD (one value in both themes) | `hudBorder` | `#737c95` | `#737c95` |
| HUD (one value in both themes) | `hudStaleInk` | `#f1af48` | `#f1af48` |

Zone colours are in item 3.

#### 2. Contrast

Every pair `CONTRAST_REQUIREMENTS` declares on `main` (99 distinct foreground/background/minimum triples; the 107 entries repeat 8), computed with `apps/web/src/design/contrast.ts` itself. A pair under its minimum would read **FAIL**; none does.

- All 99 pass in both themes: **yes**. Tightest dark: `bandEndurance` on `surface` 3.23:1 (min 3); tightest light: `bandThreshold` on `surface` 3.18:1 (min 3).
- Primary metric numerals, AAA target 7:1:

| Numeral | Pair | Dark | Light |
|---|---|---|---|
| a primary metric numeral on a metric card | `ink` on `surfaceRaised` | 9.74 | 12.96 |
| a primary metric numeral on a panel | `ink` on `surface` | 12.40 | 15.06 |
| a primary metric numeral on a HUD panel | `hudInk` on `hudSurface` | 16.68 | 16.68 |

- Adjacent surface levels (today on `main`: dark 1.09 / 1.13 / 1.15, light 1.10 / 1.10 / 1.10; raised on canvas 1.23 dark):

| Step | Dark | Light |
|---|---|---|
| `canvas` to `surface` | 1.26 | 1.16 |
| `surface` to `surfaceRaised` | 1.27 | 1.16 |
| `surfaceRaised` to `surfaceOverlay` | 1.28 | 1.16 |
| `canvas` to `surfaceRaised` (a card on the page) | 1.61 | 1.35 |

<details><summary>All 99 declared pairs</summary>

| Foreground | Background | Where (first declaration) | Min | Dark | Light |
|---|---|---|---|---|---|
| `ink` | `canvas` | body text on the page | 4.5 | 15.64 | 17.50 |
| `ink` | `surface` | body text on a panel | 4.5 | 12.40 | 15.06 |
| `inkMuted` | `canvas` | helper and empty-state text on the page | 4.5 | 10.04 | 7.64 |
| `inkMuted` | `surface` | helper and empty-state text on a panel | 4.5 | 7.96 | 6.58 |
| `border` | `canvas` | the edge of a control on the page (WCAG 2.2 SC 1.4.11) | 3 | 6.81 | 5.15 |
| `border` | `surface` | the edge of a control on a panel (WCAG 2.2 SC 1.4.11) | 3 | 5.40 | 4.43 |
| `accentInk` | `accent` | the label of a primary button | 4.5 | 10.12 | 8.44 |
| `accentInk` | `accentHover` | the label of a primary button under a pointer | 4.5 | 12.24 | 11.63 |
| `accent` | `canvas` | the label of a secondary button, an off toggle and an unchecked segment (#668) | 4.5 | 10.00 | 8.14 |
| `accent` | `canvas` | the border of a secondary button, a toggle and a segment, on the page (#668) | 3 | 10.00 | 8.14 |
| `accentHover` | `surface` | a secondary button, an off toggle or a segment under a pointer or a press (#688) | 4.5 | 9.59 | 9.66 |
| `accentHover` | `canvas` | the border of a button under a pointer, on the page (#668, #688) | 3 | 12.10 | 11.22 |
| `accentHover` | `canvas` | the label of a tertiary (text) button under a pointer or a press, on the page (#992) | 4.5 | 12.10 | 11.22 |
| `accentHover` | `selected` | the label of an on toggle and of the checked segment (#668) | 4.5 | 7.69 | 8.76 |
| `accent` | `selected` | the doubled border of an on toggle and a checked segment, and the checked radio, on the `selected` fill (SC 1.4.1, 1.4.11, #668) | 3 | 6.35 | 6.36 |
| `accentHover` | `selected` | the doubled border of an on toggle under a pointer (#668) | 3 | 7.69 | 8.76 |
| `focus` | `selected` | the focus ring on a checked segment's radio, landing on the segment's fill (#668) | 3 | 9.93 | 13.66 |
| `hudInk` | `hudSurface` | a metric on the ride HUD, over its own opaque panel (#94) | 4.5 | 16.68 | 16.68 |
| `hudInkMuted` | `hudSurface` | a field label on the ride HUD (#94) | 4.5 | 7.57 | 7.57 |
| `hudBorder` | `hudSurface` | the edge of a HUD control (WCAG 2.2 SC 1.4.11) | 3 | 4.44 | 4.44 |
| `hudInk` | `hudSurface` | the focus ring of every HUD control, the mute, the volume and the side camera’s Stop among them, offset onto its panel (WCAG 2.2 SC 2.4.13, #748) | 3 | 16.68 | 16.68 |
| `hudStaleInk` | `hudSurface` | the mark on a HUD reading whose sensor has dropped (#94) | 4.5 | 9.65 | 9.65 |
| `accent` | `surface` | link text and the active navigation item in the header | 4.5 | 7.93 | 7.01 |
| `focus` | `canvas` | the focus ring, offset onto the page (WCAG 2.2 SC 2.4.13) | 3 | 15.63 | 17.50 |
| `focus` | `surface` | the focus ring, offset onto a panel (WCAG 2.2 SC 2.4.13) | 3 | 12.40 | 15.06 |
| `ink` | `surfaceRaised` | body text on a card resting on a panel | 4.5 | 9.74 | 12.96 |
| `inkMuted` | `surfaceRaised` | a label on a card resting on a panel | 4.5 | 6.26 | 5.66 |
| `border` | `surfaceRaised` | the edge of a control on a raised card (WCAG 2.2 SC 1.4.11) | 3 | 4.24 | 3.82 |
| `accent` | `surfaceRaised` | link text on a raised card | 4.5 | 6.23 | 6.03 |
| `focus` | `surfaceRaised` | the focus ring, offset onto a raised card (WCAG 2.2 SC 2.4.13) | 3 | 9.74 | 12.96 |
| `ink` | `surfaceOverlay` | the wordmark and the navigation, on the app header | 4.5 | 7.61 | 11.17 |
| `inkMuted` | `surfaceOverlay` | secondary text on the app header | 4.5 | 4.89 | 4.88 |
| `border` | `surfaceOverlay` | the header's own bottom rule (WCAG 2.2 SC 1.4.11) | 3 | 3.31 | 3.29 |
| `accent` | `surfaceOverlay` | a navigation link on the app header | 4.5 | 4.87 | 5.20 |
| `accent` | `surfaceOverlay` | the navigation's active indicator, against the bar and the rail (SC 1.4.11, #944) | 3 | 4.87 | 5.20 |
| `focus` | `surfaceOverlay` | the focus ring, offset onto the app header (WCAG 2.2 SC 2.4.13) | 3 | 7.61 | 11.17 |
| `infoInk` | `infoSurface` | an info message | 4.5 | 8.45 | 8.10 |
| `infoBorder` | `canvas` | the edge of an info message | 3 | 3.62 | 3.74 |
| `successInk` | `successSurface` | a success message | 4.5 | 8.47 | 8.08 |
| `successBorder` | `canvas` | the edge of a success message | 3 | 3.57 | 3.70 |
| `warningInk` | `warningSurface` | a warning message — the Chrome-on-Linux path | 4.5 | 8.56 | 8.12 |
| `warningBorder` | `canvas` | the edge of a warning message | 3 | 3.59 | 3.71 |
| `dangerInk` | `dangerSurface` | an error message — the Safari and Firefox path | 4.5 | 8.48 | 8.13 |
| `dangerBorder` | `canvas` | the edge of an error message | 3 | 3.62 | 3.69 |
| `dangerAction` | `dangerSurface` | the label of a danger button at rest (#1002) | 4.5 | 6.24 | 6.58 |
| `dangerAction` | `canvas` | the edge of a danger button, at rest and under a pointer, on the dialog (#1002) | 3 | 7.90 | 7.49 |
| `dangerActionInk` | `dangerAction` | the label of a danger button under a pointer or a press (#1002) | 4.5 | 7.27 | 7.76 |
| `focus` | `infoSurface` | the focus ring round a link in an info message (WCAG 2.2 SC 2.4.13) | 3 | 12.34 | 15.29 |
| `focus` | `successSurface` | the focus ring round a link in a success message (WCAG 2.2 SC 2.4.13) | 3 | 12.35 | 15.35 |
| `focus` | `warningSurface` | the focus ring round a link in a warning message (WCAG 2.2 SC 2.4.13) | 3 | 12.41 | 15.41 |
| `focus` | `dangerSurface` | the focus ring round a link in an error message (WCAG 2.2 SC 2.4.13) | 3 | 12.35 | 15.37 |
| `link` | `canvas` | link text on canvas | 4.5 | 10.00 | 8.14 |
| `link` | `surface` | link text on surface | 4.5 | 7.93 | 7.01 |
| `link` | `surfaceRaised` | link text on surfaceRaised | 4.5 | 6.23 | 6.03 |
| `link` | `surfaceOverlay` | link text on surfaceOverlay | 4.5 | 4.87 | 5.20 |
| `link` | `infoSurface` | link text on infoSurface | 4.5 | 7.89 | 7.12 |
| `link` | `successSurface` | link text on successSurface | 4.5 | 7.90 | 7.14 |
| `link` | `warningSurface` | link text on warningSurface | 4.5 | 7.94 | 7.17 |
| `link` | `dangerSurface` | link text on dangerSurface | 4.5 | 7.90 | 7.15 |
| `linkVisited` | `canvas` | a visited link on canvas | 4.5 | 10.01 | 8.47 |
| `linkVisited` | `surface` | a visited link on surface | 4.5 | 7.94 | 7.29 |
| `linkVisited` | `surfaceRaised` | a visited link on surfaceRaised | 4.5 | 6.24 | 6.27 |
| `linkVisited` | `surfaceOverlay` | a visited link on surfaceOverlay | 4.5 | 4.87 | 5.40 |
| `linkVisited` | `infoSurface` | a visited link on infoSurface | 4.5 | 7.90 | 7.40 |
| `linkVisited` | `successSurface` | a visited link on successSurface | 4.5 | 7.91 | 7.43 |
| `linkVisited` | `warningSurface` | a visited link on warningSurface | 4.5 | 7.95 | 7.46 |
| `linkVisited` | `dangerSurface` | a visited link on dangerSurface | 4.5 | 7.91 | 7.44 |
| `linkHover` | `canvas` | a link under a pointer or focused from the keyboard on canvas | 4.5 | 12.43 | 11.22 |
| `linkHover` | `surface` | a link under a pointer or focused from the keyboard on surface | 4.5 | 9.86 | 9.66 |
| `linkHover` | `surfaceRaised` | a link under a pointer or focused from the keyboard on surfaceRaised | 4.5 | 7.74 | 8.31 |
| `linkHover` | `surfaceOverlay` | a link under a pointer or focused from the keyboard on surfaceOverlay | 4.5 | 6.05 | 7.16 |
| `linkHover` | `infoSurface` | a link under a pointer or focused from the keyboard on infoSurface | 4.5 | 9.81 | 9.81 |
| `linkHover` | `successSurface` | a link under a pointer or focused from the keyboard on successSurface | 4.5 | 9.82 | 9.84 |
| `linkHover` | `warningSurface` | a link under a pointer or focused from the keyboard on warningSurface | 4.5 | 9.86 | 9.88 |
| `linkHover` | `dangerSurface` | a link under a pointer or focused from the keyboard on dangerSurface | 4.5 | 9.82 | 9.86 |
| `linkActive` | `canvas` | a link being pressed on canvas | 4.5 | 14.55 | 14.91 |
| `linkActive` | `surface` | a link being pressed on surface | 4.5 | 11.53 | 12.83 |
| `linkActive` | `surfaceRaised` | a link being pressed on surfaceRaised | 4.5 | 9.06 | 11.04 |
| `linkActive` | `surfaceOverlay` | a link being pressed on surfaceOverlay | 4.5 | 7.08 | 9.52 |
| `linkActive` | `infoSurface` | a link being pressed on infoSurface | 4.5 | 11.48 | 13.03 |
| `linkActive` | `successSurface` | a link being pressed on successSurface | 4.5 | 11.49 | 13.07 |
| `linkActive` | `warningSurface` | a link being pressed on warningSurface | 4.5 | 11.54 | 13.13 |
| `linkActive` | `dangerSurface` | a link being pressed on dangerSurface | 4.5 | 11.49 | 13.09 |
| `ink` | `illoSky` | a hero title drawn on the sky of a menu illustration | 4.5 | 13.56 | 12.55 |
| `inkMuted` | `illoSky` | the line under a hero title, on the sky | 4.5 | 8.71 | 5.48 |
| `ink` | `illoHillFar` | a card title where it overlaps the far hills | 4.5 | 10.28 | 10.31 |
| `accent` | `illoHillNear` | the edge of a primary button standing on the near hill (WCAG 2.2 SC 1.4.11) | 3 | 4.99 | 3.72 |
| `focus` | `illoSky` | the focus ring of a control over art, where it lands on illoSky (WCAG 2.2 SC 2.4.13) | 3 | 13.56 | 12.55 |
| `focus` | `illoSun` | the focus ring of a control over art, where it lands on illoSun (WCAG 2.2 SC 2.4.13) | 3 | 3.58 | 10.36 |
| `focus` | `illoHillFar` | the focus ring of a control over art, where it lands on illoHillFar (WCAG 2.2 SC 2.4.13) | 3 | 10.28 | 10.31 |
| `focus` | `illoHillNear` | the focus ring of a control over art, where it lands on illoHillNear (WCAG 2.2 SC 2.4.13) | 3 | 7.79 | 7.99 |
| `focus` | `illoRoad` | the focus ring of a control over art, where it lands on illoRoad (WCAG 2.2 SC 2.4.13) | 3 | 5.94 | 6.19 |
| `bandRecovery` | `surface` | a bandRecovery block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 5.15 | 4.04 |
| `bandEndurance` | `surface` | a bandEndurance block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 3.23 | 7.74 |
| `bandTempo` | `surface` | a bandTempo block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.64 | 4.39 |
| `bandThreshold` | `surface` | a bandThreshold block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 10.96 | 3.18 |
| `bandVo2` | `surface` | a bandVo2 block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.40 | 5.45 |
| `bandAnaerobic` | `surface` | a bandAnaerobic block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 3.49 | 8.71 |
| `bandSprint` | `surface` | a bandSprint block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.27 | 5.47 |

</details>

#### 3. Zone ramp, with simulated colour-vision deficiency

Grey, blue, green, yellow, orange, red, purple (owner rulings of 2026-11-03). Lightness zig-zags on purpose: a ramp in this hue order cannot also be monotone in lightness without yellow turning brown, so the neighbours differ in lightness instead. Simulation: Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear sRGB. Each cell is the colour and, from zone 2, its luminance ratio to the zone before it. "On surface" is the declared band pair (min 3:1, normal vision).

**Dark**

| Vision | 1 Recovery | 2 Endurance | 3 Tempo | 4 Threshold | 5 VO₂ | 6 Anaerobic | 7 Sprint | Smallest step |
|---|---|---|---|---|---|---|---|---|
| normal | `#949aa1` | `#2f77cc` 1.60 | `#5fc372` 2.06 | `#f9df5d` 1.65 | `#f59441` 1.71 | `#cb574d` 1.84 | `#cf91f3` 1.80 | 1.60 |
| deuteranopia | `#9699a1` | `#3270ca` 1.71 | `#b7ab77` 2.11 | `#fae364` 1.78 | `#c8b441` 1.61 | `#91854a` 1.78 | `#8eabf0` 1.63 | 1.61 |
| protanopia | `#989aa1` | `#4d7ecf` 1.44 | `#c5b46c` 1.95 | `#f3da4e` 1.48 | `#b19e37` 1.91 | `#746c4b` 1.96 | `#7ea6f7` 2.18 | 1.44 |
| tritanopia | `#919c9c` | `#008b97` 1.45 | `#4cbfaf` 1.82 | `#ffd0c3` 1.61 | `#ff7f83` 1.75 | `#de4155` 1.73 | `#cc9fb7` 1.84 | 1.45 |
| on surface | 5.15 | 3.23 | 6.64 | 10.96 | 6.40 | 3.49 | 6.27 | |

**Light**

| Vision | 1 Recovery | 2 Endurance | 3 Tempo | 4 Threshold | 5 VO₂ | 6 Anaerobic | 7 Sprint | Smallest step |
|---|---|---|---|---|---|---|---|---|
| normal | `#6c7278` | `#00468c` 1.91 | `#007d30` 1.76 | `#968200` 1.38 | `#8f4c00` 1.71 | `#820b0f` 1.60 | `#7e439f` 1.59 | 1.38 |
| deuteranopia | `#6e7178` | `#00418b` 2.02 | `#726836` 1.76 | `#968512` 1.51 | `#706300` 1.63 | `#524807` 1.52 | `#3c5e9d` 1.43 | 1.43 |
| protanopia | `#707278` | `#1b4d8f` 1.74 | `#7e7128` 1.71 | `#917f00` 1.22 | `#605400` 1.89 | `#362f0d` 1.76 | `#265aa2` 1.95 | 1.22 |
| tritanopia | `#697374` | `#005762` 1.70 | `#007a6c` 1.58 | `#a3776e` 1.36 | `#9d3c40` 1.72 | `#90000f` 1.44 | `#7a536a` 1.49 | 1.36 |
| on surface | 4.04 | 7.74 | 4.39 | 3.18 | 5.45 | 8.71 | 5.47 | |

Smallest adjacent step across both themes and all four visions: **1.22:1**. Tokens: `bandRecovery`, `bandEndurance`, `bandTempo`, `bandThreshold`, `bandVo2`, `bandAnaerobic`, `bandSprint`.

#### 4. Type scale

| Step | Size | px | Weight | Face |
|---|---|---|---|---|
| Display | 2.074rem | 33.18 | 800 | Barlow |
| Heading 1 | 1.728rem | 27.65 | 800 | Barlow |
| Heading 2 | 1.44rem | 23.04 | 700 | Barlow |
| Heading 3 | 1.2rem | 19.20 | 700 | Barlow |
| Body | 1rem | 16.00 | 400 | system-ui |
| Label | 0.833rem | 13.33 | 500 | Barlow (new 500) |
| Home metric numeral | 2.074rem | 33.18 | 500 | Barlow (new 500), tabular-nums |
| HUD secondary numeral | 2.488rem | 39.81 | 500 | Barlow (new 500), tabular-nums |
| HUD primary numeral | 4.3rem | 68.80 | 500 | Barlow (new 500), tabular-nums |

Legibility at a 1 m mount: 16 arc-minutes is 4.65 mm. Barlow's cap height is 700/1000 em (OS/2 `sCapHeight`; digits 700–708), read with fontTools 4.61 from the Barlow 1.408 TTFs (Bold and ExtraBold as committed under `apps/web/tools/fonts/barlow/`; Medium and SemiBold from the same pinned upstream commit). On a 10.1-inch 1280×800 tablet one CSS px is 0.1700 mm (assumed; the owner's tablet was not measured). Primary ride numeral: 4.3rem → cap 48.2 px → **8.19 mm** (meets, 1.76×). Secondary HUD numeral: 2.488rem → **4.74 mm** (meets).

#### 5. Home wireframe

The modules of #2031: ride quick-launch, BLE sensor status (the trainer, power, heart rate and cadence, each
connected or not in words and a filled or hollow mark, never by colour alone), the last ride (numbers, elevation
profile, time in zone with every zone's number and name) and the week (a labelled SVG bar chart). There is no hero
picture. Tablet uses a 7/5 two-column grid, and the phone a single column with a bottom bar.

Screenshots (kept out of git): `B-home-tablet-dark.png`, `B-home-tablet-light.png`, `B-home-phone-dark.png`,
`B-home-phone-light.png`, and `B-home-phone-dark-full.png` (the whole phone page).

#### 6. Button, card and HUD panel

The primary, secondary, tertiary and danger buttons (the real `Button`), a card with metric tiles (level 1 with
level 2 inside it), and a HUD panel, in both themes: `B-board.png`. The whole ride HUD at 1280×800 in dark:
`B-hud-tablet-dark.png`.

### Option C: Monochrome + Zones

True black canvas (OLED-friendly) and warm greys. The accent is the ink itself: a white primary button with black
text in dark, and the reverse in light. Cards get a 1 px hairline edge. **Accent source:** none. The point of the
option is that power zones and status tones are the only colour anywhere, so a zone is the brightest thing on a
screen, and the zones get the most chroma of the three options. It has the largest type ratio (1.333) and the
biggest HUD numeral (5.61rem, cap 10.7 mm). The risk is plain: a monochrome UI can read as generic unless the type
and the zone colours carry the identity, and the owner has already called today's look generic.

#### 1. Palette, both themes

| Group | Token | Dark | Light |
|---|---|---|---|
| Canvas and the surface levels 1–3 | `canvas` | `#000000` | `#ffffff` |
| Canvas and the surface levels 1–3 | `surface` | `#1b1918` | `#f0edeb` |
| Canvas and the surface levels 1–3 | `surfaceRaised` | `#2a2827` | `#dfdcda` |
| Canvas and the surface levels 1–3 | `surfaceOverlay` | `#373433` | `#cfcccb` |
| Ink, muted ink, border | `ink` | `#f5f3f2` | `#0e0d0c` |
| Ink, muted ink, border | `inkMuted` | `#a4a1a0` | `#555251` |
| Ink, muted ink, border | `border` | `#868482` | `#6e6b6a` |
| Accent, hover, ink on the accent, selected | `accent` | `#f6f6f6` | `#111111` |
| Accent, hover, ink on the accent, selected | `accentHover` | `#ffffff` | `#000000` |
| Accent, hover, ink on the accent, selected | `accentInk` | `#000000` | `#ffffff` |
| Accent, hover, ink on the accent, selected | `selected` | `#5f5c5b` | `#d0cecc` |
| Focus ring | `focus` | `#ffffff` | `#000000` |
| Links | `link` | `#f6f6f6` | `#111111` |
| Links | `linkVisited` | `#c3b6df` | `#4d2f78` |
| Links | `linkHover` | `#ffffff` | `#000000` |
| Links | `linkActive` | `#d9d9d9` | `#303030` |
| Info | `infoSurface` | `#142b3d` | `#dceeff` |
| Info | `infoInk` | `#93cbfc` | `#004876` |
| Info | `infoBorder` | `#126aa4` | `#328bcd` |
| Success | `successSurface` | `#162e1b` | `#dbf2df` |
| Success | `successInk` | `#99d3a4` | `#005122` |
| Success | `successBorder` | `#1e743a` | `#3b9655` |
| Warning | `warningSurface` | `#35260d` | `#f9ebd3` |
| Warning | `warningInk` | `#e5c182` | `#5d4000` |
| Warning | `warningBorder` | `#865e00` | `#ae7c00` |
| Danger | `dangerSurface` | `#3e211e` | `#ffe7e4` |
| Danger | `dangerInk` | `#ffb2ac` | `#792b29` |
| Danger | `dangerBorder` | `#a34a45` | `#cc6660` |
| Danger | `dangerAction` | `#fb8981` | `#a21a21` |
| Danger | `dangerActionInk` | `#321312` | `#ffffff` |
| Illustration | `illoSky` | `#0d2339` | `#c4d9f1` |
| Illustration | `illoSun` | `#97772c` | `#eebc4b` |
| Illustration | `illoHillFar` | `#4a301b` | `#e2bc9d` |
| Illustration | `illoHillNear` | `#643f1f` | `#d3a279` |
| Illustration | `illoRoad` | `#5d5752` | `#9b9490` |
| HUD (one value in both themes) | `hudSurface` | `#0d0d0d` | `#0d0d0d` |
| HUD (one value in both themes) | `hudInk` | `#ffffff` | `#ffffff` |
| HUD (one value in both themes) | `hudInkMuted` | `#a5a5a5` | `#a5a5a5` |
| HUD (one value in both themes) | `hudBorder` | `#7c7c7c` | `#7c7c7c` |
| HUD (one value in both themes) | `hudStaleInk` | `#f1af48` | `#f1af48` |

Zone colours are in item 3.

#### 2. Contrast

Every pair `CONTRAST_REQUIREMENTS` declares on `main` (99 distinct foreground/background/minimum triples; the 107 entries repeat 8), computed with `apps/web/src/design/contrast.ts` itself. A pair under its minimum would read **FAIL**; none does.

- All 99 pass in both themes: **yes**. Tightest dark: `inkMuted` on `surfaceOverlay` 4.81:1 (min 4.5); tightest light: `inkMuted` on `surfaceOverlay` 4.85:1 (min 4.5).
- Primary metric numerals, AAA target 7:1:

| Numeral | Pair | Dark | Light |
|---|---|---|---|
| a primary metric numeral on a metric card | `ink` on `surfaceRaised` | 13.26 | 14.23 |
| a primary metric numeral on a panel | `ink` on `surface` | 15.84 | 16.66 |
| a primary metric numeral on a HUD panel | `hudInk` on `hudSurface` | 19.44 | 19.44 |

- Adjacent surface levels (today on `main`: dark 1.09 / 1.13 / 1.15, light 1.10 / 1.10 / 1.10; raised on canvas 1.23 dark):

| Step | Dark | Light |
|---|---|---|
| `canvas` to `surface` | 1.20 | 1.17 |
| `surface` to `surfaceRaised` | 1.19 | 1.17 |
| `surfaceRaised` to `surfaceOverlay` | 1.19 | 1.17 |
| `canvas` to `surfaceRaised` (a card on the page) | 1.43 | 1.36 |

<details><summary>All 99 declared pairs</summary>

| Foreground | Background | Where (first declaration) | Min | Dark | Light |
|---|---|---|---|---|---|
| `ink` | `canvas` | body text on the page | 4.5 | 18.98 | 19.42 |
| `ink` | `surface` | body text on a panel | 4.5 | 15.84 | 16.66 |
| `inkMuted` | `canvas` | helper and empty-state text on the page | 4.5 | 8.18 | 7.74 |
| `inkMuted` | `surface` | helper and empty-state text on a panel | 4.5 | 6.83 | 6.64 |
| `border` | `canvas` | the edge of a control on the page (WCAG 2.2 SC 1.4.11) | 3 | 5.64 | 5.28 |
| `border` | `surface` | the edge of a control on a panel (WCAG 2.2 SC 1.4.11) | 3 | 4.70 | 4.53 |
| `accentInk` | `accent` | the label of a primary button | 4.5 | 19.43 | 18.88 |
| `accentInk` | `accentHover` | the label of a primary button under a pointer | 4.5 | 21.00 | 21.00 |
| `accent` | `canvas` | the label of a secondary button, an off toggle and an unchecked segment (#668) | 4.5 | 19.43 | 18.88 |
| `accent` | `canvas` | the border of a secondary button, a toggle and a segment, on the page (#668) | 3 | 19.43 | 18.88 |
| `accentHover` | `surface` | a secondary button, an off toggle or a segment under a pointer or a press (#688) | 4.5 | 17.52 | 18.02 |
| `accentHover` | `canvas` | the border of a button under a pointer, on the page (#668, #688) | 3 | 21.00 | 21.00 |
| `accentHover` | `canvas` | the label of a tertiary (text) button under a pointer or a press, on the page (#992) | 4.5 | 21.00 | 21.00 |
| `accentHover` | `selected` | the label of an on toggle and of the checked segment (#668) | 4.5 | 6.63 | 13.38 |
| `accent` | `selected` | the doubled border of an on toggle and a checked segment, and the checked radio, on the `selected` fill (SC 1.4.1, 1.4.11, #668) | 3 | 6.13 | 12.03 |
| `accentHover` | `selected` | the doubled border of an on toggle under a pointer (#668) | 3 | 6.63 | 13.38 |
| `focus` | `selected` | the focus ring on a checked segment's radio, landing on the segment's fill (#668) | 3 | 6.63 | 13.38 |
| `hudInk` | `hudSurface` | a metric on the ride HUD, over its own opaque panel (#94) | 4.5 | 19.44 | 19.44 |
| `hudInkMuted` | `hudSurface` | a field label on the ride HUD (#94) | 4.5 | 7.89 | 7.89 |
| `hudBorder` | `hudSurface` | the edge of a HUD control (WCAG 2.2 SC 1.4.11) | 3 | 4.66 | 4.66 |
| `hudInk` | `hudSurface` | the focus ring of every HUD control, the mute, the volume and the side camera’s Stop among them, offset onto its panel (WCAG 2.2 SC 2.4.13, #748) | 3 | 19.44 | 19.44 |
| `hudStaleInk` | `hudSurface` | the mark on a HUD reading whose sensor has dropped (#94) | 4.5 | 10.15 | 10.15 |
| `accent` | `surface` | link text and the active navigation item in the header | 4.5 | 16.21 | 16.20 |
| `focus` | `canvas` | the focus ring, offset onto the page (WCAG 2.2 SC 2.4.13) | 3 | 21.00 | 21.00 |
| `focus` | `surface` | the focus ring, offset onto a panel (WCAG 2.2 SC 2.4.13) | 3 | 17.52 | 18.02 |
| `ink` | `surfaceRaised` | body text on a card resting on a panel | 4.5 | 13.26 | 14.23 |
| `inkMuted` | `surfaceRaised` | a label on a card resting on a panel | 4.5 | 5.72 | 5.67 |
| `border` | `surfaceRaised` | the edge of a control on a raised card (WCAG 2.2 SC 1.4.11) | 3 | 3.94 | 3.87 |
| `accent` | `surfaceRaised` | link text on a raised card | 4.5 | 13.58 | 13.84 |
| `focus` | `surfaceRaised` | the focus ring, offset onto a raised card (WCAG 2.2 SC 2.4.13) | 3 | 14.67 | 15.39 |
| `ink` | `surfaceOverlay` | the wordmark and the navigation, on the app header | 4.5 | 11.16 | 12.16 |
| `inkMuted` | `surfaceOverlay` | secondary text on the app header | 4.5 | 4.81 | 4.85 |
| `border` | `surfaceOverlay` | the header's own bottom rule (WCAG 2.2 SC 1.4.11) | 3 | 3.31 | 3.31 |
| `accent` | `surfaceOverlay` | a navigation link on the app header | 4.5 | 11.42 | 11.83 |
| `accent` | `surfaceOverlay` | the navigation's active indicator, against the bar and the rail (SC 1.4.11, #944) | 3 | 11.42 | 11.83 |
| `focus` | `surfaceOverlay` | the focus ring, offset onto the app header (WCAG 2.2 SC 2.4.13) | 3 | 12.34 | 13.15 |
| `infoInk` | `infoSurface` | an info message | 4.5 | 8.45 | 8.10 |
| `infoBorder` | `canvas` | the edge of an info message | 3 | 3.62 | 3.68 |
| `successInk` | `successSurface` | a success message | 4.5 | 8.47 | 8.08 |
| `successBorder` | `canvas` | the edge of a success message | 3 | 3.61 | 3.70 |
| `warningInk` | `warningSurface` | a warning message — the Chrome-on-Linux path | 4.5 | 8.56 | 8.12 |
| `warningBorder` | `canvas` | the edge of a warning message | 3 | 3.61 | 3.70 |
| `dangerInk` | `dangerSurface` | an error message — the Safari and Firefox path | 4.5 | 8.48 | 8.13 |
| `dangerBorder` | `canvas` | the edge of an error message | 3 | 3.62 | 3.73 |
| `dangerAction` | `dangerSurface` | the label of a danger button at rest (#1002) | 4.5 | 6.24 | 6.58 |
| `dangerAction` | `canvas` | the edge of a danger button, at rest and under a pointer, on the dialog (#1002) | 3 | 9.00 | 7.76 |
| `dangerActionInk` | `dangerAction` | the label of a danger button under a pointer or a press (#1002) | 4.5 | 7.27 | 7.76 |
| `focus` | `infoSurface` | the focus ring round a link in an info message (WCAG 2.2 SC 2.4.13) | 3 | 14.56 | 17.72 |
| `focus` | `successSurface` | the focus ring round a link in a success message (WCAG 2.2 SC 2.4.13) | 3 | 14.58 | 17.78 |
| `focus` | `warningSurface` | the focus ring round a link in a warning message (WCAG 2.2 SC 2.4.13) | 3 | 14.64 | 17.85 |
| `focus` | `dangerSurface` | the focus ring round a link in an error message (WCAG 2.2 SC 2.4.13) | 3 | 14.57 | 17.80 |
| `link` | `canvas` | link text on canvas | 4.5 | 19.43 | 18.88 |
| `link` | `surface` | link text on surface | 4.5 | 16.21 | 16.20 |
| `link` | `surfaceRaised` | link text on surfaceRaised | 4.5 | 13.58 | 13.84 |
| `link` | `surfaceOverlay` | link text on surfaceOverlay | 4.5 | 11.42 | 11.83 |
| `link` | `infoSurface` | link text on infoSurface | 4.5 | 13.47 | 15.93 |
| `link` | `successSurface` | link text on successSurface | 4.5 | 13.49 | 15.99 |
| `link` | `warningSurface` | link text on warningSurface | 4.5 | 13.55 | 16.05 |
| `link` | `dangerSurface` | link text on dangerSurface | 4.5 | 13.48 | 16.01 |
| `linkVisited` | `canvas` | a visited link on canvas | 4.5 | 11.08 | 10.53 |
| `linkVisited` | `surface` | a visited link on surface | 4.5 | 9.24 | 9.04 |
| `linkVisited` | `surfaceRaised` | a visited link on surfaceRaised | 4.5 | 7.74 | 7.72 |
| `linkVisited` | `surfaceOverlay` | a visited link on surfaceOverlay | 4.5 | 6.51 | 6.60 |
| `linkVisited` | `infoSurface` | a visited link on infoSurface | 4.5 | 7.68 | 8.89 |
| `linkVisited` | `successSurface` | a visited link on successSurface | 4.5 | 7.69 | 8.92 |
| `linkVisited` | `warningSurface` | a visited link on warningSurface | 4.5 | 7.72 | 8.96 |
| `linkVisited` | `dangerSurface` | a visited link on dangerSurface | 4.5 | 7.69 | 8.93 |
| `linkHover` | `canvas` | a link under a pointer or focused from the keyboard on canvas | 4.5 | 21.00 | 21.00 |
| `linkHover` | `surface` | a link under a pointer or focused from the keyboard on surface | 4.5 | 17.52 | 18.02 |
| `linkHover` | `surfaceRaised` | a link under a pointer or focused from the keyboard on surfaceRaised | 4.5 | 14.67 | 15.39 |
| `linkHover` | `surfaceOverlay` | a link under a pointer or focused from the keyboard on surfaceOverlay | 4.5 | 12.34 | 13.15 |
| `linkHover` | `infoSurface` | a link under a pointer or focused from the keyboard on infoSurface | 4.5 | 14.56 | 17.72 |
| `linkHover` | `successSurface` | a link under a pointer or focused from the keyboard on successSurface | 4.5 | 14.58 | 17.78 |
| `linkHover` | `warningSurface` | a link under a pointer or focused from the keyboard on warningSurface | 4.5 | 14.64 | 17.85 |
| `linkHover` | `dangerSurface` | a link under a pointer or focused from the keyboard on dangerSurface | 4.5 | 14.57 | 17.80 |
| `linkActive` | `canvas` | a link being pressed on canvas | 4.5 | 14.88 | 13.20 |
| `linkActive` | `surface` | a link being pressed on surface | 4.5 | 12.41 | 11.32 |
| `linkActive` | `surfaceRaised` | a link being pressed on surfaceRaised | 4.5 | 10.39 | 9.67 |
| `linkActive` | `surfaceOverlay` | a link being pressed on surfaceOverlay | 4.5 | 8.74 | 8.27 |
| `linkActive` | `infoSurface` | a link being pressed on infoSurface | 4.5 | 10.31 | 11.13 |
| `linkActive` | `successSurface` | a link being pressed on successSurface | 4.5 | 10.33 | 11.17 |
| `linkActive` | `warningSurface` | a link being pressed on warningSurface | 4.5 | 10.37 | 11.22 |
| `linkActive` | `dangerSurface` | a link being pressed on dangerSurface | 4.5 | 10.32 | 11.19 |
| `ink` | `illoSky` | a hero title drawn on the sky of a menu illustration | 4.5 | 14.42 | 13.45 |
| `inkMuted` | `illoSky` | the line under a hero title, on the sky | 4.5 | 6.22 | 5.36 |
| `ink` | `illoHillFar` | a card title where it overlaps the far hills | 4.5 | 10.98 | 11.02 |
| `accent` | `illoHillNear` | the edge of a primary button standing on the near hill (WCAG 2.2 SC 1.4.11) | 3 | 8.55 | 8.29 |
| `focus` | `illoSky` | the focus ring of a control over art, where it lands on illoSky (WCAG 2.2 SC 2.4.13) | 3 | 15.95 | 14.54 |
| `focus` | `illoSun` | the focus ring of a control over art, where it lands on illoSun (WCAG 2.2 SC 2.4.13) | 3 | 4.21 | 11.93 |
| `focus` | `illoHillFar` | the focus ring of a control over art, where it lands on illoHillFar (WCAG 2.2 SC 2.4.13) | 3 | 12.14 | 11.91 |
| `focus` | `illoHillNear` | the focus ring of a control over art, where it lands on illoHillNear (WCAG 2.2 SC 2.4.13) | 3 | 9.24 | 9.21 |
| `focus` | `illoRoad` | the focus ring of a control over art, where it lands on illoRoad (WCAG 2.2 SC 2.4.13) | 3 | 7.12 | 7.03 |
| `bandRecovery` | `surface` | a bandRecovery block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 6.17 | 4.18 |
| `bandEndurance` | `surface` | a bandEndurance block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 3.57 | 7.99 |
| `bandTempo` | `surface` | a bandTempo block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 8.01 | 4.53 |
| `bandThreshold` | `surface` | a bandThreshold block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 13.21 | 3.27 |
| `bandVo2` | `surface` | a bandVo2 block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 7.67 | 5.63 |
| `bandAnaerobic` | `surface` | a bandAnaerobic block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 4.17 | 9.00 |
| `bandSprint` | `surface` | a bandSprint block of the workout block chart, on its well (WCAG 2.2 SC 1.4.11) | 3 | 7.53 | 5.62 |

</details>

#### 3. Zone ramp, with simulated colour-vision deficiency

Grey, blue, green, yellow, orange, red, purple (owner rulings of 2026-11-03). Lightness zig-zags on purpose: a ramp in this hue order cannot also be monotone in lightness without yellow turning brown, so the neighbours differ in lightness instead. Simulation: Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear sRGB. Each cell is the colour and, from zone 2, its luminance ratio to the zone before it. "On surface" is the declared band pair (min 3:1, normal vision).

**Dark**

| Vision | 1 Recovery | 2 Endurance | 3 Tempo | 4 Threshold | 5 VO₂ | 6 Anaerobic | 7 Sprint | Smallest step |
|---|---|---|---|---|---|---|---|---|
| normal | `#949aa1` | `#006fd9` 1.73 | `#39c85f` 2.25 | `#ffdf23` 1.65 | `#ff8f1f` 1.72 | `#dd453e` 1.84 | `#d58cff` 1.81 | 1.65 |
| deuteranopia | `#9699a1` | `#0068d7` 1.86 | `#b9ab67` 2.29 | `#ffe435` 1.81 | `#ccb61e` 1.60 | `#968839` 1.75 | `#87acfc` 1.59 | 1.59 |
| protanopia | `#989aa1` | `#2c7add` 1.51 | `#cab656` 2.09 | `#f6d900` 1.44 | `#b19c00` 1.95 | `#70673c` 2.06 | `#73a6ff` 2.34 | 1.44 |
| tritanopia | `#919c9c` | `#008999` 1.48 | `#00c4b0` 1.89 | `#ffcdbf` 1.55 | `#ff757b` 1.82 | `#f31145` 1.62 | `#d19dba` 1.86 | 1.48 |
| on surface | 6.17 | 3.57 | 8.01 | 13.21 | 7.67 | 4.17 | 7.53 | |

**Light**

| Vision | 1 Recovery | 2 Endurance | 3 Tempo | 4 Threshold | 5 VO₂ | 6 Anaerobic | 7 Sprint | Smallest step |
|---|---|---|---|---|---|---|---|---|
| normal | `#6c7278` | `#00468c` 1.91 | `#007d30` 1.76 | `#978200` 1.39 | `#8f4c00` 1.72 | `#850009` 1.60 | `#8737b0` 1.60 | 1.39 |
| deuteranopia | `#6e7178` | `#00418b` 2.02 | `#726836` 1.76 | `#968612` 1.52 | `#706300` 1.65 | `#534900` 1.50 | `#2a5fad` 1.44 | 1.44 |
| protanopia | `#707278` | `#1b4d8f` 1.74 | `#7e7128` 1.71 | `#917f00` 1.22 | `#605400` 1.89 | `#352e06` 1.79 | `#0059b4` 2.00 | 1.22 |
| tritanopia | `#697374` | `#005762` 1.70 | `#007a6c` 1.58 | `#a4776e` 1.36 | `#9d3c40` 1.73 | `#940006` 1.39 | `#82506f` 1.47 | 1.36 |
| on surface | 4.18 | 7.99 | 4.53 | 3.27 | 5.63 | 9.00 | 5.62 | |

Smallest adjacent step across both themes and all four visions: **1.22:1**. Tokens: `bandRecovery`, `bandEndurance`, `bandTempo`, `bandThreshold`, `bandVo2`, `bandAnaerobic`, `bandSprint`.

#### 4. Type scale

| Step | Size | px | Weight | Face |
|---|---|---|---|---|
| Display | 3.157rem | 50.51 | 800 | Barlow |
| Heading 1 | 2.369rem | 37.90 | 800 | Barlow |
| Heading 2 | 1.777rem | 28.43 | 700 | Barlow |
| Heading 3 | 1.333rem | 21.33 | 600 | Barlow (new 600) |
| Body | 1rem | 16.00 | 400 | system-ui |
| Label | 0.75rem | 12.00 | 600 | Barlow (new 600) |
| Home metric numeral | 2.369rem | 37.90 | 800 | Barlow, tabular-nums |
| HUD secondary numeral | 3.157rem | 50.51 | 700 | Barlow, tabular-nums |
| HUD primary numeral | 5.61rem | 89.76 | 800 | Barlow, tabular-nums |

Legibility at a 1 m mount: 16 arc-minutes is 4.65 mm. Barlow's cap height is 700/1000 em (OS/2 `sCapHeight`; digits 700–708), read with fontTools 4.61 from the Barlow 1.408 TTFs (Bold and ExtraBold as committed under `apps/web/tools/fonts/barlow/`; Medium and SemiBold from the same pinned upstream commit). On a 10.1-inch 1280×800 tablet one CSS px is 0.1700 mm (assumed; the owner's tablet was not measured). Primary ride numeral: 5.61rem → cap 62.8 px → **10.68 mm** (meets, 2.29×). Secondary HUD numeral: 3.157rem → **6.01 mm** (meets).

#### 5. Home wireframe

The modules of #2031: ride quick-launch, BLE sensor status (the trainer, power, heart rate and cadence, each
connected or not in words and a filled or hollow mark, never by colour alone), the last ride (numbers, elevation
profile, time in zone with every zone's number and name) and the week (a labelled SVG bar chart). There is no hero
picture. Tablet uses a 7/5 two-column grid, and the phone a single column with a bottom bar.

Screenshots (kept out of git): `C-home-tablet-dark.png`, `C-home-tablet-light.png`, `C-home-phone-dark.png`,
`C-home-phone-light.png`, and `C-home-phone-dark-full.png` (the whole phone page).

#### 6. Button, card and HUD panel

The primary, secondary, tertiary and danger buttons (the real `Button`), a card with metric tiles (level 1 with
level 2 inside it), and a HUD panel, in both themes: `C-board.png`. The whole ride HUD at 1280×800 in dark:
`C-hud-tablet-dark.png`.

## What is left for the owner

- **Choose one option, or a stated mix** (for example "B's palette with A's type"), in a dated comment on #2035.
  That comment is the ruling ADR 0063 (#2036) cites. Until then nothing in #2030–#2034 is built.
- Measure the tablet if the 16 arc-minute check should hold for it exactly: the 0.1700 mm per CSS px here
  is an assumption, and it scales every cap height above.

## Reproducing

`git checkout spike/issue-2035-design-prototype`, then from `apps/web`: `node browser/design-2035/gen.ts` (palettes and
`options.json`), `pnpm exec vite build --config browser/design-2035/vite.config.ts`, and
`node browser/design-2035/shoot.mjs <out-dir>`. Barlow Medium and SemiBold are read from
`browser/design-2035/public/fonts/`, which is not committed; fetch them from the pinned upstream commit
`font-recipe.ts` names (`upstreamUrl('Barlow-Medium.ttf')`, `upstreamUrl('Barlow-SemiBold.ttf')`).
