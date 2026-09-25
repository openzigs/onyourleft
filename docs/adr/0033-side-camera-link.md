# ADR 0033: The side-camera link — a tablet drives a tripod phone over a direct link paired by QR code, with no server, and no picture is kept

- **Status**: Accepted. ⚠️ **D-1's choice of WebRTC is conditional on
  [#532](https://github.com/openzigs/onyourleft/issues/532)**, a measurement that has not been
  taken. D-2 is the owner's chosen fallback and is decided here too, so neither outcome of #532
  needs a new decision. It needs only an appended amendment recording which one happened
  ([ADR 0013](0013-adr-amendments.md): a statement of fact that has become true or false)
- **Date**: 2026-09-25
- **Deciders**: **the owner, on every product question**. The owner ruled in
  [#386](https://github.com/openzigs/onyourleft/issues/386) (closed 2026-09-25) and in a comment on
  [#527](https://github.com/openzigs/onyourleft/issues/527) the same day. Both are quoted in Context
  so they are not argued again. **The author decided the engineering content**, and four points the
  owner's rulings do not settle are flagged where they are made as *the author's choice*. Each takes
  the narrower option, and widening any of them is the owner's decision
- **Issue**: [#527](https://github.com/openzigs/onyourleft/issues/527). Parent decision
  [#386](https://github.com/openzigs/onyourleft/issues/386). It blocks
  [#528](https://github.com/openzigs/onyourleft/issues/528),
  [#529](https://github.com/openzigs/onyourleft/issues/529) and
  [#530](https://github.com/openzigs/onyourleft/issues/530)
- **Number**: **0033**. [`docs/architecture.md`](../architecture.md)'s ownership table is the check
  `CLAUDE.md` §7 asks for, and on 2026-09-25 it recorded 0033 as the next free number. No open pull
  request claimed it that day: #531 and #471 were the only ones open, and neither adds an ADR
- **Supersedes**, each **narrowly and only for the case this ADR describes**: one rider's two
  devices, in one room, for one session, paired by sight:
  - [ADR 0002](0002-local-first-architecture.md) **decision F**: its sentence *"Never for
    leaderboards, never for racing, never in the browser"*, **in its third clause only**. Decision
    F's binding reason (the enumeration argument) is untouched, and so are its first two clauses.
    D-1 below says why.
  - [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-6**: its **WebRTC row**, *"Out — it
    needs signalling infrastructure"*. Every other row of D-6 stands, and the Cloudflare Tunnel
    rejection most of all.
  - [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-2**: its **per-ride keep**, on the
    side-camera path only. D-2's default of discarding a frame after analysis is not superseded. It
    becomes the only option on this path.
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-3**: its **second sentence**, *"on
    the same camera in the same session"*. The first sentence, **no absolute joint angle ever**, is
    not touched and must not be read as touched.

  Each of those three ADRs gains an appended amendment in the same pull request pointing here, so a
  reader of the old sentence finds the new one.
- **Does NOT supersede**: [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-5**. The
  30-second camera adds a sentence beside D-5's and does not reverse any part of it. D-5 below
  argues this, because #527 asked for it to be decided rather than assumed
- **Relates to**: [ADR 0002](0002-local-first-architecture.md),
  [ADR 0008](0008-mobile-client-architecture.md) and
  [ADR 0018](0018-native-client-platform.md) (one client on every platform),
  [ADR 0024](0024-offline-and-caching-posture.md),
  [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md),
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md),
  [#385](https://github.com/openzigs/onyourleft/issues/385),
  [#387](https://github.com/openzigs/onyourleft/issues/387),
  [#388](https://github.com/openzigs/onyourleft/issues/388),
  [#389](https://github.com/openzigs/onyourleft/issues/389),
  [#495](https://github.com/openzigs/onyourleft/issues/495)

---

## Context

### What the owner decided, quoted so it is not argued again

From [#386](https://github.com/openzigs/onyourleft/issues/386), closed 2026-09-25:

> A **second phone on a tripod**, perpendicular to the bike, **side-on at roughly hip height** […]
> It runs this app in a *side camera* mode. The tablet stays on the bars as the ride screen.
>
> **The tablet drives the phone live**: it starts and stops capture over a **direct peer-to-peer
> link paired by QR code**, with no server. […] **Pictures go phone → tablet**, and **analysis runs
> on the tablet**, because a rider may not own a computer. The rider's own computer (#387) remains
> optional. **Link lost**: the phone keeps filming **at most 30 seconds**, then stops and says so.
> **The camera stands alone**: no clock alignment with the ride's power or cadence. **The report is
> on the tablet, after the ride** (#388).
>
> A **framing guide plus a stored reference** from the rider's last session, shown ghosted over the
> live preview.

From the owner's comment on [#527](https://github.com/openzigs/onyourleft/issues/527), 2026-09-25:

| Question | Ruling |
|---|---|
| Cross-session comparison (ADR 0030 D-3) | **Allowed only when the framing check passes** against the stored reference. Otherwise the report falls back to within-session differences and says why. Uncertainty is stated in the same sentence (R8) |
| Where pictures wait on the tablet (ADR 0029 D-2/D-10) | **Analysed as they arrive and discarded at once.** Only pose numbers are kept until the post-ride report. **No picture is ever stored on the tablet** |
| Picture rate | **About 5 per second, at the model's input size (~256 px).** #385 confirms or adjusts it |
| Preview on the tablet | **None.** Framing is set up on the phone. The tablet shows state only |
| Pairing lifetime | **One session only.** Scan every time; nothing is remembered, so nothing needs revoking |
| What a stranger on the Wi-Fi can do | The QR code carries a one-time secret and the peer's DTLS fingerprint. Without the QR, a device on the same network cannot connect, and a pairing dies with the session |
| The 30-second unattended camera | **Added to the consent screen**, beside D-5's bystander sentence |
| Transport | WebRTC data channel, host candidates only, QR signalling, **subject to #532**. **Fallback: a native Android local socket**, with its address in the QR code |

⚠️ **Two of the issues filed with this one were written before those rulings and now disagree with
them.** [#530](https://github.com/openzigs/onyourleft/issues/530) says analysis *"runs **after** the
ride, never during it"* and that pictures are *"discarded after analysis unless the rider keeps
them"*. [#528](https://github.com/openzigs/onyourleft/issues/528) says *"the stored reference is a
picture of the rider"*. The later rulings govern. §"Constraints this places on other work" gives the
reading each issue must take.

### Why two ADRs already said no, and which of their premises this case removes

Two accepted documents close this door, and each gives a reason.

**ADR 0002 finding 1**: *"A browser cannot be a peer, and there is no such thing as WebRTC with zero
servers."* A WebRTC connection needs *"an out-of-band SDP exchange that something else must carry"*.
**ADR 0029 D-6** repeats it for this payload: WebRTC *"needs signalling infrastructure, which is a
server we do not have"*.

**Both premises are true of the problem those ADRs addressed and false of this one.** The SDP
exchange does need a carrier. ADR 0002 was about riders who have never met, and for them the carrier
is a server. **Here the two endpoints are a metre apart and belong to one person**, so the carrier
can be **light**: one screen shows a QR code and the other device's camera reads it. The exchange is
still out-of-band, and it has no infrastructure at all. This is a narrower claim than it looks. It
does not make ADR 0002's argument wrong. It makes finding 1's second half (*"no such thing as WebRTC
with zero servers"*) true only of pairs that cannot see each other.

**ADR 0002 decision F already left this door open, in the wrong place for this product.** Decision F
admits peer-to-peer for *"direct transfer of a user's own files between their own devices, on a
**native** client, where both endpoints are the same person and there is nothing to enumerate and
nothing to cheat"*, and then says *"never in the browser"*. The side camera meets every reason in
that sentence. The one exception is the word *native*, and [#529](https://github.com/openzigs/onyourleft/issues/529)
requires the link to work in a browser as well as inside the Android shell. ADR 0008 and ADR 0018
chose one web client for every platform, so on this product *native* would mean *Android only*.

### The one thing that makes this link a privacy question rather than plumbing

**The payload is a continuous stream of photographs of the rider in their home**, at about five a
second, from a camera pointed across the room (ADR 0029's amendment, Q3 and Q4). #387's path to the
rider's computer sends **one** picture per press. This link sends every frame the phone takes while
it is filming. So the questions that D-6 asked about a single capture, *who can read it on the way*
and *where does it stop*, now apply to a stream.

### The threat model for the link

This uses ADR 0029's shape. The rows are things that could happen to the link or to what crosses
it.

| What could happen | Defended? |
|---|---|
| **A stranger on the same Wi-Fi connects to the phone or the tablet** | **Yes.** D-4: the connection is authenticated by the ICE credentials and both DTLS fingerprints, which crossed only by sight, and by a one-time secret checked as the first message. Without the QR codes there is nothing to connect with |
| **A stranger on the same Wi-Fi reads the pictures** | **Yes.** D-1: every WebRTC data channel is DTLS-encrypted and cannot be switched off. D-2's fallback, which has no DTLS, encrypts every message with a key carried in the QR code |
| **A stranger on the same Wi-Fi learns that filming is happening** | **No, and it is stated.** Traffic volume and timing show that two devices are exchanging about five encrypted messages a second. Encryption hides the content and not the fact |
| **A stranger disrupts the link** (jamming, flooding, deauthentication) | **No, and it fails in the safe direction.** A dropped link is D-5's case: the phone stops filming within 30 seconds on its own timer, and the tablet says the link is lost |
| **Someone photographs the offer QR code** | **Partly.** D-4: the offer is single-use and the tablet accepts only the answer it reads with its own camera. A photograph of the offer alone does not get an attacker onto the tablet. Someone standing in the room who can show the tablet a QR code of their own can do things that no link design stops, and this ADR does not claim otherwise |
| **A picture leaves the LAN** — a STUN or TURN server, a relay, an ICE server | **Yes, by construction.** D-1 configures no ICE server of any kind, and D-4 refuses a scanned candidate whose address is not on the rider's own network. [#532](https://github.com/openzigs/onyourleft/issues/532) is where this is **measured** rather than configured |
| **A picture reaches durable storage on the tablet** | **Yes.** D-6: each picture is analysed as it arrives and discarded. The per-ride keep is not offered on this path |
| **A picture reaches durable storage on the phone** | **Yes.** D-8: side-camera mode writes nothing durable about the rider |
| **A picture is shown on the tablet** where someone else could see it | **Yes.** No preview (owner). The tablet shows state words only |
| **The camera films with nobody able to stop it remotely** | **For at most 30 seconds, and the rider is told first.** D-5 |
| **A malicious or malformed message from the peer does harm** | **Yes, by rule.** D-4: every message is untrusted input, bounded in size and type, and nothing received ever reaches a trainer control point (ADR 0029 D-8's corollary) |
| **The no-network gate stops seeing the network** | ⚠️ **It cannot see this link today.** D-9: `no-network.test.ts` scans six primitives and **`RTCPeerConnection` is not one of them**. As of this ADR, a WebRTC connection anywhere in `apps/web/src` passes the gate. D-9 is the fix, and it must land before the first line of link code |

---

## Decision

Eleven rules. **D-0** states what this ADR builds and what it waits on. **D-1** and **D-2** are the
transport and its fallback. **D-3** is what crosses the link. **D-4** is pairing. **D-5** is the
30-second camera. **D-6** to **D-8** are where the bytes go on each device. **D-9** and **D-10**
are the gate and the published statements. **D-11** is the rider's own computer on this path.

### D-0 — This ADR builds nothing, and adds one block to the ones that already stand

| Block | State |
|---|---|
| **The transport is unmeasured** | [#532](https://github.com/openzigs/onyourleft/issues/532). D-1 is conditional on it. [#529](https://github.com/openzigs/onyourleft/issues/529) must not choose between D-1 and D-2 before #532 publishes a result |
| **The gate is blind to WebRTC** | D-9. Its first half lands before the first line of link code, or in the same commit |
| The blocks ADR 0029 and ADR 0030 already carry | **Unchanged by this document.** The EU and UK read (spike 0008, ADR 0030's amendment) and #385's accuracy measurement stand as those ADRs record them |

This ADR adds no code, no permission, no port, no dependency and no store record.

### D-1 — The transport: a WebRTC data channel, host candidates only, signalled by two QR codes

> **The rule.** The tablet and the phone connect with one `RTCPeerConnection` that has **no ICE
> server of any kind**: `iceServers` is empty, there is no STUN, no TURN and no third-party ICE
> service. The offer and answer cross by QR code. The tablet shows the offer and the phone reads it.
> The phone shows the answer and the tablet reads it. Nothing else carries signalling.

| | |
|---|---|
| **Why WebRTC** | It is **the only transport one web client can use in both a browser and the Android shell**, which #529 requires and ADR 0008 and ADR 0018's one-client decision depends on. A browser cannot listen on a socket (ADR 0002 finding 1). A data channel can be opened between two pages without either one listening |
| **Why two QR codes rather than one** | An SDP answer has to come back, and without a server the only way back is a second scan. **The tablet's camera reads the answer**, so the tablet's camera is on during pairing. D-4 says what that means |
| **Why no trickle ICE** | The QR code is a single message, so each side gathers all its candidates before encoding. Host candidates gather within milliseconds, so this costs nothing |
| **What the QR code carries** | The fields a peer needs to connect (ICE username fragment and password, the DTLS fingerprint, the host candidates) and D-4's one-time secret. A compact encoding of those fields is permitted instead of the SDP text. The decoder **refuses** anything outside that set, which is [ADR 0017](0017-workout-file-format.md) D-4's rule: an unknown field is refused, not ignored |
| **Why this does not reopen ADR 0002 F** | F's binding reason is that *"a global leaderboard is a total order over a set that must first be enumerated"*. Here nothing is enumerated, nothing is ranked and nothing is shared between people: there are two devices, one rider, one room, one session. Its first two clauses (*"never for leaderboards, never for racing"*) stand exactly as written. **Only *"never in the browser"* is superseded, and only for this case** |

**Conditional on [#532](https://github.com/openzigs/onyourleft/issues/532), and why.** Chrome replaces
a host candidate's private address with a random `.local` name resolved over mDNS. It is not
established whether an Android WebView resolves that name on an ordinary home router, and if it
cannot, a host-only connection finds no path. ⚠️ **One expectation for #532 to confirm or refute,
recorded here as an expectation and not a fact**: Chromium is understood to stop hiding host
addresses behind mDNS once a page has been granted camera access. In this design the phone always
has that access and the tablet has it while it reads the answer, so the hiding may not apply to
either end. #532 says which, and whatever it finds is recorded as an amendment here.

| #532's result | What follows |
|---|---|
| **Works** | D-1 as written |
| **Works with a named condition** (for example, *the router must not isolate clients*) | D-1 as written. The condition is appended as an amendment, and the rider is told it in words on the pairing screen |
| **Does not work** | D-2. Recorded as an amendment. ⚠️ D-2 is Android-only, so the side camera is then unavailable in a browser, and #529's *"works in a browser"* criterion is then false by this ADR's own reading and must say so rather than be quietly dropped |

### D-2 — The fallback, if #532 fails: an Android local socket, encrypted by a key in the QR code

> **The rule.** Only if #532 records *does not work*: the phone opens a listening TCP socket through
> a Capacitor plugin, and its private LAN address and port go into the QR code with a fresh 256-bit
> key. **Every message on that socket is sealed with AES-GCM under that key** in the web layer,
> through `crypto.subtle`. A plain TCP socket has no DTLS, and plaintext pictures of the rider on a
> home network are refused.

What this costs, stated so that a failed #532 is not treated as a small change:

- **It is Android on both ends.** A browser cannot listen on a socket, so the side camera would not
  exist in a browser.
- **It is Java or Kotlin that CI does not compile** (`CLAUDE.md` §4c), so the plugin inherits
  everything `apps/mobile/README.md` §5 records about Android claims that cannot be checked here.
- **The no-network gate cannot see it.** A Capacitor plugin call is not a network primitive in
  TypeScript. D-9's second half says what a gate for it would need.
- **Only one QR code is needed**, because the tablet dials the phone. The tablet's camera is then
  not on during pairing, which is the one way this option is better.

### D-3 — What crosses the link, in which direction, and in what shape

Two data channels on one connection, because commands and pictures need opposite guarantees:

| Channel | Delivery | Why |
|---|---|---|
| **`control`** | reliable, ordered | A *stop* that arrives after a *start* it overtook does real harm. Every command is acknowledged, and an unacknowledged command is **reported, not assumed**, in the same spirit as the trainer's control point (#529) |
| **`frames`** | unordered, no retransmission | A late picture is worth nothing to a pose model and would only queue behind newer ones |

**Tablet → phone, and nothing else:**

| Message | Why it exists |
|---|---|
| `start`, `stop` | The owner's *"the tablet drives it live"* |
| The **framing reference** (D-7) | Numbers only, so the phone can draw the ghost outline. Held in the phone's memory for the session only |
| The **framing verdict** (framing OK, or differs) | The check runs where the model runs, on the tablet (D-7), and the phone shows the result |
| Acknowledgements | Of what the phone sent |

**Phone → tablet, and nothing else:**

| Message | Why it exists |
|---|---|
| **Pictures** | Single frames, **not a clip**, at about **5 per second** and about **256 px**, which is the owner's figure. #385 confirms or adjusts it, recorded by an amendment here. Each is a JPEG **re-encoded from raw pixels on the phone at capture**, which is [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-9's one strip point, unchanged. Each carries a sequence number and milliseconds since the session started, and **nothing else** |
| **State** | pairing, framing, filming, stopped, link lost, and why it stopped. The tablet shows these words and never a picture |
| Acknowledgements | Of what the tablet sent |

**Never across the link, in either direction**: an athlete id, an activity id, a signed record, a
device key, a name, any reading from the ride (power, cadence, heart rate, speed), a position, the
wall-clock time, a picture from the tablet's own camera, and any analysis result other than the
framing verdict. *"The camera stands alone"* is the owner's ruling, and the missing wall clock is
what makes it hold in practice. A session-relative counter is enough to order frames and cannot be
aligned with a ride.

**Why frames and not a clip, and not a video track.** Three reasons, and each is enough on its own:

1. **A clip has to be stored whole before it can be analysed**, and the owner ruled that no picture
   is ever stored on the tablet. A frame can be analysed and discarded on arrival.
2. **A video container has its own metadata.** An MP4's location atoms are written by Android camera
   stacks without anyone asking, and ADR 0029 D-9 says strip by re-encoding from pixels in one
   place. A JPEG re-encoded from a canvas has one place. A container adds another.
3. **A WebRTC video track** would be efficient. But the encoder changes resolution and frame rate
   under congestion, so the tablet could not know that it analysed what was captured. And it arrives
   as a `MediaStream`, which a `<video>` element can play with one line. That would show a picture
   on a tablet the owner ruled must show none. The data channel carries exactly what D-9 encoded,
   and nothing on the tablet can display it without someone writing a decoder to do so.

**The size of one message.** A picture must fit the connection's `sctp.maxMessageSize` or be split
into chunks. #530 checks the size rather than assuming it, because a message that is too large fails
differently on different engines.

### D-4 — Pairing: what a QR code grants, for how long, and what a stranger can do

> **The rule.** A QR code grants **one connection, once, for one session**, and nothing is
> remembered after it. There is no list of paired devices, no stored key and no "trust this phone",
> so there is nothing to revoke. The owner's rule is: scan every time.

| | |
|---|---|
| **What authenticates the peer** | The DTLS fingerprints. Each one crossed by sight, so a device that did not appear in front of the other's camera cannot present a matching certificate. Then **a one-time secret** from the offer QR is sent as the first `control` message. If it does not match, the connection is closed before any other message is read. It is redundant with the fingerprint on D-1. It is **not** redundant on D-2, and it makes the application check the same on both transports |
| **How long the offer is valid** | **Single use.** It is void once an answer is accepted and when the pairing screen closes. #529 also bounds it with a constant, and writes the provenance of that constant beside it |
| **What a pairing lasts** | **One session.** It ends when either device stops the session, when the connection fails, or 30 seconds after the link is lost (D-5). A later session scans again |
| **Revoking** | Ending the session, from either device. #529's *"pairing can be revoked from either device"* means this, and nothing needs to persist for it to work |
| **Which candidates are accepted** | **Host candidates on the rider's own network only.** A scanned candidate that is server-reflexive, a relay, or at a public address **refuses the whole pairing** rather than being skipped. The address rule is `camera/analysis-endpoint.ts` §`addressSpaceOf`'s, reused rather than written a second time. A `.local` mDNS name is accepted |
| **What a received message may do** | Only the messages D-3 lists. Each is **untrusted input**, bounded in size and checked for type before it is used. An unknown message type closes the session. Nothing received, on either device, reaches a trainer control point, a URL, a path or a command (ADR 0029 D-8's corollary) |

**The tablet's camera during pairing.** D-1 needs the tablet to read the answer QR, so the tablet's
camera is on while it scans. Those frames are camera imagery under
[ADR 0029](0029-camera-imagery-as-a-data-class.md) D-1. They are **decoded in memory for the code
only, discarded as soon as a code is read or scanning is cancelled, never sent, never kept and never
analysed for anything else**. The live-camera indicator shows while the camera is on. ADR 0029's
consent flow is shown before the first camera use **on each device**, and scanning counts as camera
use. It is the same camera.

**What a stranger on the same Wi-Fi can and cannot do**, which is the owner's proposed answer made
exact:

| Can | Cannot |
|---|---|
| See that two devices are exchanging encrypted traffic at a steady rate, and infer that filming is going on | Connect to either device, without the ICE credentials and fingerprints that crossed by sight |
| Break the link by jamming or flooding, after which the phone stops within 30 seconds | Read a picture or a command |
| | Keep a connection after the session, because nothing survives it |
| | Relay the connection through a server of their own, because no ICE server is configured and non-host candidates are refused |

### D-5 — The 30-second camera: a sentence **beside** D-5's, and why this is not a reversal

> **The rule.** When the link is lost, the phone keeps filming for **at most 30 seconds, measured by
> its own timer**, and then stops the camera and says *stopped, link lost* on its own screen. The
> limit never depends on the link, because the case it covers is the link being gone.

**The consent screen gains this sentence, beside
[ADR 0029](0029-camera-imagery-as-a-data-class.md) D-5's bystander sentence and not in place of it.
The wording is the owner's:**

> **If this phone loses touch with your tablet, it keeps filming for up to 30 seconds, then stops.**

**Why this does not reverse D-5**, which #527 asks for as a decision rather than an assumption.
D-5 decides three things: a bystander gets a sentence, there is no blur, and the live indicator is
the bystander's only signal. The 30-second rule changes none of them. The quoted sentence is
unchanged, and `consent.test.ts` still reads it from ADR 0029 word for word. There is still no blur.
The indicator stays up throughout, with a visible countdown (#528). What D-5 **assumed** without
deciding was that someone who can stop the camera is nearby. For at most 30 seconds, the person who
started it cannot stop it from the tablet. **The phone's own stop control still works**, and the
indicator, readable from across the room, still tells anyone who walks in. So this is a fact D-5's
reasoning did not anticipate, told to the rider before it happens. It does not reverse a decision
D-5 made.

**What happens to frames during the gap.** This is the author's choice, and it is the narrower
option. Frames captured while the link is down are **held in the phone's memory only**, for at most
the 30 seconds. They are never written anywhere. If the connection recovers on its own inside the
window, which an ICE connection can do after a short outage without signalling, they are delivered
and the session continues. If it does not recover, they are **discarded when the camera stops**. A
failed connection cannot be re-established without a new pair of QR codes (D-1), so the session and
its pairing end there.

### D-6 — Pictures on the tablet: analysed as they arrive, discarded at once, never stored, never shown

> **The rule, which is the owner's.** Each picture is analysed as it arrives and discarded as soon
> as the analysis has produced its numbers. **No picture is ever written to storage on the tablet**:
> not IndexedDB, not Cache Storage, not `localStorage`, not a file. **No picture is ever displayed on
> the tablet.**

| | |
|---|---|
| **In memory** | The received bytes are decoded to an `ImageBitmap` or pixel buffer and handed to the model. **No object URL** is created, so there is nothing a `<img>` could show and nothing that could reach the service worker's caches ([ADR 0029](0029-camera-imagery-as-a-data-class.md) D-10) |
| **When the tablet cannot keep up** | **At most one picture waits for the model.** A newer arrival replaces the waiting one, and the drop is counted. This is `simulation-writer.ts`'s rule, the newest survives, applied to pictures. A queue of photographs in memory is refused |
| **What is kept** | **Pose numbers only**, until the post-ride report is produced (owner). If #530 writes them durably so a crashed tab can still produce a report, they are owned by the athlete, removed by the erase under ADR 0029 D-4's *"and everything derived from one"*, and discarded when the report is made |
| **The per-ride keep** | ⚠️ **Not offered on this path.** ADR 0029 D-2 gives a per-ride keep. The owner's *"no picture is ever stored on the tablet"* removes it here, and this ADR supersedes D-2 for this path only. ADR 0029 D-2's default is unchanged and becomes the only option on this path |
| **Analysis during the ride** | It runs **during** the ride, and **nothing is shown until after it** (owner). ⚠️ That is not live coaching: [ADR 0030](0030-what-the-app-may-say-about-a-body.md) D-7's silence rule is about what is **said**, and this path says nothing during a ride. Pose numbers never reach the HUD, the ride screen, an announcement or a trainer. [#389](https://github.com/openzigs/onyourleft/issues/389) remains a separate decision |
| **The cost** | The tablet runs a pose model at 5 per second beside the ride, and possibly beside the trainer game. The thermal budget is #385's to measure. If the tablet falls behind, the rule above drops frames. It never lets the ride stutter |

⚠️ **Because nothing is shown, [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-11 does not
newly apply** to pictures on the tablet. It still applies in full to the report (#388). The report
shows numbers and words, and it is the one screen that reads them.

### D-7 — Comparisons across sessions: permitted when the framing check passes, and the reference is numbers

> **The rule, which supersedes [ADR 0030](0030-what-the-app-may-say-about-a-body.md) D-3's second
> sentence.** Differences between two observations of the same rider are permitted under R1 when
> they come from the same camera in the same session, **or from two sessions whose framing check
> passed against the stored reference**. When the framing check did not pass, the report gives
> within-session differences only and **says why in words**. Every cross-session difference states
> its uncertainty in the same sentence (R8) and says that it compares two separate setups.

D-3's first sentence, that **no absolute joint angle, limb angle, torso angle, segment length or
body dimension is ever rendered as a number**, is not touched. [ADR 0030](0030-what-the-app-may-say-about-a-body.md)'s
amendment argues that the wider fitness claim makes it more important. D-4 (nothing in the frontal
plane), R1, R2, D-6 and D-7 stand as written. The owner's ruling widens **which two observations**
may be compared. It changes nothing about **what** may be said about them.

**The stored reference is numbers, not a picture.** This is the author's choice, and it is the
narrower option. The reference is the image-plane positions and scale of the landmarks the pose
model reports, plus the frame's dimensions. It is enough to draw a ghost outline and to test
placement against a tolerance. It is **not** a photograph.

- **Why.** Owner: *"No picture is ever stored on the tablet."* A photographic reference kept
  automatically from session to session would also be the *"always keep"* that ADR 0029 D-2 refuses
  in terms: *"there is no global 'always keep'"*.
- **Where it lives.** On the tablet, as the athlete's own record. It is removed by the erase and
  carried in the account export under ADR 0004 E, because it is the athlete's own data. It is sent
  to the phone over `control` for each session, and the phone holds it in memory only (D-8).
- **Where the check runs.** On the tablet, which is where the model is, so the phone needs no model
  and can be any phone. The verdict goes back to the phone as a D-3 message.
- **What it records.** Whether the check passed is stored with the session's numbers. That record is
  what the report reads when it decides whether a cross-session sentence is permitted.
- **A photographic reference** would be a D-2 keep. It would need a per-session press, off every
  time, and an `ERASE_REMOVES` line. Choosing it is the owner's decision, and it would supersede
  this bullet.

⚠️ **#528's criterion *"the stored reference is a picture of the rider"* is replaced by this
section.** The tolerance and its provenance stay #528's to write at their constant.

**A reference is only as good as the camera it came from.** A different phone, lens or tripod height
will fail the check. That is the correct result: the report falls back to within-session differences
and says why. #385 should measure the repeatability of a passed check between sessions. Until then,
R8's uncertainty sentence for a cross-session difference says the comparison is rougher than one
within a ride, and gives no number the program has not measured.

### D-8 — The phone keeps nothing

> **The rule.** Side-camera mode writes **nothing durable about the rider** on the phone: no picture,
> no reference, no pose numbers, no pairing, no athlete row and no session record. The one exception
> is what [ADR 0029](0029-camera-imagery-as-a-data-class.md)'s consent flow already stores on any
> device that uses the camera, which is not about a picture.

So a phone that is lent, sold, lost or reset has nothing of the session on it. The tablet's erase
has nothing to reach on the phone, and **the phone has no erase of its own to get wrong**. This is also what makes *"a second phone"* safe to mean *"any spare phone"*.

### D-9 — The gate: `no-network.test.ts` must learn to see WebRTC before it permits it

**A finding, reported rather than fixed here, because it is the precondition for #529 rather than
part of this decision.** `apps/web/src/privacy/no-network.test.ts` §`NETWORK_PRIMITIVES` matches
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and two spellings of `sendBeacon`. **It does not
match `RTCPeerConnection`.** So today a `new RTCPeerConnection(...)` anywhere in `apps/web/src`, with
a public STUN server in its configuration, would pass the gate that sits under the privacy policy's
first sentence. That is the *"rule that cannot fire"* shape, applied to the very primitive this ADR
permits.

What #529 owes, in this order, in one pull request:

1. **The scan learns the primitive.** `NETWORK_PRIMITIVES` gains `RTCPeerConnection` and
   `webkitRTCPeerConnection`, with a *"the scan itself"* case for each that shows it fires. Before
   step 2, the whole-tree gate is then red for any WebRTC in the client, which is correct.
2. **One permit, in the existing shape.** `PERMITTED_NETWORK_CALLS` gains **exactly one** entry:
   one module (the side-link transport, path chosen by #529), primitive `RTCPeerConnection`, count
   `1`. The #387 entry is unchanged. The gate's existing fixtures, *"a second one in the permitted
   module"*, *"a different primitive there"* and *"the permitted call vanishing"*, gain a WebRTC
   counterpart each.
3. **The configuration is asserted, because the scan cannot see it.** The scan counts constructors
   and not what they are pointed at. So a unit test over the permitted module asserts that the
   configuration it builds has an **empty** `iceServers` and no relay-only policy, and that D-4's
   candidate rule refuses a server-reflexive, relay and public-address candidate. **Each assertion is
   shown to fail by mutation**, as `CLAUDE.md` §5 requires.
4. **If D-2 is taken instead**, a Capacitor plugin call is invisible to this scan. So the plugin's
   TypeScript port is pinned as a permitted call by name, and the Java or Kotlin side needs a rule of
   its own. That means a scan of `apps/mobile/android` for `Socket`, `ServerSocket`, `DatagramSocket`
   and HTTP client classes that permits only the plugin's file. It is named here and not built,
   because it is owed only if #532 fails.

The file header's *"exactly one network call"* and the policy's sentence change with step 2 (D-10).
A gate rewritten as *"no network except where we do"* would be the vacuous pass that ADR 0029's
amendment warns against. The steps above keep one module and one primitive, with an exact count.

### D-10 — What the published statements must say, and when

The same rule as ADR 0029's amendment: **the policy and the Play declaration are true of the shipped
app at every point**. They change in the pull request that sends the first byte, and not before it.
**This ADR changes neither.**

| Artefact | Changes in | What changes |
|---|---|---|
| [`docs/privacy-policy.md`](../privacy-policy.md) | **#529**, the first link byte (a command) | *"The code this project writes contains exactly **one** network call"* becomes false. The policy gains a section, in the same voice as *"Pictures sent to your own computer"*, saying: a second phone you paired by scanning, on your own network, encrypted, nothing remembered after the session. **The words about pictures land with #530**, because #529 sends no picture |
| `apps/mobile/src/android/data-safety.ts` | **#530**, the first picture | The **Photos and videos** row's `why` is re-read and rewritten. ⚠️ **Not pre-answered here.** Its `collected: true` rests on #387's path, which may be plaintext `http:`. Play's exemption for end-to-end encrypted transfer may fit this path, where it did not fit that one, but the row must stay `collected: true` while #387's path exists. #530 reads Play's text first-hand and answers for **both** paths in one row |
| `no-network.test.ts` | **#529** | D-9 |
| `apps/web/src/camera/analysis-transport.ts`'s header table | **#529** | Its *"WebRTC — out"* row points here |
| Android manifest | **Only if needed** | `INTERNET` is already declared and reviewed. If #532 finds that mDNS needs a multicast permission, that permission goes through `merged-manifest.ts` §`REVIEWED_PERMISSIONS` and `data-safety.ts`'s location rule in the same pull request that adds it |

### D-11 — The rider's own computer, on this path

The owner kept [#387](https://github.com/openzigs/onyourleft/issues/387)'s computer as an option. On
this path it means:

- **The phone never talks to the computer.** Pictures go phone → tablet over this link, and the
  tablet sends them on through `camera/analysis-transport.ts`, which is the one permitted `fetch` and
  stays the only one. One link per device, and the address rule stays in one place.
- ⚠️ **It changes a published sentence.** The policy says a picture goes to the computer *"only
  when you press the button that sends it. Never on a timer and never in the background"*. Sending
  each side-camera picture as it arrives makes that false. So choosing the computer here is **its
  own switch**, off by default, with its own consent sentence, and #530 lands it with the policy
  change. The sentence, drafted by the author for the owner to rule on as #530 lands:

  > **While the side camera is filming, every picture it takes — about five a second — goes to your
  > computer**, instead of being looked at on this tablet. What your computer does with them is up to
  > your computer.

- The computer's copy is already in `ERASE_CANNOT_REACH` (ADR 0029 D-4). A continuous stream makes
  that line truer, and it does not need a new one.

---

## Consequences

### What this enables

- **#528, #529 and #530 can be written against decisions** rather than guesses. The transport, its
  fallback, the message set, the pairing lifetime, the 30-second rule, the retention on each device
  and the gate's shape are all decided before any link code exists.
- **#532 has a result table to fill.** Each of its outcomes leads to a decision already written, so
  measuring it cannot stall the work.
- **A phone can be any spare phone**, because it keeps nothing (D-8) and needs no model (D-7).
- **Cross-session comparison exists**, which is the useful version of the feature. It is permitted
  only when the framing check passed.

### What this costs, stated plainly

- **The tablet's camera turns on to pair.** Two QR codes are the price of having no server. The
  tablet shows the indicator while it scans and discards every frame it reads.
- **A stranger on the network can tell that filming is happening**, and can break the link. The
  first is not defended. The second fails in the safe direction.
- **For up to 30 seconds, nobody at the tablet can stop the camera.** The rider is told before the
  camera is turned on, and the phone's own stop control still works.
- **No keep on this path.** A rider cannot save the side camera's pictures at all. The reference is
  an outline, not a photograph. That is the owner's *"no picture is ever stored"* and the author's
  narrower reading of D-7 together, and it is friction on the most useful comparison.
- **Analysis during the ride costs battery and heat on the tablet.** That is #385's to measure. The
  drop rule means the ride never waits for the model.
- **If #532 fails, the browser loses the feature** (D-2), and the Android side gains Java that CI
  cannot build.
- **Three ADRs gain an amendment pointing here**, and one ADR (0002) has part of its most emphatic
  sentence superseded. Its reasoning is not. A reader who stops at ADR 0002 F's last clause, or at
  ADR 0029 D-6's WebRTC row, will be misled until they reach the amendment.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#532](https://github.com/openzigs/onyourleft/issues/532) | D-1's condition and its three outcomes. Also test D-1's expectation about mDNS hiding once camera access is granted. The result is appended here as an amendment |
| [#528](https://github.com/openzigs/onyourleft/issues/528) | D-5's timer and sentence. D-7: **the reference is numbers, not a picture**, and this replaces #528's *"the stored reference is a picture of the rider"* criterion. The framing verdict comes **from the tablet**. D-8: the phone keeps nothing |
| [#529](https://github.com/openzigs/onyourleft/issues/529) | D-0's order, D-1 or D-2 after #532 and not before, D-3's control channel and acknowledgements, D-4 entire, D-9 entire, and D-10's policy change for the link |
| [#530](https://github.com/openzigs/onyourleft/issues/530) | D-3's frames channel, D-6 entire, D-7's record of whether the check passed, D-10's Data Safety re-read, and D-11. ⚠️ **Two of its criteria are replaced by the owner's later rulings**: analysis runs **during** the ride (nothing is shown), and pictures are discarded after analysis **with no keep** |
| [#385](https://github.com/openzigs/onyourleft/issues/385) | The picture rate and size (an amendment here if either moves), the tablet's thermal budget with the model running during a ride, and the repeatability of a passed framing check between sessions |
| [#388](https://github.com/openzigs/onyourleft/issues/388) | D-7's reporting rule: a cross-session difference only when the framing check passed, the fallback sentence when it did not, and R8 in the same sentence |
| [#389](https://github.com/openzigs/onyourleft/issues/389) | Unchanged, and still separate. Analysis during a ride that says nothing is not coaching (D-6) |

---

## What was considered and rejected, 2026-09-25

| Option | Why not |
|---|---|
| **A signalling server** | Owner decision D6: no server in Phase 1. It was also never needed, because the two devices can see each other |
| **Web Bluetooth between the devices** | A browser is a Bluetooth **central** only. It cannot advertise or accept a connection, so neither device could be found by the other |
| **WebTransport** | Client-to-server only (ADR 0002 finding 1) |
| **Wi-Fi Direct, or Google Nearby Connections** | Native, so Android only, with D-2's costs. Nearby Connections is part of Google Play Services: proprietary, and a Gradle dependency that no licence gate here can see (`CLAUDE.md` §4g). D-2 needs none of it |
| **`iroh`** | ADR 0002 F names it for native peer-to-peer. It is Rust, and it does not run inside the WebView this client is |
| **A WebRTC video track** | D-3, reason 3 |
| **Remembered pairings** | Owner: one session only. A remembered pairing is a stored credential in a program that deliberately has none (ADR 0029 D-11's argument) |

## What this ADR did not consider, 2026-09-25

- **iOS** on either end. There is no iOS client ([ADR 0018](0018-native-client-platform.md), #15).
- **More than one side camera**, or a frontal second camera, which ADR 0030 D-4 forbids reporting in
  any case.
- **The two devices on different networks**: a guest network, a tethered hotspot, a WireGuard
  overlay between them. Host-only ICE assumes one LAN. A router that isolates clients from each
  other will fail, and that is #532's to find.
- **IPv6-only home networks**, beyond D-4 reusing an address rule that already classifies IPv6.
- **A QR code shown on one device and photographed by a third device** for later use. D-4's
  single-use offer is the defence, and it was not analysed further.
- **The legal reach of the 30-second camera** in any jurisdiction, for example recording a person
  who did not consent in a shared home. As in [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  this is not legal advice.

## What would make this ADR wrong

- **#532 finds that host-only ICE never connects inside the Android shell.** D-2 then governs, the
  browser loses the feature, and an amendment here records it.
- **A browser or WebView starts contacting a server during host-only ICE** that no configuration
  requested, such as a vendor ICE service, a telemetry request or an mDNS relay. D-1's *"by
  construction"* would then be false, and #532's packet capture is the check.
- **The framing check turns out not to predict comparability.** If #385 shows that two sessions
  which passed the check still differ by more than the differences being reported, D-7's
  cross-session permission is reporting noise as change. It needs a superseding ADR, not a looser
  sentence.
- **The pose numbers kept until the report turn out to be enough to reconstruct a recognisable
  picture.** ADR 0029's own *"what would make this wrong"* names this, and D-6's *"only numbers are
  kept"* would then be keeping a picture.
- **The owner wants a photographic reference** or a keep on this path. D-6 and D-7 are then
  superseded for this path, and ADR 0029 D-2 and D-4 govern those pictures as they do any other
  kept frame.
