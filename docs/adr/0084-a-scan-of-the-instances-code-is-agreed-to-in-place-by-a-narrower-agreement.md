# ADR 0084: A scan of the instance's code is agreed to in place, by a narrower agreement — superseding in part ADR 0033 D-4 and ADR 0029 D-5

- **Status**: **Accepted**, 2026-11-19, by the owner on
  [#2863](https://github.com/openzigs/onyourleft/pull/2863#issuecomment-7005571655), asked one
  question at a time with the screenshots of the question at 1280 and 320 px:
  1. *"Yes, short agreement (Recommended)"*: a scan of the instance's code may be agreed to by the
     two sentences alone, without ADR 0029's consent flow and its bystander sentence. The side
     camera's own pairing scans keep ADR 0029's consent. This also covers #377's *"ONE consent
     flow"* criterion for this narrower agreement.
  2. *"Superseding ADR (Recommended)"*: recorded as this ADR, superseding ADR 0033 D-4 and ADR 0029
     D-5 in part, per [ADR 0013](0013-adr-amendments.md) D-3, with one dated `## Amendments` entry
     on each pointing here.
  3. *"Approve (Recommended)"*: the wording as drafted is approved: the two sentences, *"Use the
     camera"* / *"Not now"*, the after-a-scan notice, and the privacy-policy section.
- **Date**: 2026-11-19
- **Deciders**: **the owner**, on all three answers above. **The author** wrote the design and the
  wording the owner approved, in #2856's pull request #2863
- **Issue**: [#2856](https://github.com/openzigs/onyourleft/issues/2856)
- **Number**: **0084**. On 2026-11-19 `main` held ADRs up to 0082 with 0081 unwritten. 0081 is
  claimed by #2836's lane (its comment of 2026-11-18) and 0083 by #2835's pull request
  [#2864](https://github.com/openzigs/onyourleft/pull/2864). No other open pull request adds a file
  under `docs/adr/`, and no issue or pull request names 0084
- **Supersedes, in part**, only for **a scan of the instance's code** (the instance's card, an
  invite, a code that adds this device, and the owner's claim code, read on the Connect and
  Instance screens):
  - [ADR 0033](0033-side-camera-link.md) **D-4**'s *"ADR 0029's consent flow is shown before the
    first camera use **on each device**, and scanning counts as camera use."*
  - [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-5**'s placing of the bystander sentence
    in the consent screen *"before the camera is ever turned on"*.

  Each gains one dated `## Amendments` entry pointing here. Neither body is edited (ADR 0013 D-3)
- **Leaves standing**: ADR 0033's own two pairing scans, the tablet's and the phone's, which still
  need ADR 0029's whole consent first, on each device; D-5's sentence, word for word, before every
  use of the camera that takes a picture; and everything ADR 0033 D-4 says of the frames a scan
  reads

## Context

ADR 0033 D-4 was written for the side camera's two pairing codes. Since #2785 the same camera also
reads the instance's codes on the Connect and Instance screens
([ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md) D-6,
[ADR 0080](0080-first-run-setup-and-owner-claim-on-the-loopback-listener.md)). Under D-4, on a device
nobody had agreed anything on, *Scan a code* was refused with "Agree to it on the Camera screen and
come back": a long page about being filmed while riding, six taps away, while the ten minutes of the
owner's claim code ran.

#2856 asked which of two it should be: the camera's own consent asked in place, or a separate,
narrower agreement. The camera's own consent is `consent.local`, and everything on the Camera screen
runs under it, so asking it in place would leave a rider who came to scan a code with the side
camera's features agreed to; and ADR 0029's flow is seven sentences and the bystander tick, which is
the long page again on the Connect screen. #2863 built the narrower agreement and asked the owner.

## Decision

### D-1 — The scan asks where it was pressed, in two sentences

On a device where neither agreement has been given, *Scan a code* asks in place, before any camera
is asked for (`apps/web/src/camera/consent.ts` §`SCAN_CONSENT_STATEMENT`):

> The camera is used only to read this code, and it goes off as soon as the code is read or you close the scanner. No picture is kept or sent anywhere, and nothing on the Camera screen is switched on.

with two buttons, **"Use the camera"** and **"Not now"** (`apps/web/src/views/CardScanner.tsx`).
*Use the camera* records the agreement and opens the scanner; *Not now* records nothing and asks for
no camera. ADR 0029's consent flow and its D-5 bystander sentence are not shown for this scan.

### D-2 — The agreement admits a scan and nothing else

The yes is a second agreement (`apps/web/src/camera/session.ts` §`agreeToScan`) that admits one
thing: the camera coming on to read a code (`turnOn(facing, 'scan')`, `consent.ts`
§`cameraMayOpen`). **It never sets `consent.local`.** With it alone the controller refuses the Camera
screen's and the side camera's turn-on, a capture, a side-camera picture, a picture for the rider's
own computer, the per-ride keep and the presence watch, each with the camera running and each before
the camera port is called. It is held in memory as ADR 0029's consent is, so it is asked once each
time the app is opened, and it is taken back with that consent. A rider who has given ADR 0029's
consent is not asked again.

### D-3 — What the frames are and where the sign is

Unchanged from ADR 0033 D-4: the frames are camera imagery under ADR 0029 D-1, decoded in memory for
the code only, discarded as soon as a code is read or scanning is cancelled, never sent, never kept
and never analysed for anything else. **No picture is taken, kept, sent or analysed**, so nothing
exists for ADR 0029 D-2 to keep, for D-3 to export, for D-8 to name or for D-10 to cache. The
**"Camera on" sign still shows** while a scan's camera is on: D-5's *"the bystander's only signal"*
is kept.

### D-4 — The Camera screen after such a scan

After the camera has come on for a scan under this agreement, the Camera screen no longer says the
camera *"has never been on"*. It says (`apps/web/src/camera/notice.ts` §`CAMERA_OFF_AFTER_A_SCAN`):

> It stays off until you turn it on. It has been on only to read a code, when you said it could. No picture was kept or sent, and there is nothing on this device to remove.

### D-5 — The one consent flow

This is a second agreement beside ADR 0029's, and the owner's first answer covers #377's *"ONE
consent flow"* criterion for it. Its wording lives in the one consent module (`consent.ts`), so
`camera/boundary.test.ts` holds it there. The privacy policy's section *"Scanning a code with this
device's camera"* quotes the two sentences word for word.

## Consequences

### What this enables

- A rider on a new device can scan the instance's card, an invite, an add-device code or the owner's
  claim code with one yes, where *Scan a code* was pressed, while the claim code's ten minutes run.
- A rider who came to scan a code leaves with nothing of the Camera screen switched on.

### What this costs, stated plainly

- **D-5's sentence is not shown before this use of the camera.** The case for it: no picture is
  taken, kept, sent or analysed, so the sentence's remedy (where to point the camera) has nothing to
  act on, and what the camera sees is shown only on the screen of the device being aimed. The
  "Camera on" sign is the bystander's signal here, as it is elsewhere.
- **There are two camera agreements, not one.** `cameraMayOpen` is the single rule for which
  agreement admits which use, and every use but a scan needs `consent.local`. A new camera use added
  later must say which it needs; the default is ADR 0029's consent.
- `captureSideFrame` and `setKeeping` check `consent.local` themselves, because "a running session is
  the consent" stopped being true with this agreement.

### Reversing it

Delete `agreeToScan` and the `'scan'` case of `cameraMayOpen`, and the scanner falls back to ADR
0033 D-4: no camera without ADR 0029's consent. A superseding ADR records it.
