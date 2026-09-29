# ADR 0039: Racing another rider's ghost, on that rider's consent — the owner reverses ADR 0007 D4's first ban knowing ADR 0007 D5 step 1 is not met

- **Status**: Accepted, **on the owner's decision alone**. It is ADR 0021 D-7's **Option B**. **Nothing
  about the patents has changed**, and this ADR must not be cited as though it had. **Nothing is built
  by this ADR**, and [#331](https://github.com/openzigs/onyourleft/issues/331) stays blocked on
  [#793](https://github.com/openzigs/onyourleft/issues/793) and
  [#776](https://github.com/openzigs/onyourleft/issues/776) — see D-4
- **Date**: 2026-09-29
- **Deciders**: **the owner**, in ruling 4 of the
  [comment on #16 of 2026-09-28](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5879636643):
  *"#331 is unblocked for rides the owner explicitly shared for racing: consent, trimmed of privacy
  zones. This needs a superseding ADR to ADR 0021 and ADR 0007 D4 that accepts the patent risk
  (spike 0005)."* This is the decision [ADR 0007](0007-patent-posture.md) D5 step 3 reserves to the
  owner and that [ADR 0021](0021-racing-another-riders-ghost.md) D-7 put to them. **The author**
  decided only the pairing of each constraint with the code a reviewer reads (D-3), and wrote the
  wording
- **Issue**: [#765](https://github.com/openzigs/onyourleft/issues/765), in bundle
  [#825](https://github.com/openzigs/onyourleft/issues/825). Unblocks, in a stated order,
  [#331](https://github.com/openzigs/onyourleft/issues/331)
- **Number**: **0039**, reserved with 0036, 0037 and 0038 in the same pull request — see
  [ADR 0036](0036-a-self-hostable-instance-server-now.md)'s Number line
- **Supersedes**, and **nothing else**:
  - [ADR 0007](0007-patent-posture.md) **D4's first ❌** — *"A ghost of another rider. Not behind a
    setting, not opt-in, not in a later phase."* — **for rides their owner explicitly consented to
    being raced**, under D-2 and D-3 below.
  - [ADR 0021](0021-racing-another-riders-ghost.md) **D-1** — *"ADR 0007 D4's ❌ on another rider's
    ghost is **not** relaxed. Nothing here moves it"*.

  ⚠️ **Not superseded, by name**: ADR 0007 **D4's second ❌** (*"A ranked leaderboard populated by
  ghost participants replaying prior sessions"*), which stands **untouched**; ADR 0007 **D5**, which
  stays the procedure for every other ❌; ADR 0021 **D-4**, **D-5** and **D-6**, which **bind** from
  today; and [ADR 0028](0028-racing-fairness.md) **D-7.4**, which keeps every ghost out of a live
  room. ADR 0007 and ADR 0021 each gain an appended amendment in the same pull request
  ([ADR 0013](0013-adr-amendments.md))
- **Rests on**: [ADR 0021](0021-racing-another-riders-ghost.md), in full, and
  [spike 0005](../spikes/0005-live-racing-patent-read.md), whose limits it inherits

> ## ⚠️ This is not legal advice, not a freedom-to-operate opinion, and not a finding that a risk went away
>
> ADR 0007 D1, spike 0005 and ADR 0021 each say it. This document repeats it for a sharper reason: it
> **lifts** a ban, and a lifted ban reads like clearance. It is not. The owner has decided to accept a
> risk that ADR 0021 described as *"materially larger than #488 Q6's"*. Nothing about the risk changed.

---

## Context

### The procedure, and which of its steps is met

ADR 0007 D5 says the ❌ items move only when **all three** of these happen, **in that order**:

> 1. **A fact changes.** The relevant claims expire …, or are held unpatentable in a decision that is
>    final and unappealable, or the rights are abandoned or licensed to us. …
> 2. **A new ADR supersedes this one**, citing the changed fact with its source and date. …
> 3. **The repository owner decides**, on the record, in the successor ADR's Deciders line. …

| D5 step | State on 2026-09-29 |
|---|---|
| **1. A fact changes** | ⚠️ **NOT met.** No claim in the Peloton family has expired, been held unpatentable in a final decision, been abandoned or been licensed to us. ADR 0007's Open Question 1, the IPR2020-01541 certificate for '026, is **still unread** |
| **2. A superseding ADR** | This one — **without** the changed fact step 2 asks it to cite, because there is none |
| **3. The owner decides, on the record** | **Met**: ruling 4, quoted in the Deciders line |

**So this ADR does not satisfy D5, and says so.** ADR 0021 D-7 posed the question in exactly these
terms — *"Should ADR 0007 D4's ❌ on a ghost of another rider be reversed, **knowing that D5 step 1
is not met**?"* — and Option B is the answer "yes" to that question. The owner has the authority to
give it: D5 step 3 says the line in D4 is the owner's and that *"an implementer, a reviewer and an
agent may not relax it"*, so the owner can. What this ADR must not do is let a later reader believe
step 1 happened.

### What Option B costs, in ADR 0021's words, verbatim

ADR 0021 D-7's table, Option B's cost column:

> ⚠️ The owner accepts a risk that is **materially larger than #488 Q6's**, because two claim elements
> are *met* rather than none, and D5 step 1 — the one condition that is about the world rather than
> about us — is **not satisfied**. #488 Q6's answer does **not** cover this and must not be read as
> covering it

And the ruling that accepts it names the risk it accepts: *"that accepts the patent risk (spike
0005)"*. **This is a second, separate risk decision from #488 Q6**, not an extension of it — ADR 0021
said it could not be one, and the owner made it separately.

### What ADR 0021 already found, and which of it still stands

All of it. ADR 0021 D-2's chart stands: a replayed cross-rider ghost **meets** '026's *"archived
performance data … previously generated by the other users"* and **fails** the *archived exercise
class* element and the *ranked list* element. ADR 0021 D-3's six gaps stand: the claim text was read
at one remove, no pending application was read, no non-US right was read, Open Question 1 is unread,
the *class* limitation is carrying the distance, and nobody qualified has looked. **This ADR adds no
reading.** It changes what the project does with the reading that exists.

---

## Decision

### D-1 — ADR 0007 D4's first ❌ is reversed, on consent, and nothing else in D4 moves

A rider may race a ghost of **another** rider's recorded attempt on the same route **only** when that
rider **explicitly consented** to that ride being raced, and **only** under D-2 and D-3.

- **D4's second ❌ is untouched**: no ranked leaderboard populated by ghost participants, ever. Nothing
  here relaxes it and nothing may be read as relaxing it.
- **D4's two ✅ are untouched**: the bot pacer (#92) and the rider's own ghost (#93).
- **D5 stands** as the procedure for D4's second ❌ and for any future ❌.

### D-2 — The privacy half binds first, and in a stated order (ADR 0021 D-5, restated as binding)

1. **Consent is its own record, not the share setting** (ADR 0021 D-5.1): a per-ride *"may be raced"*
   flag, **off by default**, **revocable**, and separate from whether the ride is shared.
2. **A ghost whose privacy-zone trim touches the raced route is not offered at all** (ADR 0021 D-5.2).
   A partial ghost is worse than none, on the `apps/web/src/routes/share.ts` §`RouteShare.usable`
   precedent.
3. **Two tests, built in order** (ADR 0021 D-5.3). The **consent-scoped** store test — the read takes
   the consent flag, and a fake in `packages/store/src/testing/fakes.ts` that ignores the flag must go
   **red** — is built and proved to fail **first**, by [#793](https://github.com/openzigs/onyourleft/issues/793).
   Only after it has merged may [#331](https://github.com/openzigs/onyourleft/issues/331) touch
   `packages/store/src/activity-store.ghost-scope.test.ts`, the patent control. **Never in the same
   pull request.** One change doing both is how a control disappears in review.
4. **A ghost is not a signed record and is not evidence** (ADR 0021 D-5.4). Nothing about it is
   exported or posted.
5. **The other rider's attempt reaches this device only through the instance**, and only because its
   owner set the consent ([#776](https://github.com/openzigs/onyourleft/issues/776), two-way sync).
   ⚠️ **This is narrower than ADR 0021 D-4.6, and the narrowing is the author's choice.** D-4.6 asks
   only that the data arrive *"through the other rider's own act"*, which a file the other rider sent
   by hand would also satisfy. Version 1 admits one path, the instance, because it is the only one
   where the consent flag is read by a query (#793) rather than inferred from how a file arrived.
   Admitting a second path — a file, say — is a new decision that must say where its consent is
   recorded, not a reading of D-4.6.

### D-3 — ADR 0021 D-4's seven constraints, binding, each with where a reviewer checks it

ADR 0021 wrote these as *"conditions on a permission that does not exist"*. The permission exists now,
so they are conditions on it. ⚠️ **None is checked by a machine** (ADR 0007's *"Which of D1–D7 a
machine checks: none of them"* applies). The right-hand column is where a reviewer of #331 looks, and
the question they ask.

| # | Constraint (ADR 0021 D-4) | Where a reviewer checks it in #331 |
|---|---|---|
| **D-4.1** | **One ghost at a time, never a plurality.** '224 claim 18 recites *"a plurality of ghost riders"* | `apps/web/src/game/ghost-source.ts` — the selection returns **one** attempt (today `fastestAttempt` returns `AttemptSummary \| undefined`), and `apps/web/src/game/simulation.ts` holds one ghost track. A list, an array of ghosts or a second ghost marker in the scene is the finding |
| **D-4.2** | **No ranked list, no ordering, no position, at any time during the ride** (ADR 0021 D-6) | `apps/web/src/game/hud/fields.ts` §`hudReadings` and §`gapReadings` — the ghost's reading stays **a distance and a direction word for one other participant**. A new HUD field that orders participants is the finding |
| **D-4.3** | **No class, no instructor, no course content served from anywhere** | The route raced is one the rider imported or saved (`apps/web/src/routes/`). Any list of "featured" or "suggested" ghosts or routes served by the instance is the finding; this is the element carrying the distance (ADR 0021 D-3.5) |
| **D-4.4** | **No synchronising signal**, because there is no content | `packages/domain/src/ghost/replay.ts` stays a replay of recorded distance against recorded time. Nothing embeds a timing signal in anything the instance sends |
| **D-4.5** | **Nothing is synchronised into a live session** | See D-4 below. No room module in `apps/instance` or `packages/protocol` accepts, stores or relays a ghost; [#784](https://github.com/openzigs/onyourleft/issues/784) and [#785](https://github.com/openzigs/onyourleft/issues/785) carry no ghost |
| **D-4.6** | **The ghost's data reaches this device through the other rider's own act** | D-2.1 and D-2.5: the consent flag, read by #793's store query, and the sync path of #776. A ghost sourced from the share setting is the finding |
| **D-4.7** | **No leaderboard of ghost participants** — D4's second ❌, untouched | No screen, export or instance endpoint lists ghost attempts in any order. [#68](https://github.com/openzigs/onyourleft/issues/68)'s leaderboard of **stored efforts with times** is unaffected, as D4 already says |

### D-4 — A cross-rider ghost is never placed in a live room

**ADR 0021 D-4.5 and [ADR 0028](0028-racing-fairness.md) D-7.4 both stand**, and the second is
*"doubly binding"* in its own words: *"No archived or previously recorded performance parameters in a
race. This is also ADR 0007 D4's ❌"*. The ❌ this ADR reverses is D4's ghost line **as a local
replay**. It is **not** reversed for a live session.

- **So this ADR cannot be read as permitting a ghost in [#784](https://github.com/openzigs/onyourleft/issues/784)
  (the group ride) or [#785](https://github.com/openzigs/onyourleft/issues/785) (the race).** A ghost
  is a replay the rider's own client drives, alone.
- A room that placed a recorded ride beside live riders would break ADR 0028 D-7.4, which this ADR
  does not touch, and would need its own superseding ADR and its own owner decision.

### D-5 — The order in which #331 unblocks

1. This ADR merges.
2. [#793](https://github.com/openzigs/onyourleft/issues/793) — the consent flag, the trim refusal, and
   the consent-scoped store test proved red against its fake — merges.
3. [#776](https://github.com/openzigs/onyourleft/issues/776) — two-way sync — merges, so another
   rider's consented attempt can reach this device at all.
4. Then, and not before, [#331](https://github.com/openzigs/onyourleft/issues/331) may relax
   `activity-store.ghost-scope.test.ts` and build the feature under D-2 and D-3.

This is #16's delivery queue of 2026-09-29, where bundle B13 (#793, #331) starts after B7 (sync) and
B1 (this ADR).

---

## Consequences

### What this enables

- #331 has a permission, the conditions on it, and a reviewer's checklist in D-3.
- #793 can start at once: its privacy half does not wait on anything but this ADR.

### What this costs, stated plainly

- **A patent risk ADR 0021 called materially larger than the live-racing one, accepted with open
  eyes.** Two claim elements of '026 are met rather than none. The distance to the claim rests on the
  *archived exercise class* element and the *ranked list* element, and D-4.3 and D-4.2 are what keep
  them absent.
- **Every constraint in D-3 is review-time only.** A feature request for "race your three fastest
  friends at once" breaks D-4.1 with one array.
- **A second rider's data is on this device**, which is a privacy surface the program has not had.
  D-2 is the price, and it is paid before #331 starts.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #793 | D-2.1 to D-2.3, merged before #331 touches `ghost-scope.test.ts` |
| #776 | Carries a consented attempt only; never an attempt whose flag is off |
| #331 | D-3's seven rows; D-5's order; nothing in a room |
| #784, #785 | No ghost, of anybody, in a room (D-4) |
| #68 | Unaffected |

---

## What would make this ADR wrong

- **A later reader cites it as evidence that the risk went away.** It is not. D5 step 1 was not met on
  2026-09-29 and this ADR says so in its Status line, its Context and its Consequences.
- **A pending Peloton continuation issues with a ghost claim that drops the *archived class*
  element.** ADR 0021's reading rests on that element failing, and no pending application was read.
  The owner would decide again.
- **#331 ships with more than one ghost, an ordering, served content, or a ghost in a room.** Then
  D-3 or D-4 was written and ignored, and nothing mechanical would have noticed.
- **#331 lands before #793, or in the same pull request.** Then D-2.3's order, which is the point of
  it, was lost.
