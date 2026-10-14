# ADR 0051: Live standings during a race — every rider, the room's time gap to you, and live W/kg, superseding ADR 0028 D-7.7 and ADR 0007 D4's ranked-leaderboard line for a live race

- **Status**: Accepted, on the owner's ruling of 2026-10-14 quoted in Context. **The patent half is a
  risk the owner accepted, not a finding** — see the box below and D-1
- **Date**: 2026-10-14
- **Deciders**: **the owner**, on showing a list during a race and on accepting the patent risk of
  [spike 0005](../spikes/0005-live-racing-patent-read.md) §5 Question B, which was never put to
  counsel. **The author**, on D-2 to D-8: the gap's definition and sign, what a row shows, the group
  ride, the wire format and the layout. Every rider-facing sentence is draft wording for the owner's
  approval in the pull request that lands this ADR
- **Issue**: [#1347](https://github.com/openzigs/onyourleft/issues/1347). Part of
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Number**: **0051**, the next free number in [`docs/architecture.md`](../architecture.md) on
  2026-10-14; no open issue or pull request named it
- **Supersedes**, for a **live race** and nothing else:
  - [ADR 0028](0028-racing-fairness.md) **D-7.7** — *"A dynamically updating ranked list during it is
    spike 0005 §5 Question B and is not decided"*. It is decided here.
  - The owner's ruling **Q8** of 2026-09-28, as quoted in [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md)
    Context: *"no live standings list, only the gap to one chosen rider and the finish order
    afterwards"*.
  - [ADR 0007](0007-patent-posture.md) **D4's second ❌**, *"A ranked leaderboard populated by ghost
    participants replaying prior sessions"*, to the extent it is read as reaching a ranked list of
    **live** riders. Its ghost half is untouched: no ghost ever enters a room (ADR 0028 D-7.4), so a
    room's standings cannot be populated by one, and a ranked list of ghosts stays ❌.

  ADR 0028 and ADR 0007 each gain an appended amendment in the same pull request
  ([ADR 0013](0013-adr-amendments.md)). Neither body is edited
- **Leaves standing, by name**: [ADR 0021](0021-racing-another-riders-ghost.md) **D-6** — no ranked
  list on a **ghost** ride, which this ADR does not reach; ADR 0028 D-1 to D-6 and D-7.1 to D-7.6;
  ADR 0007 D5 as the procedure for any other ❌
- **Rests on**: [spike 0005](../spikes/0005-live-racing-patent-read.md) §4 and §5 Question B
- **Relates to**: [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-4 (frames at 1 Hz),
  [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) (drafting, #787, which bumps the
  protocol again), [#774](https://github.com/openzigs/onyourleft/issues/774) (the public projection),
  [#1234](https://github.com/openzigs/onyourleft/issues/1234) (the counsel questions due about
  2027-01-15)

> ## ⚠️ The patent half of this is a risk decision, not a finding
>
> Spike 0005 §5 Question B asks whether *"a 'finish order', or live standings during a race, read on
> the ranked list limitation of US 10,486,026 claim 1, US 10,639,521 claim 1 or US 11,081,224 claim
> 1, if the archived limitation is assumed absent"*. **Nobody has answered it.** Nothing in this ADR
> establishes that live standings are outside anybody's claims. The owner has accepted the risk, as
> recorded in D-1, and Question B joins the questions for counsel due by about 2027-01-15.

---

## Context

### What the owner ruled, quoted so it is not argued again

The owner, 2026-10-14, on [#1347](https://github.com/openzigs/onyourleft/issues/1347):

> for racing it should show a list of people that are racing. It should include how far back each
> person is in time and show real time w/kg

The ruling was given **after** the owner was told that it reverses ADR 0028 D-7.7 (no ranked list
during a race), ADR 0007 D4's ❌ on a ranked leaderboard, and that spike 0005 §5 Question B was never
put to counsel. #1347's body records that sequence.

### What was in place

- **The HUD on a room ride** (#783) carried a count of nearby riders and the gap to ONE rider the
  rider chose, *"never a list, and never an order"*, citing ADR 0021 D-6, ADR 0028 D-7.7 and ruling
  Q8.
- **The wire format** (`@onyourleft/protocol`, version 1) carried, per rider, distance, speed, draft
  share and flags — no name, no gap and no power-to-weight. A seat was shown as *Rider N*, which
  `game/room-ride.ts` called *"a seat and not a person"*, because no room message carried a name.
- **The room** (`apps/instance` §`room/core/room.ts`) knew each rider's declared mass and the power
  it simulated them at, and published a mean W/kg only in the race's **result** (#785, ruling Q17).

### The three ways a "gap" could be defined

| Definition | What a row says | Against it |
|---|---|---|
| **A — to you** | how far up the road, or back, that rider is from where you are | per recipient: a frame is no longer the same for every rider |
| B — to the rider in front of that row | the split between consecutive riders, as a TV graphic shows it | a rider adds several rows to know their own distance to anyone |
| C — to the leader | how far each rider is behind the first | the leader's row says nothing; your own gap to the rider beside you is a subtraction |

And two ways of measuring one:

| Measure | What it is | Against it |
|---|---|---|
| **Time behind a track** | how long ago the rider in front was where the rider behind is now | the room keeps each seat's track |
| Distance over speed | the distance between them, divided by somebody's current speed | not a time anybody rode; it swings with every surge and is undefined at 0 m/s |

---

## Decision

### D-1 — Live standings are shown during a race, and the patent risk is the owner's to accept

During a **race**, the game shows everyone in it, in order along the route. ADR 0028 D-7.7 and ruling
Q8 are superseded for a race, and ADR 0007 D4's second ❌ is superseded for a ranked list of live
riders, on the owner's ruling alone. **ADR 0007 D5 step 1 is not met**: no claim has expired, been
held unpatentable, been abandoned or been licensed. This records the owner exercising the authority
D5 step 3 reserves to them, as [ADR 0039](0039-racing-another-riders-ghost-on-consent.md) did for the
ghost half. **Spike 0005 §5 Question B is added to the counsel questions due by about 2027-01-15
([#1234](https://github.com/openzigs/onyourleft/issues/1234))**, bundled with Question A and ADR 0007's
Open Question 1 as spike 0005 already directs. If counsel's answer says the standings read on a claim,
this ADR is wrong and a superseding one removes them.

What keeps the **other** limitations of '026, '521 and '224 absent is unchanged and is not touched by
this ADR: no archived exercise class, no instructor, no content with a synchronising signal (ADR 0028
D-7.1 to D-7.3), and no archived performance parameters in a race (D-7.4).

### D-2 — What a row shows

1. **The rider's public name**: the instance's ONE public projection of the athlete
   (`apps/instance` §`auth/public-athlete.ts`, #774) — the rider-chosen, unverified display name ADR
   0028 D-6.5 says is shown, or the hidden-name word (*Rider*) a moderator's hide puts in its place.
   Never *Rider N*, and nothing else about the athlete.
2. **Their place**, 1 for the rider furthest along.
3. **Their time gap to you** (D-3), as `+12 s` behind you and `−5 s` ahead, minutes past a minute
   (`+1:05`), and *1 h or more* at the wire's bound. Your own row says **You** and is bold.
4. **Their live W/kg** — the power the room simulated them at over its last tick, over the mass they
   declared — to one decimal. **Never watts**: ADR 0028's 2026-09-22 rule (power OR W/kg, never both
   beside a name) and ruling Q17. There is no field anywhere in the wire format for watts beside a
   rider.
5. **Flags**: a rider the room's plausibility rule flagged says *Flagged* on their row, as the result
   page flags them after the race (#785).

### D-3 — The gap is to you, in time, and the room measures it

Definition A, measured as **time behind a track**: the room keeps, for each seat, the distance it put
that seat at after every tick, and the gap between two riders is **how long ago the one in front was
where the one behind is now**, interpolated within a tick. It is positive when the other rider is
behind you. Definition A because a rider reads one number per row and it is always about the same
person — where each rider is from where they are — which is what *"how far back each person is in
time"* asks; it costs a frame per recipient, which the room already sends (each carries its own
`ackSequence`). **The room is authoritative for every gap**: the client shows the room's number and
derives none from distances, so two riders never disagree about a gap between them because of their
clocks.

A track keeps an hour of ticks; a gap that would need an older entry, or is over an hour, is sent as
the bound, an hour.

### D-4 — The mass never leaves the room

The room divides; the client receives W/kg in tenths and nothing it could multiply back into watts.
Declared mass is still sent to the instance only to mint a ticket, as since #772, and to nothing
else.

### D-5 — A lost room shows no standings, and a dropped rider's row stays until the room drops it

- **The room's connection lost** (this rider's): the standings are **not shown**, and the HUD's
  existing notice says the room is lost. Numbers the room has stopped sending are not shown as though
  it were still sending them. They return with the first frame after a rejoin.
- **Another rider dropped**: the room holds their seat for its rejoin window and coasts them at 0 W
  (ADR 0028 D-2 rule 1). Their row stays, its gap still the room's, and its W/kg cell says **No
  power** — not *0.0 W/kg*, which would say they stopped pedalling, which the room cannot know. Past
  the window a race records them as not finished and they leave the frame, and so the list.

### D-6 — A group ride shows no standings

A group ride has no finish line and nobody to be ahead of: ADR 0028 D-7.2 is *"nobody leading a
session"*, and the owner's ruling is *"for racing"*. A group ride's HUD stays #783's — a count, and the
gap to one chosen rider. The frame format is the same for both (the room fills the gap and W/kg slots
in either), so this is the client's choice and a later ADR may make the other one without a protocol
change.

### D-7 — The wire format is version 2

`PROTOCOL_VERSION` becomes **2**. A frame's rider row gains two slots, `gapDeciseconds` (signed, an
hour at most either way) and `wattsPerKilogramTenths` (0 to 1 000). A new room message, `roster`,
carries `[riderId, name]` for every seat, sent to a rider when they are welcomed and to every connected
rider whenever a seat is taken or given up — names travel on a change and never in the once-a-second
frame. A name on the wire is re-checked by the decoder against `checkDisplayName`'s refusals (no
control, format or default-ignorable character, no surrounding white space, at most 64 UTF-16 units),
because it is shown to a stranger. The largest legal message is now a full roster, 20 828 bytes, so
the byte bound before parsing is 32 KiB (it was 8 KiB).

A version-1 client's hello is refused as `protocol-mismatch`, which a version-1 client already words
as *"This app and the room are different versions. Update the app to ride in it."* —
the old version is refused cleanly rather than sent rows it cannot read. #787's drafting setting and
live draft share should land in the same release so the protocol changes once more, not twice; if
they do not, #787 is version 3.

### D-8 — Where it is drawn

A panel of its own at the end edge of the HUD's middle row, under the secondary readings, at the
**tablet** viewports — where `ride.browser.spec.ts` §"#1347" holds that no HUD panel is over the
leaning rider's box. Five rows are drawn, yours and two either side; on a phone held upright, three.
**On a phone on its side the panel is not drawn**: there is no free cell (the top and bottom panels
leave under 60 px of road), and three rows were measured on the actions panel. In every case every row
stays in the document, clipped rather than removed, so a screen reader reads the whole field. The list
is **not a live region**: a screen reader reads it on request, by going to it, and the HUD's one
region never says it, so nobody hears fifty names a second.

---

## Consequences

### What this enables

- A race reads as a race: who is ahead, by how much, and how hard they are going.
- Riders are named on the HUD, from the public projection, for the first time.

### What this costs

- **The patent risk of Question B**, accepted and unanswered (D-1).
- **A frame per recipient**: the room encodes `n` frames of `n` rows each tick rather than one; at 100
  riders, 10 000 gap look-ups a second, each a binary search over an hour of one seat's track.
- **Bytes**: a 50-rider frame is 1 475 bytes, up from 1 132 (`frame-size.test.ts`), about 0.59 Mbit/s
  out of a full room before compression.
- **A phone on its side** shows no standings (D-8).
- **A declared mass is now visible as a ratio** to every rider in the race, live, where it was visible
  only as a race's mean W/kg in the result. W/kg was always shown beside a name under Q17; this makes
  it second by second.

### Constraints this places on other work

| Work | Constraint |
|---|---|
| [#787](https://github.com/openzigs/onyourleft/issues/787) | Bundle its protocol change with version 2 if both land in one release (D-7) |
| [#1234](https://github.com/openzigs/onyourleft/issues/1234) | Question B is a counsel question (D-1) |
| A ghost ride | ADR 0021 D-6 still forbids any ranked list on one |
| A group ride | No list (D-6) unless a later ADR decides otherwise |

## What would make this ADR wrong

- **Counsel answers Question B** and says live standings read on a claim's ranked-list limitation.
- A rider finds a gap that disagrees with what they see on the road, which would mean the track or its
  interpolation is wrong — `room.test.ts` §"live standings" holds both against an independent reading
  of the room's own positions.
