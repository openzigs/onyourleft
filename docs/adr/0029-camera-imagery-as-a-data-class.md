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
a third party's TLS terminator, a second person walking behind the bike.

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

Ten rules. **D-0** says nothing is built yet. **D-1** to **D-5** are about the bytes on the device;
**D-6** and **D-7** are about the bytes leaving it; **D-8** and **D-9** are the two rules that bind
every other layer.

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

---

## Consequences

### What this enables

- **#382, #383 and #384 can be written**, against ten rules rather than an intention. #384 in
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
| [#384](https://github.com/openzigs/onyourleft/issues/384) | D-1, D-2, D-3, D-4, and D-9's note in `boundaries.ts` |
| [#387](https://github.com/openzigs/onyourleft/issues/387) | D-6 entire, D-7 entire, D-8's untrusted-response rule, and [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 |
| [#388](https://github.com/openzigs/onyourleft/issues/388) | D-8 — a report that cannot render a frame it failed to read says so without showing it |
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
- **EXIF stripping turns out to be insufficient.** D-9 assumes a re-encode from raw pixels removes
  everything that identifies a device or a place. If a format ships something that survives that —
  a sensor-noise fingerprint is the obvious candidate and is a real research area — D-9 is a weaker
  rule than it reads and would need a successor saying so.
- **A published policy is written before the code.** Both this ADR and #377's epic criterion say the
  policy changes in the same pull request as the first byte. A policy amended in advance, "so it is
  ready", is a false statement about a shipped app.
