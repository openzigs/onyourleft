# On Your Left — privacy policy

**Last updated: 2026-09-16.** This is the policy for the On Your Left Android app
(`dev.openzigs.onyourleft`) and for the web client it is built from. It is the policy linked from the
app's About page and from the Google Play listing, and those two links point at this file
([#95](https://github.com/openzigs/onyourleft/issues/95)).

## The short version

**We collect nothing.** There is no account, no server and no analytics. Everything the app records
stays on the device that recorded it, and nothing is uploaded — not a ride, not a heart rate, not a
position, not a crash report, not a page view.

That is not a promise about our intentions. It is a property of the software: the code this project
writes contains no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call at all, so there is
nothing in it that could send your data anywhere. The whole thing is
[open source](https://github.com/openzigs/onyourleft), so you can check that rather than take our
word for it.

The one exception is a map, and it is described under **What leaves the device** below: if a basemap
is configured, the map library the app uses requests tiles from the host it is configured with. That
is the only outbound request the app can make, and no basemap is configured in this build.

## What the app holds, and where

All of it is in the app's own storage on your device (IndexedDB), and none of it leaves except by
your own action:

| What | Where it comes from |
| --- | --- |
| Rides — time, power, cadence, speed, distance, heart rate, and position where a ride has one | the Bluetooth sensors and trainer you pair, and files you import |
| Health and fitness data — heart rate, power, cadence | a Bluetooth heart-rate strap, power meter or smart trainer |
| Routes, segments, efforts and workouts | drawn in the app, or imported from a file you choose |
| A threshold power and a unit preference | typed by you in Settings |
| A signing keypair, used to sign your own activity records | generated on the device the first time it is needed |

The private half of the signing key is a non-extractable key held by the browser or WebView: the app
itself cannot read it, cannot copy it, and cannot send it anywhere. Its public half travels only
inside a file you export.

**Nothing here is linked to an identity, because there is no identity to link it to.** The app never
asks for a name, an email address, a phone number or a date of birth, and it has no field to put one
in.

## Location

A ride can carry positions, and a route is a line on a map, so the app holds location data on your
device. **It does not collect it** — it is never transmitted to us or to anybody else.

Three things worth being precise about:

- **The app does not read your device's location.** It requests no GPS fix. Positions arrive from
  files you import and from routes you draw.
- **The Android location permissions are for Bluetooth, not for you.** Android 11 and earlier would
  not let an app scan for Bluetooth devices at all without a location permission, so the app declares
  `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` bounded at API 30. On Android 12 and later they
  are not requested and grant nothing. The Bluetooth scan permission itself asserts
  `neverForLocation`, which tells Android the scan is not a way of working out where you are.
- **Privacy zones are a publishing tool, not a storage one.** When a ride is shared or exported for
  sharing, points inside a zone you set are trimmed from the copy. Your own view of your own ride is
  never trimmed — it is your data.

## What leaves the device

Only these, and only when you do them:

- **A file you export.** FIT, GPX, TCX, a workout, or a whole-account export. It goes wherever you
  put it and it is then out of the app's hands.
- **A ride or route you choose to share.** A copy, trimmed by your privacy zones.
- **Map tiles, if a basemap is configured.** The map is off by default and no tile host is configured
  in this build. If one is configured, your device requests tiles from it and that host can see your
  IP address and which tiles you asked for — which is roughly the area you are looking at. That is a
  request your device makes to a third party, and it is the only outbound request this app can make.

## What the app does not do

- No advertising, and no advertising identifier.
- No analytics, no telemetry, no crash reporting, no session recording.
- No third-party SDK of any kind is linked into the app.
- No sale or sharing of personal information — there is none held, and nothing is transmitted.
- No tracking across apps or sites.

## Deleting your data

Uninstalling the app removes everything it holds. Inside the app, **Files → Erase this device**
deletes every ride, route, segment, effort, workout and setting, and the signing key with them,
after you type a confirmation phrase.

Two things an erase cannot reach, and the app says so before you press it: files you have already
exported, and a copy of a ride you have already given to somebody.

## Children

The app is not directed at children and collects nothing from anybody, including them.

## Changes to this policy

This file is version-controlled. Its history is the change log, and every change to it is a public
commit in the repository above. The date at the top is the date of the last substantive change.

## Contact

Open an issue at <https://github.com/openzigs/onyourleft/issues>. For anything that is a security or
privacy **vulnerability**, use
[private vulnerability reporting](https://github.com/openzigs/onyourleft/security/advisories/new)
rather than a public issue — `SECURITY.md` says why.
