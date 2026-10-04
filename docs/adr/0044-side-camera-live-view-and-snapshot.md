# ADR 0044: A live view and a pressed snapshot on the side-camera path

- **Status**: Accepted. ⚠️ **D-2's choice of transport is conditional on
  [#1057](https://github.com/openzigs/onyourleft/issues/1057)** (spike 0021), a measurement on the
  Pixel Tablet and the Pixel 8 that has not been taken. Both of its outcomes are decided here, in
  [ADR 0033](0033-side-camera-link.md)'s shape for #532, so the result needs only an appended
  amendment recording which one happened ([ADR 0013](0013-adr-amendments.md)), and not a new ADR
- **Date**: 2026-10-04
- **Deciders**: **the owner, on every product question**: rulings 1, 2, 4 and 5 of 2026-10-03 in
  the epic [#1055](https://github.com/openzigs/onyourleft/issues/1055), and the snapshot ruling
  posted on [#1058](https://github.com/openzigs/onyourleft/issues/1058) the same day. All are quoted
  in Context so they are not argued again. **The author decided the engineering content**, and
  marks each point the rulings do not settle as *the author's choice*. Each takes the narrower
  option, and widening any of them is the owner's decision
- **Issue**: [#1058](https://github.com/openzigs/onyourleft/issues/1058), parent epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055). It blocks
  [#1060](https://github.com/openzigs/onyourleft/issues/1060),
  [#1061](https://github.com/openzigs/onyourleft/issues/1061),
  [#1062](https://github.com/openzigs/onyourleft/issues/1062),
  [#1063](https://github.com/openzigs/onyourleft/issues/1063) and
  [#1064](https://github.com/openzigs/onyourleft/issues/1064)
- **Number**: **0044**, reserved by the epic #1055 on 2026-10-03 from
  [`docs/architecture.md`](../architecture.md)'s *"The next free number is 0044"*, together with
  **0045** for [#1059](https://github.com/openzigs/onyourleft/issues/1059). On 2026-10-04 no open
  pull request added an ADR. This pull request records both numbers in the reservation table
- **Supersedes**, each **narrowly and only on the side-camera path** (one rider's tablet and the
  tripod phone paired to it):
  - [ADR 0033](0033-side-camera-link.md) **D-6**: its sentence *"No picture is ever displayed on the
    tablet"*; its *"No picture is ever written to storage on the tablet"*, for a **pressed
    snapshot** only; and its *"Pose numbers never reach the HUD, the ride screen…"*, for the
    **outline drawn on the live view** only. D-1 below lists what of D-6 stands, which is most of it.
  - [ADR 0033](0033-side-camera-link.md) **D-3**: its **join rule**, for a snapshot only (the
    owner's ruling, D-4 below). And, **only if spike 0021 chooses a video track for the live view**,
    D-3 reason 3 and the *"Pictures"* row's *"single frames, not a clip"* for that view (D-2 below).
  - [ADR 0033](0033-side-camera-link.md) **§Context**, the owner's #527 ruling *"Preview on the
    tablet: **None.** Framing is set up on the phone. The tablet shows state only"*. Ruling 5 below
    reverses it by name.
  - [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-2**, on this path: ADR 0033 had left
    *discard* as the only option here. A rider may now keep **one still per press** (D-3 below).
    D-2's per-ride keep is **not** restored, and its default (discard after analysis) is unchanged.
- **Does NOT supersede**: [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-5 (D-6 below adds a
  sentence beside it), D-8, D-9 (D-2 below says where its one strip point is), D-10 and D-11 (D-5
  below applies it to a picture on a screen); [ADR 0030](0030-what-the-app-may-say-about-a-body.md)
  in any part, D-3, D-4, D-7 and R4–R7 above all; [ADR 0033](0033-side-camera-link.md) D-4, D-7,
  D-8, D-9 and D-11. **Fit angles are ADR 0045's**
  ([#1059](https://github.com/openzigs/onyourleft/issues/1059), reserved and not yet written on
  2026-10-04), and nothing here draws or states an angle
- **Relates to**: [ADR 0013](0013-adr-amendments.md), [ADR 0024](0024-offline-and-caching-posture.md),
  [ADR 0026](0026-realistic-game-world.md), [ADR 0035](0035-model-written-ride-write-ups.md),
  [spike 0010](../spikes/0010-on-device-pose-model-cost.md),
  [spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md),
  [#527](https://github.com/openzigs/onyourleft/issues/527),
  [#554](https://github.com/openzigs/onyourleft/issues/554),
  [#557](https://github.com/openzigs/onyourleft/issues/557)

---

## Context

### What the owner ruled, quoted so it is not argued again

From the epic [#1055](https://github.com/openzigs/onyourleft/issues/1055), *"The owner's rulings of
2026-10-03. These are decided and are not reopened in any sub-issue"*:

| # | Ruling | What it supersedes |
|---|---|---|
| 1 | A live view **during setup and during the ride** | ADR 0033 D-6's *"Pose numbers never reach the HUD, the ride screen…"* |
| 2 | It shows the **camera picture with the pose outline** drawn on it | ADR 0033 D-6's *"No picture is ever displayed on the tablet"*, and D-3 reason 3 to the extent the transport needs it |
| 4 | **The rider can save a snapshot** | ADR 0033 D-6 (never stored), and ADR 0029 D-2 on this path, for an explicit still the rider presses for |
| 5 | These reverse the earlier "Preview: None" ruling | #527's ruling, and ADR 0033 §Context |

Ruling 3 (*"Add FIT now"*) is ADR 0045's ([#1059](https://github.com/openzigs/onyourleft/issues/1059)) and
is not decided here.

From the owner's comment on [#1058](https://github.com/openzigs/onyourleft/issues/1058),
2026-10-03:

> 3. **Snapshot and ride (#1058, #1063):** a snapshot is tied to the ride it was taken in. It shows
>    on that ride's page and is deleted with the ride and by the account erase. ADR 0044 records this
>    as a departure from ADR 0033 D-3's no-join rule for snapshots only.

### Why a new ADR and not an amendment

[ADR 0013](0013-adr-amendments.md) lets an appended amendment record that **a statement of fact**
has become true or false. These rulings **reverse decisions**: ADR 0033 D-6 decided that no picture
is ever shown or stored on the tablet, and the owner has decided the opposite on two counts. That is
a superseding ADR. ADR 0033 and ADR 0029 each gain an appended amendment in this pull request that
points here, so a reader of the old sentence finds the new one, and neither body is edited.

### What is true on `main` on 2026-10-04

- The phone sends single JPEG pictures on the `frames` data channel at about 5 per second and about
  256 px, each re-encoded from pixels on the phone (ADR 0033 D-3, ADR 0029 D-9's one strip point).
- The tablet decodes each to an `ImageBitmap` in memory, hands it to the pose model in a Web Worker
  (`apps/web/src/camera/pose-worker.ts`, `numPoses: 1`), and discards it. No object URL is created
  (`analysis-safety.test.ts` checks the camera modules for one).
- The tablet shows words only: pairing, framing, filming, link lost. The phone's own screen shows
  the picture, the guide and the ghost outline, but it is 2–3 m away and side-on.
- `CameraFrameRecord` (`packages/store/src/records.ts`) exists, written by nothing on this path,
  with **no activity id** and a header that tells the first issue with a frame tied to a ride to add
  the column, its index and its cascade.

### Why spike 0021 is not waited for

Spike 0021 ([#1057](https://github.com/openzigs/onyourleft/issues/1057)) measures JPEG frames
against a WebRTC video track on the devices. #1058 lists it as a blocker. The owner asked for this
ADR on 2026-10-04 ahead of it. Every decision below that depends on the transport is decided for
**both** outcomes (D-2), as ADR 0033 did for #532, so the spike's result is a fact to record and
not a decision to make. The fit capture rate, which the spike also measures, is #1064's and ADR
0045's, under D-2's rule.

---

## Decision

### D-1 — What of ADR 0033 D-6 stands, and what goes

| D-6 said | Now |
|---|---|
| *"Each picture is analysed as it arrives and discarded as soon as the analysis has produced its numbers"* | **Stands**, with the live view as a second consumer of the same picture in memory: it is drawn, then discarded. The live view never holds more than the picture it is drawing |
| *"No picture is ever written to storage on the tablet"* | **Stands, with one exception: a snapshot the rider pressed for** (D-3). Nothing else is written: not the live view, not a buffer of recent pictures, not a picture the model was looking at when a ride ended |
| *"No picture is ever displayed on the tablet"* | **Superseded** (rulings 2 and 5). It is displayed on the surfaces D-5 lists, and nowhere else |
| *"No object URL"* | **Stands, everywhere on this path, live view and snapshot alike** (*the author's choice*). A picture is drawn to a `<canvas>` from an `ImageBitmap`, and a stored snapshot is decoded with `createImageBitmap` and drawn the same way. Nothing on this path calls `URL.createObjectURL` or puts a `blob:` or `data:` URL in an `src`, so there is nothing a service worker could cache (ADR 0029 D-10) and nothing a long-press could save. If D-2's video track is chosen, its `MediaStream` is set on one `<video>` element's `srcObject`; that is not a URL, and the element is never given an `src`, `controls` or a download path |
| *"At most one picture waits for the model"* | **Stands.** The live view adds no queue: it draws the newest picture and drops any it did not get to, counted as D-6 counts the model's drops. **A queue of photographs in memory is still refused** |
| *"Pose numbers only, until the post-ride report"* | **Stands.** The landmarks the live view draws are the numbers the model already produces. A snapshot's landmarks are stored with it (D-3) and with nothing else |
| *"Pose numbers never reach the HUD, the ride screen, an announcement or a trainer"* | **Superseded for the outline on the live view only** (ruling 1). The outline is a drawing of where the model put the body. **It still never reaches an announcement, a sentence, a notice, the HUD's readings or a trainer**, and nothing reads it to decide anything (D-7) |

### D-2 — The transport for the live view, and the one strip point, for both outcomes of spike 0021

| | **(a) JPEG frames on `frames`** — the default until spike 0021 reports | **(b) A WebRTC video track** — only if spike 0021 recommends it for a view |
|---|---|---|
| **What the live view draws** | Each picture already received for the model, drawn to a canvas before it is discarded. No new message, no new rate | The track, played into one `<video>` element by `srcObject`, with the outline drawn on a canvas above it |
| **The one ADR 0029 D-9 strip point** | **Unchanged**: the phone re-encodes each picture from pixels into a JPEG. A snapshot is that JPEG, as received | **Still on the phone and still one**: the phone draws the camera's pixels to a canvas and sends **that canvas's** `captureStream()` track, never the camera's own track. An RTP video payload has no container and no container metadata (no MP4 atoms, no EXIF), and the canvas has none to give it. **A snapshot is not taken from the track's decoded frame directly**: it is drawn to a canvas on the tablet and JPEG-encoded there from pixels, which is a second encode of pixels and not a second strip point, because nothing it reads carries metadata |
| **ADR 0033 D-3** | **Unchanged** | Reason 3 and the *"single frames, not a clip"* row are **superseded for the live view only**. What the model analyses stays the `frames` channel's JPEGs, so *"the tablet could not know that it analysed what was captured"* still cannot happen to an analysis. The track is for looking at |
| **What a track adds to the gate** | Nothing | `no-network.test.ts` counts `RTCPeerConnection` constructors and not tracks. The track rides the existing connection to the paired phone with host candidates only (ADR 0033 D-1, D-4), so no new peer and no new origin is reached. The pull request that adds the track adds a unit assertion that the tablet adds **no** track of its own and the phone adds exactly one, shown red by mutation (`CLAUDE.md` §5) |

**The result is recorded by an appended amendment** on this ADR naming which column governs each of
the three uses spike 0021 names: the live view during framing, the live view during a ride, and the
fit capture. **A fit-check burst at a higher picture rate is a change to ADR 0033 D-3's *"about 5
per second"*.** It is permitted under this ADR on two conditions, so #1064 needs no further ADR: it
is still JPEG frames on `frames`, re-encoded on the phone (column (a)'s strip point), and the rate
and its duration are recorded by an amendment on ADR 0033 the way #385 was to record the base rate.

**D-3's join rule stands for the live view and for every pose number** (*"never with an arrival
time, a wall-clock time or an offset into the ride"*). D-4 departs from it for a snapshot only.

### D-3 — A snapshot: one still per press, and what is stored

> **The rule.** A snapshot is **one** picture, saved because the rider pressed a control that says
> it saves one. It is never a switch, never a mode, never *"keep this ride"*, never a burst and never
> taken on a timer, on a fit check finishing, or by anything but the press.

| | |
|---|---|
| **What is saved** | The picture on the live view when the press landed, as the bytes D-2 names for the transport in use, and nothing burned into it: **the outline is not drawn into the stored picture** (*the author's choice*), so the picture can be shown without it |
| **Where** | A `CameraFrameRecord`, owned by the athlete. It gains **an activity id** (D-4) and **a source**, `'side-camera-snapshot'`, so a reader can tell a pressed still from any other kind of kept frame a later path may write. The store's round trip compares the bytes byte for byte, as it already does |
| **The landmarks it was shown with** | **Stored with it, as numbers**: each landmark's model name and its position as a share of the picture's width and height, the shape `FramingLandmarkRecord` already has. So the ride page can draw the outline the rider saw over the picture, and turn it off. **No angle, no length, no segment ratio and no verdict is stored with a snapshot.** Those are ADR 0045's, and if ADR 0045 lets a fit number be shown with a snapshot, it says so there |
| **How many** | One per press. A second press makes a second snapshot. There is no cap the rider is not told about: if #1063 sets one, the control says so before the press, not after |
| **What it is never** | Shown in a list, a thumbnail, a share preview or a notification (D-5); sent to the rider's computer or a hosted model (nothing on this path sends one, and ADR 0029 D-7's hosted path never carries a picture); written anywhere but IndexedDB through the store |

**Why the picture and the outline are stored apart.** A picture with an outline burned in is a
picture whose derived part cannot be removed. Kept apart, the outline is a derivative the erase
reaches by name (D-6) and the ride page can show or hide.

### D-4 — A snapshot is tied to the ride it was taken in: the one departure from D-3's join rule

> **The rule, which is the owner's.** A snapshot carries the **activity id** of the ride it was
> taken in, shows on that ride's page, and is deleted **in the same transaction** as the ride, and by
> the account erase.

| | |
|---|---|
| **What the join is** | The activity id, and nothing else. **No offset into the ride, no arrival time, no wall-clock time and no ride reading** is stored with a snapshot. So a snapshot says *"during this ride"* and never *"at this moment of it"*, and nothing aligns it with a power or cadence sample |
| **A snapshot taken with no ride recording** | During setup and framing there is no ride. Such a snapshot has **no activity id**, is shown only from the Camera screen (D-5), and is deleted by the rider or by the erase. *The author's choice*, and the narrower one: the alternative, attaching it to the next ride, would be a join the rider did not make |
| **What it does to ADR 0029 D-2** | D-2's *"deleting the activity deletes its frames in the same transaction"* stops being vacuous on this path: #1063 adds the column, its index and its cascade, as `CameraFrameRecord`'s header asks, and a round-trip test shows a deleted ride leaves no snapshot behind |
| **What does not move** | Pose numbers and the post-ride report keep D-3's rule exactly. *"The camera stands alone"* is still true of every analysis: a snapshot is a photograph the rider chose to keep, not a measurement |

### D-5 — A shared device: where the picture may appear, and where it may never (ADR 0029 D-11)

ADR 0033 D-6 said D-11 *"does not newly apply"* because nothing was shown. **It now applies in full
to the live picture and to every snapshot.** A person near the tablet sees the rider, and anyone
else in frame, while the live view is on.

| **May appear** | **May never appear** |
|---|---|
| The **Camera screen's framing view**, while the rider has it open | The activity library, any list, row, card or thumbnail |
| The **in-ride live view**, only while the rider has it on (D-7) | A share sheet, a share preview, an exported activity file (ADR 0029 D-3), a notification, the lock screen or an Android recent-apps preview where the shell can prevent it |
| A snapshot, **on the page of the ride it was taken in**, below the fold of its default render and behind a control the rider presses to show it | The account screen, Settings, the Home screen, a route or workout screen, the credits, an error message (ADR 0029 D-8) |
| A snapshot with no ride, **on the Camera screen**, behind a control the rider presses | Anything the rider did not open deliberately (D-11 rule 1) |

*The author's choice* on the recent-apps preview: the Android shell sets `FLAG_SECURE` (or the
WebView equivalent) while the live view or a snapshot is on screen, if #1061 measures that it does
not blank the live view itself; if it does, #1061 records why and the row says "where the shell can
prevent it" honestly. **No PIN and no lock**, for ADR 0029 D-11's reasons, which are unchanged.

### D-6 — Bystanders, export and erase (ADR 0029 D-3, D-4 and D-5)

**Bystanders.** ADR 0029 D-5's sentence was written for a picture that reached a model. It stands,
word for word, in the consent. **A second sentence is added beside it for a screen**, drafted here
for the owner to approve on [#1060](https://github.com/openzigs/onyourleft/issues/1060) and shipped
by #1061:

> **The side camera's picture is shown on this tablet** while you set up and, if you leave it on,
> during a ride. Anyone who can see this screen can see you, and anyone else in the picture.

The outline is drawn for **one person only** (`numPoses: 1`, unchanged). A second person in frame
gets no outline and is not detected, marked or blurred, for D-5's reason: a detector's error mode is
a miss, and a screen that outlined *"the people it found"* would imply it had found them all.

**Export (D-3).** A snapshot is a kept frame. It is in the account export
([#35](https://github.com/openzigs/onyourleft/issues/35)) as its own file beside its ride, with its
landmarks, and `accountManifest` names it by field as *"a photograph of you"*. It is never in an
activity file handed to anybody.

**Erase (D-4).** `ERASE_REMOVES`' existing line, *"every photograph this device kept from a ride,
and everything derived from one"*, **already covers a snapshot and its landmarks**, and it stays
word for word. #1063 makes the enumeration reach the new column and source and proves it with the
store's erasure test. Nothing is added to `ERASE_CANNOT_REACH`: a snapshot never leaves the device.

### D-7 — During a ride

| | |
|---|---|
| **Off-able** | The in-ride live view is **off by default** (*the author's choice*; ruling 1 asks for it to exist, not to be on) and turned on and off by one control the rider reaches during the ride, which is a ride-time control (`design/ride-time-controls.ts`, 48 px). Its state is the device's, not the athlete's |
| **Never covers** | A ride control, a reading's panel, a standing notice, or **the rider in the game** (`game/camera.ts` §`riderFrameBox`, leaning). #1062 measures it in the browser gate at every viewport `ride.browser.spec.ts` uses, with a control that must fail |
| **The model stays in the worker** | Spike 0010: on the main thread, game-frame p95 went to 50–115 ms. The live view's drawing is the only main-thread work it adds, and its cost is spike 0021's to measure |
| **Shed first** | When the quality ladder steps down, **the live view is given up before the world loses anything**: it drops its rate, then stops drawing and says *"Live view paused to keep the ride smooth"*, and comes back when the ladder recovers. Analysis continues either way |
| **It says nothing** | [ADR 0030](0030-what-the-app-may-say-about-a-body.md) D-7's silence rule and R7 are **untouched**. The live view has no announcement, no sound, no colour change that means something, no highlight on a joint and no text but its own on/off state. The outline is a drawing, not a judgement |
| **No angle** | **No angle, length or number is drawn on the live view.** If ADR 0045 names the live view as an angle surface, it says so there by name, and this row is the one it changes |

### D-8 — Which artefacts change, in which pull request (ADR 0033 D-10)

ADR 0033 D-10's rule stands: **a published statement is true of the shipped app at every merge**,
and changes in the pull request that makes it true. **This ADR changes none of them.** The wording
of each is drafted and **approved by the owner on #1060**, before any of it merges.

| Artefact | Changes in | What changes |
|---|---|---|
| [`docs/privacy-policy.md`](../privacy-policy.md), the side-camera section and its data-table rows | **#1061** (*"shown"*), **#1063** (*"a snapshot you press is kept"*) | Shown on this tablet; anyone near it can see it; never kept unless you press; a snapshot stays with its ride until you delete it, is in the account export and is removed by *Erase everything* |
| `apps/mobile/src/android/data-safety.ts`, the **Photos and videos** `why` | **#1061** (*"shown"*), **#1063** (*"stored"*) | *"never stored, shown or sent on"* loses *"shown"*, then *"stored"* for anything but a pressed snapshot. `collected: true` stays, for #387's path. Play's own text is re-read first-hand in each |
| `apps/web/src/camera/consent.ts` | **#1061** | D-6's screen sentence, beside D-5's, unchanged |
| ADR 0033 D-6 | **this pull request** | An appended amendment pointing here |
| ADR 0029 D-2 | **this pull request** | An appended amendment pointing here |
| `analysis-safety.test.ts`'s object-URL rule | **#1061** | Extended to every module the live view and snapshot add, not relaxed |

---

## Consequences

### What this enables

- The rider on the bike sees what the side camera sees, with the outline, at the distance they
  ride from, where today they have to walk to the phone.
- A rider can keep a picture of themselves on a ride's page, and get it back in the export.
- Fit capture (#1064) can choose a higher picture rate without another ADR.

### What this costs, stated plainly

- **The tablet now shows a photograph of a person.** Everything ADR 0029 D-11 says about a shared
  device, which ADR 0033 could set aside, now applies, and the defence is still the operating
  system's lock. D-5 keeps the picture off incidental surfaces; it does not stop a person who looks.
- **A snapshot is the first picture this path stores.** The account export becomes a set of
  photographs as ADR 0029 D-3 warned, and the ride page becomes a place a photograph can be found.
- **Two published statements become false the day each feature ships**, and must change with it
  (D-8). A build that showed the picture with the policy still saying *"never shown"* would be a
  false statement in the owner's name.
- **If spike 0021 chooses a video track**, there is a second media path on the link that no
  current gate models beyond the connection count, and a second encode on the tablet for a snapshot.

### Constraints this places on other work

- **#1061** (live view, setup): D-1, D-2 (a), D-5, D-6's sentence, D-8's first rows; no object URL.
- **#1062** (live view, ride): D-7 in full, measured in the browser gate with a failing control.
- **#1063** (snapshot): D-3, D-4, D-6's export and erase; the `CameraFrameRecord` column, source,
  index and cascade with a round-trip and erasure test, and the fakes extended (`CLAUDE.md` §5).
- **#1064** (fit capture): D-2's burst rule; an amendment on ADR 0033 records the rate.
- **#1057** (spike 0021): its result is recorded as an amendment here, naming a column of D-2 for
  each of its three uses.
- **ADR 0045** (#1059): any angle on the live view or with a snapshot is named there, by D-3 and D-7.

## What was considered and rejected, 2026-10-04

- **Burning the outline into the stored snapshot.** Simpler to show, but the derivative could not be
  removed from the picture, and the picture could never be shown without it (D-3).
- **Attaching a framing-time snapshot to the next ride.** A join the rider did not make (D-4).
- **The live view on by default during a ride.** Ruling 1 asks for the view to be available. A
  photograph on a screen others can see should be something the rider turns on.
- **An object URL for the snapshot on the ride page.** The shortest route to an `<img>`, and the
  one ADR 0029 D-10 and ADR 0033 D-6 refused for a reason that has not changed.
- **Outlining every person in frame.** Implies detection the model does not do (D-6).

## What would make this ADR wrong

- **Spike 0021 finds that drawing the picture on the main thread costs the ride**, at any rate the
  live view could use. D-7's *"shed first"* then means the in-ride view is never on in practice, and
  ruling 1's in-ride half needs a design this ADR does not have.
- **A canvas `captureStream()` track carries metadata after all**, or a WebView passes the camera's
  own track through where a canvas's was asked for. D-2 (b)'s *"still one strip point"* is then
  false, and only column (a) may be used.
- **The Android shell cannot keep the picture out of the recent-apps preview** without blanking the
  live view itself. D-5's row then says less than it promises and must be reworded by amendment.
- **A snapshot's landmarks turn out to be enough to reconstruct the picture.** They are a handful of
  points, but if that changed, D-3's *"stored apart so it can be removed"* would be storing the
  picture twice.
- **The owner wants a snapshot shared, sent to a model, or shown in a list.** D-3 and D-5 are then
  superseded, and ADR 0029 D-3, D-7 and D-11 govern that picture.
