# ADR 0021: Racing another rider's ghost — what spike 0005 changes, what it does not, and the one decision that is the owner's

- **Status**: Accepted — for **D-1 to D-6**, which are engineering and privacy decisions this document
  is entitled to take. ⚠️ **D-7 is explicitly NOT decided and is the owner's**, and it is the
  question [#330](https://github.com/openzigs/onyourleft/issues/330) was opened to have answered.
  D-1 means nothing can be built while D-7 is open, so an `Accepted` status here cannot cause code to
  be written against an unanswered question. The alternative — `Proposed` — was rejected for the
  reason [ADR 0007](0007-patent-posture.md) and [ADR 0028](0028-racing-fairness.md) both give for the
  same choice: D-1 and D-5 bind work that is already filed
  ([#331](https://github.com/openzigs/onyourleft/issues/331)), and an ADR a reader is told not to
  rely on cannot bind anything
- **Date**: 2026-09-22
- **Deciders**: **the author, on the engineering and privacy content of D-1 to D-6. ⚠️ No owner
  decision was sought or given for this ADR, and none is recorded in it.** That is the whole of why
  D-7 is a question rather than a decision: [ADR 0007](0007-patent-posture.md) **D5** step 3 says the
  ❌ line in **D4** is the owner's and that *"an implementer, a reviewer and an agent may not relax
  it"*. This document is written by an agent. ⚠️ ADR 0007 carries the note that its own reasoning
  *"was not put to the owner"*; #330's sixth acceptance criterion asks this one not to repeat that
  ambiguity, and the way it does not repeat it is by **not claiming a decision it does not have**
- **Issue**: [#330](https://github.com/openzigs/onyourleft/issues/330). Blocks
  [#331](https://github.com/openzigs/onyourleft/issues/331)
- **Number**: **0021**, the reservation [#330](https://github.com/openzigs/onyourleft/issues/330) has
  held since before [#340](https://github.com/openzigs/onyourleft/issues/340) took 0022.
  [`docs/architecture.md`](../architecture.md)'s reservation table is the check `CLAUDE.md` §7 asks
  for, and it recorded 0021 as reserved-and-unwritten on 2026-09-22. Writing it consumes the
  reservation and nothing is renumbered
- **Supersedes**: ⚠️ **nothing.** In particular it does **NOT** supersede or relax
  [ADR 0007](0007-patent-posture.md) **D4**'s ❌ on a ghost of another rider — see **D-1**, which is
  the single most important sentence in this document
- **Rests on**: [spike 0005](../spikes/0005-live-racing-patent-read.md), the live-racing patent read
  ([#466](https://github.com/openzigs/onyourleft/issues/466)), whose eleven-patent first-hand reading
  of 2026-09-22 is the evidence D-2 and D-3 are built from and whose limits D-3 inherits in full
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) (whose device performs the steps),
  [ADR 0004](0004-privacy-and-location.md) (D-5's whole subject),
  [ADR 0028](0028-racing-fairness.md) (the live race, which is a different question and says so),
  [#7](https://github.com/openzigs/onyourleft/issues/7),
  [#68](https://github.com/openzigs/onyourleft/issues/68),
  [#93](https://github.com/openzigs/onyourleft/issues/93),
  [#16](https://github.com/openzigs/onyourleft/issues/16)

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> [ADR 0007](0007-patent-posture.md) D1 says it of itself; [spike 0005](../spikes/0005-live-racing-patent-read.md)
> repeats it because it went wider; this document repeats it again because it goes **narrower and
> deeper on one claim element**, and depth reads like confidence. **No lawyer has reviewed any of
> it. No systematic landscape search was performed. No pending application was read. Anyone citing
> this ADR as clearance is misusing it.**

---

## Context

### What #330 asked for, and what this document does instead

#330 is titled *"Write ADR 0021: superseding ADR 0007 D4's ban on racing another rider's ghost"*, and
its first acceptance criterion asks for an ADR that *"explicitly **supersedes ADR 0007 D4's ghost
line** — naming it, not implying it."* **That criterion presupposes an outcome, and this document
does not deliver it.** It names D4's ghost line, it rules on every other criterion, and it leaves the
reversal itself to the owner, because [ADR 0007](0007-patent-posture.md) **D5** makes the reversal
the owner's and nobody else's. #330's own body says the same thing in its own words — *"⚠️ This
issue does not reverse that"* — so the criterion and the body disagree, and the body is the half that
matches D5.

**Manufacturing a supersession would have satisfied the criterion and broken the rule the criterion
exists to serve.** That is the failure shape this repository keeps finding in other domains: a gate
that is green because it measured the wrong thing.

### The line being examined, quoted so nobody has to go and find it

> ❌ **A ghost of another rider. Not behind a setting, not opt-in, not in a later phase.** The moment
> another person's recorded ride drives an on-screen rider, the "other users" and "archived/live
> performance parameters … used in subsequent sessions" limitations are both live, and the remaining
> distance to the claim is argument rather than construction.
>
> — [ADR 0007](0007-patent-posture.md) D4, third bullet

And the procedure for moving it, which is the thing that actually governs:

> Not "never" as a slogan. Concretely, **all three** of the following, in order:
>
> 1. **A fact changes.** The relevant claims expire …, or are held unpatentable in a decision that is
>    final and unappealable, or the rights are abandoned or licensed to us. A settlement between
>    other parties is not one of these; neither is a dismissal without prejudice.
> 2. **A new ADR supersedes this one**, citing the changed fact with its source and date. …
> 3. **The repository owner decides**, on the record, in the successor ADR's Deciders line. …
>
> — [ADR 0007](0007-patent-posture.md) D5

### What has actually happened since D4 was written

Three things, and it matters which kind each is.

| | What happened | Kind |
|---|---|---|
| **1** | [Spike 0005](../spikes/0005-live-racing-patent-read.md) read **eleven** granted US patents first-hand on 2026-09-22, where ADR 0007 read six. Five of the seven granted Peloton family members had never been read here | **New information about existing facts.** Nothing in the world changed |
| **2** | The owner decided on 2026-09-22 ([#488](https://github.com/openzigs/onyourleft/issues/488) Q6) **not** to buy a targeted claim opinion, and to proceed on spike 0005's reading — for **live racing** | **An owner decision, about a different question.** [ADR 0028](0028-racing-fairness.md)'s amendment says so in terms: *"ADR 0007 D4 is untouched … A race with a ghost in it is D4's"* |
| **3** | The owner asked for riders to be able to race a ghost of another rider (#330's opening sentence) | **An appetite, not a decision.** #330 itself calls it *"the owner's appetite"* and says that is a decision reversal ADR 0013 does not cover |

⚠️ **None of the three is D5 step 1.** D5 step 1 is a closed list — expiry, a final unappealable
holding of unpatentability, abandonment, or a licence to us — and it explicitly excludes things that
look like progress but are not (*"A settlement between other parties is not one of these"*). **A
better reading of a claim we could always have read is not on that list either**, and this document
declines to treat it as though it were. That is the finding, and everything in D-1 follows from it.

### What is different about a *replayed* ghost, and why it is not spike 0005's question

[Spike 0005](../spikes/0005-live-racing-patent-read.md) §1.1 charts a **live** race and its §1.1 note
is explicit that *"'No replay' is the load-bearing one"*:

> D4 rules on **ghosts**: an on-screen rider driven by a *recorded* ride. A live race has no recording
> behind any rider — every position on screen is being produced by somebody who is pedalling at that
> moment. **A race with a ghost in it is D4's, not this document's.**

So spike 0005 deliberately did not chart the thing #330 asks about. **D-2 is that chart**, built from
the claim text spike 0005 quoted rather than from a re-read — see D-3's provenance note, which is not
a formality.

---

## Decision

### D-1 — ADR 0007 D4's ❌ on another rider's ghost is **not** relaxed. Nothing here moves it

D5 requires **all three**, in order. Taking them one at a time against the record above:

| D5 step | State on 2026-09-22 |
|---|---|
| **1. A fact changes** | ⚠️ **NOT satisfied.** No claim in either family has expired, been held unpatentable in a final unappealable decision, been abandoned, or been licensed to us. Spike 0005 is a *reading*; [ADR 0007](0007-patent-posture.md) Open Question 1 (the IPR2020-01541 certificate for '026) is **still unread**, and spike 0005 §1.4 records two fresh failures to reach it on the same day |
| **2. A new ADR supersedes 0007** | This document could be that ADR. It is not, because step 1 is unmet and step 3 has not happened |
| **3. The owner decides, on the record** | ⚠️ **NOT satisfied.** No owner decision on a cross-rider ghost exists. The 2026-09-22 decision on #488 Q6 is about **live racing** and [ADR 0028](0028-racing-fairness.md)'s amendment says so in its own words |

**So `#331` stays blocked and nothing about it may be implemented.** Not behind a setting, not
opt-in, not in a later phase — D4's own words, unchanged.

⚠️ **What this ADR adds is not permission. It is the chart D5 says is "the thing worth buying"
before step 3**, built from the one piece of evidence that did not exist when D4 was written, plus a
privacy ruling (D-5) that stands whichever way D-7 goes.

### D-2 — What spike 0005's reading **does** establish about a replayed cross-rider ghost

D4's ❌ paragraph says that with *"other users"* and *"archived … performance parameters"* both live,
*"the remaining distance to the claim is argument rather than construction."* **On spike 0005's
fuller reading that sentence understates what remains**, and the understatement is worth writing down
precisely because D4 is the decision it is used to justify.

Charting a cross-rider ghost — one other rider's recorded attempt on a route **this** rider imported,
replayed against them, no ordering and nothing published — against the three claims that actually
recite a ghost or archived data:

| Limitation, in the claim's own words as [spike 0005](../spikes/0005-live-racing-patent-read.md) quotes it | A cross-rider ghost |
|---|---|
| *"archived performance data … **previously generated by the other users** … while participating in the archived exercise class"* ('026 cl. 1) | ⚠️ **PRESENT in its first half, ABSENT in its tail.** *Archived data previously generated by other users* is exactly what a cross-rider ghost is: this is the limitation D4 names, it is met, and it is the reason D4 exists. But the clause does not stop there — the data has to have been generated *while participating in the archived exercise class*, and there is no class. ⚠️ **Quoted in full deliberately**: an earlier draft of this row elided the tail at the ellipsis, which hid where '026's **second** independent limitation comes from and made the reading below look like an assertion rather than a reading of the clause |
| *"numerical performance parameters for a plurality of **ghost riders** … previously generated by other users"* ('224 cl. 18) | ⚠️ **PRESENT in substance**, with one qualifier: *"a plurality of"*. A single ghost is not a plurality, and **that is a distinction to note and not to rely on** — a second ghost is one product decision away and the word would then be met |
| *"a plurality of available **archived exercise classes** for selection"* ('521 cl. 1, '224 cl. 1) | **Absent by construction.** There is no class, nothing is offered for selection, and the course is a route the rider imported ([ADR 0002](0002-local-first-architecture.md)) |
| *"available archived **instructor-led** exercise classes"* ('224 cl. 1) | **Absent by construction**, twice |
| *"content … comprising video content and audio content and at least one **synchronizing signal**"* ('224 cl. 1) | **Absent by construction.** No content exists, so nothing is embedded in it |
| *"a **dynamically updating ranked list**"* ('026, '521, '224) | **Absent as designed** — and D-6 is what keeps it absent |
| '886 cl. 19's eight elements, of which three are *"maintaining them at a storage device **with the exercise content**"*, *"providing them during a **subsequent** session, where they represent ghost riders"*, and *"**maintaining at least one live performance parameter as private**"* | **Two of the three absent by construction** (there is no exercise content and nothing is stored with any), and the ghost element **present**. Spike 0005 §2 is the first-hand enumeration |

**The reading.** A replayed cross-rider ghost meets the *other users* and *archived data* elements —
D4 is right about that and always was — and it **fails the same *class* element that spike 0005 found
carries the whole distance for a live race**, plus the *ranked list* element independently. In '026
those are the **two**: the class element is not a separate limitation sitting elsewhere in claim 1,
it is the **tail of the same clause** — the archived data must have been generated *while
participating in the archived exercise class* — which is why the row above quotes the clause whole.
So the remaining distance is **two independent limitations in '026, and three or four in '224 and
'521**, not the one D4's sentence implies.

⚠️ **This is a strictly weaker statement than "it is fine", and the difference is the whole of D-3.**

### D-3 — What it does **not** establish, stated as the gap it is

Six things, and any one of them is enough to make D-1 the right call independently of D5's procedure.

1. ⚠️ **The claim text in D-2 was NOT re-read first-hand for this ADR.** The re-read was attempted on
   2026-09-22 with the command [spike 0005](../spikes/0005-live-racing-patent-read.md) §1.3 records,
   for `US11081224B2` and `US10486026B2`, and **both returned Google's "your computer or network may
   be sending automated queries" interstitial** — the exact failure that section warns is
   *"not reliable and its failure is silent-looking"*. So D-2 rests on spike 0005's quotations, which
   are first-hand and dated the **same day**. That is the best provenance available here and it is
   **one remove**, which ADR 0007 **D7** requires to be said rather than glossed.
2. **No pending application was read.** Spike 0005 §1.4 calls this *"the most important gap"* in a
   family with **seven granted US members from one 2012-07-31 priority**, and §1.4's quotation from
   '085's specification — *"a wide range of **direct competitions can be created between and among
   users**"*, read by eye from the USPTO print — is disclosure a continuation may draw on.
3. **No non-US right was read.** Not one. ADR 0007 Open Question 2 stands verbatim.
4. **ADR 0007 Open Question 1 is still unread.** The IPR2020-01541 certificate for '026 failed again
   on 2026-09-22 (404 and 403, the same two failures as 2026-09-03).
5. **The *class* limitation is doing the load-bearing work, and a limitation carrying the distance is
   not the same as several carrying it.** Spike 0005 §4's first thin margin applies here verbatim: a
   design that drifted toward serving course content from an instance erodes the one element the
   argument rests on. For a ghost this is **more** acute than for a live race, because the other two
   elements are already met.
6. **Nobody qualified has looked at any of it.** Spike 0005 §5 Question A was **not bought** and, by
   the owner's #488 Q6 decision, is not going to be — **for live racing**. Whether that decision
   extends to a *ghost*, where two claim elements are met rather than none, is D-7 and is not assumed
   here.

### D-4 — If D-7 is ever answered "yes", these are the constraints, in ADR 0007 D2's shape

Written now because it is free to write now and expensive to discover later, and written as
**conditions on a permission that does not exist**. Each is checkable by reading our own code.

1. **One ghost at a time, never a plurality.** '224 claim 18 recites *"a plurality of ghost riders"*.
   A second simultaneous cross-rider ghost meets that word; a single one does not. ⚠️ This is the
   cheapest constraint in the list and the easiest to lose to a feature request.
2. **No ranked list, no ordering, no position, at any time during the ride.** D-6.
3. **No class, no instructor, no course content served from anywhere.** The route is the rider's own
   (ADR 0002). This is the element carrying the distance (D-3.5) and it is the one to be most
   conservative about.
4. **No synchronising signal, because there is no content to embed one in.**
5. **Nothing is synchronised into a live session.** A ghost is a replay the local client drives; it
   is not a live party, and the moment a room places a ghost beside live riders it is
   [ADR 0028](0028-racing-fairness.md) D-7.4's prohibition **and** D4's ❌ at once, *"doubly
   binding"* in that ADR's own words.
6. **The ghost's data reaches this device through the other rider's own act** — D-5, which is a
   privacy rule first and happens also to be the thing that makes element 1 of '026 a **consented**
   disclosure rather than a silent one.
7. **No leaderboard of ghost participants**, which is D4's *second* ❌ and is untouched by anything
   here. [#68](https://github.com/openzigs/onyourleft/issues/68)'s leaderboard of **stored efforts
   with times** is a different thing and is unaffected, exactly as D4 already says.

### D-5 — The privacy half, decided here, and it does not wait on D-7

#330's fourth acceptance criterion asks for this to be *"answered, not deferred"*. It is separable
from the patent question — it would bind a cross-rider ghost even if every patent in the world
expired tomorrow — so it is decided now.

**D-5.1 — Sharing a ride is not consent to being raced, and the two are different records.**
`apps/web/src/detail/privacy.ts` decides what a **shared copy** of a ride contains; nothing in this
program has ever asked whether a ride may drive a marker on somebody else's screen. Those are
different questions with different harms, and a cross-rider ghost may **not** be sourced from a
ride's share setting. It needs a consent of its own, recorded on the ride, defaulting to **off**, and
revocable.

**D-5.2 — A ghost is trimmed by the source athlete's privacy zones, and the trim is a *refusal*, not
a gap.** [ADR 0004](0004-privacy-and-location.md) decisions B, C and E already trim a shared trace.
A ghost is a trace **that moves**, and a ghost that thins out near somebody's house discloses the
house — the disclosure #330 names. So the rule is not "trim the trace": it is that **an attempt whose
trimmed portion overlaps the raced route at all is not offered as a ghost**, on the
`apps/web/src/routes/share.ts` §`RouteShare.usable` precedent, where a route starting inside a
privacy zone *"cannot be shared at all"*. A partial ghost is worse than none.

**D-5.3 — What replaces `activity-store.ghost-scope.test.ts`'s double duty.** #331 is right that the
existing test does two jobs, and that relaxing it weakens both. The replacement is **two tests, not
one**, because two properties that fail for different reasons need two:

| Property | What asserts it |
|---|---|
| **No ride reaches a ghost that its owner did not consent to** — the cross-athlete exposure control under `CLAUDE.md` §6 | A store-level scoping test in the shape `activity-store.scoping.test.ts` already has: the read takes the **consent flag** as well as the route, a fake that answers the query while ignoring the flag is added to `packages/store/src/testing/fakes.ts`, and the round trip against it must go **red** |
| **No ride reaches a ghost at all, while D-7 is unanswered** — the patent control | The **existing** `ghost-scope.test.ts`, unchanged and unrelaxed. ⚠️ It is not touched by this ADR and must not be touched by #331 until D-7 is answered "yes" |

⚠️ **The order matters and is the point**: the replacement for the privacy half is built and proved
to fail **before** the patent half is relaxed, never in the same change. One change doing both is how
a control disappears in review.

**D-5.4 — A ghost is not a signed record and must not be treated as evidence.** A replayed attempt is
the source athlete's data on this device; [ADR 0019](0019-signed-records-in-an-export.md) governs how
a signed record travels and a ghost is not one of its shapes. Nothing about a ghost is exported, and
a ghost is not an attempt this athlete can post anywhere.

### D-6 — No ranked list, and what enforces it

#330's third acceptance criterion. **No ordering, no position, no list, at any moment while a ride is
running**, and nothing published or exported.

**What enforces it is not a grep.** ADR 0007's own §*"Which of D1–D7 a machine checks: none of them"*
applies here verbatim, and pretending otherwise would be the worse answer. What is available is
narrower and real:

- The HUD's readings are enumerated in one place — `apps/web/src/game/hud/fields.ts` §`hudReadings` —
  and the gap against a ghost is already `gapReading`: **a distance and a direction word, for one
  other participant.** A ranked list is a different *shape*, not a different value, so it cannot
  arrive as a tweak to an existing reading; it needs a new component and a new field, which is
  visible in a diff.
- [ADR 0028](0028-racing-fairness.md) D-7.7 already decides the neighbouring case for a live race —
  a finish order **after** is decided, a dynamically updating ranked list **during** is not — so a
  future author meets the same rule from two directions.
- **A reviewer noticing is the mechanism**, and the question to ask of any ghost or racing diff is
  the one this section exists to supply: *does anything on screen order participants while the ride
  is running?*

### D-7 — ⚠️ The decision, which is the owner's, written as a question

**Should ADR 0007 D4's ❌ on a ghost of another rider be reversed, knowing that D5 step 1 is not
met?**

The question is not *"is it safe"* — nobody in this loop can answer that. It is **which of three
postures the owner wants**, and each has a consequence that is stated rather than implied.

| Option | What it means | What it costs |
|---|---|---|
| **A — D4 stands.** The default, and what is in force today | #331 stays blocked indefinitely. The own-ride ghost (#93) and the synthetic bot (#92) are unaffected and keep working | The feature the owner asked for is not built. ⚠️ **This is the status quo and needs no decision at all** — it is what happens if D-7 is never answered |
| **B — D4 is reversed on this record**, by a successor ADR to this one that carries the owner's decision in its Deciders line | #331 becomes buildable under **D-4**'s seven constraints and **D-5**'s privacy rules, both of which bind whatever else happens | ⚠️ The owner accepts a risk that is **materially larger than #488 Q6's**, because two claim elements are *met* rather than none, and D5 step 1 — the one condition that is about the world rather than about us — is **not satisfied**. #488 Q6's answer does **not** cover this and must not be read as covering it |
| **C — D4 stands until counsel answers a question that is bought** | The purchase is [spike 0005](../spikes/0005-live-racing-patent-read.md) §5 **Question A**, extended: does a **replayed** ghost of another rider, unranked and on the rider's own route, read on '026 claim 1 or '224 claim 18 — literally, and under the doctrine of equivalents — given that the *archived class* element is absent by construction? ⚠️ **Question B belongs in the same purchase**, because D-6's ranked-list rule is the second of the two elements the answer turns on | Money, and time. It is the same purchase #488 Q6 declined for live racing, on a question where the answer would change what gets built rather than merely bless it |

**What this document recommends, as a recommendation and not a decision: C, and A in the meantime.**
The reason is D-3.5 and D-2 together — for a live race the *class* element is one of several
independent failures, and for a ghost it is carrying the distance **with two elements already met**,
which is precisely the configuration where an engineer's reading is worth least and a lawyer's is
worth most. ⚠️ **If the owner prefers B, that is a legitimate call with open eyes** and it is exactly
what ADR 0007 D5 step 3 reserves to them; what it may **not** be is arrived at by an agent, a
reviewer or an acceptance criterion.

---

## Consequences

### What this enables

- **#331 has a document to point at**, and a list of constraints (D-4) and privacy rules (D-5) that
  are settled before anyone writes a line. If D-7 is ever answered "yes", the work starts from a
  design rather than from a blank page.
- **The privacy half is decided independently of the patent half** (D-5), so the answer to D-7 does
  not also have to be an answer about consent and privacy zones. Those were the two questions #330
  bundled, and unbundling them is most of this document's value.
- **The chart ADR 0007 D5 calls *"the thing worth buying"* before step 3 now exists** in D-2, in a
  form a lawyer can be handed alongside a short description of the design.

### What this costs

- **The feature the owner asked for is not delivered and is not scheduled.** That is the honest
  outcome and this document does not dress it up.
- **#330's first acceptance criterion is not met as written**, and the pull request that lands this
  says so rather than ticking it. See Context §"What #330 asked for".
- ⚠️ **A reader in a hurry will take D-2 as encouragement.** D-3 is the counterweight and is
  deliberately longer.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#331](https://github.com/openzigs/onyourleft/issues/331) | **Blocked**, by D-1. When and if it unblocks, D-4 and D-5 bind it entirely |
| [#93](https://github.com/openzigs/onyourleft/issues/93) | Unaffected. The own-ride ghost is ADR 0007 D4's second ✅ and nothing here touches it. ⚠️ `packages/store/src/activity-store.ghost-scope.test.ts` stays exactly as it is |
| [#68](https://github.com/openzigs/onyourleft/issues/68) | Unaffected. A leaderboard of **stored efforts with times** is not a ghost participant, as D4 already says |
| [#16](https://github.com/openzigs/onyourleft/issues/16), [#465](https://github.com/openzigs/onyourleft/issues/465) | Unaffected. Live racing is [ADR 0028](0028-racing-fairness.md)'s and replays nothing. ⚠️ **A race with a ghost in it is this document's and is still blocked** |
| [#7](https://github.com/openzigs/onyourleft/issues/7) | A cross-rider ghost needs another athlete's ride to arrive on this device, which needs a server. So D-7 being answered "yes" would still leave #331 blocked on #7 |

### Who performs the steps, which #330 asks about and which matters

'026 claim 1 is a **system** claim. [ADR 0002](0002-local-first-architecture.md)'s deployment unit is
designed to be somebody else's: a self-hosted instance a rider runs for themselves is a different
posture from a service this project operates. ⚠️ **This document does not rest on that distinction
and #331 must not either.** Divided infringement and who "receives" and "synchronises" archived data
is exactly the kind of question an engineer gets wrong, and the honest position is that the
distinction is **recorded as potentially relevant and not relied on** — which is the same posture
ADR 0007 takes toward its own claim readings.

---

## What would make this ADR wrong

- **The owner answers D-7.** Then a successor ADR carries the answer and this one is superseded on
  its face. That is not this document failing; it is the mechanism working.
- **The IPR2020-01541 certificate turns out to have cancelled '026's independent claims.** D-1 would
  **not** change on its own — D5 step 1 would then be satisfied for '026, and steps 2 and 3 would
  still be required, and '224 and '886 were never challenged — but D-2's chart would lose a row and
  D-7's option C would get cheaper.
- **A pending Peloton continuation issues with a ghost claim that drops the *archived class*
  element.** D-2's reading is built on that element failing, and D-3.2 records that no pending
  application was read. This is the single most likely way D-2 becomes wrong.
- **Somebody reads D-2 as clearance.** It is a chart of three claims, made by an agent, from
  quotations taken at one remove, on one day.
- **#331 ships a cross-rider ghost without D-7 being answered.** Then D-1 was written and ignored,
  which is `CLAUDE.md` §4j's failure shape in a domain no gate reaches. ⚠️ **Nothing mechanical
  checks any decision in this ADR**, D-6 included, and a reviewer noticing is the entire mechanism.
