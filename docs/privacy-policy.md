# On Your Left — privacy policy

**Last updated: 2026-09-25.** This is the policy for the On Your Left Android app
(`dev.openzigs.onyourleft`) and for the web client it is built from. It is the policy linked from the
app's About page and from the Google Play listing, and those two links point at this file
([#95](https://github.com/openzigs/onyourleft/issues/95)).

## The short version

**We collect nothing.** There is no account and no analytics. **Your rides stay on your device.** To
draw a map, the app asks our tile server for the map around where you rode. It sends no ride data,
and we keep no record of the request, nor have one kept for us. You can turn map tiles off in Settings. Apart
from that map request, **on its own the app uploads nothing** — not a ride, not a heart rate, not a
position, not a crash report, not a page view.

That is not a promise about our intentions. It is a property of the software: the code this project
writes contains exactly **one** network call, and it can do only the one thing described in the next
paragraph. The whole thing is [open source](https://github.com/openzigs/onyourleft), so you can check
that rather than take our word for it.

**The one thing you can switch on: a picture sent to a computer of your own.** If you use the
camera, you can enter the address of a computer on your own network — one you run, with a model
server you installed on it — and switch it on. The app then sends one picture from the camera to
that address, and only when you press the button that sends it. Nothing is set up to begin with,
and nothing is sent until you have entered an address and switched it on. It is described under
**Pictures sent to your own computer** below.

⚠️ **That computer is yours, not ours.** On Your Left runs no server. It is not an On Your Left
service, not an account, and not the future sync server this project may one day run
([#7](https://github.com/openzigs/onyourleft/issues/7)), which does not exist. We never see the
picture, and we cannot see what your computer does with it.

The other exception is a map, and it is described under **What leaves the device** below: when a
ride with a GPS track is shown on a map, the map library the app uses requests map tiles from
`tiles.openzigs.com`, which is where this project keeps its basemap. That is a request the map
library makes, not this app's code, and it is **on by default** — it carries no account, cookie or
identifier of ours, but the host can see your IP address and roughly which area you are looking at.
**You can turn it off**: Settings → *Ride map* → *Draw map tiles under my rides*. With it off the app
requests nothing from `tiles.openzigs.com`, and still draws your route on a plain background.

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
| Pictures from the camera — only the ones you chose to keep | the camera, if you turn it on and then turn on "keep the pictures from this ride" for that ride. Otherwise a picture is thrown away as soon as it has been looked at |
| The address and model name of your own computer, if you set one up | typed by you on the Camera page, and kept in this device's browser storage |

The private half of the signing key is a non-extractable key held by the browser or WebView: the app
itself cannot read it, cannot copy it, and cannot send it anywhere. Its public half travels only
inside a file you export.

**Nothing here is linked to an identity, because there is no identity to link it to.** The app never
asks for a name, an email address, a phone number or a date of birth, and it has no field to put one
in.

## Location

A ride can carry positions, and a route is a line on a map, so the app holds location data on your
device. **It does not collect it** — a ride's positions are never transmitted to us or to anybody
else. The one thing that says anything about where you rode is the map's tile request, described
under **What leaves the device**, and you can turn that off.

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
- **A picture sent to your own computer, if you set one up and switch it on.** See the next section.
- **Map tile requests, when a map is on screen.** Map tiles are **on by default**, and you can turn
  them off in Settings → *Ride map*. To draw a ride that has
  a GPS track, your device requests map tiles from `tiles.openzigs.com` — a single static
  file this project keeps on Cloudflare R2 storage, served through Cloudflare. Nothing is sent with
  the request but the request itself: no ride data, no account, no cookie and no identifier. But the host
  sees your IP address and which tiles you asked for, and for your own ride that is roughly **where
  you rode** — including inside your privacy zones, because your own view of your own ride is never
  trimmed. We keep no record of the request, nor have one kept for us: no access logging, log export or
  analytics is turned on for that host, and that is checked before every release. Cloudflare, which
  operates the host for us, handles the traffic under its own privacy policy; this project does not
  use it to identify you or to work out where you are. With map tiles off, the app requests nothing
  from `tiles.openzigs.com` and draws your route on a plain background, with the OpenStreetMap
  credit beneath it.
  Indoor rides, and the map drawn during a game ride, request nothing. The tiles cover the
  contiguous United States; elsewhere the map shows your line on a plain background, and after
  reading the file's index the app requests no tiles at all. A build of the app can be pointed at another tile
  host, or at none.

## Pictures sent to your own computer

This is the one thing this app's own code can send anywhere, and it is off until you turn it on.

- **What is sent:** one still picture from the camera, and a fixed question written into the app.
  Nothing else — not your rides, not your position, not your heart rate, not a name, not an
  identifier, and not a filename. The picture is re-encoded from its pixels when it is taken, so it
  carries no location or device metadata.
- **Where it goes:** to the one address you typed, and nowhere else. The app refuses an address
  that is not on your own network — a private address such as `192.168.…` or `10.…`, a name ending
  in `.local`, or the address your own encrypted network (such as a WireGuard-based one) gives your
  computer. It will not send a picture to a service on the internet, and it will not follow a
  redirect somewhere else.
- **When:** only when you press the button that sends it. Never on a timer and never in the
  background.
- **How:** over your own network. Unless your computer's address starts with `https://`, the
  picture is **not encrypted on the way**, so anyone who can watch your home network could see it.
  The app does not send it through any tunnel or relay service; one that can read what it carries —
  Cloudflare Tunnel is the example we have ruled out by name — would put a photograph of you, in
  your home, on somebody else's servers.
- **What happens to it afterwards:** on this device, the picture is thrown away once it has been
  sent, unless you turned on "keep the pictures from this ride". On your computer, that is up to
  your computer and the software you installed on it — this app cannot see or delete a copy there.
- **Anyone else in the room is in the picture.** The app says so before the camera is ever turned
  on, and does not try to detect or blur anybody.

To stop it, switch it off or press **Forget this computer** on the Camera page. Nothing is sent
afterwards. [How to set up a computer of your own](analysis-on-your-own-computer.md) says what to
install, and what the risk of a downloaded model file is to that computer.

There is no option in this app to send a picture to a hosted AI service, and no such service is
built in, suggested or named.

## What the app does not do

- No advertising, and no advertising identifier.
- No analytics, no telemetry, no crash reporting, no session recording.
- No third-party SDK of any kind is linked into the app.
- No sale or sharing of personal information — none is held by us, and nothing is transmitted to us
  or to anybody else except the picture you choose to send to your own computer and the map tile
  requests described above.
- No tracking across apps or sites.

## Deleting your data

Uninstalling the app removes everything it holds. Inside the app, **Files → Erase this device**
deletes every ride, route, segment, effort, workout and setting, and the signing key with them,
after you type a confirmation phrase.

Some things an erase cannot reach, and the app says so before you press it: files you have already
exported, a copy of a ride you have already given to somebody, and a picture you sent to your own
computer, which is a copy that computer holds.

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
