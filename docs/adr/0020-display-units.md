# ADR 0020: One display-unit switch, stored on the athlete

- **Status**: Accepted
- **Date**: 2026-09-12
- **Deciders**: the repository owner, who answered both questions on 2026-09-11 in a comment on
  [#238](https://github.com/openzigs/onyourleft/issues/238). Recorded here rather than left in the
  issue thread because an issue comment is not where somebody looks two years later, and because
  #238's own body warns that *"getting it wrong later means migrating a stored setting"*
- **Issue**: [#238](https://github.com/openzigs/onyourleft/issues/238), under epic
  [#10](https://github.com/openzigs/onyourleft/issues/10)
- **Number**: **0020**. Every number from 0001 to 0019 was written and `CLAUDE.md` §7 and
  `docs/architecture.md`'s index both recorded 0020 as the next free one with no live reservation —
  the check §7 asks for before a number is taken. The same pull request moves both sentences on to
  0021
- **Supersedes**: nothing
- **Relates to**: [ADR 0005](0005-tech-stack.md), whose canonical-unit choices this does not touch;
  [`packages/domain/README.md`](../../packages/domain/README.md), which tabulates those units and
  stays true of everything stored, computed, signed and exported

---

## Context

Every distance and speed the client rendered was metric, with no way to change it. A rider in the
US, the UK or anywhere else that rides in miles read every screen in units they do not use.

It was hard-coded in two places, and — this is the part that makes it more than a settings toggle —
**they were not the same mechanism**:

| Where | What |
| --- | --- |
| `apps/web/src/format.ts` | `SPEED_UNIT = 'km/h'` and `DISTANCE_UNIT = 'km'` — constants, so every caller inherited the choice |
| `apps/web/src/game/hud/fields.ts` | the HUD converted and labelled inline: `(state.ride.speed as number) * 3.6, 'km/h'` |

A preference wired only into the constants would have changed most of the product and left the one
screen a rider stares at for an hour unchanged. A half-converted app is worse than a consistently
metric one.

Two questions had to be answered before any of it could be written, because both decide the shape
of a **stored** setting and neither can be changed later without migrating one.

---

## Decision

### D-1 — One switch: metric or imperial, covering distance, speed, elevation and weight

Not per-quantity, and not a split between distance/speed and elevation.

⚠️ **The cost is real and is accepted rather than overlooked.** A rider who wants miles for distance
but metres for climbing — a genuinely common combination in the UK — cannot have it.

The reason to take that trade is that a settings screen with four unit dropdowns is one nobody
finishes reading, and **the split can be added later additively**, where collapsing several settings
into one later cannot be done without choosing for somebody.

Temperature is **not** in the list. Nothing in this client has ever rendered a Fahrenheit reading,
the four quantities above are what the owner enumerated, and adding a fifth is additive in exactly
the sense the paragraph above describes. `detail/series.ts` says so where the Celsius label is
written.

Weight has **no render site today**. `AthleteRecord.mass` is stored and is read only as the source
of an effort's frozen copy; no screen shows a rider a kilogram. It is inside the switch's scope so
that whichever screen first renders one has an answer already, and `units/format.ts` deliberately
does **not** ship a mass formatter with no caller — `format.ts`'s own history records what happens
to an exported helper written ahead of its second caller.

### D-2 — Stored on the athlete row, not per device

So it travels with the athlete, is carried by the account export
([#35](https://github.com/openzigs/onyourleft/issues/35)), and survives an erase-and-reimport.
`packages/store`'s README records that an optional field is not a migration, so this is additive to
the existing schema rather than a new version.

⚠️ **The consequence to hold onto**: a rider with a tablet on the turbo and a phone on the road gets
the **same** units on both. That is the intended behaviour of an athlete-scoped setting and not a
defect to be worked around with a device override.

### D-3 — Metric is the default, and it is never guessed from the locale

#238 is explicit that *"guess from the locale and say nothing"* is the wrong answer: a locale is a
language and a region, not a statement about how somebody measures a bike ride, and a wrong guess
silently misreports every number on every screen with nothing to tell the rider a choice was made
for them.

Metric is also the canonical unit of the program, so it is the reading that involves the fewest
conversions — but the reason it is the *default* is that a rider can **see** it is selected. The
settings screen's radio group shows the current choice rather than implying it, which is the
difference between a default and a guess.

### D-4 — The conversion happens at the last moment before a string, in one module

`apps/web/src/units/format.ts` is the only place in the client that decides a unit. Everything
stored, computed, signed and exported stays canonical.

Two properties make that enforceable rather than aspirational:

1. **A value and its label are produced together.** Every function returns a `Measurement`, so a
   caller cannot obtain the string `mi` without also obtaining the number of miles. That closes the
   *accidental* half-conversion.
2. **Nothing outside `src/units/` writes a unit label by hand**, checked by
   `units/no-inline-units.test.ts`, which reads the client's own comment-stripped source and fails
   on a quoted unit, a unit after an interpolation, or an inline `3.6`. That closes the
   *deliberate* one — which is what the HUD did for four months while the shared constants sat one
   directory away.

⚠️ **Nothing in `packages/` reads the setting.** `packages/domain` gains
`metresPerSecondToMilesPerHour` beside the kilometres-per-hour conversion it has always had; it
converts and it does not decide. `packages/store` holds the value because the value has to be
persisted, and branches on it nowhere.

### D-5 — Three tiers, and the precision is per tier rather than per system

| Tier | Metric | Imperial | Used for |
| --- | --- | --- | --- |
| speed | km/h | mph | a live or recorded speed |
| distance | km | mi | a ride, a route, a leg |
| small distance | m | ft | a segment, a climb, an altitude |

The third tier exists because `SegmentsView` never used the shared distance formatter in the first
place: a segment runs from the 400 m minimum to a few kilometres, and "0.4 km" throws away the digit
that tells one climb from another. Its imperial counterpart is feet rather than miles for exactly
that reason.

#238 asks for rounding to be decided rather than inherited. **It is the same in both systems**, and
it can be because the imperial units bracket the metric ones acceptably:

- a speed at one decimal — 0.1 mph is a *coarser* step than 0.1 km/h, so the last-digit jitter #238
  warns about on a handlebar does not get worse in the direction this adds;
- a distance at one decimal — 0.1 mi is 161 m against 0.1 km's 100 m. The mile reading is 1.6×
  coarser and that is accepted: a ride total is not read to the hundred metres. A caller that
  genuinely needs finer, like the HUD counting down the last kilometre, passes a precision
  explicitly, which is a precision argument and not a unit one;
- a small distance at no decimals — a foot is 0.3 m, so whole feet are *finer* than whole metres.

---

## Consequences

- **`format.ts`'s constants are gone.** `SPEED_UNIT`, `DISTANCE_UNIT`, `formatSpeedValue` and
  `formatDistanceValue` no longer exist; `POWER_UNIT`, `formatDuration`, `formatPowerValue` and
  `formatStartedAt` stay, because a watt and a minute are not units a rider chooses.
- **A pure function takes the unit system as a parameter; a component reads it from a context.**
  `units/context.tsx` records why: threading a prop through every component would put the
  preference in the signature of components that render no number, and one that forgot to pass it
  down would render metric — the silent half-conversion, arriving by a new route.
- **A new screen that renders a distance cannot hard-code a literal and pass review**, because the
  source scan fails the build. A screen that legitimately needs a new unit adds it to
  `units/format.ts` and to `UNIT_TOKENS`.
- **An exported file is unaffected**, and the settings screen says so. FIT, GPX and TCX have their
  own unit rules and a rider's display preference has no business reaching a file another program
  will read. The same is true, more strongly, of the signed record.
- **One latent store defect was fixed on the way**: `setAthleteThresholds` rebuilt the athlete row
  from a hand-written list of three fields, so saving a threshold silently erased `mass` — and
  would have erased `units`. It spreads the decoded record now.
- **A rider on two devices gets one answer**, per D-2. If that turns out to be wrong, the repair is
  a device-level override that falls back to the athlete row, which is additive.

## What would make this ADR wrong

- **Riders ask for the split D-1 forecloses.** Miles for distance with metres for climbing is the
  common case that would reopen it, and reopening it is additive: a second optional field beside
  `units`, defaulting to whatever `units` says.
- **A second athlete exists on one device** ([#33](https://github.com/openzigs/onyourleft/issues/33))
  and the two want different units. D-2 already handles that correctly — the setting is on the row —
  so this would not reopen anything.
- **Something below the presentation boundary needs to know.** Nothing does today, and if something
  ever appears to, the first question is whether it is really a presentation concern; D-4 is the
  line that makes every claim in this ADR checkable.
