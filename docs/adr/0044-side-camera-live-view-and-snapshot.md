# ADR 0044: A live view and a pressed snapshot on the side-camera path, superseding ADR 0033 D-6

- **Status**: Proposed. It records the owner's rulings of 2026-10-03 and the owner's answers of
  2026-10-04 to the seven questions the first draft left open (§"What the owner answered on
  2026-10-04"). **The owner approved the wording on 2026-10-04**: *"go ahead and do 1058 now I
  approve the wording"*. Where an answer left a detail open, the narrower reading is marked *the
  author's choice* at the place, and §"What the owner has not decided" says none remain. ⚠️ **D-2
  is conditional on spike 0021
  ([#1057](https://github.com/openzigs/onyourleft/issues/1057))**, which has not been run. D-2
  decides what follows from each of its outcomes, so the spike needs only an appended amendment
  here saying which one happened ([ADR 0013](0013-adr-amendments.md))
- **Date**: 2026-10-04
- **Deciders**: **the owner, on every product question**, in the epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055) and in comments on it and on
  [#1058](https://github.com/openzigs/onyourleft/issues/1058), all dated 2026-10-03 and quoted in
  Context, and in the owner's answers of **2026-10-04** to this ADR's seven questions, recorded in
  D-3, D-6, D-8, D-11 and D-12. **The author decided the engineering content**
- **Issue**: [#1058](https://github.com/openzigs/onyourleft/issues/1058), parent epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055). It blocks
  [#1060](https://github.com/openzigs/onyourleft/issues/1060),
  [#1061](https://github.com/openzigs/onyourleft/issues/1061),
  [#1062](https://github.com/openzigs/onyourleft/issues/1062),
  [#1063](https://github.com/openzigs/onyourleft/issues/1063) and
  [#1064](https://github.com/openzigs/onyourleft/issues/1064)
- **Number**: **0044**, reserved by the epic. On `main` on 2026-10-04,
  [`docs/architecture.md`](../architecture.md) said *"The next free number is 0044"*, and no open
  pull request adds an ADR above 0043. **0045 is reserved for
  [#1059](https://github.com/openzigs/onyourleft/issues/1059)** (fit from one side camera), and this
  pull request records both in the reservation table, as the epic asks of whichever lands first
- **Supersedes**, each **only on the side-camera path**:
  - [ADR 0033](0033-side-camera-link.md) **D-6**, by D-1 below, in the two places the owner's
    rulings reverse it: *"No picture is ever displayed on the tablet"* and *"never stored"* (for a
    pressed snapshot only), and its row *"Pose numbers never reach the HUD, the ride screen"* as
    far as the outline is concerned. What of D-6 still stands is listed in D-1.
  - [ADR 0033](0033-side-camera-link.md) **D-3**, in two places only: its **join rule**, for a
    snapshot and nothing else (D-3 below), and **reason 3**'s display clause (D-2 below). Reason 3
    as a whole, and D-3's picture row, are superseded only if spike 0021 picks a video track.
  - [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-2**, on this path, for one still the
    rider presses for. [ADR 0033](0033-side-camera-link.md)'s 2026-09-25 supersession of D-2's
    per-ride keep is **not** reversed: there is still no keep switch on this path.
  - The owner's #527 ruling *"Preview on the tablet: None"*, quoted in ADR 0033 §Context.
- **Does NOT supersede**: [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-5, D-8, D-9, D-10
  or D-11, each of which binds the new surfaces unchanged and is applied in D-4 to D-7 below.
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md) in any part. ADR 0033 D-7 and D-8. Absolute
  sagittal angles are [ADR 0045](https://github.com/openzigs/onyourleft/issues/1059)'s to decide,
  and not this ADR's
- **Relates to**: [ADR 0004](0004-privacy-and-location.md),
  [ADR 0013](0013-adr-amendments.md), [ADR 0024](0024-offline-and-caching-posture.md),
  [ADR 0035](0035-model-written-ride-write-ups.md),
  [spike 0010](../spikes/0010-on-device-pose-model-cost.md),
  [spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md),
  [#554](https://github.com/openzigs/onyourleft/issues/554),
  [#1112](https://github.com/openzigs/onyourleft/issues/1112)

---

## Context

### What the owner ruled, quoted so it is not argued again

From the epic [#1055](https://github.com/openzigs/onyourleft/issues/1055), *"The owner's rulings
of 2026-10-03"*, the rulings this ADR records:

| # | Ruling |
|---|---|
| 1 | A live view **during setup and during the ride** |
| 2 | It shows the **camera picture with the pose outline** drawn on it |
| 4 | **The rider can save a snapshot** |
| 5 | These reverse the earlier "Preview: None" ruling |

Ruling 3, *"Add FIT now"*, is [ADR 0045](https://github.com/openzigs/onyourleft/issues/1059)'s.

From the owner's comment on #1058 and #1055, 2026-10-03, ruling 3:

> **Snapshot and ride (#1058, #1063):** a snapshot is tied to the ride it was taken in. It shows on
> that ride's page and is deleted with the ride and by the account erase. ADR 0044 records this as
> a departure from ADR 0033 D-3's no-join rule for snapshots only.

And from the same comment, two rulings this ADR **cross-references and does not decide**:

> **FDA general-wellness condition 6 (#1059):** accept the risk, framed. Show absolute sagittal fit
> angles, each marked as a rough estimate from one camera and not a professional fit, on the ADR
> 0035 precedent. ADR 0045 records the acceptance and lists the questions for counsel.
>
> **Trunk angle (#1059, #1064):** the phone sends its own tilt from its motion sensor with the
> frames, and the tablet corrects for it. This adds a phone-side change. File it with the capture
> work once spike 0021 settles the transport.

So: whether an angle is ever drawn on or beside the live view is ADR 0045's. The phone's tilt
message is a new D-3 message that the capture work after spike 0021 adds, and this ADR does not
add it.

### What the owner answered on 2026-10-04

The first draft of this ADR left seven questions to the owner. The owner answered all seven on
2026-10-04 and approved the wording: *"go ahead and do 1058 now I approve the wording"*. Each answer
is recorded in the Decision where it applies:

| # | The owner's answer | Where |
|---|---|---|
| 1 | The in-ride live view **remembers the rider's last choice**, stored on the device. It is not off at the start of every ride | D-8 |
| 2 | A snapshot **may be taken during setup**. It is held in memory and **joins the next ride that is saved**. If no ride is saved, it is discarded | D-3 |
| 3 | On a ride's page the snapshot section is **closed by default**, and no picture is mounted until it is opened | D-6 |
| 4 | The outline is **stored as numbers and drawn when shown**, as drafted | D-3 |
| 5 | A snapshot **never shows where in the ride it was taken, nor any reading**, as drafted | D-3 |
| 6 | A snapshot is **never sent to the rider's computer or to a model**, as drafted | D-11 |
| 7 | The camera screens set Android's **secure window flag** (`FLAG_SECURE`) **while a picture is shown**, which blocks the recent-apps thumbnail and screenshots on those screens | D-12 |

### Why this is a superseding ADR and not an amendment

[ADR 0013](0013-adr-amendments.md) allows an appended amendment to record that **a statement of
fact** in an ADR has become false. It does not allow an amendment to reverse a **decision**. ADR
0033 D-6 is a decision, and its two sentences *"No picture is ever displayed on the tablet"* and
*"never stored"* are the decisions the owner reversed. So the reversal is here, and ADR 0033 gains
only an appended pointer.

### What exists today

- **The phone sees itself; the rider does not.** `camera/FramingPreview.tsx` plays the phone's own
  camera into a `<video>` with the framing guide and last session's ghost outline. The phone stands
  2–3 m away and side-on, so the rider on the bike cannot read it. That is the gap the owner's
  rulings close.
- **The tablet shows words only**: pairing, framing, filming, stopped and link lost
  ([#551](https://github.com/openzigs/onyourleft/issues/551)), and the framing verdict (ADR 0033
  D-7). The one relaxation is ADR 0033's 2026-09-26 amendment: the **tablet's own** front camera,
  as a viewfinder, while it reads the phone's QR code.
- **The tablet already decodes every picture and runs the pose model on it.**
  `camera/pose-worker.ts` runs MediaPipe Pose Landmarker lite, `numPoses: 1`, on the CPU, in a
  module Web Worker. Each JPEG becomes an `ImageBitmap` and is thrown away after the model has
  answered. No object URL is ever created (ADR 0033 D-6).
- **The model must stay in the worker.** [Spike 0010](../spikes/0010-on-device-pose-model-cost.md)
  measured it beside the game: in a worker at 5 a second, 65.8 ms p50 and 80.9 ms p95 inference,
  and no game frame over 20 ms. On the main thread, game-frame p95 rose to 50–115 ms.
- **`packages/store` already has a record for a kept picture.** `CameraFrameRecord`
  (`records.ts`, schema version 10, #384) holds the athlete id, `capturedAt`, the media type, the
  dimensions and the bytes, and **no activity id**. Its own doc comment says that ADR 0029 D-2's
  *"deleting the activity deletes its frames"* is vacuous today, because nothing links them.

### A measured fact this ADR must not decide past

On 2026-10-04, measuring the shipped pipeline for [#554](https://github.com/openzigs/onyourleft/issues/554)
on the owner's Pixel Tablet and phone, **the side camera delivered about 0.3 pictures a second**:
197 pictures in about 10 minutes, against ADR 0033 D-3's about 5 a second. The tablet skipped none,
and its worker answered in 83 ms p50, so the shortfall is on the phone or the link. That is
[#1112](https://github.com/openzigs/onyourleft/issues/1112), open. A second 30-second session got
about 0.75 a second.

At 0.3 a second, a live view is a slide show. Whether that is fixed inside the data-channel design
or by moving to a WebRTC video track is spike 0021's question
([#1057](https://github.com/openzigs/onyourleft/issues/1057)). **This ADR does not pick a
transport.** D-2 says what follows from each answer.

---

## Decision

Thirteen rules. **D-0** says what this ADR builds. **D-1** is the supersession of ADR 0033 D-6.
**D-2** is the transport, conditionally. **D-3** is the snapshot and its departure from D-3's join
rule. **D-4** to **D-7** apply ADR 0029's metadata, error, store, shared-device and bystander rules
to the new surfaces. **D-8** and **D-9** are the ride: where the view may sit and what it may say.
**D-10** is the published wording. **D-11** is the rider's own computer on this path. **D-12** is
Android's secure window flag while a picture is shown.

### D-0 — This ADR builds nothing, and the order of work is fixed here

No code changes with this ADR. The work is in the issues it blocks, in this order:

1. **Spike 0021** ([#1057](https://github.com/openzigs/onyourleft/issues/1057)) settles the
   transport, and [#1112](https://github.com/openzigs/onyourleft/issues/1112) is fixed or explained
   by it. An appended amendment here records the outcome (D-2).
2. **The published wording** ([#1060](https://github.com/openzigs/onyourleft/issues/1060)), with
   the owner's approval, lands **in the same pull request as the first byte it describes** (D-10),
   not before it.
3. **The live view during setup** ([#1061](https://github.com/openzigs/onyourleft/issues/1061)),
   then **during the ride** ([#1062](https://github.com/openzigs/onyourleft/issues/1062)), then
   **the snapshot** ([#1063](https://github.com/openzigs/onyourleft/issues/1063)). The secure window
   flag (D-12) lands with the first of these that shows a picture, #1061, in the same pull request.

### D-1 — ADR 0033 D-6 is superseded: a picture may be shown, and one the rider presses for may be kept

**What D-6 said**, quoted:

> **The rule, which is the owner's.** Each picture is analysed as it arrives and discarded as soon
> as the analysis has produced its numbers. **No picture is ever written to storage on the tablet**:
> not IndexedDB, not Cache Storage, not `localStorage`, not a file. **No picture is ever displayed on
> the tablet.**

and, in its table, *"Pose numbers never reach the HUD, the ride screen, an announcement or a
trainer"*.

**What replaces it**, as the rule on this path:

> Each picture is analysed as it arrives. While the rider has the live view on (D-6, D-8), the
> picture is **shown** on the tablet with the pose outline the model drew from **that** picture,
> and is discarded once the next one replaces it. **No picture is written to storage on the tablet,
> except a snapshot**: one still, saved by one press of *Save snapshot* (D-3).

**What of D-6 still stands, unchanged:**

| D-6 says | Status |
|---|---|
| Analysed as they arrive | **Stands** |
| At most one picture waits for the model; the newest survives; a queue of photographs is refused | **Stands.** The live view adds at most **one** more held picture: the one on screen. It never holds a second |
| Never written to Cache Storage, `localStorage` or a file | **Stands for every picture**, a snapshot included (ADR 0029 D-10). A snapshot's only home is IndexedDB, through `packages/store` (D-5) |
| Never written to IndexedDB | **Stands except for a snapshot** |
| No per-ride keep on this path | **Stands.** A snapshot is one press for one picture. There is no switch that keeps a ride's pictures, and no "always" |
| What is kept: pose numbers, then the pose summary (ADR 0035 D-6's supersession) | **Stands** |
| Pose numbers never reach an announcement or a trainer | **Stands** |
| Pose numbers never reach the HUD or the ride screen | **Superseded for the outline only.** The outline is a drawing of the landmarks over the picture they came from. No number derived from them (an angle, a length, a difference, a verdict) reaches the HUD or the ride screen by this ADR. ADR 0045 decides whether any angle is drawn anywhere, and the issue's own reading is that its surface list excludes the ride |
| **No object URL** | **Stands for the live view.** It is drawn from a decoded bitmap onto a `<canvas>`, or played by `srcObject` into a `<video>` if D-2's video-track branch is taken. Neither is a URL. **A saved snapshot on its ride's page** needs an image source, so it may have an object URL, created only while the rider has the snapshot section open (D-6) and revoked when it closes or unmounts. That URL is never logged, never put in an error (D-4), and never reaches the service worker, which does not intercept `blob:` URLs (ADR 0029 D-10) |
| The model runs in the worker | **Stands**, and is now a rule rather than an observation: nothing in the live view may move inference to the main thread (spike 0010) |

**And #527's "Preview on the tablet: None" is reversed**, by the owner's ruling 5. ADR 0033's
2026-09-26 amendment (the tablet's own viewfinder while pairing) is unaffected.

### D-2 — The transport is spike 0021's to measure, and each outcome is decided here

The owner's rulings need a picture on the tablet at a rate a person can set up by. Today the rate
is about 0.3 a second ([#1112](https://github.com/openzigs/onyourleft/issues/1112)). **This ADR
does not choose between still frames and a video track.** It decides what each choice changes, so
the spike's result needs only an amendment.

**On both branches**, ADR 0033 D-3 reason 3's display clause loses its premise. It said a video
track *"arrives as a `MediaStream`, which a `<video>` element can play with one line. That would
show a picture on a tablet the owner ruled must show none."* The owner now rules that a picture is
shown, so that clause no longer argues for or against either transport. Reason 3's **other** half,
that *"the encoder changes resolution and frame rate under congestion, so the tablet could not know
that it analysed what was captured"*, is still a real concern, and it is a measurement for the
spike rather than a rule.

| | **Branch A: still frames on the `frames` channel** (ADR 0033 D-3 as it is) | **Branch B: a WebRTC video track** |
|---|---|---|
| D-3's picture row | **Stands**, with the rate restored by #1112's fix. The spike records the rate it reached | **Superseded** for the live view. The track carries the picture; D-3's `frames` channel then carries nothing, or a fit-check burst if ADR 0045 and #1064 need one |
| D-3 reason 3 | Display clause gone (above). Nothing else changes | **Superseded in full**, by this row. The spike must show the tablet can tell what resolution it analysed (`getStats()`), or the analysis must record the size of each picture it analysed |
| Where the ADR 0029 D-9 strip happens, **for the live view** | **Unchanged**: on the phone, at capture, in `camera/frame.ts`, by re-encoding from pixels | On the phone, where the **platform's video encoder** encodes the camera's raw pixels. RTP carries no container, so ADR 0033 D-3 reason 2 (an MP4's location atoms) does not arise. But the encode is no longer this project's code, and the spike must say what the track carries besides pixels (RTP header extensions included) |
| Where the strip happens, **for a snapshot** | **Unchanged**: the snapshot is the bytes the phone already stripped. The tablet stores them as received and never re-encodes them (`CameraFrameRecord.bytes`) | **One new place, on the tablet**: a single module that draws the decoded video frame to a canvas and encodes a JPEG from it, and nothing else may encode a snapshot. That module is D-9's one place for this path's snapshots, and its unit test feeds it a source carrying metadata and finds none in the output (D-4) |
| What feeds the pose model | The decoded JPEG, in the worker, as today | A frame taken from the track and handed to the worker (for example a `VideoFrame` or a transferred `ImageBitmap`). The spike must show this keeps inference in the worker; if it cannot, **branch B is refused**, because spike 0010's main-thread figure breaks the game |
| What the QR code must carry | Unchanged | A video m-line in the offer and answer, which `side-link-sdp.ts` rebuilds and which changes the QR payload. The spike must measure it |
| The no-network gate | Unchanged (ADR 0033 D-9) | Unchanged in count: the same one `RTCPeerConnection`. A media path is a new kind of thing on it, and the spike states whether its configuration assertions (empty `iceServers`, host candidates only) still hold with a track |

**If the spike finds neither branch gives a usable view on the owner's devices**, the live view is
not built, and that is recorded by an amendment here. The snapshot (D-3) still works on branch A at
whatever rate is reached, because it needs only one picture.

**A fit-check burst** at a higher rate, for bottom dead centre, is ADR 0045's and #1064's. If it
changes D-3's picture row, that change is theirs to record.

### D-3 — The snapshot: one still per press, tied to the ride it was taken in

> **The rule.** *Save snapshot* saves **exactly one** still, the picture on screen when it was
> pressed, with the outline drawn over it. It is never a switch, never held down to save a run of
> pictures, and never "keep this ride". It is tied to the ride it was taken in, shown on that ride's
> page, and deleted with that ride and by the erase.

**The departure from ADR 0033 D-3's join rule, for snapshots only.** D-3 says the tablet stores pose
numbers *"keyed only by the frame's session-relative sequence number and milliseconds, and never
with an arrival time, a wall-clock time or an offset into the ride"*, and that *"nothing on the
tablet joins them to a ride reading"*. The owner's ruling 3 departs from it for a snapshot:

- **What is joined**: a snapshot record names the **ride** (its activity id). That is the whole of
  the join.
- **What is still never joined**, the owner's answer of 2026-10-04 to question 5, as drafted: *a
  snapshot never shows where in the ride it was taken, nor any reading*. It is never shown, stored or
  exported with a ride **reading** (power, cadence, heart rate, speed), a lap, a workout segment, or
  its **offset into the ride**. Nothing computes where in the ride it was taken. The record keeps
  `capturedAt`, which it already has and which the export's file name uses, but no code reads it
  against the ride's streams.
- **What does not move**: the pose numbers, the post-ride report and the pose summary (ADR 0035 D-6)
  stay under D-3's join rule exactly as written. The departure is for the snapshot record and
  nothing else.

**When it is offered.** The owner's answer of 2026-10-04 to question 2: *a snapshot may be taken
during setup. It is held in memory and joins the next ride that is saved. If no ride is saved, it
is discarded.* So *Save snapshot* is offered wherever the live view is shown: during setup, on the
side-camera framing view, and during a ride while the in-ride view is on (D-8). During setup, beside
the control, the rider is told in words that a snapshot taken now joins the next ride they save and
is discarded if they save none. The words are #1060's, with the owner's approval (D-10).

**Which ride.** The rule `camera/side-report-keeper.ts` already uses for the report (#388), widened
by the owner's answer for setup:

1. A snapshot taken **while a ride is under way** (recording, paused, or being saved) is held **in
   this tab's memory**, owned by that ride, and written to the store **in the same transaction as,
   or straight after, that ride's save**.
2. A snapshot taken **during setup**, with no ride under way, is held **in this tab's memory** and
   joins **the next ride started in this tab and saved**. It is written with that ride's save, as in
   rule 1, and never before it: until then nothing about it is in the store.
3. If the save of the ride a snapshot is held for comes back empty or failed, that ride's snapshots,
   setup snapshots included, are dropped and nothing was written. The author's reading of *"the
   next ride that is saved"*, and the narrower one: a setup snapshot does not wait on for a later
   ride.
4. **If no ride is saved, a setup snapshot is discarded.** It was only ever in memory, so closing or
   reloading the tab, or the erase, discards it, and nothing was written.
5. A recovered ride saved later from the leftover list never collects a snapshot, whether it was
   taken during that ride or during setup: the ride must have been seen under way in this tab, or
   started in it after the setup snapshot was taken. The author's reading, and the narrower one.

The number held in memory, per ride and for setup, is bounded, and the bound is #1063's to set at its
constant, with its provenance. A press past the bound is refused in words, not silently dropped.

**Where it is stored.** In `packages/store`'s existing `cameraFrames` table, as a
`CameraFrameRecord`, in the next schema version. The author's choice, so that one table holds every
picture this device keeps and ADR 0029 D-1's *"its own store record"* stays one record. The new
version adds:

| Field | What it holds |
|---|---|
| `source` | `'snapshot'` for this path. A row written before the new version reads back as the existing keep's (`'kept'`), by the migration |
| `activityId` | The ride it belongs to. Required for a snapshot. `null` only for a row written before the new version, which has none |
| The outline | The landmarks it was **shown with**, as image-plane shares: the pose model's near-side names and positions, as `FramingReferenceRecord` already stores them. `null` when the model had no pose for that picture. **No angle, no length and no difference** is stored with it |

**The outline is drawn when shown, never burned into the bytes.** The owner's answer of 2026-10-04
to question 4, as drafted: *the outline is stored as numbers and drawn when shown*. Drawing it
into the picture would be a second encode of the picture on the tablet, which is a second place for
D-9's strip to be got wrong, and it would make the outline impossible to leave out of a copy the
rider wants without it. The bytes stay exactly what was stripped (D-2's table says where).

**Deleting.** Deleting a ride deletes its snapshots **in the same transaction**, which makes ADR
0029 D-2's *"Deleting the activity deletes its frames"* true for the first time. The rider can also
delete one snapshot, through an owner-scoped delete (D-5).

### D-4 — Metadata and errors: ADR 0029 D-9 and D-8, unchanged, on two new surfaces

- **D-9: one strip point, by re-encoding from pixels.** On branch A it is unchanged: the phone,
  `camera/frame.ts`. On branch B, D-2's table names the tablet module for a snapshot. **Either way,
  no snapshot reaches the store carrying metadata.** #1063's test feeds the save path a synthetic
  picture whose bytes carry an APP1 Exif segment with a GPS IFD, reads the stored bytes back
  through a fresh connection, and finds no APP1 marker and no GPS tag. The fixture is built in the
  test: no real photograph is committed. `privacy/boundaries.ts` still cannot see inside image
  bytes, which is why the test reads the bytes rather than walking a structure.
- **D-8: no picture in any error.** A message about the live view or a snapshot may say that there
  was a picture and what went wrong with it. It never carries the picture, a crop, a thumbnail, a
  data URL, a `blob:` URL, a content hash or a path to one. That binds every log line, toast and
  notice on these surfaces, and the object URL of D-1's table above most of all.
- **D-10: nothing reaches a cache.** Neither the live picture nor a snapshot is written to Cache
  Storage, `localStorage`, `sessionStorage` or any HTTP cache, and neither travels through the
  service worker.

### D-5 — The store: owner-scoped, exported, erased

- **Every read is owner-scoped.** The snapshot section of a ride's page reads through a new
  `ActivityStore` member that takes `owner` first and filters on it, for example
  `listRideSnapshots(owner, activityId)`, and the one-snapshot delete takes `owner` too.
  `activity-store.scoping.test.ts` derives every `owner`-taking member from
  `ActivityStore.prototype` and requires a probe for each, so a new read without a three-athlete
  probe is a red test by construction. ⚠️ **ADR 0029 D-11 and the `CameraFrameRecord` doc comment
  refuse a point lookup** (*"There is no `getCameraFrame(owner, id)` and that is deliberate"*). A
  read by **ride** is what ruling 3's *"shows on that ride's page"* needs, and it is the one read
  this ADR adds. A read by snapshot id is still not added.
- **The account export carries every snapshot.** The decision is to **include** them: a snapshot is
  a kept frame, and ADR 0029 D-3 puts every kept frame in the account export, un-trimmed, as the
  athlete's own data (ADR 0004 E). The manifest names each one against its ride, and lists *"a
  photograph of you"* among what an activity file cannot carry. The export screen's existing
  warning, that the archive then holds photographs of the inside of the house, applies.
- **An activity export to a third party never carries one** (ADR 0029 D-3), whatever the ride's
  visibility.
- **The erase removes every snapshot and its outline.** `ERASE_REMOVES`'s existing line, *"every
  photograph this device kept from a ride, and everything derived from one"*, already covers both,
  and #1063 checks the wording still reads true. `activity-store.erasure.test.ts` derives its table
  list from `SCHEMA_VERSIONS`, so the new version's rows are covered with no edit to that test.
- **The migration is an `up`/`down` pair** in `packages/store`, and `down` is tested and run
  (`CLAUDE.md` §5). A rollback nobody has run is not a rollback.

### D-6 — A shared device: where the picture may appear, and where never (ADR 0029 D-11)

ADR 0033 D-6 said D-11 did not newly apply *"because nothing is shown"*. It now applies. **There is
still no sign-in and no lock on the device** (ADR 0029 D-11), so anybody near the tablet, or holding
it, sees what the rider sees.

**What another person near the tablet can see:**

- **The live view, while it is on.** The rider and anybody else in frame, as a picture, on the
  tablet's screen. That includes someone looking over the rider's shoulder and, in a browser,
  anyone the tablet's screen is shared or cast to. In the Android app the secure flag (D-12) blanks
  a cast or a screen recording while a picture is shown.
- **A saved snapshot, only on that ride's page, and only after opening its section.** The owner's
  answer of 2026-10-04 to question 3: *on a ride's page, the snapshot section is closed by default,
  and no picture is mounted until it is opened.* The section is closed when the page opens, says how
  many snapshots there are in words, and does not mount a picture, or create its object URL (D-1),
  until the rider opens it. That is how ruling 3's *"shows on that ride's page"* and D-11 rule 1's
  *"No frame … in the ride detail view's default render"* both hold: the default render shows none,
  and the page is the one place a snapshot is reached.

**Where the picture may appear:** the Camera screen's side-camera framing view (during setup); the
ride surfaces (the game's stage and the Ride screen) **only while the rider has the in-ride view
on**; and a ride's page, inside the snapshot section the rider opened.

**Where it never appears**: the activity library, any list or row, Home, a thumbnail anywhere, a
share sheet or share preview, an exported activity file, a notification (the Android recording
service's included), the Devices, Settings or account screens, an error (D-4), and, in the Android
shell, Android's recent-apps thumbnail or a screenshot of a screen showing it (D-12).

⚠️ **This defends against the accidental case and not against a person who is looking.** That is
D-11's own sentence, and it is truer now: a housemate who opens the rider's ride page and the
section will see the snapshots, and anybody standing by the bike sees the live view. The remedy is
D-11's: the view can be switched off, a snapshot can be deleted, and the erase removes them all.

### D-7 — Bystanders, on a screen (ADR 0029 D-5)

ADR 0029 D-5's sentence, *"Anyone in the room will be in the picture"*, was written for a picture
that reached a **model**. On this path the picture now also reaches a **screen**, and a snapshot
reaches storage. D-5 is not superseded: no blur, and the refusal is the decision, for D-5's reason.
What changes is what the rider is told:

- The consent screen gains a sentence, beside D-5's and ADR 0033 D-5's, that the picture is
  **shown on this tablet** and that a snapshot keeps it. The words are #1060's, with the owner's
  approval (D-10). This ADR does not write them.
- **The outline is drawn for one person only.** The pose model runs with `numPoses: 1`, and that
  stays. A second person in frame appears in the picture **without** an outline. The view never
  draws a second outline, and never says that it saw a second person.

### D-8 — During a ride: where the live view may be, and the gates that hold it

> **The rule.** During a ride the live view is **on or off as the rider last left it on this
> device**, and a ride-time control turns it on or off. Turning it off **removes** the element and
> stops drawing; it is not hidden by a style. It never covers a ride-time control, a reading, a
> panel or a standing notice, and never covers the rider in the game. It is shed before the world
> degrades.

- **It remembers the rider's last choice.** The owner's answer of 2026-10-04 to question 1: *the
  in-ride live view remembers the rider's last choice, stored on the device. It is not off at the
  start of every ride.* The choice is a device preference, kept beside the game's other device
  preferences (`game/world-preference.ts`, `game/hud/announce-preference.ts`), and it is a
  boolean: no picture and nothing derived from one is stored with it (D-4). Before the rider has
  ever chosen, it is **off**, the author's choice and the narrower one. The draft's per-ride default
  (the shape of ADR 0029 D-2 and ADR 0030 D-7 S5) is **not** taken; what that costs is in
  §Consequences.
- **The toggle and *Save snapshot* are ride-time controls.** They join
  `design/ride-time-controls.ts` §`RIDE_TIME_CONTROLS`, so each is 48 px and at least 8 px from the
  next (#669).
- **Clear of the rider.** On the game's stage the view stays clear of the **leaning** rider box,
  `game/camera.ts` §`riderFrameBox(aspect, MAXIMUM_LEAN_RADIANS)`, at every overlay viewport, after
  the safe-area insets, and its margin is published.
- **Never a standing notice's cell.** A standing safety notice (the trainer, *Eased*, *Keep the
  screen on*, a lost side camera) keeps its cell. Where the stage has no room for the view beside a
  standing notice, **the view gives way**, not the notice.
- **On the Ride screen**, the view sits **below** the ride controls in its column, so #692's rule
  holds: *"nothing whose height changes during a ride sits above a ride control in its column"*.
  Every ride control and standing notice keeps its 50 px margin to the fold at every tablet in the
  shell.
- **In the HUD's light palette**, whatever the page's theme (#672, #744).
- **Shed first.** When the game's quality ladder (`game/quality.ts`) steps down from its top rung,
  the live view stops drawing before anything in the world is given up, and says so in words. The
  rung rule is #1062's to set and record in `quality.ts`.
- **A lost link removes the picture at once.** The words #551 shows stay as they are.
- **The model stays in the worker**, and drawing never waits for an inference (spike 0010).

**The browser gates that will hold this**, each gaining cases rather than loosening a bound:

| Gate | What it gains |
|---|---|
| `ride.browser.spec.ts` | The view inside every overlay viewport after insets, over no panel, reading or control (hit-tested), clear of the leaning rider box with its margin published; a control that places it over the box and must fail |
| `rideview.browser.spec.ts` | With the view on, every ride control and standing notice still 50 px above the fold at every tablet in the shell both ways up; a control that moves it above *Pause* / *Stop* and must fail |
| `ride-targets.browser.spec.ts` | The toggle and *Save snapshot* found on a scene and measured #316's three ways at 48 px |
| `theme.browser.spec.ts` | The view in the HUD's palette in both page palettes |
| `hud-focus.browser.spec.ts` | Their focus rings at 3:1 on the surface they land on |
| `sidecamera.browser.spec.ts`, `controls-first.browser.spec.ts`, `reflow.browser.spec.ts` | The framing view on the Camera screen: no sideways scroll, and the first control above the fold |
| `kept-visible.a11y.test.tsx` | The new consent and *"shown on this tablet"* sentences (#1060) never tucked |

### D-9 — The view says nothing, and draws no angle

- **No word, sound or announcement judges the picture.** ADR 0030 D-7's silence rule and R7 (no
  prompt to act, no alert) are untouched. The outline is a drawing of where the model put the
  landmarks, not a judgement. It is not coaching ([#389](https://github.com/openzigs/onyourleft/issues/389)
  stays a separate decision).
- **Any text over or beside the view is in ADR 0030's vocabulary**, and
  `camera/no-absolute-angles.test.ts` still scans it: no degree sign, no frontal-plane word, no
  verdict.
- **No angle is drawn on the live view or on a snapshot**, unless ADR 0045 names that surface as one
  where an angle may appear. ADR 0045 decides it; this ADR does not.
- **Nothing in the frontal plane is drawn** (ADR 0030 D-4). The outline is the near side's sagittal
  landmarks, as the model reports them, and no line is drawn across the rider.

### D-10 — The published wording changes with #1060, in the pull request that ships the first byte

ADR 0033 D-10's rule stands: **the policy and the Play declaration are true of the shipped app at
every point.** They change in the pull request that first shows a picture, and the words about a
kept snapshot in the one that first stores one, not before either. **This ADR changes none of
them.** [#1060](https://github.com/openzigs/onyourleft/issues/1060) drafts every change below, the
owner approves the words there, and the pull request that ships the behaviour carries them.

| Artefact | What becomes false, and must change |
|---|---|
| [`docs/privacy-policy.md`](../privacy-policy.md) §"A second phone you pair as a side camera" | That pictures are never shown or stored on the tablet. It gains: shown on the tablet while the view is on, and one snapshot kept per press, with its ride, until the rider deletes it or the ride, or erases |
| [`docs/privacy-policy.md`](../privacy-policy.md) §"Deleting your data" | It names snapshots among what the erase removes and what the account export carries |
| `apps/mobile/src/android/data-safety.ts`, the **Photos and videos** row's `why` | Its *"analysed on the tablet and discarded at once, never stored, shown or sent on (ADR 0033 D-6)"*. The **answers** (`collected`, `shared`) are expected not to change, because a picture shown or stored on the rider's own tablet is not collection under Play's definition. #1060 reads Play's text first-hand and says so rather than assuming it |
| `apps/web/src/camera/consent.ts` §`CONSENT_STATEMENT`, and the Camera and side-camera screens' kept-visible sentences (`views/CameraView.tsx` §`CAMERA_KEPT_VISIBLE`, `views/SideCameraView.tsx` §`SIDE_CAMERA_KEPT_VISIBLE`) | The consent says what is captured, where it goes and what is kept. It gains the *"shown on this tablet"* sentence (D-7) and the snapshot. Each is kept visible (#666) |
| The side-camera setting in Settings (`views/SettingsView.tsx`), beside the consent's own sentence | Nothing there says screenshots are blocked. It gains D-12's sentence: in the Android app, screenshots and the app-switcher preview are blocked while a camera picture is on screen, and a browser cannot block them |
| `transfer/erase-device.ts` §`ERASE_REMOVES` | Re-read; D-5 expects its existing line to cover snapshots, and a setup snapshot is only ever in memory (D-3) |
| [ADR 0033](0033-side-camera-link.md) | Its wording is not edited. Its appended amendment points here (below) |

### D-11 — The rider's own computer, on this path (ADR 0033 D-11)

When the rider has switched on ADR 0033 D-11's stream to their own computer, the tablet still
receives every picture, so it may show them in the live view. The outline is then drawn only from
a pose that passed `camera/pose-plausibility.ts`, and the view draws no outline for a picture whose
answer was refused. **This ADR adds no new egress**: a snapshot is never sent to the rider's
computer, to a hosted model or to an instance by anything this ADR permits, and a hosted model is
still never sent a picture (ADR 0029's 2026-09-29 entries). That is the owner's answer of
2026-10-04 to question 6, as drafted: *a snapshot is never sent to the rider's computer or to a
model*, the write-up of ADR 0035 included, which reads no picture.

### D-12 — Android's secure window flag, while a picture is shown

> **The rule.** In the Android shell, while a side-camera picture is on screen (the live view during
> setup or the ride, or a snapshot in an open section of a ride's page), the app's window carries
> Android's secure flag, `WindowManager.LayoutParams.FLAG_SECURE`. It is set when the first picture
> is mounted and cleared when the last one is removed. It is not set at any other time.

The owner's answer of 2026-10-04 to question 7: *the camera screens set Android's secure window flag
(`FLAG_SECURE`) while a picture is shown, which blocks the recents thumbnail and screenshots on those
screens.* A snapshot shown in an open section of a ride's page is the same picture, so the author
applies the flag there too, the narrower reading. While it is set, Android shows a blank recent-apps thumbnail for the app, refuses a
screenshot or screen recording of it, and shows a non-secure display (a cast, for example) blank.

**The native piece**, in `apps/mobile`, the shape `ThermalPlugin` and `RecordingServicePlugin`
already have:

- **A small Capacitor plugin**, for example `SecureWindowPlugin.java` beside `MainActivity.java`,
  registered in `MainActivity` with `registerPlugin(...)` (which `plugin-registration.test.ts`
  checks), with two methods: one that adds `FLAG_SECURE` to the activity's window
  (`getWindow().addFlags`) and one that clears it (`clearFlags`), each on the UI thread. It takes no
  argument and returns nothing but success; it reads nothing.
- **Its TypeScript side** under `apps/mobile/src/`, as `thermal/` is, offered to the client through
  `src/index.ts`, and reached in `apps/web` through a `*-port.ts` so `check:wiring` sees an unwired
  method (§4j).
- **One owner in the web client**: a reference count over the mounted pictures, so two pictures on
  one screen, or a picture replaced by the next, never clear the flag early. Every picture
  component takes it on mount and gives it back on unmount, the error path included.
- **In a browser it does nothing.** A web page cannot stop a screenshot or the browser's own
  tab-switcher preview, and the port is a no-op there. That is said to the rider (below), not
  hidden.

**What the rider is told.** The camera consent, and the side-camera setting in Settings, gain a
sentence that, in the Android app, screenshots and the app-switcher preview are blocked while a
camera picture is on screen, and that a browser cannot block them. The words are #1060's, with the
owner's approval (D-10).

**What it does not do.** It does not stop a person looking at the screen or photographing it with
another device (D-6). It costs the rider their own screenshots of these screens, on purpose.

---

## Consequences

### What this enables

- **The rider can see themselves** from the bike, during setup and during the ride, with the outline
  that says what the model found. That is the gap ADR 0033's no-preview ruling left.
- **A snapshot the rider chose, kept with its ride**, shown on that ride's page, which is the
  smallest form of the photographic comparison ADR 0033 §"What this costs" called friction.
- **ADR 0029 D-2's cascade becomes real.** Deleting a ride deletes its pictures, in one transaction,
  for the first time.
- **#1060, #1061, #1062 and #1063 can be written against decisions**, and spike 0021 has a table of
  consequences to fill rather than a design to invent.

### What this costs, stated plainly

- **A picture of the rider in their home is now on a screen.** Anybody near the tablet sees it while
  the view is on, and anybody who opens a ride's snapshot section sees the snapshots. D-6 keeps it
  off every accidental surface and is honest that it does nothing against a person who is looking.
- **A view left on stays on.** Because the in-ride view remembers the rider's last choice (D-8), a
  ride a guest walks into starts with the picture on screen if the rider left it on last time. The
  owner chose that over a per-ride default on 2026-10-04.
- **The rider loses their own screenshots** of every screen showing a picture, in the Android app
  (D-12), and gains a native plugin to maintain. A browser gets no such protection, and is told so.
- **A setup snapshot can be lost without a word at the moment it is lost**: closing the tab before
  any ride is saved discards it (D-3). The rider is told that beside the control, before pressing.
- **Bystanders now appear on a screen and may be stored.** The consent says so. Nothing detects or
  hides them, and the outline is drawn for one person only.
- **The account export grows more dangerous again**, by every snapshot (ADR 0029 D-3).
- **One join D-3 forbade now exists**: a snapshot names its ride. The rule that keeps it to the ride
  and nothing finer is a rule in code review and in #1063's tests, not a property of a format.
- **More work beside the ride.** Drawing the view costs main-thread time beside the game. It is
  measured by #1062 against #554's figures, and the view is shed first.
- **A schema version and a migration** in `packages/store`, with a `down` that must be run.
- **The transport is undecided.** If spike 0021 picks a video track, D-3 reason 3 falls in full, the
  QR payload grows, and a strip point moves to the tablet for snapshots.
- **ADR 0029 gains no pointer amendment in this pull request**, though #1058 asks for one. Its newest
  `## Amendments` entry is read by `apps/web/src/camera/hosted-model.test.ts`, which requires it to
  be the 2026-09-29 hosted-consent entry. Appending a pointer would turn that test red, and this pull
  request changes no code. The pointer is owed, and lands with whichever pull request next changes
  that test's reading of the section (#1060 is the natural one). Until then a reader of ADR 0029 D-2
  finds this ADR through ADR 0033's amendment and `docs/architecture.md`'s index.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#1057](https://github.com/openzigs/onyourleft/issues/1057), spike 0021 | D-2's table: every row of the branch it picks is a measurement it owes. Its result is appended here as an amendment |
| [#1112](https://github.com/openzigs/onyourleft/issues/1112) | The live view is not usable at 0.3 a second on branch A. Its fix, or the spike's choice of branch B, comes first |
| [#1060](https://github.com/openzigs/onyourleft/issues/1060) | D-10's table, with the owner's approval of each sentence: D-7's consent sentence, D-3's setup-snapshot sentence and D-12's screenshot sentence. The pointer amendment to ADR 0029 (above) if it touches `hosted-model.test.ts` |
| [#1061](https://github.com/openzigs/onyourleft/issues/1061) | D-1 (no object URL for the live view, the model in the worker, at most one shown picture), D-6, D-7, D-9, the setup half of D-8's gates, and D-12's plugin and port, which land with the first picture shown |
| [#1062](https://github.com/openzigs/onyourleft/issues/1062) | D-8 entire, the remembered preference included, D-9, D-12 on the ride surfaces, and the device measurement against #554 |
| [#1063](https://github.com/openzigs/onyourleft/issues/1063) | D-3 (setup snapshots and their discard included), D-4, D-5 and D-6's snapshot section, D-12 on a ride's page, the migration and its `down` |
| [#1064](https://github.com/openzigs/onyourleft/issues/1064) | D-2's note on a fit-check burst, and the phone's tilt message (the owner's trunk-angle ruling), both added there and not here |
| [#1059](https://github.com/openzigs/onyourleft/issues/1059), ADR 0045 | Whether any angle appears on the live view, a snapshot or a ride's page (D-9) |

---

## What the owner has not decided

**None remain.** The first draft asked the owner seven questions, and the owner answered all seven
on 2026-10-04 (*"go ahead and do 1058 now I approve the wording"*). The answers are in §Context
§"What the owner answered on 2026-10-04" and in the Decision: question 1 in D-8, questions 2, 4 and
5 in D-3, question 3 in D-6, question 6 in D-11 and question 7 in D-12. Where an answer left a detail
open, the author took the narrower reading and says so at the place: the view is off before the
rider has ever chosen (D-8), a setup snapshot does not wait past a failed save or join a recovered
ride (D-3), and the secure flag also covers a snapshot on a ride's page (D-12). The author's other
choices, such as one `cameraFrames` table for every kept picture (D-3), stand under the owner's
approval of the wording.

## What this ADR did not consider

- **Screen casting and screen sharing** of the tablet in a browser, beyond saying in D-6 that they
  show the view. In the Android app D-12's secure flag blanks them while a picture is shown.
- **A second person's profile on one device**, which ADR 0029 D-11 already names as the day its
  argument changes (accounts, [#7](https://github.com/openzigs/onyourleft/issues/7)).
- **iOS**, and **more than one side camera**, as in ADR 0033.
- **The legal reach of showing or keeping a picture of a bystander** in any jurisdiction. As in ADR
  0029, this is not legal advice.

## What would make this ADR wrong

- **Spike 0021 finds the model cannot stay in the worker on branch B, and branch A cannot reach a
  usable rate.** Then the live view has no transport that keeps the game whole, D-2's last row
  applies, and an amendment records that the view is not built.
- **The live view costs the game frames it cannot shed.** If #1062 measures a game-frame p95 above
  #554's figure by more than its stated margin with the view on and shed, D-8's *"shed first"* is not
  enough and the in-ride half needs a superseding decision.
- **A snapshot turns out to be joinable to the ride in a way that matters**: for example if a
  rider's snapshots, each with its `capturedAt`, combined with the ride's streams, re-create the
  timed pose record D-3 forbids. D-3's *"no code reads it against the streams"* would then be
  protecting a join that the data allows anyway, and storing `capturedAt` would need revisiting.
- **The video encoder's output carries something that identifies the device or the place**, through
  RTP header extensions or otherwise (branch B). D-4's strip claim for the live view would then be
  false.
- **Play reads a picture shown or kept on the rider's own tablet as collection**, or a reviewer does.
  Then D-10's expectation that the Data Safety answers do not change is wrong, and #1060 changes
  them.
- **The owner wants an angle, a verdict or coaching on the live view.** That is ADR 0045's or
  #389's to decide, and D-9 here would be superseded.

## What was read, and when

All on 2026-10-04, from `main` at `a9c7f3ff`:

- [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-1 to D-11 and every amendment;
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md) D-2 to D-7 and its amendments;
  [ADR 0033](0033-side-camera-link.md) in full, D-3 reason 3, D-6, D-8, D-10, D-11 and every
  amendment; [ADR 0013](0013-adr-amendments.md).
- `packages/store/src/records.ts` §`CameraFrameRecord`, `activity-store.ts`
  §`listCameraFrames`, `camera/side-report-keeper.ts`, `camera/pose-worker.ts`,
  `apps/mobile/src/android/data-safety.ts`, and `apps/web/src/camera/hosted-model.test.ts`
  §`newestAmendment`.
- The epic #1055, #1058 and their owner-ruling comments of 2026-10-03; #554's measurement comment of
  2026-10-04; #1112.
- A research summary of 2026-10-03 on a live view of the side camera (three options, their costs and
  their conflicts with ADR 0033), which is not committed. Its unconfirmed points (hardware H.264 in
  the WebView, `VideoFrame` support in tasks-vision 1.0.1, a video m-line in the QR code) are spike
  0021's to settle, and this ADR rests on none of them.
