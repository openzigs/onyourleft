# ADR 0093: The side camera pairs with one scan, remembers the pair, and may meet through the rider's instance — superseding in part ADR 0033 D-1, D-4 and D-8

- **Status**: **Accepted**, 2026-11-22, by the owner on its pull request
  [#3018](https://github.com/openzigs/onyourleft/pull/3018), asked one question at a time, with
  every recommendation of §"The owner's questions" taken: Q7 a four-digit check, Q8 the D-4
  sentence as drafted, Q9 `OYLSIDE2` with one-scan's implementation. Proposed 2026-11-22
- **Date**: 2026-11-22
- **Deciders**: **the owner**, on every product question. The owner asked for this ADR on
  [#3010](https://github.com/openzigs/onyourleft/issues/3010) on 2026-11-21, after a tablet session,
  and said **yes** to it covering all three options; the lane note of 2026-11-22 scoped it to the
  ADR alone. **The author** decided the engineering content, and each point the owner's words do not
  settle is marked *the author's choice*, taking the narrower option
- **Issue**: [#3010](https://github.com/openzigs/onyourleft/issues/3010). Epic
  [#549](https://github.com/openzigs/onyourleft/issues/549). Refs
  [#2863](https://github.com/openzigs/onyourleft/pull/2863)
- **Number**: **0093**. On 2026-11-22 `main` (at `76c1b2603`) held ADRs up to 0091 and named 0092
  as the next free number, but the open pull request
  [#2864](https://github.com/openzigs/onyourleft/pull/2864) (#2835) adds an ADR 0092 in its branch,
  so 0092 is taken. The concurrent ADR lane for
  [#3011](https://github.com/openzigs/onyourleft/issues/3011) took 0094 in its pull request
  [#3017](https://github.com/openzigs/onyourleft/pull/3017) and left 0093 to this one. No other open
  pull request adds 0093
- **Supersedes, in part**, each only for the pairing paths D-1 to D-3 describe:
  - [ADR 0033](0033-side-camera-link.md) **D-1**'s *"The offer and answer cross by QR code. […]
    Nothing else carries signalling"*, and its row *"Why two QR codes rather than one"*. Two QR
    codes stay as one path of three (D-1.1).
  - [ADR 0033](0033-side-camera-link.md) **D-4**'s rule *"nothing is remembered after it. There is
    no list of paired devices, no stored key and no 'trust this phone', so there is nothing to
    revoke"*, and its rows *"What a pairing lasts"* and *"Revoking"*, for a remembered pair (D-2).
  - [ADR 0033](0033-side-camera-link.md) §Context's table row *"Pairing lifetime: One session
    only. Scan every time; nothing is remembered, so nothing needs revoking"*, which is the owner's
    2026-09-25 ruling, reversed by the owner's words of 2026-11-21 quoted in Context.
  - [ADR 0033](0033-side-camera-link.md) **D-8**'s *"no pairing"*: the phone keeps one pairing
    record per remembered tablet, and nothing else (D-2.4).
  - [ADR 0033](0033-side-camera-link.md) **D-3**'s never-sent list, in its words *"a device key"*,
    for the one message that makes a remembered pairing's key (D-2.2).
  - [ADR 0033](0033-side-camera-link.md) §"What was considered and rejected"'s row *"Remembered
    pairings"*.

  [ADR 0033](0033-side-camera-link.md) gains one dated `## Amendments` entry pointing here. Its
  body is not edited ([ADR 0013](0013-adr-amendments.md))
- **Leaves standing**: ADR 0033 D-3's two channels, its message set and its join rule; D-4's
  one-time secret as the phone's first message, its candidate rule and its untrusted-input rule;
  D-5's 30-second camera and its consent sentence; D-6 as ADR 0044 D-1 leaves it; D-7; D-9 and
  D-10's order (the gate before the first byte); D-11 as ADR 0050 leaves it.
  [ADR 0029](0029-camera-imagery-as-a-data-class.md)'s consent flow before the first camera use on
  each device. [ADR 0084](0084-a-scan-of-the-instances-code-is-agreed-to-in-place-by-a-narrower-agreement.md)
  is not widened: the side camera's own scan still needs ADR 0029's consent
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) finding 1 and decision F,
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3,
  [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md),
  [ADR 0050](0050-side-camera-pictures-to-the-riders-instance-sealed.md),
  [spike 0012](../spikes/0012-webrtc-webview-to-webview.md),
  [#733](https://github.com/openzigs/onyourleft/issues/733)

---

## Context

### What the owner said, quoted so it is not argued again

From the tablet session of 2026-11-21, testing #2863 on the Pixel 8 and the Pixel Tablet:

> the entire scanning procedure between the two is really kludgy. Why do they both need to scan.
> Can't it just present a code after the first scan.

Asked whether the ADR should cover one scan, a remembered pairing and pairing through the
instance, the owner said **yes** (2026-11-21, #3010). The lane note of 2026-11-22: *"write the ADR
only — one-scan pairing, remembered pairing, and pairing via the rider's instance, superseding /
amending ADR 0033 D-1 as needed. No implementation in this PR."*

### What happens today, and why

ADR 0033 D-1 signals the WebRTC link with **two QR codes**. The tablet shows an offer and the phone
reads it; the phone shows an answer and the tablet reads it with its front camera (ADR 0033's
2026-09-26 amendment). The second scan exists because a browser cannot listen on a socket (ADR 0002
finding 1), so with no server the answer has no other way back. D-4 makes every pairing last one
session, so the rider does both scans every time.

Two facts have changed since 2026-09-25:

1. **There is a server the rider may own.** ADR 0036 gave the rider an instance. ADR 0036 D-3 (a)
   still holds: a rider with no instance must lose nothing.
2. **The app on Android has native plugins.** `apps/mobile/android/app/src/main/java/` holds four
   Capacitor plugins written for this app (`SecureWindowPlugin` among them). ADR 0033 D-2 described a native LAN socket as the
   fallback if WebRTC failed. [Spike 0012](../spikes/0012-webrtc-webview-to-webview.md) found that
   WebRTC works with a named condition, so D-2 was never built.

**Both ends are the Android app** in the owner's setup and in the usual one. That is what makes one
scan possible without a server: the tablet can listen for the answer, so the phone can send it
back over the LAN.

### Also seen in the same session

Scanning the tablet's code with the **phone's system camera** says *"app not found"*. The code is
`OYLSIDE1{…}` (`apps/web/src/camera/side-link-code.ts` §`PAIRING_CODE_PREFIX`), a string, not a
link, so Android has nothing to hand to On Your Left. D-4 decides what to do about it.

### What every option keeps

The issue names four rules, and each decision below is held against them:

| Kept | Where it is decided |
|---|---|
| **A stranger on the same Wi-Fi cannot connect without the key** | ADR 0033 D-4, and each decision's threat table here |
| **No STUN, TURN or relay.** Pictures go phone → tablet over the LAN | ADR 0033 D-1, D-4's candidate rule. Unchanged by every decision here |
| **The 30-second unattended camera** | ADR 0033 D-5. Unchanged |
| **The consent screen** | ADR 0029 D-5, ADR 0033 D-4 and D-5. Unchanged |

---

## Decision

Five rules. **D-0** says what this ADR builds. **D-1** is one scan with no server. **D-2** is the
remembered pairing. **D-3** is pairing through the rider's instance. **D-4** is the phone's system
camera. **D-5** is the gate and the published statements.

### D-0 — This ADR builds nothing

This ADR adds no code, no permission, no port, no dependency and no stored record. Each of D-1 to
D-4 is built by its own issue under [#549](https://github.com/openzigs/onyourleft/issues/549),
filed once the owner accepts this ADR (§"Constraints this places on other work").

### D-1 — One scan, no server: the tablet listens for the phone's answer on the LAN

> **The rule.** When the tablet is the Android app, it opens a **native LAN listener** while its
> pairing code is on screen, and its code carries that listener's private address, its port and a
> fresh 256-bit key. A phone that is also the Android app scans the code **once**, builds its WebRTC
> answer as it does today, and sends that answer **sealed under the key** to the tablet's listener.
> The tablet reads the sealed answer, closes the listener, and the two connect over **the same
> host-only WebRTC data channels as today**. The tablet's camera stays off.

#### D-1.1 — It sits beside the two-scan path, and the browser keeps two scans

| Tablet | Phone | How they pair |
|---|---|---|
| Android app | Android app | **One scan** (D-1). The phone reads the tablet's code and answers over the LAN |
| Android app | Browser | **Two scans**, as today. A browser phone cannot open a raw socket. It shows its answer code, and the tablet still offers *Scan the phone's code* |
| Browser | either | **Two scans**, as today. A browser tablet cannot listen (ADR 0002 finding 1), so its code carries no listener |

**One code serves both phones.** An Android tablet's code carries the WebRTC offer **and** the
listener fields. A phone that can dial uses them. A phone that cannot shows its answer code as it
does today. *The author's choice*: the two-scan path stays as the fallback rather than being
removed, because it is the only path in a browser and the only one that needs no native code.

#### D-1.2 — The native socket carries the answer, and only the answer

*The author's choice*, and the narrower option. The listener carries **signalling only**. Pictures
and commands still travel over WebRTC, as ADR 0033 D-1 and D-3 say.

| | |
|---|---|
| **Why not move the whole link to the socket** | ADR 0033 D-2 described that, and it costs three things D-1.2 avoids. It would replace `side-link.ts`, whose behaviour four ADR 0033 amendments record against real engine faults (#568). It would lose DTLS. And TCP has no unordered, unretransmitted channel, so a late picture would block newer ones, which is what ADR 0033 D-3's `frames` channel exists to prevent |
| **Why the tablet listens and not the phone** | ADR 0033 D-2 put the listener on the phone, so the tablet's camera would read the phone's code. The owner's complaint is the scan held up to a tripod phone. The tablet showing a code and the phone (which is a camera, and is already filming) reading it removes the tablet's scan |
| **What the phone sends** | One sealed message: the fields of today's answer code (ADR 0033 D-1's table), and nothing else. The decoder refuses an unknown field (ADR 0017 D-4's rule) |
| **What the tablet sends back** | One sealed acknowledgement that carries nothing, so the phone knows its answer arrived and can say *"Connecting…"* rather than wait blind. Then both ends close the socket |

#### D-1.3 — How the answer is sealed: ADR 0033 D-2's four rules, with one change

ADR 0033 D-2's four rules apply to the listener, word for word except the fourth:

| | |
|---|---|
| **One key per direction** | Two AES-GCM keys derived with HKDF-SHA-256 (in `crypto.subtle`) from the code's listener key, with the info labels `side-answer phone-to-tablet` and `side-answer tablet-to-phone`. The listener key is **a fresh key of its own**, never ADR 0033 D-4's one-time secret, so neither can stand in for the other |
| **The nonce is a counter and never repeats** | As ADR 0033 D-2: a 32-bit direction prefix and a 64-bit counter from zero |
| **Direction and order are bound, and a replay is rejected** | As ADR 0033 D-2: the direction label and the counter are the additional authenticated data, and a counter that is not strictly greater closes the connection |
| **Connections to the listener** | ⚠️ **Changed from D-2's "exactly one".** The listener takes **one connection at a time**. Each must deliver a sealed answer that authenticates within **2 seconds** and in at most **4 KiB**, or it is closed. The **first that authenticates** closes the listener before anything else is read. After **three** connections that failed, the listener closes, the code is void, and the screen says that something on this network kept interrupting pairing and offers the two-scan path. *The author's choice*: under D-2's rule any port scanner on a home network (a router's security scan, a network-inventory app) would void every code by accident. Under this rule a stranger can still void a code, but needs three tries to do it, and can never hold a connection beside the real one |

**The listener's life.** It opens when the code is shown and closes when an answer authenticates,
when the code runs out (the offer's own expiry, ADR 0033's 2026-10-20 amendment), or when the
pairing screen closes. It binds only to the tablet's private LAN address, never to `0.0.0.0` on a
mobile-data interface. The address in the code obeys ADR 0033 D-4's candidate rule:
`addressSpaceOf` must classify it as `local`, and the decoder refuses the whole code otherwise.

#### D-1.4 — Threat table for one scan

| What could happen | Defended? |
|---|---|
| **A stranger on the same Wi-Fi connects to the listener** | **Yes.** Without the listener key nothing it sends authenticates, and it is closed after 2 seconds. Three such connections void the code (D-1.3): the safe direction |
| **A stranger on the same Wi-Fi reads the answer** | **Yes.** It is sealed. It would reveal only ICE credentials and a DTLS fingerprint in any case, which ADR 0033 D-4 already guards with the fingerprints themselves |
| **A stranger learns that a tablet is pairing** | **No, and it is stated.** An open port on the tablet is visible to a port scan while the code is on screen, as WebRTC traffic is visible today |
| **Someone photographs the tablet's code** | ⚠️ **Partly, and narrower than today.** Today a photograph of the offer alone gets nobody onto the tablet, because the tablet reads the answer with its own camera (ADR 0033's threat table). **With one scan, the code is the whole pairing.** A person who photographs it, is on the same LAN, and answers before the real phone within the code's life pairs **their** device as the side camera. What they then receive: `start`, `stop`, the framing verdict, and the framing reference, which is the image-plane positions of the rider's landmarks (ADR 0033 D-7). What they cannot receive: any picture, because pictures go phone → tablet. The real phone then fails to connect and says so on the tripod, and the tablet's screen shows a paired phone that is not filming. The code is shown only on the tablet's own screen, for the offer's life, and is voided on first use |
| **A picture leaves the LAN** | **Yes, by construction**, as today. The listener carries no picture, and WebRTC still has no ICE server |
| **A malicious or malformed message reaches the tablet through the listener** | **Yes, by rule.** At most 4 KiB, sealed, one message type, an unknown field refused. Nothing received reaches a trainer control point, a URL, a path or a command (ADR 0033 D-4) |
| **The no-network gate cannot see the listener** | ⚠️ **Not today.** A Capacitor plugin call is not a TypeScript network primitive. D-5 is the fix, and it lands before the first byte |

### D-2 — A remembered pairing: one key per pair, kept on both devices, forgotten from either

> **The rule.** After a pairing that the phone has proved (ADR 0033 D-4's secret, and the
> tablet's `welcome`), the tablet asks the rider once whether to pair automatically next time. If
> the rider says yes, the two devices make **one long-term pairing key** for that pair and each
> keeps it. In a later session, with the side-camera screen open on both, they find each other on
> the LAN, prove that each holds the key, and pair **with no scan**. Either device can forget the
> other, and a forgotten pairing cannot be used again from either end.

#### D-2.1 — What a remembered pairing never does

These are the reason a remembered pairing is safe to have, and each is a rule:

- **It never turns a camera on.** The phone pairs only while the rider has opened side-camera mode
  on it, and films only on the tablet's `start` (ADR 0033 D-3). Nothing listens in the background,
  nothing wakes the phone, and nothing on the tablet dials a phone that is not on its side-camera
  screen.
- **It never skips consent.** ADR 0029's consent and ADR 0033 D-5's 30-second sentence are shown on
  each device exactly as today, before the first camera use.
- **It never reconnects a lost session by itself.** ADR 0033 D-5 stands: a link lost for 30 seconds
  ends the session. A remembered pair starts a **new** session when the rider asks for one.
  *The author's choice*: re-dialling inside the 30 seconds would make *"the phone stops"* depend on
  a reconnect that may or may not come.
- **It never leaves the two devices.** The key is not exported, not sent to the instance, and not
  backed up (D-2.4).

#### D-2.2 — How the key is made

Inside the proved, DTLS-encrypted `control` channel, after the `welcome`, each end sends **32 fresh
random bytes** and a **random 128-bit pairing id** the tablet chooses. Each end derives the pairing
key with HKDF-SHA-256 over both contributions and the pairing id, and imports it into `crypto.subtle`
as a **non-extractable** key. The raw bytes are then dropped from memory. Neither end alone chooses
the key. On a pairing introduced through the instance, this exchange waits until the rider has
confirmed D-3.2's check on both devices.

This is the one place a key crosses the link, so it supersedes ADR 0033 D-3's never-sent *"a device
key"* for this message and no other. It carries no athlete id, no name and no device identity.
Every other entry on that list stands.

#### D-2.3 — How a remembered pair meets again

| Step | What happens |
|---|---|
| **The tablet waits** | With the side-camera screen open and at least one remembered phone, the tablet opens D-1's native listener and **advertises it on the LAN by DNS-SD** (Android's network service discovery). The service instance name is random for each advertisement and carries no device name, pairing id or athlete. It advertises only while that screen is open |
| **The phone looks** | With side-camera mode open and at least one remembered tablet, the phone browses for the service for at most two minutes, then says it cannot find the tablet and offers to scan its code |
| **Each proves it holds the key** | Over the connection, the tablet sends a fresh 32-byte nonce, the phone answers with its own and an HMAC over both under a key derived from the pairing key, and the tablet answers with an HMAC of its own. No pairing id crosses in clear: the tablet tries each remembered key it holds, which is a short list. A failed proof closes the connection before anything else is read |
| **Connections to the waiting listener** | ⚠️ **Not D-1.3's rule**, because this listener is long-lived and advertised. It takes **one connection at a time**. Each must complete the proof within **2 seconds** and in at most **4 KiB** across all of its messages, or it is closed. A failed connection **does not void the listener**: three strikes would let a router's port scan, or any stranger, shut every waiting tablet. Instead, after each failed connection the listener accepts nothing for **1 second**, so a stranger cannot hold it or flood it, and the phone keeps retrying for its two minutes. Guessing is not what this bounds: the proof is an HMAC under a 256-bit key |
| **The session keys** | Per-direction AES-GCM keys derived with HKDF from the pairing key and both nonces, so each session's keys are new. D-1.3's counter and replay rules apply |
| **Then as today** | The tablet sends a fresh WebRTC offer, **with a fresh ADR 0033 D-4 one-time secret**, over the sealed socket. The phone answers over it. The socket closes, and the link is ADR 0033's from the first `ping` on |

A remembered pair that cannot find each other (a router that filters multicast, two networks) is
told so and scans **once** (D-1). The pairing key is unchanged by that scan.
⚠️ **A browser at either end has no remembered pairing without an instance**, because it can
neither listen nor dial. D-3 is how a browser gets one.

#### D-2.4 — What each device keeps, and what removes it

| | Tablet | Phone |
|---|---|---|
| **The record** | For each remembered phone: the pairing id, the non-extractable key, the date paired, the date last used, and a label the rider may edit (by default *"Phone paired on 21 Nov"*) | For each remembered tablet: the same fields. **Nothing about the rider.** This supersedes ADR 0033 D-8's *"no pairing"* and no other word of D-8 |
| **Where** | IndexedDB, as a `CryptoKey` object, which the structured clone keeps non-extractable | The same |
| **The control** | **Forget this phone**, in the side-camera settings, beside each record | **Forget this tablet**, on the side-camera mode's own screen |
| **The erase** | Removed by *erase everything on this device* (`transfer/erase-device.ts`), with a line in `ERASE_REMOVES` | The same. ADR 0033 D-8's *"the phone has no erase of its own to get wrong"* is no longer true, and the Forget control and the device erase are that erase |
| **Export and backup** | **Never** in the account export, never sent to the instance, never synced. `android:allowBackup="false"` already keeps it out of Android's cloud backup and device transfer | The same |

*The author's choice*: the record is the **device's**, not the athlete's. A pairing is between two
devices, and a credential in an export file would let whoever reads that file pair with the tablet.

#### D-2.5 — Revocation, a lost phone and a factory reset

| Event | What it means | What the rider does |
|---|---|---|
| **Forget on one device** | That device deletes its record. The other's next proof fails, and it says *"This tablet no longer knows this phone"* (or the reverse) and offers to forget it too and scan again | Nothing more. A forgotten record cannot authenticate |
| **A lost or stolen phone** | Whoever holds it, unlocked, holds a key that pairs with the tablet **only while** they are on the rider's LAN **and** the rider has the tablet's side-camera screen open. They would receive what D-1.4's photograph row lists: commands and the framing reference, never a picture | **Forget this phone** on the tablet. The tablet shows *last used* beside each record, so a phone that was not the rider's is visible |
| **A lost or stolen tablet** | Its holder can pair the rider's remembered phone as a side camera, while the rider opens side-camera mode on the phone on the same LAN, and would receive **pictures**. This is the serious case | **Forget this tablet** on the phone. ⚠️ A lost tablet is already the larger loss: it holds every ride. ADR 0004's threat model answers *"someone with the athlete's unlocked device"* with **No**, and this does not improve on it |
| **A factory reset, or the app's data cleared** | That device's record is gone. The other device's record is dead, and its next proof fails as above | Forget the dead record, and scan once |
| **The app reinstalled on the phone** | The same as a factory reset of the app's data | The same |

*The author's choice*: **no automatic expiry**. Forgetting is explicit, and the tablet lists each
record with the date it was last used. Q5 asks the owner.

#### D-2.6 — Threat table for a remembered pairing

The table ADR 0033 did not need, because nothing outlived a session:

| What could happen | Defended? |
|---|---|
| **A stranger on the same Wi-Fi pairs with the tablet or the phone** | **Yes.** It holds no pairing key, so its proof fails and the connection closes before anything else is read |
| **A stranger on the same Wi-Fi advertises a fake tablet** | **Yes, as far as pairing.** The phone connects, and the fake cannot prove the key, so the phone closes the connection. The phone learns nothing new, and the fake learns only a nonce and an HMAC it cannot use: no pairing id crosses in clear |
| **A stranger learns that a remembered tablet is waiting** | **No, and it is stated.** The DNS-SD service type is visible on the LAN while the screen is open. The instance name is random, so it does not identify the tablet from one session to the next. It does say that an On Your Left tablet is waiting for its side camera |
| **A stranger connects to the waiting listener again and again** | **Partly.** Each connection is closed within 2 seconds or at 4 KiB, and the listener pauses 1 second after each failure, so nothing is exhausted and nothing is learnt. Failures never void the listener, so a port scan does not shut it. ⚠️ A stranger who keeps connecting can delay the real phone until its two-minute browse ends. The phone then offers the scan (D-1), which is the safe direction |
| **A stranger records a session and replays it** | **Yes.** Session keys are derived from fresh nonces from both ends, and D-1.3's counters reject a replay |
| **The pairing key is read from a device** | **Partly.** It is non-extractable to the page, so a script running in the page cannot read the bytes. It is not in Android's hardware keystore, so a person with a rooted device can. ⚠️ Such a person already has the rider's rides |
| **A lost device keeps working** | **Until it is forgotten** (D-2.5). The rider is told how on the record's own row |
| **A remembered pair films without the rider** | **No, by rule** (D-2.1). Both screens must be open, and filming starts only on the tablet's `start` |
| **A key outlives the rider's wish to keep it** | **No.** Forget, the device erase and a factory reset each remove it. It is never in an export or a backup that would bring it back |
| **A picture leaves the LAN** | **Yes, by construction**, as D-1.4 |

### D-3 — Pairing through the rider's instance, when there is one: an addition, never a requirement

> **The rule.** When the tablet and the phone are **both signed in to the same instance as the same
> athlete**, they may exchange their WebRTC offer and answer **through the instance** instead of a
> scan or the LAN listener. **Pictures still go phone → tablet over the LAN, on host candidates
> only, never through the instance.** A rider with no instance, or with one device signed out,
> pairs by D-1 or D-2 and loses nothing (ADR 0036 D-3 (a)).

#### D-3.1 — What the instance carries

| | |
|---|---|
| **The message** | The same fields as the offer and answer codes (ADR 0033 D-1's table, and D-1's listener fields left out), plus, for a first introduction, D-3.2's commitment in the offer, nonce in the answer and one reveal message, and nothing else. They travel through the instance's sealed requests (ADR 0047 D-7 and D-8), so the tunnel's edge reads none of it |
| **Who can read it** | **Any device of the athlete's that asks, and the instance itself**, for a first introduction. ADR 0047 D-10: *"End-to-end means device-to-instance, not device-to-device."* For a **remembered pair**, each message is also sealed between the two devices under keys derived from the pairing key (D-2.3), so the instance relays bytes it cannot read or change |
| **Where it waits** | **In the instance's memory only**, never in its database or a log. At most one offer per tablet, deleted when read, gone after **two minutes**, and bounded in size. The read filters on the owning athlete **and** the tablet's offer, which is `CLAUDE.md`'s cross-athlete rule |
| **Through which client module** | `instance/instance-transport.ts`, the one module ADR 0036 D-3 (a) and `no-network.test.ts` (#777) admit for instance traffic, on its existing sealed `fetch` **only**. **Not its room socket (#782)**, which ADR 0047 records as not sealed (*"The owner ruled the room sockets are not sealed"*), so the tunnel's edge would read the offer, the answer and ADR 0033 D-4's one-time secret. *The author's choice*: the phone and the tablet poll the sealed request for the two minutes an offer lives, rather than unseal a socket. **No new permitted call** |

#### D-3.2 — The rider's two steps, and the check on a first introduction

1. The rider opens side-camera mode on the phone. Signed in, the phone tells the instance that it
   is ready as a side camera, which carries its device id from the instance's device list (#777)
   and nothing else.
2. On the tablet, the side-camera screen lists the athlete's devices that are ready, by the name
   the device list already shows. The rider taps one. The tablet posts its offer, the phone posts its
   answer, and they connect on the LAN.

**A first introduction shows a four-digit check on both screens, and the rider confirms it on
both devices.** *The author's choice*, and Q7 asks the owner. The reason: the instance carries the
fingerprints, and **a home instance is usually on the same LAN**, so a hostile or compromised
instance could put its own fingerprints in both messages and sit between the phone and the tablet.
It would then receive **pictures the client never chose to send it**, which is the one thing
ADR 0036 D-3 (d) forbids and the one thing ADR 0050's two consents exist to gate. The instance also
holds ADR 0033 D-4's one-time secret, because the secret travels in the offer, so on this path that
secret proves nothing about who is at the other end. **The check is this path's only defence**, and
these rules make it one.

**The digits are committed before they can be chosen.** A check over the two fingerprints alone
can be ground: the instance sees the tablet's fingerprint first, hands the phone a certificate made
in advance, sees the phone's fingerprint, and then makes certificates for the tablet's side (about
10^4 of them, well under a second) until both screens show the same digits. The check is therefore
built as Bluetooth's numeric comparison and ZRTP's hash commitment are, in a fixed order:

| Step | What is sent, and when |
|---|---|
| **1. The tablet commits** | The offer carries `C = SHA-256("oyl-side-commit" ‖ Nt ‖ fpT)`, where `Nt` is 16 fresh random bytes the tablet keeps and `fpT` is its DTLS fingerprint. `Nt` is not sent |
| **2. The phone answers** | Only after it holds `C`, the phone draws 16 fresh random bytes `Np` and sends them in the answer beside `fpP`, its fingerprint |
| **3. The tablet reveals** | Only after it holds the answer, the tablet sends `Nt` in one reveal message. One answer per offer: a second is refused, and the offer is spent |
| **4. Each checks and shows** | The phone recomputes `C` from `Nt` and the fingerprint of the peer it actually completed DTLS with, and ends the attempt if it differs. Each device shows the first four decimal digits of `SHA-256("oyl-side-check" ‖ fpT ‖ fpP ‖ Nt ‖ Np)`, over the fingerprints of its own DTLS session |

An interposing instance must commit to its tablet-side nonce before it sees the phone's `Np`, and
must send its phone-side `Np` before it sees the tablet's `Nt`, so it cannot steer either screen's
digits. It is right by chance **once in 10,000 attempts**, and each attempt is a check the rider
sees. A mismatch on either device, or *They don't match*, ends the attempt on that device, voids
the offer and says that the connection may not be private.

**Both devices gate on the rider, and the phone gates first.** The phone is the device that sends
pictures, so a check only the tablet enforces defends nothing: an instance could play the tablet
towards the phone and receive pictures whatever the tablet showed. On a first introduction:

- **The phone** shows the digits and asks the rider to tap *They match* **on the phone**. Until
  then it refuses `start`, turns no camera on and sends no frame, whatever its DTLS peer sends.
  It handles only the join (ADR 0033 D-4's one-time secret and the `welcome`) and `ping`, and
  neither the secret nor the `welcome` unlocks it.
- **The tablet** shows the same digits and sends no `start` until the rider taps *They match* on
  the tablet.
- **D-2.2's key is made only after both taps**, so a remembered pairing is never made with an
  interposer.

A remembered pair needs no check, because the instance cannot change what it relays (D-3.1).

#### D-3.3 — Threat table for pairing through the instance

| What could happen | Defended? |
|---|---|
| **A rider with no instance loses something** | **No.** D-1 and D-2 work with no instance, and the two-scan path stays (ADR 0036 D-3 (a)) |
| **A picture goes through the instance** | **Yes, by construction.** The instance carries signalling only, and ADR 0033 D-4's candidate rule still refuses every non-host candidate, so no path through the instance can be offered. ADR 0050 is a separate path, behind its own consents, and this ADR does not touch it |
| **The instance interposes between the two devices** | **Yes for a remembered pair**, by D-2's sealing. **Yes, if the rider checks on both devices, for a first introduction**, by D-3.2's committed four-digit check, which the phone enforces before it films and the tablet before it sends `start`. ⚠️ A rider who taps *They match* without looking is not defended, and ADR 0047 D-10 says what a compromised box already holds |
| **The instance grinds certificates until both screens show the same digits** | **Yes.** The tablet commits to its nonce before the phone draws its own, and reveals it only after the answer (D-3.2), so a certificate made after seeing either fingerprint does not move the digits. What is left is a guess, right once in 10,000 attempts, and each attempt is shown |
| **The instance plays the tablet towards the phone and takes the pictures** | **Yes, by D-3.2's phone gate.** The phone refuses `start` and sends no frame until the rider confirms the digits on the phone. Holding the one-time secret, which the instance relays, unlocks nothing |
| **Another athlete on the same instance pairs with this tablet** | **Yes.** The ready list and the offer are filtered on the owning athlete, and a test enumerates the reads as `activity-store.scoping.test.ts` does |
| **Someone signed in as the athlete on another device pairs it** | **Partly.** They are the athlete, as far as the instance knows. They would appear in the tablet's ready list by their device's name, and the rider chooses. ADR 0047 D-10's *"a device"* row is how one is revoked |
| **The tunnel's edge reads the connection details** | **Yes.** Sealed requests only (ADR 0047), never the unsealed room socket (D-3.1). The details are private LAN addresses and fingerprints in any case, and never a location |
| **The instance keeps a record of the pairing** | **Yes, it keeps none.** Memory only, two minutes, deleted on read (D-3.1). The pairing key never reaches it |
| **The instance is used when the rider has none** | **No.** Without a signed-in session on both devices the option is not shown |

### D-4 — The phone's system camera: the in-app scanner stays the only way, and the screen says so

> **The rule.** The pairing code stays a string the app's own scanner reads (`OYLSIDE…`), and is
> **not** an app link. The tablet's pairing screen says, in words beside the code, that it is read
> with On Your Left's side-camera mode on the phone, not the phone's camera app.

| Option | Why not |
|---|---|
| **A custom scheme** (`onyourleft://…`) | Any app on the phone may register the same scheme, and the code carries the listener key and ADR 0033 D-4's one-time secret. An app that claimed the scheme would receive them, and could pair as the phone (D-1.4's photograph row, without needing a photograph) |
| **A verified App Link** (`https://…`) | It needs a domain that serves the app's signing-certificate fingerprint in `assetlinks.json`, which this project does not have for this purpose. And a phone without the app would open the link in a browser, while camera apps may offer to look the link up |
| **A link that only opens the app, with no secret** | It would need a second code beside the real one, which is the clutter the owner complained of |

The draft wording for the tablet's screen, for the owner to rule on (Q8):

> **On the phone, open On Your Left and choose Side camera, then scan this code.** The phone's own
> camera app can't read it.

#### D-4.1 — Threat table for the system camera

| What could happen | Defended? |
|---|---|
| **Another app on the phone receives the code** | **Yes, by D-4.** The code is not a link, so Android routes it to no app |
| **The code is read by the system camera anyway** | **Partly.** The camera app shows the string and may offer to search for it. The rider is told, beside the code, to use the in-app scanner. The code is single-use and runs out with the offer |

### D-5 — The gate and the published statements

ADR 0033 D-9 and D-10's rule applies: **the gate learns a primitive before the first byte, and the
policy changes in the pull request that sends that byte.** This ADR changes neither.

| Artefact | Changes in | What changes |
|---|---|---|
| `apps/web/src/privacy/no-network.test.ts` | **D-1's implementation**, before the first line of listener code | ADR 0033 D-9 step 4, now owed: the native socket plugin's TypeScript port pinned as a permitted call by name, and a scan of `apps/mobile/android` for `ServerSocket`, `Socket`, `DatagramSocket`, the DNS-SD classes and HTTP client classes that permits only that plugin's file. Each shown to fire by mutation |
| `no-network.test.ts`, for D-3 | **D-3's implementation** | Nothing new: the instance module's existing entries. A second module for instance traffic is a red run, as it is today |
| [`docs/privacy-policy.md`](../privacy-policy.md) | **D-1's and D-2's implementations** | The side-camera section gains: a remembered pairing keeps a key on both devices until forgotten; the tablet listens on the home network while its code is shown; the waiting tablet is visible on the home network. **D-3's** adds that the instance passes the connection details on and keeps nothing |
| `apps/mobile/src/android/data-safety.ts` | **D-1's implementation** | Re-read. No new data type is collected, and the pairing key does not leave the devices |
| Android manifest | **Only if needed** | Whatever local-network or multicast permission DNS-SD or the listener needs on the target API is read first-hand by D-1's or D-2's implementation, and goes through `merged-manifest.ts` §`REVIEWED_PERMISSIONS` in the pull request that adds it. Not pre-answered here |
| `transfer/erase-device.ts` §`ERASE_REMOVES` | **D-2's implementation** | The pairing records, on each device |
| The Java the plugin adds | **D-1's implementation** | ⚠️ `CLAUDE.md` §4c: CI does not compile `apps/mobile/android` on pull requests. Its claims inherit what `apps/mobile/README.md` §5 records about Android claims that cannot be checked here, and the owner's device check (#733) is the check |

---

## Consequences

### What this enables

- **One scan** between two Android devices, with the tablet's camera off and the phone doing the
  reading, which is the device that is already a camera.
- **No scan** from the second session on, for a remembered pair on one LAN, and for any pair whose
  devices are both signed in to the rider's instance.
- **A browser gets a remembered pairing**, through the instance (D-3), where no LAN path can give
  it one.
- **The WebRTC link is unchanged.** Every ADR 0033 amendment about the engine's faults, and every
  test that reproduces them, still holds, because only the way the offer and answer travel changes.

### What this costs, stated plainly

- **Native code on both ends**, in Java that CI does not compile (D-5). The listener and DNS-SD are
  Android only.
- **A photograph of the tablet's code is worth more than it was** (D-1.4). It is the whole pairing,
  not half of it.
- **A key outlives a session.** ADR 0033's *"nothing is remembered, so nothing needs revoking"* is
  reversed for a remembered pair, and the rider has two Forget controls to know about and an erase
  line on each device.
- **The phone keeps something.** ADR 0033 D-8's *"a second phone is any spare phone"* still holds for
  a phone that was never remembered. A remembered phone that is lent or sold should be told to
  forget its tablet first, and the Forget control says so.
- **A waiting tablet is visible on the home network**, by port while a code is shown and by DNS-SD
  while a remembered tablet waits.
- **A first introduction through the instance asks the rider to compare four digits and tap
  *They match* on both devices**, including the phone on its tripod. That is two taps where the
  owner wanted a scan gone, and the phone's tap cannot be dropped (D-3.2).
- **Three ways to pair**, each with its own words on screen when it cannot be used.

### Reversing it

Each decision reverses on its own. Without D-1, the tablet's code carries no listener and every
pairing is two scans. Without D-2, no record is made, and the existing ones are deleted on the
next start. Without D-3, the instance stops offering the ready list and its memory holds nothing.
A superseding ADR records each.

### Constraints this places on other work

Each becomes one implementation issue under [#549](https://github.com/openzigs/onyourleft/issues/549)
once the owner accepts this ADR, and none is filed before that:

| Issue (to be filed) | What it inherits |
|---|---|
| **One scan** | D-1 entire; D-4's wording on the pairing screen; D-5's gate (first), the policy and Data Safety rows, the manifest row. It owns the native plugin's `listen` and `dial` |
| **Remembered pairing** | D-2 entire; the plugin's DNS-SD advertisement and browse; the `ERASE_REMOVES` line; the policy row. It needs the one-scan issue's plugin |
| **Pairing through the instance** | D-3 entire, on both sides: the instance's memory-only rendezvous with its athlete-scoping test, and the client's ready list and committed four-digit check with its gate on both devices, through `instance-transport.ts`'s sealed `fetch` |
| **The system camera** | D-4's wording, if the owner wants it before the one-scan issue lands |
| [#733](https://github.com/openzigs/onyourleft/issues/733) | The owner's device check: pair the Pixel 8 and the Pixel Tablet with one scan, then again the next session with none |

---

## What was considered and rejected, 2026-11-22

| Option | Why not |
|---|---|
| **The whole link over the native socket** (ADR 0033 D-2 as written) | D-1.2: it loses DTLS, the unordered `frames` channel and the tested `side-link.ts`, and the browser loses the feature |
| **The phone listens and the tablet dials** | D-1.2: the tablet would read the phone's code with its camera, which is the scan the owner wants gone |
| **Wi-Fi Direct, or Google Nearby Connections** | ADR 0033's reasons stand: Android only, and Nearby Connections is proprietary Play Services code no licence gate here can see |
| **A remembered phone that reconnects inside the 30 seconds** | D-2.1: *"the phone stops"* would then depend on a reconnect |
| **The pairing key in Android's hardware keystore** | Native code for the key's whole life, on both ends, for a gain only against a rooted device, whose holder already has the rides. A non-extractable `CryptoKey` keeps it from the page's scripts in a browser too |
| **The pairing key as an athlete record, carried in the export** | D-2.4: a credential in an export file pairs whoever reads it |
| **Pictures through the instance when the LAN fails** | ADR 0033 D-1 and the issue: no relay. ADR 0050 is the only picture path to the instance, and it is behind its own consents |
| **A first introduction through the instance with no check** | D-3.2: a home instance on the LAN could interpose and receive pictures the client never chose to send |

## What would make this ADR wrong

- **DNS-SD does not work on ordinary home routers** for the two Android devices. D-2's no-scan path
  would then rarely fire, and a remembered address, or the instance, would have to carry it. That
  is the remembered-pairing issue's first measurement.
- **The listener cannot bind on the tablet** under the target API's restrictions on local network
  access. D-1 then needs a platform permission this ADR has not read, and the manifest row decides.
- **Riders tap *They match* without looking.** The four-digit check would then be ceremony, and
  D-3's first introduction would rest on trusting the instance, which ADR 0036 D-3 (d) does not let
  it rest on.

## The owner's questions

Each has a recommendation, and the ADR as written follows every one.

1. **One scan beside two, or instead of two?** *Recommended: beside.* The browser can only pair by
   two scans, and it is the fallback when the listener cannot be used (D-1.1).
2. **The native socket for the answer only, with WebRTC still the link?** *Recommended: yes*
   (D-1.2).
3. **Is a remembered pairing asked once after the first pairing, on the tablet ("Pair automatically
   next time?" — *Yes* / *Not now*)?** *Recommended: yes, asked, not on by default* (D-2).
4. **May the tablet advertise itself on the home network by DNS-SD while it waits for a remembered
   phone?** *Recommended: yes*, with a random name and only while the screen is open (D-2.3,
   D-2.6).
5. **Should a remembered pairing expire after a time unused?** *Recommended: no*; Forget is explicit
   and the last-used date is shown (D-2.5).
6. **Are the pairing records the device's, removed by the device erase, never exported, never sent
   to the instance?** *Recommended: yes* (D-2.4).
7. **A committed four-digit check on both screens, confirmed on both devices, for a first
   introduction through the instance?** *Recommended: yes*, and none for a remembered pair
   (D-3.2). Six digits, as Bluetooth uses, would cut a lucky guess from 1 in 10^4 to 1 in 10^6 at
   the cost of two more digits to compare.
8. **The system camera: the in-app scanner only, with the sentence in D-4 beside the code?**
   *Recommended: yes*, and the sentence as drafted.
9. **Bump the code's prefix to `OYLSIDE2` for a code that carries listener fields**, so that a phone
   on an older build refuses it at the scan with *"update both devices"* rather than as malformed?
   ADR 0033's 2026-10-05 and 2026-10-20 amendments left the bump to the owner. *Recommended: yes*,
   with one-scan's implementation.
