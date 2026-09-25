# ADR 0029: Camera imagery is its own data class — what a frame is, where it may go, and which pipe it may travel down

- **Status**: Accepted — for the decisions below, **and four named questions in
  §"What the owner has not decided" are explicitly NOT decided and are the owner's.** **D-0** means
  nothing can be built until they are, so an Accepted status here cannot cause code to be written
  against an unanswered question. The alternative — `Proposed` — was rejected for
  [ADR 0007](0007-patent-posture.md)'s own reason, restated by [ADR 0028](0028-racing-fairness.md):
  every Phase B and Phase C issue on [#377](https://github.com/openzigs/onyourleft/issues/377) is
  blocked on this document, and an ADR a reader is told not to rely on cannot block anything
- **Date**: 2026-09-22
- **Deciders**: the author, on the engineering content. ⚠️ **No owner decision was sought or given
  for this ADR.** The owner's recorded decisions are **D-A**, **D-B** and **D-C** in #377's body,
  quoted in Context; **D-B** is what this document turns into rules. Four of #377's six open
  questions are this ADR's subject matter and are listed rather than answered — the shape
  [ADR 0028](0028-racing-fairness.md) used
- **Issue**: [#378](https://github.com/openzigs/onyourleft/issues/378). Parent
  [#377](https://github.com/openzigs/onyourleft/issues/377)
- **Number**: **0029**. [`docs/architecture.md`](../architecture.md)'s ownership table is the check
  `CLAUDE.md` §7 asks for; it recorded 0029 as the next free number after
  [ADR 0028](0028-racing-fairness.md) took 0028. ⚠️ **0021 is a live reservation**
  ([#330](https://github.com/openzigs/onyourleft/issues/330), unwritten) and is left alone for
  [ADR 0022](0022-game-scenery-model-pack.md)'s reason: a written ADR cannot be renumbered without
  breaking citations, so a collision would land on the reservation rather than here
- **Supersedes**: nothing. ⚠️ In particular it does **not** supersede, relax or restate
  [ADR 0004](0004-privacy-and-location.md). It **extends** that ADR's decision **D** to a second
  channel (**D-8** below) and leaves every other decision in it exactly as written
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) (what "local-first" does and does not
  promise about a frame), [ADR 0004](0004-privacy-and-location.md) (the model this one is
  deliberately *not* a copy of), [ADR 0014](0014-portable-identity.md) (why an erase is
  irreversible), [ADR 0024](0024-offline-and-caching-posture.md) (the caches a frame must never
  reach), [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) (what may be at the other end
  of the pipe D-6 and D-7 describe),
  [#34](https://github.com/openzigs/onyourleft/issues/34),
  [#35](https://github.com/openzigs/onyourleft/issues/35),
  [#95](https://github.com/openzigs/onyourleft/issues/95),
  [#328](https://github.com/openzigs/onyourleft/issues/328),
  [#382](https://github.com/openzigs/onyourleft/issues/382),
  [#383](https://github.com/openzigs/onyourleft/issues/383),
  [#384](https://github.com/openzigs/onyourleft/issues/384),
  [#387](https://github.com/openzigs/onyourleft/issues/387)

---

## Context

### The question, and why ADR 0004 does not already answer it

[ADR 0004](0004-privacy-and-location.md) is this repository's privacy model, and it is about
**coordinates**: where a named person was, at 1 Hz, on the days they left the house. Its threat
model, its privacy zones, its jitter and its coordinate-message rule are all built around a stream
of numbers that *implies* a place.

**A photograph does not imply a place. It is one, and it has the rider in it.** A single frame of a
rider on a trainer in their spare room discloses, in one artefact and with no correlation attack
required: the inside of a dwelling, its contents, who else is in it, what the rider's body looks
like, and — through EXIF, which is metadata a JPEG carries and a GPS-capable device writes without
being asked — possibly the coordinate ADR 0004 spends six hundred lines protecting.

So the tempting move is to take ADR 0004's threat-model table and swap the noun. #378's own body
forbids it, and it is right to: every row of ADR 0004's table is about an **adversary reading a
published artefact**, and in Phase 1 of this epic nothing is published. The rows that matter here
are about artefacts that are never published and leak anyway — a cache, a log line, a crash report,
a third party's TLS terminator, a second person walking behind the bike. **So this ADR has its own
threat-model table, in ADR 0004's shape and with none of its rows**, and it is below.

### The threat model

Stated up front, for ADR 0004's own reason — *"a privacy model without a threat model is a mood"* —
and in its shape: the left column is the thing that could happen, the right is whether this document
defends against it and by what. ⚠️ **The rows are paths a frame could take, not adversaries reading
a published page**, because in this epic nothing is published: the exposure is a byte that was never
meant to be durable and became durable anyway.

| What could happen to a frame | Defended? |
|---|---|
| **It reaches durable storage** — IndexedDB, a file, a temporary directory — as a side effect of being analysed | **Yes, by default** — D-2 discards after analysis and writes nothing. A frame becomes durable only when the rider turns on a per-ride keep, which is off every time |
| **It reaches a cache** — Cache Storage, `localStorage`, an HTTP cache, the service worker's fetch path | **Yes** — D-10 forbids all four by name, and D-7's hosted request is a `POST` for that reason. ⚠️ This is the row most likely to fail *later*: ADR 0024 precaches by URL and a future handler written by somebody who never read this ADR is the failure mode |
| **It reaches a log line or a crash report** | **Yes, by rule; partly, in fact** — D-8 forbids the frame, a crop, a thumbnail and a locator in every layer that formats one, and the standing constraint against a transmitting crash-reporting SDK is inherited from ADR 0004 D. ⚠️ **A rule about what goes into a log is only as good as the review that reads the diff**; D-8 is not machine-checkable today and says so |
| **It reaches an error message** | **Yes** — D-8. This is ADR 0004 D extended, and it binds **harder**: that rule lets a non-coordinate quantity keep its value because *"the value is most of the diagnostic"*, and nothing about an image is diagnosed by having the image in the message |
| **It crosses a third party in plaintext** because the transport's operator terminates TLS | **Yes** — D-6 rejects Cloudflare Tunnel **by name** for this payload, on a dated finding, and permits only a LAN or a WireGuard-class overlay that relays ciphertext. This is the row the whole transport decision exists for, because the failure arrives looking like plumbing |
| **It carries the rider's front door in EXIF** to wherever it goes next | **Yes, by construction** — D-9 strips at capture by re-encoding from raw pixels, in one place. ⚠️ **Not by the privacy walk**: `coordinatesIn` cannot see inside a `Blob`, so a departing boundary over a payload with a frame in it is green for a reason unrelated to the frame |
| **A bystander is in frame** | **No, and deliberately** — D-5 refuses to blur and tells the rider so before the camera is switched on, because a detector that misses is worse than a sentence that was honest. The bystander's only signal is the live-camera indicator. **This is the row this ADR defends least and says so most plainly** |
| **The device is shared between people** — a partner, a housemate, a child, a repair shop, a resale | **No access control exists**, and D-11 is what limits the blast radius rather than preventing it. Under D-2's default there is nothing on the disk to find; where the rider kept frames, anyone with the unlocked device can reach them, and D-11 keeps them off every screen somebody would meet by accident. ⚠️ **Materially worse than ADR 0004's own "No" for the same row**, because a trace says where the athlete went and a kept frame is a photograph of the room the device is sitting in |
| **A hosted model keeps a copy** the rider cannot delete | **No, and it is said before the fact** — D-7 makes it opt-in, on the rider's own key, on a press, never default and never silent, and the consent wording says *"we cannot delete it for you afterwards"*. D-4 puts the same sentence in `ERASE_CANNOT_REACH`. There is no mechanism to compel a vendor's deletion and this document does not pretend there is |
| **An account export becomes a set of photographs of a house**, and is then handed on | **Partly** — D-3 carries kept frames untrimmed, because ADR 0004 E's invariant is that the athlete's own data comes back whole. What defends it is the delivery rule (authenticated, single-use, short-lived, never by email) and the export screen saying in words that the archive contains frames. **A rider who forwards it has made a disclosure decision**, exactly as ADR 0004 says of approving a follower |
| **A shared activity file carries one** to whoever the rider sends it to | **Yes, absolutely** — D-3 forbids it with no per-export opt-out, because a photograph inside a FIT, GPX or TCX file is a disclosure the format gives the recipient no way to notice and the sender no way to see |

### What the owner has already decided, quoted so it is not re-litigated

From #377's body, 2026-09-19:

> **D-A** — **Post-ride first, live second.** Phase one captures stills or short clips during the
> ride and analyses them **afterwards** …
>
> **D-B** — **Privacy boundary: the rider's own machine by default.** A rider MAY additionally opt
> in to a hosted model by supplying their own API key. That needs an explicit consent flow, a plain
> statement of exactly what is transmitted, and an ADR on third-party image egress. **Third-party
> egress is never the default and never silent.**
>
> **D-C** — **Share the camera with #328, keep the decisions separate.** ONE camera-capture pipeline
> and ONE consent flow, built once, used by both.

**This ADR is the document D-B asks for.** D-A's phasing is why the retention question is answerable
at all: a post-ride report can be produced from a frame that is then thrown away, which a live coach
cannot.

### The one fact that makes the transport question a privacy question rather than plumbing

**Cloudflare terminates TLS at its edge.** That is how the proxy works — it is what enables the WAF,
the cache and Access policies — and it is not a misconfiguration anybody could correct. #377 records
five independent sources read 2026-09-19, including a vendor comparison stating it plainly for
Cloudflare Access: *"No. Encrypted data in transit via HTTPS, but not end-to-end encryption.
Cloudflare's edge network terminates TLS connections and can inspect traffic."*

The consequence for this payload, specifically: **a photograph of the rider in their home would
exist in plaintext on a third party's infrastructure on every single capture** — on the path #377's
own sketch proposes as *"the rider's own machine"*. That is a strictly worse posture than the hosted
API path D-B gates behind explicit consent, and it would arrive unannounced **because it looks like
plumbing**. D-6 is the decision that stops it, and it names the product rather than describing a
property, because a rule that says "avoid proxies that terminate TLS" is one nobody can check
against a vendor page.

### What already models this in the repository, and the one place the model has a hole

`apps/web/src/privacy/boundaries.ts` declares every boundary as **`departing`** (for somebody else —
no coordinate anywhere in the payload may lie inside a privacy zone) or **`retained`** (the
athlete's own data coming back to them — a trim here is the bug), and `coordinatesIn` walks the
payload *structurally* so that a field added tomorrow is covered without anybody remembering the
file exists.

⚠️ **`coordinatesIn` cannot see a coordinate inside an image.** It matches objects carrying finite
numeric `latitude` and `longitude`; a JPEG's EXIF GPS IFD is bytes inside a `Blob`, and the walk
reports a clean payload over a file that names the rider's house to six decimal places. The file's
own header already warns that a bare `[longitude, latitude]` pair is invisible to it for a
structural reason; this is the same class of blindness one layer down, and it is worse, because the
`Blob` case *looks* covered. **D-9 is the decision that closes it, and it closes it by construction
rather than by asking the walk to parse image formats.**

---

## Decision

Eleven rules. **D-0** says nothing is built yet. **D-1** to **D-5** are about the bytes on the
device; **D-6** and **D-7** are about the bytes leaving it; **D-8** and **D-9** are the two rules
that bind every other layer; **D-10** and **D-11** are the two rows of the threat model above that
nothing else in the list answers.

### D-0 — Nothing is built until Phase A lands and four questions are answered, and this ADR builds nothing

| Block | What would clear it |
|---|---|
| **Phase A is not complete** | #377's own rule: no Phase B, C or D issue starts until #378, #379, #380 and #381 are closed |
| **Four questions are the owner's** | §"What the owner has not decided" — #377's open questions 1, 2, 3 and 4. **Question 1 is load-bearing**: the first byte this client sends anywhere turns `no-network.test.ts` red and obliges a privacy-policy change and a Data Safety re-filing |
| **There is no camera code** | #382 and #383. This ADR writes none and adds no permission, port or dependency |

⚠️ **An `Accepted` status is not a licence to start.** It is what lets #382–#390 be *written against*
these rules while the questions are outstanding.

### D-1 — A captured frame is its own data class, and it is never "another sensor channel"

> **The rule.** Camera imagery — a still, a clip, and **anything from which a frame could be
> reconstructed** — is a distinct class in this program. It is never modelled as a stream channel
> beside power, cadence and heart rate, never stored in a `StreamSet`, and never covered by a rule
> whose subject is "activity data".

Three reasons, and the third is the operative one:

1. **Its sensitivity is categorically different.** Heart rate says how hard somebody worked. A frame
   says what their house looks like and who was in it.
2. **Its lifetime is different.** Every other channel in this program is kept for ever by default
   (ADR 0004 F: *"Retention is the athlete's own disk and nothing expires"*). D-2 says a frame is
   not.
3. **A shared rule is a rule that gets widened by accident.** `StreamSet` is written to by the
   recorder, read by the detail view, downsampled into a chart, exported into a FIT file and packed
   into an account export. A frame that rode inside it would inherit five behaviours nobody chose
   for it, and each of them is a path this ADR forbids.

**What follows for #384**: a captured frame is its own store record with its own retention, not a
column on an existing one, and the `PersistentStore` write path it adds brings its own entry in
`packages/store/src/testing/fakes.ts` — which is not optional, because the type does not compile
until it does.

### D-2 — Retention: **discarded after analysis**, with an explicit per-ride keep the rider turns on

> **The rule.** The default is that a frame is destroyed as soon as the analysis that consumed it
> has produced its result, and never written to durable storage at all. A rider may turn on
> *"keep the frames from this ride"* for **one ride at a time**; the switch does not persist across
> rides, and there is no global "always keep".

| | |
|---|---|
| **Default** | Discarded. A frame lives in memory for the length of one analysis and is not written to IndexedDB, to Cache Storage, to a file, or to a temporary directory |
| **If the rider keeps it** | Written as a `CameraFrame` record, owned by the athlete, with the activity id it belongs to. **Kept until the rider deletes it, the activity, or the device** — there is no expiry timer, for the reason below |
| **What expires it** | Deleting the activity deletes its frames in the same transaction, the way ADR 0004 F requires of a stream. Nothing else expires it |
| **What the switch is not** | It is not a setting. It is a per-ride control on the capture screen, off every time |

**Why not a timer.** A "frames are deleted after 30 days" promise is the shape of promise this
repository refuses elsewhere: it is true only while the app is opened, and a rider who stops using
the app for a year is the one it was written for. A deletion that depends on the program running is
not a deletion, it is a hope. Deleting on the rider's action is checkable by
`@onyourleft/store/testing`'s round trip; deleting on a clock is not.

**Why per-ride rather than a setting.** The useful version of this feature — compare this week's
position with last month's — needs frames kept, and #377's own open question 3 says so: *"The second
is far more useful and far more sensitive."* A setting turned on once in March is consent given
once for every ride since. A per-ride control is the rider deciding each time, which is what the
sensitivity buys.

⚠️ **This is the author's engineering choice on a question #377 lists as the owner's** (open
question 3). It is written as a decision because #378's acceptance criteria require one, and it is
the **narrower** of the two options — widening it to "held by default" is the owner's and is listed
in §"What the owner has not decided". Narrowing later costs nothing; widening later means deciding
retrospectively for frames that already exist, which is exactly the failure ADR 0004's §"Why this is
decided in Phase 0" describes.

### D-3 — Export: a kept frame is in the account export; a discarded one is in nothing; and it is named in the manifest

- **An account export** ([#35](https://github.com/openzigs/onyourleft/issues/35)) carries every
  **kept** frame, as its own file beside the activity file, in the shape ADR 0019 chose for a signed
  record. It is the athlete's own data coming back to them, so ADR 0004 E applies unchanged: it is
  **not** obfuscated, trimmed or downscaled.
- **`accountManifest` names it**, in the same style it already names everything else — fields, not
  a spread row — and lists **"a photograph of you"** in the *what an activity file cannot carry*
  list by name. It is the most extreme member of that list: a FIT, GPX or TCX file has no field for
  an image at all, so unlike a lap or a signed record this is not a lossy carry, it is no carry.
- **An activity export to a third party never carries a frame**, whatever the rider's visibility
  setting says, and there is no per-export opt-out of the kind ADR 0004 E offers for a full track.
  A shared activity file is a file the rider hands to somebody; a photograph in it is a disclosure
  the file's format gives them no way to notice.
- ⚠️ **The account export becomes strictly more dangerous.** ADR 0004 E already calls it *"the most
  concentrated location dataset the system ever produces — a single file naming where the athlete
  lives"*. With frames in it, it is that **and** a set of photographs of the inside of the house.
  ADR 0004 E's delivery rule — authenticated, single-use, short-lived, never by email — is
  unchanged in wording and considerably more load-bearing in effect, and the export screen says so
  in words when the archive contains frames.

### D-4 — Erase: `ERASE_REMOVES` by name, and two honest lines in `ERASE_CANNOT_REACH`

`apps/web/src/transfer/erase-device.ts` carries two lists, and a frame belongs in both.

**`ERASE_REMOVES` gains, by name:**

> every photograph this device kept from a ride, and everything derived from one

The second half is the half that is easy to drop. A frame's *derivatives* — a pose skeleton, a set
of joint coordinates, a model's description of the rider, a thumbnail generated for a report — are
each a smaller artefact that says the same thing about the same person, and a purge that removed the
frame and left the skeleton would be exactly ADR 0004 F's *"a deletion that leaves a derived
artefact is not a deletion"*. The enumeration is derived from the schema rather than written out, as
#35's criteria already require.

**`ERASE_CANNOT_REACH` gains, by name:**

> a photograph you sent to your own machine to be analysed, which is a copy that machine holds

> a photograph you sent to a hosted model, which is a copy that service holds

Both are true, both are unpleasant, and both must be on the screen **before** the rider presses
anything rather than discovered afterwards. The second is the more important: a hosted vendor's
retention is that vendor's policy, not ours, and this project has no mechanism to compel a deletion
from it — which is the same honesty ADR 0004 F applies to a federated record and for the same
reason.

### D-5 — Bystanders: a sentence in the consent screen. **No blur, and the refusal is the decision**

> **The rule.** A person who is not the rider may appear in frame, and this program neither detects
> that nor obscures it. What it does instead is say so, in the consent screen, before the camera is
> ever turned on, in these words:

> **Anyone in the room will be in the picture.** This app cannot tell who is in a frame and does not
> try to hide anyone. If somebody else might walk behind you, point the camera so they will not be
> in it, or leave the camera off.

**Why not blur, stated as #378's acceptance criterion requires — by naming the second model and its
error mode.** Automatic blurring means a second model — a face or person detector, which is what
every implementation of this is — running on every frame, and its error mode is a **missed
detection**: a face at the edge of the frame, in profile, partly occluded, at low light, in motion,
or at the resolution a 4-bit model actually gets. A blur that misses is worse than a sentence that
was honest, for the reason this repository states about every other guard it will not build: the
green result is indistinguishable from the correct one. A rider who has been told "faces are
blurred" has been given a reason to stop pointing the camera carefully, and the one frame the
detector missed is the one that leaves the device.

Two further points, because "we will not blur" is not the whole answer:

- **A bystander never consented and cannot.** Nothing in this design gives them a control, and
  saying otherwise would be a lie. What the design gives them instead is that the rider is told,
  before the fact, that the remedy is where to point the camera.
- **The live-camera indicator is the bystander's only signal**, and #377's Phase B already requires
  it to be **independent of the operating system's**. That is not decoration: it is the one thing in
  the room that tells somebody walking in that a camera is running, and it must be visible from
  where a person would enter, not only to the rider on the bike.

⚠️ **This is the author's engineering choice on #377's open question 4, which is the owner's.** It
is the **narrowest** of the three options that issue names, and widening it to a blur or to a
consent event is listed in §"What the owner has not decided".

### D-6 — Transport: LAN first; Tailscale-class WireGuard if remote; **Cloudflare Tunnel is rejected by name**

> **The rule.** A frame may travel over (1) the local network, to an endpoint the rider typed, or
> (2) a peer-to-peer WireGuard-class overlay where the relay forwards **ciphertext** only. It may
> not travel over a transport whose operator can read it.

| Transport | Ruling | Why |
|---|---|---|
| **Plain LAN** | **Adopted, and the default** | The phone and the machine are in the same room during an indoor ride. No tunnel, no third party, no account, zero cost. This is the case the feature actually has |
| **Tailscale / WireGuard / NetBird** | **Permitted** for the remote case | Peer-to-peer and end-to-end encrypted; DERP relays forward ciphertext only. The relay operator holds bytes it cannot read |
| **Cloudflare Tunnel** | ⚠️ **REJECTED for this payload, by name** | **Cloudflare terminates TLS at its edge.** Read 2026-09-19, five independent sources, recorded in #377. A photograph of the rider in their home would exist in plaintext on a third party's infrastructure **on every single capture** |
| **WebRTC** | **Out** | It needs signalling infrastructure, which is a server we do not have and which owner decision D6 forbids in Phase 1 |

⚠️ **The rejection is of the product by name and not of a property**, deliberately. A rule reading
*"do not use a proxy that terminates TLS"* is one nobody can check against a vendor page — the
vendor's page describes it as security rather than as interception, truthfully, because for most
payloads it is. Naming the product is what makes a future pull request proposing it a decision
somebody has to argue with rather than a configuration nobody reads.

⚠️ **What this rejection is NOT.** It is not a judgement about Cloudflare, about Cloudflare Tunnel
for any other purpose, or about this project's other uses of a CDN — [ADR 0010](0010-map-tiles-and-routing.md)
puts basemap tiles behind one and nothing here disturbs that. A tile is public map data; a frame is
a photograph of somebody's house. The ruling is about **this payload**, and it says so.

⚠️ **This decision is reversible only by a superseding ADR**, and the argument it would have to make
is that the operator cannot read the payload — not that the risk is small, not that the operator is
trustworthy, and not that it is convenient.

### D-7 — The hosted path: exactly what leaves, to where, on whose key, and the words the rider reads

Owner decision **D-B** permits a hosted model **on the rider's own key, opted into, never default and
never silent**. What that means precisely:

| | |
|---|---|
| **What bytes leave** | The frame, and a fixed prompt this repository's source contains. **Nothing else** — no athlete id, no activity id, no device key, no signed record, no position, no heart rate, no serial, and no filename |
| **Which origin** | **The one the rider typed.** See [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4: this client ships no vendor list, no default endpoint and no vendor name in source |
| **Whose key** | The rider's own, entered by them, stored on the device, never in an export and never in a log. It is not a secret this project holds and `.env.example` gains nothing |
| **When** | Only for a frame the rider is looking at, on a press. Never on a timer, never in the background, and never for a frame captured under D-2's default |
| **What comes back** | Untrusted input. See D-8 |

**The consent screen's words, quoted here so Phase C implements a sentence somebody ruled on:**

> **This sends a photograph of you to a service you have chosen.**
>
> If you turn this on, each picture you pick is uploaded to the address you entered, using the key
> you entered. That is a company or a computer that is not yours and not ours, and we cannot see
> what they do with it or how long they keep it. We cannot delete it for you afterwards.
>
> We send the picture and nothing else — not your name, not your rides, not where you were.
>
> **You do not need this.** The app can do the same analysis on a machine in your own house, and
> that is what it does unless you turn this on.
>
> This is off. It stays off until you turn it on, and you can turn it off again at any time.

Three things about that wording are decisions rather than tone. It says **"a photograph of you"**
rather than "image data", because the second is what makes a person click through. It says
**"we cannot delete it for you afterwards"**, which is D-4's `ERASE_CANNOT_REACH` line said before
the fact rather than after. And it says **"you do not need this"**, because a consent screen that
only lists risks reads as a formality; one that names the alternative is a choice.

### D-8 — ADR 0004 decision D, extended: **an error message never carries a frame, a crop, a thumbnail, or a path to one**

> **The rule.** Where ADR 0004 D says a message about a coordinate may name the field and the
> constraint and never the value, this says a message about imagery may name **that there was an
> image** and **what went wrong with it**, and must never carry the image, a part of it, a rendering
> of it, or a locator for it.

| Permitted | Forbidden |
|---|---|
| `the picture could not be read` | any data URL, base64 blob or `blob:` URL |
| `the picture is larger than this device will analyse` | a thumbnail, a crop, a downscale, a single pixel sample |
| `the analysis service did not answer` | a filesystem path, a cache key, an object URL, a content hash |
| a count, a byte size, a format name | the frame's own timestamp where it is the only frame |

**Scope is every layer that formats one**, exactly as ADR 0004 D is scoped: an error message, a log
line, a toast, a crash report, a diagnostic breadcrumb, and any Phase 4 error body. And **it binds
harder than the coordinate rule does**, because ADR 0004 D permits every non-coordinate quantity to
keep its value on the argument that *"the value is most of the diagnostic"*. That argument does not
transfer: nothing about an image is diagnosed by having the image in the log.

Two corollaries that are the ones actually likely to be got wrong:

- **A model's text response is untrusted input and is never interpolated into a path, a URL, a
  command, or anything that reaches a trainer control point.** #377 records this as a security
  consideration; it is stated here as a rule because the severe case is the trainer, which
  `CLAUDE.md` §6 treats as a safety issue *"because a smart trainer applies physical resistance to
  a person who is pedalling"*. A VLM's output is attacker-influenceable through the image.
- **The standing constraint in ADR 0004 D is inherited unchanged**: the client ships no third-party
  analytics or crash-reporting SDK that transmits off-device by default. A rule about what goes into
  a log is unenforceable next to an SDK that ships the whole log somewhere, and a log with a frame
  in it is the worst version of that.

### D-9 — Metadata is stripped at capture, before anything else, and the privacy walk cannot check it

> **The rule.** A frame is stripped of **all** metadata at the moment it is captured — re-encoded
> from raw pixels, not filtered — before it is analysed, kept, sent anywhere, or handed to any other
> module. There is exactly one place this happens and it is inside the capture port.

**Why at capture and not at the boundary.** `apps/web/src/privacy/boundaries.ts` is the repository's
boundary check and **it cannot see inside a `Blob`**. `coordinatesIn` walks a JavaScript structure
for objects carrying finite numeric `latitude` and `longitude`; an EXIF GPS IFD is bytes, and the
walk reports a clean payload over a file that names the rider's front door. So a departing boundary
declared over a payload containing a frame is **green for a reason unrelated to the frame**, which
is the shape of green result this repository keeps finding. Stripping at capture is the only
placement where the property holds for every consumer — including ones written later by somebody who
never reads this ADR.

**And the boundary registry still gains its entries**, because the direction matters even where the
walk is blind:

| Boundary | Kind | What it means here |
|---|---|---|
| A frame to the rider's own machine for analysis | **`departing`** | It is leaving the athlete's control. #377's own sequence diagram says so |
| A frame to a hosted model (D-7) | **`departing`** | Same, plus a third party |
| A kept frame in an account export | **`retained`** | The athlete's own data coming back to them. **A trim here is the bug** — ADR 0004 E |
| A frame in a shared activity file | **does not exist** | D-3 forbids it, so there is no boundary to declare |

⚠️ **`boundaries.ts` must say in its own header that it cannot inspect image bytes**, so that a
future reader does not take a green walk as evidence about a frame. That note is #384's, and it is
an acceptance criterion rather than a courtesy.

### D-10 — A frame never reaches a cache, and the service worker is the specific risk

[ADR 0024](0024-offline-and-caching-posture.md) precaches this application's whole asset graph and
`apps/web/src/offline/` serves from Cache Storage. A frame must never enter it, and the reason it
might is not carelessness: the worker's fetch handlers are written over an injected scope and a
future handler that caches responses by URL would cache a `blob:` or a `POST` reply without anybody
intending it.

> **The rule.** No frame, and nothing derived from one, is written to Cache Storage, to
> `localStorage`, to `sessionStorage`, or to any HTTP cache. A request carrying a frame is never
> handled by the service worker's caching path.

The same rule is why D-7's hosted request is a `POST` to an origin the rider typed rather than a
`GET` of a URL — a `GET` is cacheable by every layer between here and there, and some of them are
not ours.

### D-11 — A device shared between people: there is no access control, and a kept frame is never on a screen somebody could meet by accident

ADR 0004's threat model answers *"Someone with the athlete's unlocked device"* with a flat **No**,
and that answer is inherited here rather than improved on. It is worth saying exactly how little
stands in the way, because the reader's instinct is that *something* does:

- **There is no sign-in and no device lock in this program.** `apps/web/src/local-athlete.ts` says
  it in terms — *"There is no server and no sign-in in Phase 1 (owner decision D6), so every ride
  belongs to a fixed local identity"*. There is **one** athlete on a device, so two people sharing
  it are not two profiles; they are the same row.
- **The athlete scoping in `packages/store` is not an access control.**
  `activity-store.scoping.test.ts` exists to stop a query matching an entity id without also
  filtering on its owner. That is a correctness boundary against cross-athlete *reads in code*, and
  it defends nothing at all against a person holding the unlocked device.
- **IndexedDB is readable by anything running in the origin.** So is Cache Storage. The defence
  against a second person is the operating system's screen lock, which is not ours and which this
  document cannot assume is on.

> **The rule.** This ADR does not invent an access control, and Phase B must not either. What it
> does instead is keep the blast radius at what D-2 already chose, and keep a kept frame off every
> surface a person who did not take it would meet without asking for it:
>
> 1. **No frame, thumbnail, crop or filmstrip appears on the activity library row, in the ride
>    detail view's default render, in the workout or route screens, in a share sheet's preview, or
>    in any list.** A kept frame is reached from the report the rider opens deliberately, and from
>    nowhere else.
> 2. **The per-ride keep is off every time** (D-2), so the ordinary state of a shared device is one
>    with no frames on it at all. That is not a mitigation bolted on; it is the reason D-2 chose the
>    narrower default, stated for the row it protects.
> 3. **The erase is the remedy and it is honest about being the only one** — D-4's `ERASE_REMOVES`
>    line covers frames and their derivatives, and a rider handing a device on is the case it is
>    for.

**Why a rule about screens rather than a lock.** A per-feature PIN is the obvious answer and it is
the wrong one at this size: it would be the only credential in a program that has deliberately none
(ADR 0014 — the device keypair is an identity, not an authenticator), it protects nothing from
anybody who can open the browser's storage inspector, and it would read to a rider as a promise the
software cannot keep. Keeping frames off incidental surfaces is a smaller claim that is **true**,
and it is checkable in review of #384 and #388 rather than argued about.

⚠️ **This defends against the accidental case and not against a person who is looking.** A
housemate scrolling the library will not meet a photograph; a person who opens the rider's report,
or the browser's storage, will. The ADR says so rather than implying otherwise, and the owner's
Q2 — widening D-2 to keep by default — is the decision that makes this row materially worse.

---

## Consequences

### What this enables

- **#382, #383 and #384 can be written**, against eleven rules rather than an intention. #384 in
  particular has its record shape (D-1), its retention (D-2), its export (D-3) and its erase (D-4)
  decided before a schema version is picked, which is the whole reason ADR 0004 was written in
  Phase 0.
- **#387's transport is settled** before anybody writes request-shaping code, so the failure this
  document was opened to prevent — a transport chosen because it looked like plumbing — cannot
  happen quietly. It can still happen; it now needs a superseding ADR.
- **#328 inherits the same rules for free**, which is owner decision D-C working as intended: one
  camera port, one consent flow, and one data class rather than two.
- **The consent wording in D-5 and D-7 is quoted rather than described**, so Phase B and Phase C
  implement a sentence somebody ruled on rather than one somebody drafted at the keyboard.

### What this costs, stated plainly

- **The most useful version of the feature is off by default.** Comparing this week's position with
  last month's needs frames kept, and D-2 makes that a decision the rider takes every single ride.
  That is friction on the feature's best use case and it is accepted.
- **A bystander gets a sentence and nothing else.** D-5 refuses the protection a rider would most
  expect, and the honest reading is that the protection is the rider's aim rather than the
  software's. Somebody will find that insufficient, and the ADR does not argue that they are wrong —
  it argues that a blur that misses is worse.
- **A shared device gets a screen rule and not a lock.** D-11 keeps a kept frame off every
  incidental surface and refuses to invent an access control this program does not have anywhere
  else. A partner who opens the rider's own report, or the browser's storage inspector, sees the
  photographs; the rider is not told otherwise. The honest summary is that the defence against a
  second person in the house is the operating system's screen lock, which is not ours.
- **A kept frame is one press further away for the rider too.** D-11's first rule costs the
  obvious, useful thing — a filmstrip on the ride's row, so a rider can see at a glance which rides
  have frames. That affordance is exactly the one that shows a photograph to somebody who did not
  ask for it, so it is refused rather than made smaller.
- **Remote use is second-class.** D-6 makes the LAN the path and a WireGuard overlay the fallback,
  both of which the rider has to set up. The thing that would have made it one click is the thing
  that is rejected.
- **The account export becomes a set of photographs of somebody's house.** D-3 accepts that, because
  the alternative — an export that silently omits the rider's own data — breaks the invariant
  ADR 0002 and ADR 0004 E both rest on.
- **The first byte turns a gate red.** `apps/web/src/privacy/no-network.test.ts` asserts this client
  contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon` at all, and
  `docs/privacy-policy.md` opens with *"We collect nothing"*. Every decision above is conditional on
  a policy change this ADR does not make and cannot: it is #377's open question 1 and it is the
  owner's.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#382](https://github.com/openzigs/onyourleft/issues/382) | D-1, D-5's wording verbatim, D-9's strip-at-capture, and D-10 |
| [#383](https://github.com/openzigs/onyourleft/issues/383) | D-9 (the Android capture path strips too — a platform camera writes EXIF by default) and D-5's indicator |
| [#384](https://github.com/openzigs/onyourleft/issues/384) | D-1, D-2, D-3, D-4, D-9's note in `boundaries.ts`, and **D-11** — the record it adds must not be reachable from any list, row or default render |
| [#387](https://github.com/openzigs/onyourleft/issues/387) | D-6 entire, D-7 entire, D-8's untrusted-response rule, and [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 |
| [#388](https://github.com/openzigs/onyourleft/issues/388) | D-8 — a report that cannot render a frame it failed to read says so without showing it — and **D-11**: the report is the one screen a kept frame may appear on, which makes it the screen that must not be linked from a list |
| [#328](https://github.com/openzigs/onyourleft/issues/328) | All of it, by owner decision D-C |
| [#35](https://github.com/openzigs/onyourleft/issues/35) | D-3's manifest line and D-4's two lists |
| [#95](https://github.com/openzigs/onyourleft/issues/95) | The Data Safety re-filing and the privacy-policy rewrite named below |

### What `docs/privacy-policy.md` and Play Data Safety would have to say

Recorded here rather than done, because nothing has been built and a policy that describes a feature
the app does not have is a false statement in the other direction.

| Today | What shipping this would require |
|---|---|
| *"We collect nothing … nothing is uploaded"* | False the moment a frame leaves. The sentence becomes a statement about **what the app does on its own** plus a named exception the rider switched on |
| `data-safety.ts` answers `collected: false` to every row | **Photos and videos** becomes a row. Under Play's taxonomy the honest answers are *collected: yes / shared: yes* for the hosted path, *optional*, *user can request deletion* — and the shared answer is the one that changes the listing's face |
| `no-network.test.ts` is the gate under the first sentence | It is amended or it stays red. Amending it is #377's open question 1, which is the owner's, and the amendment must be **narrow** — a rider-configured endpoint the rider switched on — rather than a deletion of the rule |
| The in-app privacy link is derived from the policy's path (`apps/web/src/privacy/policy.ts`) | Unchanged. Play requires the listing and the in-app link to be the same URL, and they already are |

⚠️ **All four land in the same pull request as the first byte, not after it.** #377's epic criterion
says it: *"`docs/privacy-policy.md` and `apps/mobile/src/android/data-safety.ts` are true of the
shipped app at every point, not only at the end."*

---

## What the owner has not decided

Four questions, all of them #377's own open questions, none of them engineering questions, and
**D-0** blocks implementation until they are answered.

**Q1 — Is amending `no-network.test.ts` acceptable at all?** (#377 open question 1.) This is the
load-bearing one. The gate sits under the privacy policy's first sentence, and turning it into
*"no network except a rider-configured local endpoint the rider switched on"* is a **policy** change
rather than a code change. Every decision above is conditional on it. If the answer is no, this
epic's Phase C does not exist and Phase B is still useful — #328's on-device classifier and #390's
presence answer both live entirely inside the current gate.

**Q2 — Is "discarded after analysis, with a per-ride keep" the right default?** (#377 open
question 3.) D-2 chooses the narrower option and says why. The wider one — held by default, so a
rider can compare weeks without deciding each time — is more useful and more sensitive, and it is
the owner's to choose. ⚠️ **It is cheap to widen now and expensive to widen later**, because
widening later decides retrospectively for frames that already exist.

**Q3 — Is a sentence enough for a bystander?** (#377 open question 4.) D-5 refuses to blur and says
why in terms. The owner may prefer a blur with its error mode accepted and stated, or a consent
event of some kind. ⚠️ If the answer is "blur", the ADR that records it must name the second model
and say what a missed detection does, because that is the whole of the argument.

**Q4 — Which camera sees the rider, and from where?** (#377 open question 2.) Not a privacy question
on its face, and it reaches this ADR through D-5: a second device placed perpendicular at hip height
is a camera pointed across the room rather than at the bike, which is a materially larger chance of
a bystander in frame than a tablet on the bars. #386 owns the question; this ADR records that the
answer changes how strong D-5's sentence has to be.

---

## What would make this ADR wrong

- **The owner answers Q1 "no".** Then D-6, D-7 and most of D-3's egress reasoning describe a path
  that does not exist, and what survives is D-1, D-2, D-4, D-5, D-8, D-9 and D-10 — which is still
  most of the document, because most of it is about bytes that never leave.
- **A frame turns out to be reconstructible from what D-2 keeps after a discard.** The rule says
  "anything from which a frame could be reconstructed" is in the class, and the reconstruction
  literature moves. If a stored pose skeleton is ever shown to reconstruct a recognisable image, D-2
  applies to it and this document is wrong to have implied the derivative is a smaller thing.
- **Cloudflare stops terminating TLS**, or ships a mode that demonstrably does not. D-6's table row
  is a dated finding, not a position about a company, and a superseding ADR that showed the operator
  could not read the payload would be a good ADR.
- **This program gains a sign-in or a device lock.** D-11 is written for a client with neither, and
  its argument against a per-feature PIN — *"it would be the only credential in a program that has
  deliberately none"* — stops being true the day accounts arrive (Phase 3,
  [#7](https://github.com/openzigs/onyourleft/issues/7)). Then the screen rule is still right and it
  is no longer the whole answer, and a successor should say what a second profile on one device
  means for a kept frame.
- **EXIF stripping turns out to be insufficient.** D-9 assumes a re-encode from raw pixels removes
  everything that identifies a device or a place. If a format ships something that survives that —
  a sensor-noise fingerprint is the obvious candidate and is a real research area — D-9 is a weaker
  rule than it reads and would need a successor saying so.
- **A published policy is written before the code.** Both this ADR and #377's epic criterion say the
  policy changes in the same pull request as the first byte. A policy amended in advance, "so it is
  ready", is a false statement about a shipped app.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-09-23** — **The owner has answered all four questions, and one of them amends a promise
  this repository has kept since Phase 0.** [#495](https://github.com/openzigs/onyourleft/issues/495)
  carries them verbatim. **Q2 and Q3 ratify D-2 and D-5 exactly as written** — they were the
  author's engineering choices on questions §"What the owner has not decided" names as the owner's,
  and they are now the owner's decisions rather than the author's. **Q1 amends the no-network
  promise**, which is the one this ADR calls load-bearing. **Q4 answers
  [#386](https://github.com/openzigs/onyourleft/issues/386) in substance** and makes D-5's sentence
  carry more weight than D-5 itself contemplated. §"What the owner has not decided" is therefore no
  longer a list of open questions but a record of what was asked. ⚠️ **A reader who remembers this
  ADR having four open questions is reading the old file.**

  | | Question | Owner's answer | What it changes |
  |---|---|---|---|
  | **Q1** | Is amending `no-network.test.ts` acceptable at all? | **Yes — amend it to *"no network except a local endpoint the rider configured and switched on"*** | **Nothing above is changed and a great deal below is unblocked.** D-6 and D-7 stop being conditional on a policy question. ⚠️ The amendment is **narrow** and is not made here: §Q1 below is what it permits, what it does **not** permit, and the three artefacts that move together with it |
  | **Q2** | Is "discarded after analysis, with a per-ride keep" the right default? | **Yes — discarded after analysis, with a per-ride keep the rider turns on** | **D-2 is unchanged and is now owner-ratified.** Its stated cost stands as written: the most useful version of the feature — comparing this week with last month — is a decision the rider takes every single ride |
  | **Q3** | Is a sentence enough for a bystander? | **A sentence, no blur** | **D-5 is unchanged and is now owner-ratified**, including its refusal to run a second detector and its argument for why a blur that misses is worse. ⚠️ It interacts with Q4 — see below |
  | **Q4** | Which camera sees the rider, and from where? | **A second phone on a tripod, side-on, at roughly hip height** | **Nothing above is changed and D-5 now carries more than it was written to carry**, because this is the placement D-5 itself names as the one with the larger bystander chance. #386 is answered in substance; the pairing between two devices is not, and that issue stays open for it |

  ### Q1 — the sentence that replaces the promise, and the four things it does not permit

  **The amended promise, in the owner's own words:**

  > **No network except a local endpoint the rider configured and switched on.**

  What that permits is **one destination, typed by the rider, off until the rider turns it on** —
  D-6's LAN address or WireGuard-class peer, reached because somebody entered it. It permits nothing
  else, and four exclusions are worth writing down because each is a thing a later reader could
  reasonably believe follows and none of them does:

  1. **It is not a permission to make a request the rider did not configure.** No analytics, no
     crash reporting, no telemetry, no update check, no vendor list, no default endpoint. The two
     halves of the sentence — *configured* and *switched on* — are each a separate condition, and a
     build that shipped an endpoint pre-filled would satisfy neither.
  2. **It does not, on its face, cover D-7's hosted model.** ⚠️ This is the one that matters and it
     is a finding rather than a restatement: the owner's sentence says *"a local endpoint"*, and a
     hosted model is not local. D-7 already requires its own explicit consent on the rider's own
     key, so the *consent* is not the gap — the gap is that the **published promise** would still be
     false for a rider who turned the hosted path on. Either the policy sentence gains a second
     named exception when [#387](https://github.com/openzigs/onyourleft/issues/387) ships the hosted
     path, or the hosted path stays unbuilt. **That is a question for the owner and it is not
     answered here.**
  3. **It is not a widening of the basemap exception.** `docs/privacy-policy.md` already discloses
     that a configured basemap host is requested from by the map library, which is a *dependency's*
     request rather than this client's, and no basemap is configured in this build. The two
     exceptions are separate sentences about separate things and neither enlarges the other.
  4. **It is not a deletion of the gate.** `apps/web/src/privacy/no-network.test.ts` is re-stated,
     not removed: a `fetch` outside the one module that owns the configured endpoint must still fail
     the build, and the module that owns it must still be a module somebody chose. Its own header
     already says *"if this test ever goes red, the privacy policy is what needs changing, not the
     test"*; Q1 is the first time the answer is to change the policy **and** re-state the test, and
     the re-statement has to keep the scan able to fire. A gate rewritten as *"no network except
     where we do"* is the vacuous pass this repository keeps finding.

  **What Q1 obliges, and it is three artefacts that move together or not at all:**

  | Artefact | What changes |
  |---|---|
  | `apps/web/src/privacy/no-network.test.ts`, and `apps/web/src/game/plan-no-network.test.tsx` beside it | The whole-tree gate is re-stated around one permitted module; the plan view's own "issues no request" assertion is unaffected in substance and must stay exactly as strict |
  | [`docs/privacy-policy.md`](../privacy-policy.md) | *"We collect nothing … nothing is uploaded"* becomes a statement about what the app does **on its own**, plus the named exception the rider switched on |
  | `apps/mobile/src/android/data-safety.ts` ([#95](https://github.com/openzigs/onyourleft/issues/95)) | Every row answers `collected: false` today. **Photos and videos** becomes a row, and the Play declaration is re-filed |

  ⚠️ **This pull request moves none of them, and that is deliberate.** #377's epic criterion is that
  the policy and the Data Safety answers are *"true of the shipped app at every point, not only at
  the end"*, and the body's own §"What would make this ADR wrong" says a policy amended in advance
  *"so it is ready"* is a false statement about a shipped app. The three land in the same pull
  request as the first byte, and that is its own piece of work. **It must not be smuggled into the
  camera build.**

  ### Q3 and Q4 together — the sentence is unchanged and the room it is read in is not

  D-5's quoted wording is **not edited by this amendment**, and it must not be edited by #382
  either: the point of quoting it in an ADR was that Phase B implements a sentence somebody ruled on.
  What changes is which half of it is doing the work.

  - D-5's remedy has two limbs — *"point the camera so they will not be in it, **or leave the camera
    off**"*. With a bar-mounted tablet the first limb is usually available. With Q4's tripod side-on
    at hip height, the camera is pointed **across the room**, and in a small room the first limb may
    not be available at all. **The second limb is then the whole remedy**, and a reviewer of #382
    should read it that way rather than as a softener.
  - **The live indicator is now in a different place from the rider.** D-5's second bullet already
    requires an indicator *"visible from where a person would enter, not only to the rider on the
    bike"*, and that sentence was written when those were plausibly the same screen. Under Q4 they
    are not: the capturing device is on a tripod across the room and the rider is on the bike. That
    is a real constraint on [#382](https://github.com/openzigs/onyourleft/issues/382) and
    [#383](https://github.com/openzigs/onyourleft/issues/383), and it is recorded here because it
    follows from the owner's answer rather than from anything the body anticipated.
  - **Two devices is the one thing Q4 does not settle.** #386 stays open for the pairing design —
    which device captures, which analyses, how they find each other, and what happens when they
    disagree — and a comment on that issue records what this answer did and did not resolve.
  - **Side-on at hip height is a sagittal view**, which is the only plane
    [ADR 0030](0030-what-the-app-may-say-about-a-body.md) D-4 permits anything to be said about. The
    placement the owner chose is therefore the one that makes a sagittal-only product possible at
    all; a frontal arrangement would have produced a view nothing may report on.

  ### What is still blocked

  **D-0's second block — *"four questions are the owner's"* — is discharged by this entry**, and its
  first block is clear on the facts: #377, #378, #379, #380 and #381 are all closed, read
  2026-09-23, so Phase A is complete. **What remains is the third block, and a new one.**

  | Block | State |
  |---|---|
  | There is no camera code | **Stands.** [#382](https://github.com/openzigs/onyourleft/issues/382) and [#383](https://github.com/openzigs/onyourleft/issues/383) own it, and this amendment writes none, adds no permission, no port and no dependency |
  | ⚠️ **New: the EU and UK regulatory read** | [ADR 0030](0030-what-the-app-may-say-about-a-body.md)'s amendment of the same date records the owner's Q2 answer, which makes that read a **gate on camera code**. It is [spike 0008](../spikes/0008-eu-uk-medical-device-read.md), written in the same pull request as this entry, and a spike decides nothing — what clears the gate is the owner reading it |
  | ⚠️ The no-network change itself | **Not started, and named rather than done** — the three artefacts above, in one pull request, with the first byte |

- **2026-09-25** — **D-6's WebRTC row, and D-2's per-ride keep on one path, are superseded by
  [ADR 0033](0033-side-camera-link.md)** (#527), for the side camera the owner chose in
  [#386](https://github.com/openzigs/onyourleft/issues/386). The WebRTC row's premise, *"it needs
  signalling infrastructure, which is a server"*, does not hold when the two devices are in one
  room: the offer and answer cross by QR code, and no ICE server of any kind is configured. **Every
  other row of D-6 stands**, the Cloudflare Tunnel rejection included. On the side-camera path, the
  owner ruled that pictures are *"analysed as they arrive and discarded at once"* and that *"no
  picture is ever stored on the tablet"*, so **D-2's per-ride keep is not offered there**. D-2's
  default is unchanged. **D-5 is NOT superseded.** The owner added a sentence beside the quoted
  bystander sentence for the 30-second camera that keeps filming after the link is lost. D-5's own
  wording is not edited, and ADR 0033 D-5 argues why this adds to D-5 rather than reversing it.
  **D-9 and D-10 bind the new path unchanged.** Pictures are stripped at capture on the phone, and
  no picture reaches a cache on either device.
