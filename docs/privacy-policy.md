# On Your Left — privacy policy

**Last updated: 2026-09-26.** This is the policy for the On Your Left Android app
(`dev.openzigs.onyourleft`) and for the web client it is built from. It is the policy linked from the
app's About page and from the Google Play listing, and those two links point at this file
([#95](https://github.com/openzigs/onyourleft/issues/95)).

## The short version

There is no account, and the app contains no analytics. **Your rides stay on your device.** To draw a
map, the app asks our tile server for the map around where you rode. It sends no ride data.
**Cloudflare, which runs the tile server for us, keeps a record of each map request — your IP
address, the time, and your device or browser type, not which part of the map — that our Cloudflare
account can see for up to 7 days**, as part of the standard traffic analytics it keeps for every
site it serves. We do not use that record or share
it, and it is not linked to your rides or to any account. You can turn map tiles off in Settings,
and then no request is made and there is nothing to record. Apart from that map request,
**on its own the app uploads nothing** — not a ride, not a heart rate, not a position, not a crash
report, not a page view.

That is not a promise about our intentions. It is a property of the software: the code this project
writes contains exactly **two** network calls, and each can do only the one thing described below —
a picture to a computer of your own, and a direct link between your tablet and a second phone you
paired with it. The whole thing is [open source](https://github.com/openzigs/onyourleft), so you can
check that rather than take our word for it.

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
identifier of ours, but the host sees your IP address and roughly which area you are looking at
while it answers. The record Cloudflare keeps afterwards — your IP address, the time, and your
device or browser type, not which part of the map — our Cloudflare account can see for up to 7 days. **You can turn it off**: Settings → *Ride map* → *Draw map tiles under my rides*. With it off the app
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
| Where you were in the side camera's picture — a handful of positions, not a picture — from your last session whose check found the camera where it was the time before (or your first session), and whether that check passed | worked out on the tablet from the side-camera phone's pictures, so the next session can check the camera is in the same place |
| What the side camera's report said about a ride — a few sentences, such as "your upper body was possibly lower late in the session than early in it", with no picture, no positions and no numbers | written on the tablet when a side-camera session ends, from the positions it kept in memory, and saved with the ride that session filmed so you can read it on that ride's page |

The private half of the signing key is a non-extractable key held by the browser or WebView: the app
itself cannot read it, cannot copy it, and cannot send it anywhere. Its public half travels only
inside a file you export.

**Nothing here is linked to an identity, because there is no identity to link it to.** The app never
asks for a name, an email address, a phone number or a date of birth, and it has no field to put one
in.

## Location

A ride can carry positions, and a route is a line on a map, so the app holds location data on your
device. **A ride's positions are never transmitted** — not to us and not to anybody else. The one
thing that says anything about where you rode is the map's tile request, described under **What
leaves the device**: the tiles asked for say roughly where you rode, and the host sees that while it
answers the request. What Cloudflare keeps afterwards is your IP address, the time, and your device
or browser type, not which part of the map, and our Cloudflare account can see it for up to 7 days.
An IP address says roughly which country or network you are on, not where you rode. You can turn map
tiles off.

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
- **Start and stop, and pictures, between your tablet and a side-camera phone, if you pair them.**
  The pictures go from the phone to your tablet and no further. See **A second phone you pair as a
  side camera** below.
- **Map tile requests, when a map is on screen.** Map tiles are **on by default**, and you can turn
  them off in Settings → *Ride map*. To draw a ride that has
  a GPS track, your device requests map tiles from `tiles.openzigs.com` — a single static
  file this project keeps on Cloudflare R2 storage, served through Cloudflare. Nothing is sent with
  the request but the request itself: no ride data, no account, no cookie and no identifier. But the host
  sees your IP address and which tiles you asked for, and for your own ride that is roughly **where
  you rode** — including inside your privacy zones, because your own view of your own ride is never
  trimmed. That is what the host sees while it answers. **Cloudflare, which runs the host for us,
  keeps a record of each map request — your IP address, the time, and your device or browser type,
  not which part of the map — that our Cloudflare account can see for up to 7 days**, as part of the
  standard traffic analytics Cloudflare keeps for every site it serves, which cannot be switched off.
  The map is one file and the app picks each tile out of it with a byte range, which that record
  does not include: every request in it names the same file. Seven days is how far back this
  project's Cloudflare plan lets its account look (Cloudflare's
  [Security Analytics availability table](https://developers.cloudflare.com/waf/analytics/security-analytics/)
  gives *"up to the last 7 days"*). This project's Cloudflare account can look at it. **We do not use it and we do not share it**: it
  is not linked to your rides or to any account, and we do not use it to
  identify you or to work out where you are. No further logging, log export or analytics of those
  requests is turned on, and that is checked before every release. Cloudflare handles the traffic
  as our service provider, under its own privacy policy. With map tiles off, the app requests nothing
  from `tiles.openzigs.com` and draws your route on a plain background, with the OpenStreetMap
  credit beneath it.
  Indoor rides, and the map drawn during a game ride, request nothing. The tiles cover the
  contiguous United States; elsewhere the map shows your line on a plain background, and after
  reading the file's index the app requests no tiles at all. A build of the app can be pointed at another tile
  host, or at none.

## A second phone you pair as a side camera

If you set up a spare phone on a tripod as a side camera, the tablet and the phone talk to each other
directly, over your own Wi-Fi.

- **How they are paired:** you scan a code on the tablet with the phone's camera, and a code on the
  phone with the tablet's camera. Nothing else carries the pairing — no server of ours, no account,
  and no third-party service. The pictures the two cameras see while scanning are read for the code
  and thrown away at once.
- **What crosses:** the tablet's *start* and *stop*, and the phone's word for where it is — framing,
  filming or stopped, and why it stopped. **While the phone is filming, about five small pictures a
  second go from the phone to the tablet**, each carrying a number and how long after filming began
  it was taken, and nothing else. Each is re-encoded from its pixels on the phone, so it carries no
  location or device metadata. Not your rides, not your position, not your heart rate, not a name,
  and not the time of day.
- **What the tablet does with a picture:** a pose model running on the tablet itself looks at it,
  and it is thrown away as soon as it has been looked at. **No picture is ever saved on the tablet,
  shown on its screen, or sent anywhere else** — not to us, not to a computer of your own, and not
  to any service. What is kept is where the model found your ear, shoulder, elbow, wrist, hip, knee,
  ankle, heel and toe in each picture: numbers, not a picture, held in the tablet's memory and gone
  when the app is closed. At the end of a session the tablet keeps two things
  on the device. **The report:** a few sentences about what changed between the start and the end
  of the session — whether your upper body was lower, your knee straighter at the bottom of the
  stroke, your elbow more bent, your head further forward, or you sat further back on the saddle —
  each worded as a possibility, with no numbers, saved with the ride the session filmed and shown
  on that ride's page. Nothing is ever said about side-to-side movement, because one camera from
  the side cannot see it. If no ride was recorded while the camera was filming, nothing is saved.
  **Where you were in the picture overall**, and whether that session's check found the camera
  where it was the time before — kept only when the check passed, or when there was nothing to
  check against yet, so that a camera that creeps a little each time is still noticed. Deleting a
  ride removes its report; erasing the device removes both; and the account export includes both.
- **The pose model** is Google's MediaPipe Pose Landmarker, and it is part of the app: it and the
  code that runs it are served from the app itself, never downloaded from Google. ⚠️ **That code
  contains a usage logger that would send Google a report** of how often the model ran and how long
  it took (not the pictures). **The app blocks it**: the model runs in a part of the app that is
  refused every connection except to the app itself, and the project's tests check that no request
  leaves.
- **What the phone keeps:** nothing. No picture, no numbers and no record of the pairing.
- **Where it goes:** from one of your devices to the other, directly. The app configures no relay
  and no address-discovery server of any kind, and it refuses a pairing code that names an address
  outside your own network. The link is encrypted, as every WebRTC data channel is.
- **What is remembered:** nothing. A pairing lasts one session. Either device ends it, and the next
  session is paired by scanning again.
- **Anyone on your Wi-Fi** cannot join the link without the codes, and cannot read what crosses it.
  They can see that your two devices are exchanging encrypted traffic.
- **If the phone loses touch with the tablet**, it keeps filming for up to 30 seconds, then stops.
  The phone tells you this before its camera is ever turned on.

## Pictures sent to your own computer

This is the only way this app's own code sends **a picture** anywhere, and it is off until you turn
it on.

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
- The app contains no analytics, no telemetry, no crash reporting and no session recording.
- No third-party SDK is linked into the app for any of those. One library the app does include —
  Google's MediaPipe, which runs the side camera's pose model on your tablet — contains a usage
  logger, and the app blocks every request it would make (see **A second phone you pair as a side
  camera** above).
- No sale or sharing of personal information. Nothing is transmitted to us or to anybody else
  except the picture you choose to send to your own computer and the map tile requests described
  above, whose record our Cloudflare account can see for up to 7 days and which we neither use nor
  share.
- No tracking across apps or sites.

## Deleting your data

Uninstalling the app removes everything it holds. Inside the app, **Files → Erase this device**
deletes every ride, route, segment, effort, workout and setting, and the signing key with them,
after you type a confirmation phrase.

Some things an erase cannot reach, and the app says so before you press it: files you have already
exported, a copy of a ride you have already given to somebody, a picture you sent to your own
computer, which is a copy that computer holds, and Cloudflare's record of recent map requests —
your IP address, the time, and your device or browser type — which we cannot delete on request and
which ages out of what our Cloudflare account can see after 7 days.

## Children

The app is not directed at children. It collects nothing from anybody, including them, beyond the
map tile requests described above, which you can turn off.

## Changes to this policy

This file is version-controlled. Its history is the change log, and every change to it is a public
commit in the repository above. The date at the top is the date of the last substantive change.

## Contact

Open an issue at <https://github.com/openzigs/onyourleft/issues>. For anything that is a security or
privacy **vulnerability**, use
[private vulnerability reporting](https://github.com/openzigs/onyourleft/security/advisories/new)
rather than a public issue — `SECURITY.md` says why.
