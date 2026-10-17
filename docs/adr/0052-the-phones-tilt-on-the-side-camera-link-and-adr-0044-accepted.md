# ADR 0052: The phone's tilt on the side-camera link, widening ADR 0033 D-3, and ADR 0044 accepted

- **Status**: Accepted, on the owner's rulings of 2026-10-03 and 2026-10-04 quoted in Context. Every
  point those rulings leave open is marked **the author's choice** where it is made, and each takes
  the narrower option. **Nothing is built by this ADR**: the message is added by
  [#1064](https://github.com/openzigs/onyourleft/issues/1064), the capture work
- **Date**: 2026-10-16
- **Deciders**: **the owner**, on the phone sending its own tilt with the pictures (ruling 2 of
  2026-10-03), on approving ADR 0044's wording (2026-10-04), and on *"One small ADR for both"*
  (2026-10-04). **The author**, on what the message carries in detail, its channel, its rate, its
  bounds and what the tablet does with a bad one (D-2 to D-4)
- **Issue**: [#1122](https://github.com/openzigs/onyourleft/issues/1122). Parent epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055). Relates to
  [#1059](https://github.com/openzigs/onyourleft/issues/1059) (ADR 0045) and
  [#1064](https://github.com/openzigs/onyourleft/issues/1064) (the capture, which builds the message)
- **Number**: **0052**, the next free number in
  [`docs/agents/conventions.md`](../agents/conventions.md) §7 on 2026-10-16, checked against the
  ownership table in [`docs/architecture.md`](../architecture.md) and against every open pull
  request's files: none adds an ADR above 0051
- **Supersedes**: [ADR 0033](0033-side-camera-link.md) **D-3**'s phone-to-tablet list, **in its
  closing words only**, *"and nothing else"*: the list gains one row (D-1). Every other row of D-3,
  its tablet-to-phone list, its never-sent list, its join rule and its channels stand. ADR 0033
  gains an appended amendment pointing here ([ADR 0013](0013-adr-amendments.md))
- **Records**: the owner's acceptance of [ADR 0044](0044-side-camera-live-view-and-snapshot.md)
  (D-5). Its body, Status line included, is not edited; it gains an appended amendment pointing here
- **Discharges**: [ADR 0045](0045-fit-from-one-side-camera.md) **D-0 item 4** and **D-0's trunk
  precondition** (D-6). ADR 0045 gains an appended amendment saying so
- **Relates to**: [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-8 (untrusted input),
  [ADR 0033](0033-side-camera-link.md) D-4, D-10 and D-11,
  [ADR 0050](0050-side-camera-pictures-to-the-riders-instance-sealed.md)

---

## Context

### What the owner ruled, quoted so it is not argued again

**2026-10-03**, ruling 2 in the owner's comment on #1055 and #1059, quoted in ADR 0045 §Context:

> **Trunk angle (#1059, #1064):** the phone sends its own tilt from its motion sensor with the
> frames, and the tablet corrects for it. This adds a phone-side change. File it with the capture
> work once spike 0021 settles the transport.

**2026-10-04**, on #1058: *"go ahead and do 1058 now I approve the wording"*. ADR 0044 merged that
day ([#1113](https://github.com/openzigs/onyourleft/pull/1113)) with its Status *Proposed*.

**2026-10-04**, asked about the tilt message on ADR 0033 D-3's list together with ADR 0044's
acceptance, quoted in ADR 0045 §"The owner's rulings of 2026-10-04": *"One small ADR for both"*.
The owner's ruling on #1122 asks it to record ADR 0044's acceptance *"in the way ADR 0013 allows, or
in this new ADR if a Status line cannot change by amendment"*.

### Why this is an ADR and not two amendments

- **The tilt changes what a reader should do.** ADR 0033 D-3 says what the phone may send *"and
  nothing else"*, and its D-4 ends a pairing on anything it does not list. A new message is a new
  decision, and ADR 0013 D-3 sends a decision to an ADR.
- **A Status line cannot change by amendment.** ADR 0013 D-2: *"The `Status` field is part of the
  body, so an amendment does not change it."* So ADR 0044's acceptance is recorded here, and its
  amendment points here.

### What ADR 0045 already decided about the tilt

ADR 0045 D-4, approved by the owner on 2026-10-04, decides what the tablet does with the tilt and
what it may contain: *"one unit direction, the gravity vector **projected into the picture's own
axes**, keyed by the picture's sequence number, and nothing else. No raw sensor stream, no
orientation beyond that direction, no time of day, no position."* It left the widening of ADR 0033
D-3 to an accepted ADR, and the wire format to the transport. This ADR does the first and fixes
what the second must respect, without waiting for spike 0021
([#1057](https://github.com/openzigs/onyourleft/issues/1057)), which is still open.

## Decision

### D-1 — ADR 0033 D-3's phone-to-tablet list gains one row, and only one

| Message | Why it exists |
|---|---|
| **Tilt** | The direction of gravity in the picture, so that the tablet can measure the trunk against horizontal (ADR 0045 D-3, D-4). One per picture at most, keyed by that picture's sequence number. Sent only while filming |

With that row, the list again closes with *"and nothing else"*. Nothing else on the list changes,
and **D-3's never-sent list stands in full**: the tilt is not a reading from the ride, not a
position (it says which way is down, and nothing about where the phone is), not a time and not a
picture.

### D-2 — What a tilt message carries

Exactly three things:

1. **The sequence number of the picture it describes**, the same number that picture carries on
   ADR 0033 D-3's picture row. On a video track (ADR 0044 D-2 branch B), it is whatever identifies
   the analysed picture there, and it is subject to the same join rule: **never an arrival time, a
   wall-clock time or an offset into the ride**. Which identifier that is belongs to the amendment
   that records spike 0021's outcome.
2. **`x` and `y`, the gravity direction projected into the picture's own axes**: the plane of the
   picture as it is encoded and sent, `x` to the right and `y` downward, normalised to unit length
   on the phone. A phone standing upright and level, with the picture the right way up, sends
   about `(0, 1)`.
3. **Each component rounded to three decimal places**, which is about 0.06° and well inside ADR
   0045 D-4's 2° steadiness bound. ⚠️ **The rounding is the author's choice**: it removes digits
   the trunk does not need and that would only make the stream a finer record of how the phone
   moves.

And **nothing else**: no out-of-plane component, no raw accelerometer, gyroscope or magnetometer
reading, no compass heading, no rotation matrix or quaternion, no sensor timestamp, no device model,
no picture and no location.

**When the phone sends none.** If gravity's component in the picture's plane is less than half its
full magnitude (the phone is pointing well up or down), or the phone cannot read its motion sensor,
it sends no tilt for that picture. A missing tilt is what ADR 0045 D-4 already handles: more than a
fifth missing, and the trunk is not measured. ⚠️ **The half is the author's choice**: below it, a
small wobble moves the projected direction by many degrees.

### D-3 — Channel and rate

- **On `control`**, reliable and ordered (ADR 0033 D-3), on either branch of ADR 0044 D-2.
  ⚠️ **The author's choice**: a tilt is tiny, a lost one costs a trunk measurement, and on branch B
  `frames` may carry nothing at all. The picture it is keyed to may arrive before or after it,
  because `frames` is unordered; the tablet matches them by sequence number.
- **At most one tilt per picture sent**, so never faster than the picture rate, and **only while
  filming**: none before `start`, none after `stop`, none during pairing.
- **The tablet holds tilts in memory for the session only**, beside the pose numbers they serve, and
  keeps none once the fit check is computed. The fit check records **whether** the gravity
  reference was used (ADR 0045 D-12), never the directions themselves.
- **The tilt goes no further than the tablet.** It is not sent to the rider's computer (ADR 0033
  D-11) or to the rider's instance (ADR 0050), and no model is shown it. ⚠️ **The author's
  choice**, the narrower option: neither path computes a trunk angle.

### D-4 — A bad tilt is untrusted input and ends the pairing

ADR 0029 D-8 makes everything from the phone untrusted, and ADR 0033 D-4 ends a pairing on what D-3
does not list. A tilt message the tablet receives is **`broken`, and ends the pairing**, if:

- either component is not a finite number, or lies outside −1 to 1;
- its length differs from 1 by more than 0.01 (rounding to three places moves it by less than
  0.002);
- a second tilt arrives for a sequence number that already has one;
- it arrives before the phone has reported, in this pairing, that it is filming, or before the
  phone is proved (ADR 0033 D-4, unchanged).

A tilt that arrives after the tablet sent `stop` is **dropped, not refused**: the phone may have
sent it before the `stop` reached it, and a genuine pairing must not end on that crossing.

A tilt can set nothing on the tablet but the trunk's reference. It reaches no trainer, no command,
no URL, no path and no screen, and no text built from it names its values. ⚠️ **Ending the pairing
rather than dropping the message is the author's choice**, made because it is what this link
already does with every other malformed message, and an honest phone never sends one.

### D-5 — ADR 0044 is accepted

**ADR 0044 is Accepted, on the owner's approval of its wording on 2026-10-04**, quoted in Context,
and on the owner's ruling of the same day that this ADR records it. Its Status line still reads
*Proposed*, because an amendment cannot change it (ADR 0013 D-2); a reader takes its Status from
here, and its appended amendment says so.

What acceptance does **not** settle: **ADR 0044 D-2 stays conditional on spike 0021**, as its own
Status says, in the same way ADR 0033 was accepted with its D-1 conditional on #532. The spike's
outcome is still recorded by an amendment there. Nothing in ADR 0044's body changes.

### D-6 — ADR 0045 D-0: item 4 and the trunk precondition are discharged

- **D-0 item 4** (*"ADR 0044 is accepted"*) **holds**, by D-5.
- **D-0's trunk precondition** (*"blocked until an accepted ADR widens ADR 0033 D-3's
  phone-to-tablet list … to admit the phone's tilt message"*) **holds**, by D-1.

**What this does not do.** D-0 items 1 to 3, the measured rate, the fixtures and the run-time
refusal, still stand, so no fit check ships yet. Until #1064 builds the message and the tablet
reads it, there is no tilt to measure against, and every fit check still reports the trunk as
*"not measured"* with its reason (ADR 0045 D-4, D-6). ADR 0045 D-4's 2° and one-fifth rules are
unchanged.

## Consequences

### What this enables

- #1064 can add the tilt message on both ends of the link without an implementation issue widening
  an ADR's list, which ADR 0045 D-0 said it could not do.
- ADR 0045's trunk angle has a reference it may use once it is built, and ADR 0045 D-0 no longer
  waits on a Status line.

### What this costs, stated plainly

- **One more message the phone may send**, and one more thing the tablet must parse and refuse.
  The bounds in D-4 are that parser's specification.
- **Builds either side of the change cannot fully pair.** A tablet from before #1064 does not
  recognise a tilt and ends the pairing as `broken` the first time a newer phone films (ADR 0033
  D-4's rule working as written). A newer tablet with an older phone gets no tilt and reports the
  trunk as not measured. Whether to bump the pairing code's prefix so that a mismatched pair is
  refused at the scan is the owner's call, as ADR 0033's 2026-10-05 amendment left it.
- **A record of how the phone moves.** A stream of directions says how the phone stood and wobbled
  during a session. It is kept in memory only, goes no further than the tablet, and is rounded
  (D-2, D-3), which is as far as it can be narrowed while still serving the trunk.

### Constraints this places on other work

| Issue | What it must do |
|---|---|
| [#1064](https://github.com/openzigs/onyourleft/issues/1064) | Build the message on the phone and its parser on the tablet to D-2 to D-4, with a test for every refusal in D-4, and key the tilt to the picture by sequence number only |
| [#1060](https://github.com/openzigs/onyourleft/issues/1060) | Whether the privacy policy and Play Data Safety name the tilt (ADR 0045 D-4), true at the merge that sends the first one (ADR 0033 D-10) |
| [#1057](https://github.com/openzigs/onyourleft/issues/1057) (spike 0021) | If it picks a video track, the amendment that records it names the tilt's key on that branch (D-2 item 1) |

## What would make this ADR wrong

- **If the tilt turns out to need more than one direction** — for example the out-of-plane
  component to correct for a phone leaning toward the rider — then D-2's *"nothing else"* is too
  narrow, and widening it is a new decision, not an amendment.
- **If a phone's motion sensor proves too noisy on a tripod** for ADR 0045 D-4's 2° bound to pass,
  the trunk stays not measured, and this message carries nothing anyone uses. That is a reason to
  remove it, by a superseding ADR.
