# ADR 0050: Side-camera pictures may go to the rider's instance, sealed, to be looked at by a model there — never stored, on the local picture model or the rider's own key, behind two consents

- **Status**: **Accepted, 2026-10-12**, on the owner's decisions on
  [#1106](https://github.com/openzigs/onyourleft/issues/1106) of that day: the ruling of five points
  ([comment](https://github.com/openzigs/onyourleft/issues/1106#issuecomment-6123462729)) and the
  decisions made after reading the draft
  ([comment](https://github.com/openzigs/onyourleft/issues/1106#issuecomment-6127194892)), both
  quoted in Context
- **Date**: 2026-10-12
- **Deciders**: **the owner**, in the two comments above and in
  [#1092](https://github.com/openzigs/onyourleft/issues/1092)'s ruling 1 of 2026-10-04. The author
  wrote the wording and decided the engineering content the rulings do not settle. Each such point
  is marked *the author's choice* where it is decided, and D-11 lists them all. ⚠️ **The text of
  this ADR was written after the owner's decisions and no comment says the owner has read it**:
  the first ruling says nothing merges *"before the owner approves the ADR text"*, the merge is the
  owner's, and it is this file's text that the merge accepts
- **Issue**: [#1106](https://github.com/openzigs/onyourleft/issues/1106). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092)
- **Number**: **0050**, read from [`docs/architecture.md`](../architecture.md)'s ownership table on
  2026-10-12, when it said the next free number was 0050, and checked that day against every open
  pull request and open issue: none names 0050. The draft of this decision was written as
  amendments and offered 0049, which
  [ADR 0049](0049-open-asset-sources-for-the-realistic-world.md) had taken the day before
- **Supersedes**, each **for one payload on one path** (a side-camera picture, sealed, on its way to
  the rider's own instance and from there to one model) and for nothing else:
  - [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-6**'s row rejecting the Cloudflare Tunnel
    for a picture, and **D-7**'s *"only for a frame the rider is looking at, on a press"* and its
    consent sentences
  - [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md) **D-14 Q4** (*"camera
    pictures stay off the tunnel, even sealed"*) and **D-12**, which records it
  - [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) **D-1**'s
    *"pictures do not leave the room"* and **D-14(d)**'s closing paragraph (the Q3 ruling of
    2026-10-07), as far as they apply to that picture

  D-10 below says, decision by decision, what is superseded and **what stays**. Each of those three
  ADRs, and [ADR 0033](0033-side-camera-link.md), carries one dated pointer here under its
  `## Amendments`; no body and no `Status` line is edited ([ADR 0013](0013-adr-amendments.md))

  ⚠️ **This list is wider than the owner's decision 2 named**, which is *"ADR 0029 D-6/D-7, ADR
  0047 D-14 Q4, ADR 0046 D-1"*. Four things here are *the author's reading* of what follows from
  those, and no comment decided them:
  - **ADR 0047 D-12**, because it is the decision that records Q4 and says *"ADR 0029 D-6 stands"*:
    superseding the answer and leaving the section that states it would leave two accepted texts
    disagreeing
  - **ADR 0046 D-14(d)'s closing paragraph**, itself the owner's Q3 ruling of 2026-10-07, because
    it says in so many words *"never through the Cloudflare tunnel"*, which is what D-1's *"pictures
    do not leave the room"* means for a rider away from home
  - **ADR 0029 D-7's consent sentences**, because the owner approved different words for this path
    (D-7 here), and D-7's are about one picture on a press
  - **The pointer in ADR 0033**, which reverses nothing: its 2026-10-07 entry said this path was due
    to move, and a reader of D-6 and D-11 there needs to find where it went
- **Related, and not superseded**: ADR 0029 D-1 (a frame is its own data class), D-4 (erase), D-8
  (no frame in an error) and D-9 (stripping at capture), which this ADR applies; ADR 0033 D-3, D-6
  and D-11; ADR 0046 D-8 (one module reaches a model) and D-9 (the rider's own key); ADR 0047 D-7 to
  D-11 (the sealed transport);
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 (no vendor list);
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 (a rider with no instance loses
  nothing: the tablet's own pose model is still the default)

## Context

### What was decided before, in the words this ADR reverses

Three accepted decisions kept every camera picture off the Cloudflare tunnel, and one of them said
how it could be undone.

- **ADR 0029 D-6** rejected the tunnel for a picture by name, because *"Cloudflare terminates TLS at
  its edge"*, under the rule *"It may not travel over a transport whose operator can read it."* It
  ends: *"This decision is reversible only by a superseding ADR, and the argument it would have to
  make is that the operator cannot read the payload — not that the risk is small, not that the
  operator is trustworthy, and not that it is convenient."*
- **ADR 0047 D-12** noted that *"A sealed picture would make that argument for the payload. This
  ADR does not make it"*, for two reasons: the owner's Q3 ruling of 2026-10-07, and that *"a
  picture's size and timing are themselves revealing in a way D-11's padding does not answer."*
  D-14 Q4 was the owner's answer then: *"camera pictures stay off the tunnel, even sealed. ADR 0029
  D-6 stands."*
- **ADR 0046 D-1** carried the owner's ruling that *"The live side-camera pose model (MediaPipe on
  the tablet, epic #1055) stays on the device: it is not an analysis job, and pictures do not leave
  the room"*, and D-14(d) closed with *"Pictures travel only over the home network or a
  WireGuard-class overlay, never through the Cloudflare tunnel (ADR 0029 D-6)."*
- **ADR 0029 D-7** allowed a hosted model one picture *"the rider is looking at, on a press"*, on a
  key held on the device.

### What the owner ruled

**On [#1092](https://github.com/openzigs/onyourleft/issues/1092), 2026-10-04, ruling 1**:

> Pose on your computer (ADR 0033 D-11): move it to the instance. Side-camera pictures will go to
> the instance, which asks the vision model. A photograph of the rider then leaves the room, through
> the tunnel when away from home.

**On #1106, 2026-10-12, five points.** Point 3 is the owner's own wording:

> 1. **Sealing.** Side-camera pictures travel only through the sealed transport (ADR 0047). If it is
>    not available they are refused, never sent unsealed. Cloudflare terminates TLS on the tunnel, so
>    the seal is what keeps it from reading them.
> 2. **Storage.** Never stored on the instance: not in the job table, not in a log, not in an error
>    message. Analysed in memory and discarded.
> 3. **Which model may see them (owner's ruling).** The instance's local model, **or a hosted
>    vendor's model when the rider has entered their own key for it** (DeepSeek, Anthropic and the
>    like). Never the operator's key: the shared key of the 2026-10-04 ruling is withdrawn (Share
>    mode was withdrawn), so the body's "or the shared key under ruling 5" no longer applies.
>    - The consent for a hosted model **names the vendor** and says that pictures of the rider go to
>      that company and that what it keeps is under its terms. It is a separate consent from the
>      write-up's hosted consent (#1104 B1).
>    - "Never stored" is a promise about the instance only, and the wording must not imply more.
>    - A model that does not accept pictures is refused cleanly, with a message that says why. State
>      which models were actually checked for image input, and how.
> 4. **Consent.** Its own switch, off by default, separate from the write-up consent. Wording
>    approved by the owner before merge.
> 5. **Stripping.** EXIF and any location or device detail stripped on the device first (ADR 0029
>    D-9), as snapshots are.

**On #1106, 2026-10-12, after reading the draft on
[#1284](https://github.com/openzigs/onyourleft/pull/1284)**:

> 1. **Rider-facing wording: approved as written** ("Writeups look good"): the always-shown text,
>    both consents, the seven stop messages, the erase-screen line and the changed switch sentence,
>    as quoted in PR #1284's description.
> 2. **A new superseding ADR, not amendments.** The draft amendments become ADR 0050 (0049 is taken
>    by the asset sources). The reversed decisions (ADR 0029 D-6/D-7, ADR 0047 D-14 Q4, ADR 0046
>    D-1) each get one dated pointer under `## Amendments`, and no ADR body is edited.
> 3. **Play Data Safety: the Photos and videos row becomes shared.** Accepted.
> 4. **The through-the-tunnel measurement may be made on the Mac home instance:** one
>    picture-capable model pulled into its Ollama, one `.env` line naming it, one throwaway account,
>    removed afterwards by the owner.
> 5. **One real test against DeepSeek with the owner's key is allowed**, with a test picture that is
>    not of a person.
>
> Items 2 to 4 were my recommendations; the owner answered "yes" to the list and named 1 and 5.

That comment is quoted in full. It answers the five things put to the owner and **says nothing of
the three other questions #1284 raised** (D-11 rows 2, 3 and 5): those were not ruled on.

### Why this is an ADR and not the amendments it was drafted as

The first ruling on #1106 asked for amendments, and the draft was written as nine entries across
four ADRs. ADR 0013 D-3 has a reversed decision superseded by a new ADR, ADR 0029 D-6 says so of
itself, and the review of #1284 held the pull request on that point. The owner settled it: decision
2 above. Those draft entries never merged; this ADR carries what they said.

## Decision

### D-1 — One path: a side-camera picture may go to the rider's instance, when the rider switches it on

> **The rule.** While the side camera films, the tablet may send its pictures to the rider's own
> instance, which shows each to one model and answers what the model said. Nothing is sent until the
> rider has switched it on, and the tablet's own pose model is what runs until then.

- **For every other picture the earlier decisions stand as written.** A kept frame, a snapshot and
  the single-picture camera send nothing to an instance; no analysis job, no tool and no synced item
  carries a picture.
- **It is not an analysis job.** There is no job row, no event, no stream and no tool, and ADR 0046
  D-7's budgets do not apply. It is one request and one answer: `POST /v1/camera/side-pose`.
- **One module puts a picture in an instance's request**: `apps/web/src/camera/instance-pose.ts`.
  `apps/web/src/camera/no-picture-reachable.test.ts` §"a picture reaches an instance by one path"
  fails if a second module names the route, or if any other module that names an instance route can
  reach a picture module.
- **A rider with no instance loses nothing** (ADR 0036 D-3): the tablet's model is the default and
  needs no instance.
- **The rider's-computer path of ADR 0033 D-11 is still here** until
  [#1103](https://github.com/openzigs/onyourleft/issues/1103) removes it. The two switches cannot
  both be on, and `side-analyser.ts` takes the instance if a device somehow holds both.

### D-2 — A picture travels sealed, or it is not sent

The owner's point 1. A side-camera picture leaves the tablet only inside a sealed request (ADR 0047
D-8, D-9): sealed on the device to the instance's encryption key, signed by the device's key, through
the one module the client reaches an instance through (`instance/instance-transport.ts`). No new
network primitive and no new permit in `privacy/no-network.test.ts`.

- **The app has no unsealed way to call the route.** With no card, with keys that do not verify, or
  in a copy of the web app loaded from a website (ADR 0047 D-11), no picture is sent and the screen
  says so.
- **The instance refuses the route unsealed on EVERY instance.** It is on `sealed/phase-one.ts`'s
  list, and its handler answers `sealed_required` itself to anything that did not arrive inside
  `POST /v1/sealed`. ⚠️ **This is stricter than ADR 0047 D-7's rule for an instance with no keys**,
  which *"has no sealed routes"* and answers them in plaintext: this one route is refused there too,
  so a keyless instance takes no picture at all (`camera/routes.ts`). *The author's choice*, read
  from the owner's *"refused, never sent unsealed"*; the ruling does not name a keyless instance.
- **The row ADR 0047 D-7's table gains**, in phase 1 and born sealed: *a side-camera picture and the
  model's answer about it* — `POST /v1/camera/side-pose` — both directions.

**This is the argument ADR 0029 D-6 said a reversal would have to make**: that the operator cannot
read the payload. Cloudflare carries ciphertext it holds no key for, and a picture that cannot be
sealed is not sent. D-6's rule is unchanged; this payload now meets it on that transport.

### D-3 — What Cloudflare can see, said and not answered

ADR 0047 D-12's second reason is **not answered by this ADR. It is told to the rider instead.**

**What crosses the tunnel.** Going up, the sealed envelope, whose plaintext is the picture (a JPEG
of at most 64 KiB, base64), which model to use, and for a hosted model the origin the rider agreed
to. Coming down, the sealed answer: a few hundred bytes of a model's text.

**What Cloudflare can see**, which terminates TLS on the tunnel:

| It can see | It cannot see |
|---|---|
| That this rider's device is sending this instance something, from which address, when and how often | The picture |
| Each envelope's size to within its padding bucket: the next 64 KiB above 64 KiB, so a picture's size to within that, which says roughly how much detail was in it | The model's answer |
| The bearer session token in the header, as for every request (ADR 0047 D-11) | Which model was asked, or whether a hosted service was |
| From the rhythm, at most one a second and as slow as the model answers (one every five to seven seconds with the local models asked), for as long as it lasts: that a side camera is filming, and for how long | |

The first consent says this in a sentence (D-7): *"That service can still see that something is
being sent, how often and roughly how large."* The privacy policy repeats it.

### D-4 — A picture is never stored on the instance

The owner's point 2. A picture is in transit, analysed, and discarded.

- `apps/instance/src/camera/` **is handed no store, no blob store and no log, and imports none**
  (`camera/hosted-pictures-seam.test.ts` walks its imports). A picture is the argument of one call:
  decoded from the request, checked, shown to one model, and dropped when the call returns.
- **No job table row, no queue, no file and no cache.** The request log carries the sealed route
  alone, as for every sealed request.
- **An error is a closed code and a fixed sentence** (ADR 0029 D-8). A model server's own error
  text, which can quote what it was sent, never leaves `analysis/model.ts`.
- `camera/side-pose.test.ts` reads every byte of the database and every log line after a picture
  has been through, one of them through a model that failed.
- **At most one picture an athlete is held at a time.** A second while one is with the model is
  refused `rate_limited`, unread: a queue of photographs in memory is refused (ADR 0033 D-6).
  *The author's choice*, and so is that there is **no other cap on a rider**: inside the
  120-a-minute allowance a rider may keep the local picture model busy for as long as they film.
- **Per-athlete scoping.** The route is the session's own (`reaches: 'own'`); no body or path names
  an athlete; the one thing read about an athlete is their OWN hosted key, and a key held for
  anybody else is refused there as well as by the lookup.

⚠️ **"Never stored" is a promise about the software this repository publishes, on the instance.**
Whoever runs an instance controls that machine, a model server in front of it may log what it is
sent (`docs/operating-an-instance.md` tells an operator not to), and what a hosted service keeps is
under its own terms. The rider-facing words say each of those.

### D-5 — Which model may see a picture: the local picture model, or a hosted one on the rider's own key

The owner's point 3, in the owner's words: *"The instance's local model, or a hosted vendor's model
when the rider has entered their own key for it (DeepSeek, Anthropic and the like). Never the
operator's key."*

**Local.** A model the operator NAMES for pictures (`OYL_INSTANCE_PICTURE_MODEL`), on the server at
`OYL_INSTANCE_ANALYSIS_MODEL_URL` and held to its local-address rule on every look (ADR 0046 D-9,
[ADR 0040](0040-a-history-index-on-the-riders-instance.md) D-6). Not set, no local model takes pictures
(`pictures_off`). **The analysis model is never used in its place**: a model that writes may not
read a picture. No model is recommended or named in this repository (ADR 0031 D-4).

**Hosted.** The rider's own key (`analysis/hosted-key.ts` §`ownHostedKeyState`, ADR 0046 D-9) and
nobody else's — never the operator's, never another rider's — through one builder
(`camera/hosted-pictures.ts`, the only module besides `model.ts` that may name the hosted picture
connection).

- **What the service is sent, in full**: the picture and one fixed question this repository's
  source contains (`SIDE_POSE_QUESTION`), the model's name and a token bound. No athlete id, no
  session, no ride, nothing the rider typed. ADR 0046 D-10's masking does not apply because there
  are no words of the rider's to mask, which is why this is a second seam and not
  `analysis/hosted.ts`'s.
- **The request is pinned to the one host the key was stored with and never follows a redirect**
  (`pinnedTo`), so neither the picture nor the key can be sent on to another.
- **A key moved to another service is refused** (`picture_source_unavailable`) until the rider has
  agreed to a sentence naming the new one (D-7).

**A model that takes no picture is refused, saying so.** A 400, 415 or 422 whose words say the
MODEL does not take pictures is `model_without_pictures`; the words are matched and dropped, and the
app says *"The model answered that it does not take pictures"* and stops for the session. ⚠️ **A
refusal that merely names an image is not that.** The draft matched any such refusal containing
*image*, *vision* or *multimodal*, and the real models of §"What was verified" showed it wrong: two
models that DO take pictures, sent bytes they could not decode, answered with words naming an image.
Those are now one failed picture each. **One sentence was observed** from a server refusing a model
that takes no picture; every other wording the patterns take is the author's reading of what
servers say (`analysis/model.ts` §`WITHOUT_PICTURES`, six patterns, each written to stop where a
statement about the picture itself would go on). A status that is not one of the three, a 429 or a
5xx, is never read this way whatever it says. ⚠️ **A model that takes no picture and words it
otherwise is `picture_model_failed`**: three failed pictures and a stop that says *"gave no usable
answer"*, the wrong sentence, with no picture sent on regardless.

⚠️ **A server that silently drops a picture it cannot read is not detected.** Its answer is then
about nothing, and what stands between it and the report is the device's check that the points
could be a person on a bicycle (#761). None of the four models asked did this (§"What was
verified"); a sight check, a known picture asked about before the first real one, is owed if one is
found to.

### D-6 — The hosted consent travels with every picture, and is not a row on the instance

*The author's choice, put to the owner as a question on #1284 and not ruled on (D-11).* The hosted
consent is given on the device, stored there, and sent with every picture as the origin it named,
inside the sealed and device-signed request. The instance sends a picture on only when that origin
is the origin the rider's key goes to. It is a different consent from the write-up's (ADR 0046 Q10,
`athlete_hosted_consent`), which this path never reads.

One fewer thing about a rider is kept on a server, against no server-side record that consent was
given. Nobody between the device and the instance can assert it for the rider, because the request
is signed by the device's key.

### D-7 — Two consents, each off by default, and the words

The owner's point 4, and decision 1 of the second comment: **the wording is approved as written.**

- **Two switches on the Camera page**, each beside the sentence it is consent to, both `false` on
  every device until the rider ticks them. The second sits under the first and is withdrawn with it.
- **Neither is the write-up's consent**, and this path never reads that one.
- **Stored on the device, not the instance**, the first consent as well as the hosted one (D-6):
  *the author's choice*, and not ruled on. The first is stored as the address of the instance it
  was given for: a device that later signs in to another instance holds no agreement for that one.
  *Erase this device* forgets both with the sign-in, and so does disconnecting from the instance, so
  the next account on a shared tablet inherits neither.
- **Turning the instance's switch on turns off ADR 0033 D-11's computer switch**, and the reverse:
  one place at a time.
- **The hosted consent names the service** by the host of the URL the rider stored their key with,
  read back from their instance on a press, because the app ships no vendor list and no vendor's
  name (ADR 0031 D-4).

**The words** are `apps/web/src/camera/instance-pose.ts` §`SIDE_INSTANCE_WHAT_IS_SENT`,
§`SIDE_INSTANCE_CONSENT` and §`sideInstanceHostedConsent`, and `docs/privacy-policy.md` §"Side-camera
pictures sent to your instance" quotes them word for word (`camera/instance-pose-policy.test.ts`).
The source is the record; they are quoted here so a later change to them is seen to be a change to
what the owner approved.

What is sent, always shown:

> Your instance can look at the side camera’s pictures instead of this tablet. Nothing is sent until
> you switch it on here. Each picture is then sealed on this tablet so that only your instance can
> open it, sent to your instance, looked at by a model there, and not kept there: not in its
> database, not in a file and not in its logs. If the sealed connection is not available, no picture
> is sent.

The first consent:

> While the side camera is filming, pictures of you leave this room, about one a second, and go to
> your instance instead of being looked at on this tablet. They are sealed before they leave, so
> nobody between this tablet and your instance can see them, including the tunnel service a home
> instance is reached through. That service can still see that something is being sent, how often
> and roughly how large. Your instance shows each picture to the model its operator set up on that
> machine, and does not keep it. That is a promise about the software this project publishes:
> whoever runs your instance controls that machine.

The hosted consent, with the service's host where *the service* stands here:

> This sends pictures of you to the service. If you turn this on, your instance sends each
> side-camera picture on to the service, the service your own key is for, using your key. That is a
> company that is not you and not us. What it does with your pictures, and how long it keeps them,
> is under its terms and not ours. We cannot see that, and we cannot delete them for you afterwards.
> “Not kept” is a promise about your instance only. It says nothing about the service. Your instance
> sends the picture and one fixed question, and nothing else: not your name, not your rides, not
> where you were. You do not need this. This tablet can look at the pictures itself, and so can the
> model on your instance. This is off, and it stays off until you turn it on.

**When it stops, the screen says why** (`views/SideCameraControl.tsx` §`SIDE_INSTANCE_STOPPED_TEXT`,
seven sentences), and a stop lasts the session.

**ADR 0029 D-4's second `ERASE_CANNOT_REACH` line ships now**, worded for who sent it: *"a
photograph your instance sent on to a hosted service you agreed to, which is a copy that service
holds"*.

**Play Data Safety: the Photos and videos row is `shared: true`**, the owner's decision 3. The
instance sending a picture on to a hosted service is a transfer to a third party, filed as shared on
[#803](https://github.com/openzigs/onyourleft/issues/803)'s reasoning for the health rows. ADR 0029
§"What `docs/privacy-policy.md` and Play Data Safety would have to say" is done in the same pull
request as the first byte, as it asked.

### D-8 — Stripping on the device first, and checked twice more

The owner's point 5 (ADR 0029 D-9). The rule is applied three times on this path:

1. **At capture**: a side-camera picture is re-encoded from pixels on the phone when it is taken.
2. **Before the tablet sends**: it refuses to send one that carries a metadata marker
   (`instance-pose.ts`, through `frame.ts` §`capturedFrame`).
3. **On arrival**: the instance checks again and refuses one (`camera/picture.ts`), because its next
   hop may be a company.

ADR 0029 D-9's boundary table gains a row, `departing`: a side-camera picture to the rider's
instance (`privacy/boundaries.test.ts`).

⚠️ **The instance's check is a window scan, not a segment walk**, mirroring `frame.ts`: an Exif
block that starts after the first 4096 bytes passes it. The device re-encodes from pixels, so only a
modified client could send one, and only of its own rider.

### D-9 — One picture a second, and why

[Spike 0025](../spikes/0025-side-camera-pictures-through-the-instance.md), loopback, 2026-10-12.

- **Five a second is not reachable, and not for bandwidth.** An instance allows one session 120
  sealed requests a minute (`auth/identity.ts` §`DEFAULT_LIMITS`), and offered a picture every
  200 ms it refused 180 of 450 in ninety seconds. That allowance is shared with sync and with a
  write-up's stream, and this ADR does not raise it. *Not raising it is the author's choice.* The
  owner approved wording that says *"about one a second"*, which is not a ruling on the allowance.
- **So the app sends at most one a second, one at a time** (`INSTANCE_POSE_INTERVAL_MILLISECONDS`),
  and a model slower than that sets the rate. **One a second is the cap on sending, not a rate
  that was achieved with a real model.** With a SCRIPTED model that answers at once, 130 of 130 of
  the largest pictures offered a second apart were answered over 129 s with none refused, which
  shows the transport and the allowance carry it. With the two real local models asked, on a
  machine at a load average of 11 to 23, a picture was sent about once every five to seven seconds
  (16 of 90 and 27 of 200 offered a second apart).
- **What it costs.** A sealed picture is 22 KB up for an 8 KiB picture, 87 KB for 24 KiB and 175 KB
  for the largest the side link carries (64 KiB), and about 0.4 KB down: 176 KB a second up at the
  largest, 1.4 Mbit/s. Sealing, the round trip and opening took 8 to 31 ms at the median with a
  model that answered at once, so the model is the whole of the latency.
- **What the side analysis needs** is ten pictures with a rider in them for the framing check, and
  a session's worth for the report. It needs no particular rate. A rider waits for the check as long
  as ten answers take, where the tablet's own model takes two seconds: about ten seconds with a
  model that answers inside a second, which no model asked did, and **67 s and 80 s with the two
  local models asked on this machine** (§"What was verified").
- A picture's envelope is at most 175 KB, inside `/v1/sealed`'s own limit for the 1 MiB body an
  instance starts with.

A session looked at by the instance records its source as `computer`, the stored value for a
general vision model off the tablet (D-11).

### D-10 — What is superseded, and what stays of each

| Decision | Superseded, for a sealed side-camera picture to the rider's instance | Stays |
|---|---|---|
| **ADR 0029 D-6** | The table's row *"Cloudflare Tunnel — REJECTED for this payload, by name"*, for this payload **when it is sealed** | The rule itself, *"It may not travel over a transport whose operator can read it"*, which this path meets. Every other row. **An UNSEALED picture through a TLS-terminating proxy is as rejected as it was**: #387's path to the rider's own computer still refuses any address off their own network |
| **ADR 0029 D-7** | *"Only for a frame the rider is looking at, on a press"*: a hosted model may now be sent the side camera's pictures continuously while it films, about one a second, behind two switches. Its consent sentences, which are not the ones shown (D-7 here) | What leaves: *"the frame, and a fixed prompt this repository's source contains. Nothing else"*. The key is the rider's own, though it lives on their instance since ADR 0046. Never default, never silent. What comes back is untrusted input (D-8). The single-picture camera's own hosted path, which is unchanged |
| **ADR 0047 D-14 Q4**, and **D-12** which records it | *"Camera pictures stay off the tunnel, even sealed"* | D-12's second reason, that size and timing are revealing: not answered, and said to the rider (D-3 here). **Every other camera picture stays off the tunnel**: only the side camera's are admitted |
| **ADR 0047 D-7** | Nothing. Its table gains a row (D-2 here), and that row is stricter than its rule for a keyless instance | The table and the rule |
| **ADR 0046 D-1** | *"Pictures do not leave the room"*, for the side camera's pictures when the rider has switched this on | *"AI analysis … runs only on the rider's instance"*. *"The live side-camera pose model (MediaPipe on the tablet …) stays on the device"*: it does, as the default. *"It is not an analysis job"*: this is not one either |
| **ADR 0046 D-14(d)**, closing paragraph (Q3, 2026-10-07) | *"Never through the Cloudflare tunnel"*, for a picture that is sealed | The rest of D-14(d): nothing the client refuses to send leaves through the instance, as it narrows it |
| **ADR 0033 D-6** | Nothing is reversed. *"Never … sent anywhere else"* has a second exception beside D-11's | At most one picture waits; no picture is written to the tablet's storage; the per-ride keep is not offered on this path; pose numbers alone are kept |
| **ADR 0033 D-3** | Nothing | Its never-across list holds here too: the request carries the picture, which model, and for a hosted model the origin agreed to, and nothing else |

### D-11 — The questions #1284 put to the owner, and the answer taken for each

| # | The question | The answer taken | Whose |
|---|---|---|---|
| 1 | Amendments, or a superseding ADR? | **A superseding ADR**: this one | The owner, decision 2 |
| 2 | The hosted consent is not a row on the instance; should it be? | **Not a row.** It is the device's, sent sealed and signed with every picture (D-6) | *The author's choice.* **Not ruled on**: the owner's decisions comment does not mention it. A second consent table is a later ADR's to add |
| 3 | The local picture model is its own setting, never the analysis model; a rider on a hosted key uses that key's one model for pictures and write-ups | **As built** (D-5) | *The author's choice*, not ruled on. A separate picture model per key would change the stored key |
| 4 | Play Data Safety: the Photos and videos row `shared: true`? | **Yes** (D-7) | The owner, decision 3 |
| 5 | A session looked at by the instance is recorded with source `computer`; a third stored value? | **`computer`.** A third value would change the stored record, the account export and what an instance accepts in a job | *The author's choice*, not ruled on |
| — | The rider-facing wording | **Approved as written** | The owner, decision 1 |
| — | The run through the tunnel | **May be made on the Mac home instance**, by the owner's arrangement, and is still owed | The owner, decision 4 |
| — | A real hosted model | The owner allowed **one real test** against DeepSeek. **Two requests were made on the owner's key**: the test, and a second with a deliberately undecodable picture to obtain a real refusal (§"What was verified") | The owner, decision 5, for the one test. The second request was the author's and was not asked for |
| — | The sealed-request allowance is not raised, so the cap is one a second (D-9) | **As built** | *The author's choice*, not ruled on |
| — | The route is refused on a keyless instance, stricter than ADR 0047 D-7 (D-2) | **As built** | *The author's choice*, not ruled on |
| — | The first consent is stored on the device, as the hosted one is (D-7) | **As built** | *The author's choice*, not ruled on |
| — | One picture an athlete at a time, and no other cap on a rider (D-4) | **As built** | *The author's choice*, not ruled on |
| — | The supersession list beyond the four the owner named: ADR 0047 D-12, ADR 0046 D-14(d)'s closing paragraph, ADR 0029 D-7's consent sentences, the pointer in ADR 0033 | **As listed under Supersedes**, with why each follows | *The author's reading* |

### D-12 — How it is held

| What | Held by |
|---|---|
| One module puts a picture in an instance's request | `apps/web/src/camera/no-picture-reachable.test.ts`; `privacy/no-network.test.ts` §"through the one instance module"; `privacy/boundaries.test.ts` |
| Sealed on every instance, a keyless one included | `apps/instance/src/camera/side-pose.test.ts` through the real listener; `sealed/phase-one.test.ts` |
| Nothing stored | `camera/side-pose.test.ts` (the database and every log line read after a picture); `camera/hosted-pictures-seam.test.ts` (no store, blob store or log imported) |
| The rider's own key, and the consent's origin | `camera/side-pose.test.ts`; `analysis/model.test.ts` (one host, no redirect, the local-address rule, for both picture builders) |
| A model that takes no picture, and a picture a model could not open | `analysis/model.test.ts`, with the words the real servers answered |
| The consents: off by default, one instance, forgotten on erase and on disconnect | `camera/instance-pose.test.ts`, `views/SideInstancePictures.test.tsx`, `instance/instance-port.test.ts`, `transfer/erase-device.test.ts` |
| The words, and the policy quoting them | `camera/instance-pose-policy.test.ts`, `a11y/route-sentences.a11y.test.tsx` |
| The instrument | `apps/instance/tools/side-picture-round-trip.test.ts`, through `startInstance` itself |

## Consequences

### What this enables

- The side analysis can use a general vision model on the rider's instance, at home or away,
  without the rider's computer being on their network path (#1103 can then remove that path).
- A rider with their own hosted key can use it for pictures, having read a sentence that names the
  service.

### What this costs, stated plainly

- **A photograph of the rider leaves the room**, at most one a second while the side camera films
  (one every five to seven seconds with the local models asked), when they switch this on. Until this ADR no picture left the rider's own network.
- **Cloudflare learns that a side camera is filming, for how long, and roughly how detailed each
  picture is** (D-3). The seal does not hide that, and nothing here pads timing.
- **With the hosted switch on, a company holds pictures of the rider under its own terms**, and
  neither the rider's instance nor this project can delete them. The erase screen says so.
- **The Play listing's Photos and videos row reads "shared"** for every user of the app, including
  the many who never switch this on.
- **The framing check took 67 s and 80 s with the two local models asked, against 2 s on the
  tablet's own model** (D-9): thirty to forty times as long, on a busy machine.
- **An operator's model is busy for as long as a rider films.** A rider with an account can ask the
  local picture model about one picture at a time, inside the 120-a-minute limit, with no cap of its
  own. Write-ups have a start limit; this has none.

### Constraints this places on other work

- **Any other picture on the tunnel is a new ADR.** This admits the side camera's pictures and
  nothing else: not a kept frame, not a snapshot, not the single-picture camera.
- **An unsealed route for a picture is not a configuration.** The handler's own `sealed_required`
  is part of this decision, not of ADR 0047 D-7's table.
- **A change to the words quoted in D-7 is a change to what the owner approved**, and needs the
  owner.
- **Raising an instance's sealed-request allowance to send faster** changes D-9 and what D-3 tells
  the rider about the rhythm.
- **A vendor's name in the app** is still ADR 0031 D-4's to refuse: the service is named by the
  host of the rider's own key.
- [#1121](https://github.com/openzigs/onyourleft/pull/1121) edits `docs/privacy-policy.md` and
  `data-safety.ts` too; whichever merges second merges the other in.

### What would make this ADR wrong

- **The seal not holding**: a way for the tunnel's operator to read a sealed envelope, or a path by
  which a picture is sent unsealed. D-2 is the whole of the argument ADR 0029 D-6 asked for.
- **A picture found stored on an instance** this repository's software runs: in the database, a
  file, a log or an error.
- **A hosted service being sent a picture on any key but the rider's own**, or to an origin the
  rider's consent does not name.
- **A real model that drops a picture silently and answers anyway** in a way the plausibility check
  passes (D-5).
- **The through-the-tunnel run showing one a second is not sustainable** on a home connection's
  upstream (D-9 is a loopback measurement).

## What was verified, and what was not

Run on 2026-10-12 from this branch, on an instance started for each run on loopback
(`apps/instance/tools/side-picture-round-trip.ts --loopback`), never the home instance. Written up
in full in [spike 0025](../spikes/0025-side-camera-pictures-through-the-instance.md) §8.

**The picture was of nobody**: three coloured shapes, drawn and encoded in code
(`apps/instance/tools/drawn-picture.ts`), 320 by 240, 6 021 bytes, no metadata. No image file is
committed. **No model was shown a rider, so no model's landmarks were read.**

| Model | Where | Accepted the picture | Round trip, through the sealed route | What it answered |
|---|---|---|---|---|
| `gemma4:12b` | the owner's Ollama 0.30.5, local | **Yes**, 27 of 27 sent | 6.6 s p50, 11.7 s p95, 12.8 s at most (4.5 s at least) | `{"rider":false}` every time, 19 of 27 inside a Markdown code fence, which the app's reader takes |
| `gemma3:4b` | the same, local | **Yes**, 15 of 16 sent; one was answered `picture_model_failed`, and why was not established (the 25 s bound while the model loaded is the likely cause) | 4.7 s p50, 6.5 s at most (0.5 s at least) | `{"rider":false}` every time |
| `qwen2.5:3b` | the same, local, a text-only model | **No**: HTTP 400, *"Multimodal data provided, but model does not support multimodal requests."* | 10.4 s, loading included | The instance answered `model_without_pictures`: **read correctly** |
| `deepseek-flash` | `https://api.deepseek.com/v1`, on the owner's key | **Yes**: HTTP 200 | 2.0 s (1 972 ms at the service) | `{"rider":false}`; its reasoning named *"shapes only"*, so it saw the picture |

- **DeepSeek: the owner allowed one real test, and two requests were made on the owner's key.**
  The first is the row above. The second sent a deliberately undecodable picture (the tool's filler
  bytes) to obtain a real refusal; it was the author's decision, not something the owner's decision
  5 asked for, and it is said here because it cannot be undone.
- **One a second was offered and the local models set the rate**: of 200 pictures offered a second
  apart, `gemma4:12b` was sent 27, and of 90 `gemma3:4b` was sent 16, because each was still out
  when the next fell due: about one every seven seconds and one every five to six. Ten answers,
  the framing check's count, took 67 s (`gemma4:12b`) and 80 s (`gemma3:4b`). ⚠️ The machine was
  busy with other work (a one-minute load average of 11 to 23), so these are slower than the models
  alone.
- **The refusal pattern was wrong, and is fixed** (D-5). `gemma3:4b`, sent the measuring tool's
  filler bytes, answered 400 *"Failed to load image or audio file"*; `deepseek-flash`, sent the
  same, answered 400 *"You have uploaded an unsupported image. Please make sure your image is valid
  and has one of the following formats: webp, png, jpeg, and gif."* The instance read both as
  `model_without_pictures`. They are now `picture_model_failed`, one failed picture.
- ⚠️ **A model server's list is not a reliable "no"**: that Ollama lists `gemma3:4b` with
  `completion` alone and no `vision`, and it read the picture.
- **The key**: read from a file into one process's environment for each of the two requests, stored
  sealed on a throwaway account of a loopback instance, cleared and read back as cleared, and the
  instance's data directory deleted. It was written to no file, log line or report.

**Not verified:**

- **Anthropic**, or any hosted service but DeepSeek: read from documentation only.
- **The tunnel**: the owner's decision 4 allows the run on the Mac home instance, and it is owed.
- **A picture with a rider in it, on any model**: whether a real model returns nine landmarks the
  reader takes and the plausibility check passes, and whether a model that reasons finishes inside
  the 512-token bound on that longer answer. A local picture model has no reasoning allowance
  setting; a hosted key has one.
- **What a hosted service that takes no picture answers.** DeepSeek's `deepseek-flash` takes them.
- **A real camera's picture sizes, the tablet, and a WebView's sealing time.**
