# ADR 0077: The AI pacer's line may name a cadence or power target — superseding in part ADR 0072 D-4.2 and R-4

- **Status**: **Accepted**, 2026-11-17, by the owner, who answered *"Yes"* to the recommendation
  put on [#2762](https://github.com/openzigs/onyourleft/pull/2762): *"allow cadence and power
  numbers only"*
- **Date**: 2026-11-17
- **Deciders**: **the owner**, who ruled which numbers a line may carry. **The author** decided what
  that left open, marked *the author's choice* where it is made
- **Issue**: [#2760](https://github.com/openzigs/onyourleft/issues/2760), built in its pull request
  [#2762](https://github.com/openzigs/onyourleft/pull/2762)
- **Number**: **0077**. On 2026-11-17 `main` gives 0075 as the next free number; **0075 is taken by
  [#2670](https://github.com/openzigs/onyourleft/issues/2670)** (the ride-controls fade) and
  **0076 by [#2767](https://github.com/openzigs/onyourleft/pull/2767)** (AI bots' bodies), both in
  open pull requests. 0070 stays claimed by #2684, and 0057 and 0058 by #1748 and #1752. The next
  free number is then **0078**
- **Supersedes, in part**: [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md)
  **D-4.2**'s *"no digit of any script"* and the same words in its **R-4** (D-10, D-11). It is a new
  ADR because it reverses part of an accepted decision, and [ADR 0013](0013-adr-amendments.md) D-3
  sends a reversed decision to a new ADR. ADR 0072 gains one dated `## Amendments` entry pointing
  here; its body is not edited
- **Leaves standing**: the rest of ADR 0072 — the 80 characters, one line, no markup, no metric
  trademark, no medical wording, the invisible characters removed and NFKC before the rules are
  read (D-4.1, D-4.2), a failing line voiding the whole answer (D-4.2, R-5), the line never kept
  (D-4.4), no power field in the answer (D-3), and the trainer guarantee (D-6)

## Context

ADR 0072 D-4.2 refused any digit in the pacer's line, so no figure the pacer could be read as asking
the rider to hold and no coordinate could be shown. #2760 then gave the model the rider's own
cadence, power and heart rate to coach from. Coaching without a number reads vaguely ("a quicker
spin"), and #2762 put the question to the owner, recommending cadence and power figures only.

### What the owner ruled

The owner answered *"Yes"* to the recommendation, and ruled in a
[comment on #2762](https://github.com/openzigs/onyourleft/pull/2762#issuecomment-6948468037):

> **Owner ruling, 2026-11-17, on R-4 (numbers in the pacer's line):** "Yes". This allows cadence and
> power digits only, as the PR recommended. Every other digit stays refused, heart rate included.

*Context, not the owner's words*: the recommendation was *"allow cadence and power numbers only"*,
with "aim for 90 rpm", "hold around 200 watts" and "try 3 W/kg" as its examples. "Every other
digit" is read here as heart rate, time, distance, speed, zones and percentages.

## Decision

### D-1 — A figure is admitted only as a plausible cadence or power target

`@onyourleft/domain` §`pacerSayProblem`, still the one screen on the instance and on the device:

1. **A number is admitted only when its unit follows it at once**, with one space allowed: `rpm`,
   `watt` or `watts`, `W`, or `W/kg` (in any case). The number is ASCII digits after NFKC, so a
   full-width `９０ rpm` reads as `90 rpm` and a digit of another script is still refused. No sign,
   thousands separator, range or letter may touch the number, and no letter, digit or slash may
   follow the unit (`200 wattage`, `200 W2` and `200-250 watts` are refused). A sign is any dash
   (`\p{Pd}`) or mathematical symbol (`\p{Sm}`), so `−200 watts` and `±200 watts` are refused as
   well as `-200 watts`. A decimal point may not touch the number either, except as W/kg's one
   decimal place (D-1.2).
2. **The value must be plausible**, inclusive: cadence **30 to 150 rpm** and power **30 to 2 000 W**,
   in whole numbers; **0.5 to 10 W/kg**, with at most one decimal place (*the author's choice*: one
   place is all a target needs, and it keeps a long decimal out). No leading zero. An implausible
   value is refused as a number.
3. **Every other digit voids the answer, as before**: a heart rate, a time, a distance, a speed, a
   zone, a percentage (whose `%` is also markup), or a number with any other unit or none. A
   Unicode number form (`\p{Nl}`, and the Roman numerals U+2160 to U+2188) is refused as a number,
   read before NFKC, which would turn `Ⅳ` into letters; so is a bare Roman numeral in ASCII letters
   after the word "zone" (`zone IV`).
4. The slash in `W/kg` is admitted only inside an admitted figure; anywhere else it is markup, as
   before.
5. **A figure is admitted only in a cadence or power sentence.** A line that carries an admitted
   figure and also names a heart rate, `bpm`, a pulse, a minute, second or hour, a `km`, mile or
   metre (meter), a zone, or `%` (in any case, after NFKC) is refused as a number: `Heart rate
   150 W` is not a power target. A line with no figure may still say "easy for a minute".

A coordinate still cannot be shown: no admitted form reads as one (a latitude would need a value
above 10 W/kg, or a decimal power or cadence), and the input still holds none (ADR 0072 D-3.4).

### D-2 — The prompt is `pacer-3`

The model is told it may give a cadence target in rpm or a power target in watts or W/kg, from the
player's own readings, in digits with the unit straight after (with the three examples above),
and never any other number, in digits or in words. `PACER_PROMPT_VERSION` is `pacer-3`.

### D-3 — A device and an instance on either side of this change

**Deploy the instance first.** This change ships in the same pull request as #2760's new input
fields, so:

- **An instance from before it, a device after it**: the instance refuses a state carrying #2760's
  new fields as `validation_failed` (ADR 0072's amendment for #2760), and the ride's asks end
  (ADR 0072 D-7). This is the order to avoid.
- **An instance after it, a device from before it**: the device screens the line again under ADR
  0072's rule, so a line with a figure voids the answer (R-5) and the pacer keeps the decision in
  force. Nothing wrong is shown; an older app only loses the lines that carry a figure, until it is
  updated.
- **A figure line carried back in `recentLines` to an instance from before it** (an instance rolled
  back mid-ride) is refused as `validation_failed`, which ends the ride's asks (ADR 0072 D-7).

## Consequences

- **Coaching can say what to aim for** ("aim for 90 rpm") from the rider's own reading, which is the
  point of #2760.
- **A figure is now something the rider can be asked to hold.** It is text, on the HUD for 8 s or
  spoken with announcements on; it never reaches the trainer (D-6 and its tests are unmodified), and
  the bounds keep it to what a rider could ride.
- **The screen cannot check that a figure fits the rider**, only that it is plausible for some rider:
  "hold 400 watts" passes for a rider riding 150. The prompt asks for targets from the rider's own
  readings; the screen is the outer bound, not a fit.
- **Heart-rate guidance stays words only**, so ADR 0072's "never as a health matter" is not weakened
  by a heart-rate number.

### What would make this ADR wrong

A line that names a figure the screen admits but that reads as something other than a cadence or
power target, seen on a ride or in a measurement. Then the fix is a tighter rule in D-1, with that
line as its test.
