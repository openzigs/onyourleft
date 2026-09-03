# `@onyourleft/domain`

The shared vocabulary: the canonical representation of every quantity this program measures, the
conversions into and out of the formats it reads, and the validation that happens where an untrusted
number becomes a typed one.

Apache-2.0, like everything under `packages/`. **No platform API at all** — no DOM, no Node globals,
no I/O, no network types — because the same code runs on a phone in Phase 1 and on an instance in
Phase 3. See [`docs/architecture.md`](../../docs/architecture.md).

## The canonical representations

One representation per quantity, chosen once, so that "every conversion in the program goes through
this package" is enforceable rather than aspirational. SI where the sensors and the physics model
already speak SI; the rest are conversions *out*.

| Quantity | Canonical unit | Type | Constructor | Rejects |
|---|---|---|---|---|
| Distance | metre | `Metres` | `metres()` | non-finite, negative |
| Speed | metre per second | `MetresPerSecond` | `metresPerSecond()` | non-finite, negative |
| Power | watt | `Watts` | `watts()` | non-finite, negative |
| Cadence | revolution per minute | `RevolutionsPerMinute` | `revolutionsPerMinute()` | non-finite, negative |
| Heart rate | beat per minute | `BeatsPerMinute` | `beatsPerMinute()` | non-finite, negative |
| Altitude | metre, **signed** | `AltitudeMetres` | `altitudeMetres()` | non-finite |
| Temperature | degree Celsius | `DegreesCelsius` | `degreesCelsius()` | non-finite, below absolute zero |
| Mass | kilogram | `Kilograms` | `kilograms()` | non-finite, zero or negative |
| Latitude | decimal degree, WGS 84, north positive | `DegreesLatitude` | `degreesLatitude()` | non-finite, outside ±90 |
| Longitude | decimal degree, WGS 84, east positive | `DegreesLongitude` | `degreesLongitude()` | non-finite, outside ±180 |
| Position | the two above, as named fields | `GeographicPosition` | `geographicPosition()` | nothing — it takes already-labelled coordinates, so a transposition is a **compile** error and the range checks already ran |
| Duration | second | `Seconds` | `seconds()` | non-finite, negative |
| Instant | second since the Unix epoch | `UnixSeconds` | `unixSeconds()` | non-finite |

Presentation-only, never stored or transmitted: `KilometresPerHour` (`kilometresPerHour()`).

### Three of those choices are worth reading twice

**Altitude is signed and is not a `Metres`.** About a hundred million people live below sea level and
the Dead Sea shore is around -430 m, so the non-negative guard that is correct for a distance is a
data-loss bug for an altitude. The separate type is also what stops an altitude being summed into a
distance.

**Latitude and longitude are different types.** It costs a little ceremony at every construction
site and it buys the one geographic bug that is easiest to write and hardest to see. A swapped pair
stays inside the valid range whenever both values are under 90 degrees — which is most of Europe —
so no range check finds it. `GeographicPosition` uses named fields rather than a tuple for the same
reason: GeoJSON orders a position `[longitude, latitude]` and nearly everything else orders it the
other way.

**An instant is a number of seconds, not a `Date`.** `Date` is mutable, carries an implicit local
time zone in half its methods, and is exactly the platform-flavoured type this package must not
spread.

### Validation is definitional, not plausible

A constructor rejects values that are **not the quantity at all**: `NaN`, a negative distance, a
temperature below absolute zero, a latitude of 91. It does not reject values that are merely
unlikely. A heart rate of 260 bpm is a strap fault rather than a decoding fault, and telling those
apart needs the neighbouring samples that analysis (#75–#78) has and a constructor does not. A
plausibility check placed here would silently drop real data from the one athlete who is an outlier.

Everything rejected throws `UnitError`, and the message names the field and the reason.

## Unit safety is a compile error

`Quantity<Unit>` intersects `number` with a phantom property keyed on a `unique symbol` that is
never exported, so nothing outside this package can produce a quantity except through a constructor
— which is also where validation lives, making "has a unit" and "has been checked" the same
statement.

```ts
import { metresPerSecond, metresPerSecondToKilometresPerHour, metres } from '@onyourleft/domain';

metresPerSecondToKilometresPerHour(metresPerSecond(10)); // 36
metresPerSecondToKilometresPerHour(10);                  // compile error: not a MetresPerSecond
metresPerSecondToKilometresPerHour(metres(10));          // compile error: metres are not a speed
```

The type erases completely: a `Metres` at runtime is a plain `number`, with no wrapper and no
allocation, which matters on the hot path of a 1 Hz record loop. It is assignable **to** `number`,
so `Math.abs(distance)` and `a < b` work unchanged; arithmetic widens back to `number`, and the way
back in is the constructor, which re-validates.

`src/unit-safety.test.ts` asserts the compile failures with `@ts-expect-error`. That is not
decoration: an unused `@ts-expect-error` is itself a TypeScript error, so if a wrong-unit call ever
starts to compile, `pnpm run typecheck` fails and CI fails with it. A runtime test could not make
that assertion — by the time a test runs the brand has erased and the wrong-unit call would happily
return a wrong number.

A cast still defeats it. This is a guard against mistakes, not against a determined author.

## The conversions, and the bug each one prevents

### FIT semicircles — `position.ts`

`degrees = semicircles × 180 / 2³¹`, over the full `sint32` range.

The sign is carried by the two's-complement integer itself, so an implementation that reaches for
`Math.abs`, or that reads the field as `uint32`, produces a coordinate that is still a valid
coordinate: +45.5 comes back as -45.5 or as 214.7, and the first puts a French ride in the Southern
Ocean. Every test uses a negative latitude and a negative longitude for that reason.

**Round-trip precision: better than 1×10⁻⁷ degrees**, about 1.1 cm. The true worst case is half a
semicircle, 4.19×10⁻⁸ degrees or about 4.7 mm — two orders of magnitude below the best civilian GNSS
fix, so the encoding is lossless for every purpose this program has.

A longitude of exactly +180° scales to 2³¹, one past the largest `sint32`, and is **clamped** to
2³¹−1 rather than wrapped: wrapping would send a point on the antimeridian to −180°, the same place
on the globe but with a sign flip that turns a track crossing the line into one crossing the whole
map. The clamp costs about 9 mm.

**A raw `sint32` is not a coordinate until it is labelled.** `latitudeSemicircles()` and
`longitudeSemicircles()` are the only way in, and they return distinct branded types
(`LatitudeSemicircles`, `LongitudeSemicircles`) that every function here consumes and produces. So
`semicirclesToPosition(longitude, latitude)` is a **compile** error, not a runtime one — which
matters because a runtime range check cannot see a transposition when both values are under 90°, and
that is most of Europe. London is 51.5074 N, 0.1278 W; transposed it is a valid position in Kenya.

⚠️ **The one transposition no type can catch — read this before writing a decode loop.** Applying
the *wrong label* at the field read — `latitudeSemicircles(positionLongField)` — declares that field
to be a latitude and this package believes you. A FIT record message carries `position_lat` and
`position_long` one field apart, both `sint32`, so #30 and #31 must call the labelling functions **at
the field read**, where the field name is visible next to the label and a reviewer can check them
against each other. Nothing downstream re-labels, so that single line is the whole trust boundary.

### The FIT epoch — `time.ts`

FIT's `date_time` counts seconds from **1989-12-31T00:00:00Z**, 631 065 600 s after the Unix epoch.
Treating one as the other dates a 2026 ride to 2006 — a date that sorts, formats and charts
perfectly well.

An instant **before** that epoch is **rejected**, not wrapped. A negative `date_time` written into an
unsigned field reappears as a date sixty years in the future, which is plausible enough to store and
impossible to detect afterwards. The range check runs before the round-to-nearest-second, so an
instant a fraction of a second before the epoch is rejected rather than rounded onto it.

FIT reserves `date_time` values below `0x10000000` for **system time** — seconds since power-on, from
a device with no clock. That threshold lands in mid-1998, below every real outdoor ride. This package
does not reject them, because 0 is a legitimate `date_time` meaning the epoch itself; it exposes
`isFitSystemTime()` and the FIT codec (#30, #31) is expected to branch on it.

### Event-time counters — `time.ts`

CSCS and CPS report the time of the last wheel or crank event as a **`uint16` that wraps**.
`unsignedCounterDelta()` is the primitive; `eventTimeIntervalSeconds()` is the event-time form.

**The tick rate is an argument, never a constant.** The CSCS wheel and crank event times and the CPS
*crank* event time are 1/1024 s (`EVENT_TICKS_PER_SECOND_1024`); the CPS **wheel** event time, one
field away in the same packet, is 1/2048 s (`EVENT_TICKS_PER_SECOND_2048`). Hard-coding either
halves or doubles the result.

**A wrap is not distinguishable from a very long interval, and it cannot be made so.** The counter
carries the elapsed time only modulo 65 536 ticks — 64 s at 1024 Hz, 32 s at 2048 Hz. Within one
period the modulus recovers the interval exactly, rollover included. Beyond it, an interval of 636
ticks and one of 66 172 ticks produce byte-identical readings: the sensor did not transmit the
difference, so no arithmetic can recover it. A test asserts exactly this, so the limitation is
pinned rather than assumed.

**What a consumer must do** (#41, #42): record the wall-clock time at which each notification
arrived and call `eventTimeIntervalIsAmbiguous(elapsedRealSeconds, ticksPerSecond)` before trusting
an interval. When it is ambiguous, drop the sample and restart the accumulator rather than emitting a
cadence — a sensor idle for longer than a period is a stopped bike, and "no reading" is the honest
output. `eventTimeAmbiguityHorizonSeconds()` publishes the horizon. This package cannot measure
elapsed real time itself: a clock is a platform API and it has none.

### FIT altitude — `altitude.ts`

`metres = raw / 5 − 500`, a `uint16`. Dropping the offset puts every point 500 m too high, which
looks like a plausible mountain profile; dropping the scale multiplies total ascent by five, and
total ascent is a number nobody checks against anything. The all-ones value `0xFFFF` is FIT's
"no value" marker and is **rejected by name** — decoded arithmetically it is 12 606.8 m, high but not
absurd enough to notice in an averaged elevation profile.

### FTMS speed — `speed.ts`

FTMS Indoor Bike Data carries speed as a `uint16` in units of **0.01 km/h**.
`hundredthsKilometresPerHourToMetresPerSecond()` undoes both the scaling and the unit in one place.

## Not decided here

**The vertical datum of an altitude.** Whether `AltitudeMetres` is above the WGS 84 ellipsoid or
above a geoid model is a separate decision, and the two differ by up to about 50 m worldwide and
around 45 m in western Europe. Every Phase 1 source is a device-reported figure whose datum the
device does not state. Consumers must not assume one, and must not mix a barometric altitude with a
GNSS one without recording which is which. Settling it needs a geoid model — data rather than code —
and belongs to the elevation work.

**Torque.** CPS accumulated torque (1/32 N·m) has no canonical type here yet, because torque is not
one of the quantities #25 was asked to fix and #42 owns the characteristic. Add it there, or in the
issue that first needs it.

## Layout

| File | Holds |
|---|---|
| `quantity.ts` | the `Quantity<Unit>` nominal-typing mechanism |
| `quantities.ts` | every canonical type and its validating constructor |
| `unit-error.ts` | `UnitError` and the shared guards |
| `speed.ts` | m/s ↔ km/h, and the FTMS 0.01 km/h scaling |
| `position.ts` | the FIT semicircle encoding |
| `altitude.ts` | the FIT altitude scale and offset |
| `time.ts` | the FIT epoch, and wrapping event-time counters |
| `index.ts` | the public surface; consumers import from here and never from a file inside |

Tests sit beside their module and import from `./index`, so a function that exists but is not
exported from the barrel — which is a function no consumer can call — fails its own test.

## Commands

```bash
pnpm --filter @onyourleft/domain run test        # run once; never `vitest` on its own
pnpm --filter @onyourleft/domain run typecheck   # also the gate for the compile-failure tests
```
