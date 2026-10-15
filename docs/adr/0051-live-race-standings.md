# ADR 0051: Live race standings — every racer listed with the room's time gap and live W/kg, superseding ADR 0028 D-7.7

- **Status**: Accepted, on the owner's ruling of 2026-10-14 quoted in Context. **The patent half is a
  risk the owner accepted, not a finding** — see D-6
- **Date**: 2026-10-14
- **Deciders**: **the owner**, on showing a ranked list of racers during a race, after being told that
  it reverses ADR 0028 D-7.7 and ADR 0007 D4's ranked-leaderboard line and that spike 0005 §5
  Question B was never put to counsel. **The author**, on everything the ruling left open: which gap,
  group rides, the wire format, what a dropped rider's line shows, the layout and the screen reader's
  path (D-2 to D-5, D-7)
- **Issue**: [#1347](https://github.com/openzigs/onyourleft/issues/1347). Parent
  [#16](https://github.com/openzigs/onyourleft/issues/16). Relates to
  [#785](https://github.com/openzigs/onyourleft/issues/785) (the race and its result, which stay as
  built) and [#787](https://github.com/openzigs/onyourleft/issues/787) (drafting, whose room setting
  and draft percentage ride on the same protocol version, D-4)
- **Number**: **0051**, the next free number in
  [`docs/agents/conventions.md`](../agents/conventions.md) §7 on 2026-10-14, checked against the
  ownership table in [`docs/architecture.md`](../architecture.md) and against every open pull
  request's files
- **Supersedes**: [ADR 0028](0028-racing-fairness.md) **D-7.7** — *"Deliberate care with live
  standings … a dynamically updating ranked list during it is spike 0005 §5 Question B and is not
  decided"* — and, for live racers only, [ADR 0007](0007-patent-posture.md) **D4's second ❌**, the
  ranked leaderboard (D-6 says exactly how far). Each gains an appended amendment in the same pull
  request ([ADR 0013](0013-adr-amendments.md)). No other decision of either is touched
- **Rests on**: [spike 0005](../spikes/0005-live-racing-patent-read.md) §5 Question B, which is
  **not answered** — the owner accepts its risk (D-6)
- **Relates to**: [ADR 0028](0028-racing-fairness.md) D-2, D-3, D-7.2 and its 2026-09-22 publication
  rule; [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-4 (1 Hz fan-out);
  [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md)

---

## Context

### What the owner ruled, quoted so it is not argued again

2026-10-14, on [#785](https://github.com/openzigs/onyourleft/issues/785) and filed as #1347:

> *"for racing it should show a list of people that are racing. It should include how far back each
> person is in time and show real time w/kg"*

The ruling was given **after** the owner was told three things: that it reverses ADR 0028 D-7.7; that
it reverses ADR 0007 D4's ❌ on a ranked leaderboard; and that spike 0005 §5 Question B — whether
live standings read on the *ranked list* limitation of US 10,486,026 claim 1, US 10,639,521 claim 1
and US 11,081,224 claim 1 — was never put to counsel. The owner's decision of 2026-10-14 on
[#1234](https://github.com/openzigs/onyourleft/issues/1234) adds Question B to the counsel questions
due by about 2027-01-15, and accepts the risk in the meantime.

### What was there before

Since #783 a room ride's HUD said how many riders were near and the gap to **one** rider the rider
chose to follow, by seat order — *"never a list, and never an order"* (`apps/web/src/game/hud/fields.ts`
§`RoomHud`). A race's finish order existed only after the race (#785), and the frame carried no name,
no power and no mass (`@onyourleft/protocol`).

## Decision

### D-1 — A race shows every racer, in the room's order, with a time gap and live W/kg

During a race the HUD lists the field **in the room's order**: riders who have crossed the line
first, by their crossing, then everybody on the road by distance along the route, furthest first,
ties by seat. Each line carries the rider's **place**, their **public name** — the room's one
projection of an athlete (`apps/instance/src/auth/public-athlete.ts`, #774), so a hidden name is
`Rider` and nothing else about them is sent — their **time gap**, and their **live W/kg**. The
rider's own line says *You* and is marked for a screen reader (`aria-current`).

- **W/kg and never watts**, per ADR 0028's 2026-09-22 rule (*power or W/kg for a rider over a window,
  never both*) and ruling Q17. *Live* is the power the room simulated the rider at on the last tick,
  over the declared mass it holds. The mass itself is never sent or shown (ADR 0028 D-3), **but it is
  not kept secret either**: every physics input except the mass is public, and every frame carries the
  rider's speed, so another racer's software can solve for the mass that makes the speed and the
  W/kg agree, and the room-core test `standings.test.ts` §"what the live W/kg gives away" does so to
  within a few kilograms. W/kg times that mass is the rider's watts. This was found in review of
  #1354; rounding the figure does not close it, and closing it means not showing a live W/kg.
- ⚠️ **The owner decided, on 2026-10-15, to keep live W/kg and disclose what it gives away**
  ([comment on #1354](https://github.com/openzigs/onyourleft/pull/1354)): *"keep live W/kg and
  disclose it. Before joining a race, riders are told plainly that others in the race can estimate
  their weight from it."* **The mechanism, stated so it is not rediscovered:** the room's physics is
  public (ADR 0028 D-1, the game's own model), every input to it but the mass is public or sent —
  the route's gradient, the riding position's drag and rolling resistance, and each rider's speed in
  every frame — and live W/kg is power over mass. Speed fixes the power the physics needs at a given
  mass; W/kg fixes power over mass; only one mass satisfies both, and W/kg times it is the watts.
  **What this supersedes:** ADR 0028 D-3's *"declared mass never shown"* no longer holds in substance
  for a **live race** (ADR 0028's amendment of 2026-10-15). The mass is still never sent or shown as a
  number, and a group ride, which carries no W/kg, is unchanged. **The disclosure:** before a rider
  makes a race, and in a race they joined before they ride in it, the room panel says *"In a race,
  everyone in it sees your watts per kilogram live, so they can work out roughly what you weigh."*
  (`apps/web/src/rooms/RoomPanel.tsx` §`RACE_WEIGHT_DISCLOSURE`, held by
  `race-weight-disclosure.test.tsx`; a group ride shows no such sentence). The panel's "what is sent"
  paragraph, the privacy policy's room row and the Data safety answer say the same rather than *never
  your weight*. All of that wording is a draft for the owner's approval. A rider the room
  is coasting (rule 1) reads *Coasting*, never a figure; a finisher reads *Finished*.
- **A plausibility flag stays visible** as ADR 0028 D-2 rule 3 requires: a flagged rider's line says
  *Flagged*, and the result after the race still carries the flag's window, as it did.
- **The finish order and the stored result are unchanged** (#785, the owner's comment of 2026-10-14:
  *"The finish order and results stay as built"*). A result is still read from the instance only
  once the room says the race is over.

### D-2 — The gap is to YOU, and the room computes it

Of the two the issue offered — to the rider in front, or to you — **the gap is to you**: "how far back
each person is" is answered for the person reading it. Positive is behind you (*+12 s*), negative
ahead (*−8 s*, a minus sign), nought on your own line.

**The room computes every gap, from its own positions** (`apps/instance/src/room/core/room.ts`
§`timeGapTicks`). It keeps each racer's distance after every tick, and the gap from a rider in front
to a rider behind is how long ago the one in front was where the one behind is now, interpolated
inside the tick. Two finishers are apart by their crossings. Because the gap is to the recipient, each
rider is sent their own standings; the client puts the room's numbers into words and computes no gap
of its own.

### D-3 — Not in a group ride

A group ride has **no list**, and its room sends no names and no standings. ADR 0028 D-7.2 is *"nobody
leading a session"*, and a group ride is a ride together, not a race: ordering it would make one rider
its leader. It keeps #783's count and one chosen gap. The owner's ruling names racing only.

### D-4 — On the wire: protocol version 2

Two room → client messages, both **race-only** (`packages/protocol/src/messages.ts`):

- `name { riderId, displayName }` — once a seat: the whole field to a rider as they are welcomed and
  on every rejoin, and a newcomer's name to everybody already there. One message a rider, because a
  hundred names of 32 scalars do not fit one message of `MAXIMUM_MESSAGE_BYTES`. The decoder holds a
  name to `checkDisplayName`'s rule, so a hostile room cannot reverse the list with an override.
- `standings { tick, riders: [[riderId, gapDeciseconds, wattsPerKilogramTenths, flags]] }` — after
  every frame of a running race. `flags` is the frame's two and `FLAG_FINISHED`.

`PROTOCOL_VERSION` is **2**. A version-1 build is refused `protocol-mismatch` at its hello and told to
update, rather than seated in a race it cannot list. [#787](https://github.com/openzigs/onyourleft/issues/787)'s
room setting for drafting and its live draft percentage **may share version 2** if no release carries
version 2 before it lands; once one does, #787 is version 3.

### D-5 — A dropped rider, and a lost room

- **A rider who drops** keeps their line, coasting (*Coasting*), for the room's rejoin window — the
  room keeps their seat and their place on the road for that long. Past it the room records them as
  not finishing and the line goes.
- **When this rider's connection to the room is lost**, the list is taken off the HUD and the existing
  *"The room's connection was lost"* notice says why: a gap that has stopped moving is a gap that is
  wrong. Back in, the list returns with the room's next standings, never the old ones.

### D-6 — The patent risk, as accepted

Spike 0005 §5 Question B is **unanswered**. The design keeps every other element ADR 0028 D-7 lists
absent — no exercise class and no course content served from an instance (D-7.1), no instructor
(D-7.2), no synchronising signal (D-7.3), **no archived performance in a race** (D-7.4: no ghost ever
enters a room), no threshold-derived zone leaderboard and nothing overlaid on a broadcast (D-7.5), no
team win condition (D-7.6). What this ADR adds is the one element D-7.7 held back: a dynamically
updating ranked list during a live race. The owner accepted that risk on 2026-10-14 and put Question B
to counsel, bundled with ADR 0007's Open Question 1, by about 2027-01-15 (#1234).

⚠️ **How far ADR 0007 D4 is moved.** D4's second ❌ reads *"A ranked leaderboard populated by ghost
participants replaying prior sessions"*. These standings contain **no ghost**, so on its own words the
❌ is not engaged; the issue asks for it to be superseded so that nobody reads it as barring a live
ranked list. It is superseded **for a ranked list of live racers in a race, and for nothing else**: a
leaderboard of ghosts replaying prior sessions stays refused in full, and ADR 0007 D5 stays the
procedure for that ❌ and every other. **Nothing here is a finding that the risk changed.**

### D-7 — Where it is drawn, and how a screen reader gets it

- **On a tablet** (the corners layout at 47 rem tall or more: 1280×800, 1024×768, 800×1280) the
  standings are a panel of their own at the end edge, under the secondary readings, at most seven
  lines — the rider's own and three either side, each keeping its place number — and a summary line,
  *"You are 4 of 12."* `apps/web/browser/ride.browser.spec.ts` §"#1347" holds the panel whole, over no
  other panel and clear of the leaning rider's box at all three, with anchor positioning and without,
  and its control moves the panel to the middle of the stage and finds it over the rider.
- **On a phone** the panel is visually hidden, by clip: a phone's corners are taken, and the middle of
  its stage is the rider. ⚠️ **A racer on a phone sees no list**, and keeps *Follow* and its one gap;
  recorded as #419 asks rather than discovered.
- **A screen reader gets the standings on request**: the panel is a labelled section (*Race
  standings*) that is **not a live region**, so a screen-reader user reaches it when they ask, and the
  HUD's one announcer never reads it — a list that changes every second, spoken, would drown every
  other sentence the HUD has to say.

## Consequences

### What this enables

A race shows who is racing, how far each is behind or ahead in seconds, and the power-to-weight each is
putting out now — the owner's ruling — from numbers the room is authoritative for.

### What this costs

- **The patent risk of D-6**, accepted and not bought down.
- **Bytes**: one standings message a rider a second in a race. The largest legal one is 2 955 bytes
  for a hundred riders (`packages/protocol/src/frame-size.test.ts`), under the 3 682 of the largest
  frame, so a race's fan-out is at most about 1.8 times a group ride's, and permessage-deflate applies
  as before.
- **CPU and memory in the room**: a distance a tick a racer (8 bytes; under 60 KiB a racer for two
  hours) and, each tick, a binary search for every pair — 10 000 searches for a hundred racers, small
  beside the physics.
- **Every client must update**: version 1 is refused (D-4).
- **The privacy policy's room row and the Data safety answer** say that, in a race, the other riders
  see your name, your power-to-weight every second and how far ahead or behind them you are, and that
  from it and your speed they can work out roughly what you weigh. Drafted for the owner in the same
  pull request.
- **A racer's weight is not private from the other racers** (D-1, the owner's decision of
  2026-10-15). A rider who does not want that has the group ride, which carries no W/kg.

### Constraints this places on other work

| Issue | What binds it |
|---|---|
| [#787](https://github.com/openzigs/onyourleft/issues/787) | D-4: shares version 2 only if no release carries version 2 first |
| [#1234](https://github.com/openzigs/onyourleft/issues/1234) | D-6: Question B is a counsel question due by about 2027-01-15 |
| Any public race ([#907](https://github.com/openzigs/onyourleft/issues/907)) | D-1: names are the public projection only; a public room changes who sees them, which is its own disclosure |

## What would make this ADR wrong

- **Counsel answers Question B yes** — that live standings read on the ranked-list limitation with the
  rest of the claim absent is not a distance worth relying on. Then D-1's list is the change to undo,
  and ADR 0028 D-7.7's finish-order-only line is the fallback, which #785 still builds.
- **A gap that riders read as wrong.** The time gap is the room's, from positions it re-simulates; a
  rider whose own screen is corrected toward the room may briefly see their own place differ from where
  they are drawn. If owner rides find that confusing, the window of seven or the gap's definition is the
  thing to revisit, not where the numbers come from.
