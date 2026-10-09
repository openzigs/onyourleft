# On Your Left — privacy policy

**Last updated: 2026-10-09.** This is the policy for the On Your Left Android app
(`dev.openzigs.onyourleft`) and for the web client it is built from. It is the policy linked from the
app's About page and from the Google Play listing, and those two links point at this file
([#95](https://github.com/openzigs/onyourleft/issues/95)).

## The short version

There is no account unless you connect the app to an instance, and the app contains no analytics.
**Your rides stay on your device.** To draw a
map, the app asks our tile server for the map around where you rode. It sends no ride data.
**Cloudflare, which runs the tile server for us, keeps a record of each map request — your IP
address, the time, and your device or browser type, not which part of the map — that our Cloudflare
account can see for up to 7 days**, as part of the standard traffic analytics it keeps for every
site it serves. We do not use that record or share
it, and it is not linked to your rides or to any account. You can turn map tiles off in Settings,
and then no request is made and there is nothing to record. Apart from that map request,
**on its own the app uploads nothing** — not a ride, not a heart rate, not a position, not a crash
report, not a page view.

**If you connect the app to an instance.** An instance is a server that lets riders ride together.
You choose whether to connect, and to which one: nothing is sent to any instance until you type its
address and press *Connect*. Connecting sends this device's public key, the name other riders will
see if you type one, and — as with any server — your internet address and your device or browser
type. Nothing else of yours unless you **make or join a private room** — a group ride or a race
with people you share a code with: then the route you choose for a room you make, your power and
cadence while you ride in one, your declared weight once as you join, and a race's result go to that
instance. It sends no ride and no heart rate to an instance unless you **sync** with it: then your
rides — whole, their positions and heart rate included — and what goes with them are sent to that
instance, sealed on this device so that only that instance can read them. This version of the app
does not offer *Sync* yet. It is all described under **An instance you connect to** below, class by
class.

That is not a promise about our intentions. It is a property of the software: the code this project
writes contains exactly **four** network calls, and each can do only the one thing described below —
a picture, or a ride's numbers when you ask for an analysis, to a computer of your own, a direct link between your tablet and a second phone you
paired with it, a question, or a ride's numbers when you ask for an analysis — never a picture — to a service you chose, on your own key,
and talking to an instance you chose to connect to — signing in, a private room, and what you sync. The whole thing is [open source](https://github.com/openzigs/onyourleft), so you can
check that rather than take our word for it.

**The one thing you can switch on: a picture sent to a computer of your own.** If you use the
camera, you can enter the address of a computer on your own network — one you run, with a model
server you installed on it — and switch it on. The app then sends one picture from the camera to
that address, and only when you press the button that sends it. If you also switch on sending a
side camera's pictures there — a second switch, off to begin with — every picture the side camera
takes while it films goes there instead of being looked at on the tablet. Nothing is set up to
begin with, and nothing is sent until you have entered an address and switched it on. It is
described under **Pictures sent to your own computer** below. The same computer can also be sent a
ride's numbers — never a picture — when you press the button that asks for an analysis of that
ride, as described under **A ride sent to your own computer** below.

**The second thing you can switch on: a question sent to a service you chose, on your own key.**
If you use the camera, you can also enter the address of a hosted model service you have an account
with, the model's name, and your own key for it, and then turn it on. It is sent **numbers and
words, never a picture**: a test question when you press the button that sends it, and a ride's
numbers when you ask for an analysis of that ride. It is off whenever the app is opened, and
nothing is set up to begin with. It is described under **Questions sent to a service you chose, on
your own key** below.

⚠️ **That computer is yours, not ours.** It is not an On Your Left service, not an account, and not
an instance ([#7](https://github.com/openzigs/onyourleft/issues/7)) — instances are described
separately below, and no picture is ever sent to one. We never see the picture, and we cannot see
what your computer does with it.

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
| Your list of words to mask before anything is sent to a hosted model — a street, a town, a name | typed by you in Settings; kept with your rides on this device, not put in the account export, and *Erase everything* removes it |
| Whether the app is shown light or dark, if you chose one | chosen by you in Settings, and kept in this device's browser storage; *Erase everything* removes it |
| A signing keypair, used to sign your own activity records | generated on the device the first time it is needed |
| The address of an instance you connected to, the account id it gave you, and this device's sign-in to it (a session token) | kept in this device's browser storage when you press *Connect*; never put in an export; *Disconnect* and *Erase everything* remove it |
| Pictures from the camera — only the ones you chose to keep | the camera, if you turn it on and then turn on "keep the pictures from this ride" for that ride. Otherwise a picture is thrown away as soon as it has been looked at |
| The address and model name of your own computer, if you set one up | typed by you on the Camera page, and kept in this device's browser storage |
| The address and model name of a hosted service, and **your key for it**, if you set one up | typed by you on the Camera page, and kept in this device's browser storage; never put in an export; *Erase everything* removes it |
| Where you were in the side camera's picture — a handful of positions, not a picture — from your last session whose check found the camera where it was the time before (or your first session), and whether that check passed | worked out on the tablet from the side-camera phone's pictures, so the next session can check the camera is in the same place |
| What the side camera's report said about a ride — a few sentences, such as "your upper body was possibly lower late in the session than early in it", with no picture, no positions and no numbers | written on the tablet when a side-camera session ends, from the positions it kept in memory, and saved with the ride that session filmed so you can read it on that ride's page |
| How much your position changed between the start and the end of a side-camera session — for each of your upper body, knee, elbow, head and where you sat on the saddle, how far it moved between the first and last third of the session (a difference only, never where it was), how many pictures found you, found nobody or could not be read, and whether your tablet or your own computer worked the positions out. No picture, no positions, and nothing tied to a moment in the ride. Kept only when the session was long enough to compare, and only from positions that could be a person on a bicycle | worked out on the tablet when a side-camera session ends, from the same numbers as that ride's report, and saved with the report on the ride that session filmed. It goes with the ride when you delete it, is in the account export, and *Erase everything* removes it |

The private half of the signing key is a non-extractable key held by the browser or WebView: the app
itself cannot read it, cannot copy it, and cannot send it anywhere. Its public half travels only
inside a file you export.

**Nothing here is linked to an identity unless you connect to an instance.** The app never asks for
an email address, a phone number or a date of birth, and it has no field to put one in. The one name
it asks for is optional, and only when you connect to an instance: the name other riders will see
there. It is sent to that instance and is not kept on this device.

## Location

A ride can carry positions, and a route is a line on a map, so the app holds location data on your
device. **A ride's positions leave the device only if you sync your rides with an instance you
connected to** (see **An instance you connect to**), and then only to that instance, sealed on this
device so that nothing on the way can read them; the instance shows them to nobody else. This version
of the app does not offer *Sync* yet. Otherwise they are never transmitted — not to us and not to
anybody else. **A route
is sent only if you make a private room on it** (see **An instance you connect to**), to the instance
running the room and the riders you share its code with, and a route that starts, ends or passes
inside one of your privacy zones is refused before anything is sent. The one
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

Only these, and only when you do them. Everything below that the app sends travels **encrypted on
the way** — `https://`, `wss://`, or an encrypted WebRTC link — **except** a picture or a ride's
numbers sent to your own computer, which travels unencrypted when your computer's address starts
with `http://` (see **Pictures sent to your own computer** and **A
ride sent to your own computer** below).

- **A file you export.** FIT, GPX, TCX, a workout, or a whole-account export. It goes wherever you
  put it and it is then out of the app's hands.
- **A ride or route you choose to share.** A copy, trimmed by your privacy zones.
- **Signing in to an instance you chose to connect to.** This device's public key, the name other
  riders will see if you type one, and — as with any server — your internet address and your device
  or browser type. See **An instance you connect to** above.
- **A private room you make or join on that instance.** The route of a room you make — refused
  before anything is sent if any of it is inside one of your privacy zones — the code you type to
  join one, your power and cadence while you ride in one, the weight you declare once as you join,
  and after a race its result. See **An instance you connect to** above.
- **What you sync with that instance, when you press *Sync*.** Your rides, whole, with their
  positions and heart rate, and what goes with them — sealed on this device for that instance alone.
  This version of the app does not offer *Sync* yet. See **An instance you connect to** above.
- **A picture sent to your own computer, if you set one up and switch it on.** See **Pictures sent
  to your own computer** below.
- **A ride's numbers sent to your instance, when you ask for an analysis of it** — never a
  picture. See **A ride analysed on your instance** below.
- **A ride's numbers sent to your own computer, when you ask for an analysis of it** — never a
  picture. See **A ride sent to your own computer** below.
- **A question, or a ride's numbers when you ask for an analysis of it, sent to a service you
  chose, on your own key, if you set one up and turn it on** — never a picture. See **Questions sent
  to a service you chose, on your own key** below.
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

## An instance you connect to

An **instance** is an On Your Left server that lets riders ride together. Anybody can run one. You
choose whether to connect this app to one, and to which, on Settings → *Instance*. **Nothing is sent
to any instance until you type its address and press *Connect*.** The screen lists what the instance
will receive before you press it.

**Who you are sending it to.** An instance belongs to whoever runs it:

- **An instance you run yourself** is yours, the way the computer under **Pictures sent to your own
  computer** is yours. We never see what it receives.
- **The project's own instance** is ours. It runs on this project's maintainer's computer, at their
  home, and the maintainer is its operator. You reach it through **Cloudflare Tunnel**: the encrypted
  connection from the app ends at Cloudflare's edge, so **Cloudflare decrypts and carries the traffic**
  between you and that computer, as our service provider, under its own privacy policy.
- **Anybody else's instance** is theirs, under their own terms. We cannot see what it does with what
  it receives, and we cannot delete it for you.

**How it travels.** The app talks to an instance only over `https://` (and `wss://` for a room),
which is encrypted on the way. It refuses a plain `http://` address, before sending anything, unless
the instance is on the same computer as the app (`localhost`). It will not follow a redirect
somewhere else.

**What is sealed, so that only the instance can read it.** When you paste or scan an instance's
**card** — a line its operator gives you, which names the instance's key — this device can seal what
it sends: encrypt it, on this device, for that instance alone, inside the encrypted connection. Then
Cloudflare, which carries the project's instance's traffic, carries it without being able to read
it. Everything you sync is sealed, and so are your recovery codes, the list of your devices, adding
and removing a device, and recovering your account; none of those is offered without the card. The
app seals only in the Android app, or in a copy of the web app loaded from your own computer,
because a web page served from anywhere else could be changed on the way to take the seal off. What
Cloudflare still sees, even then: that you are talking to the instance, from which internet
address, when, how often and roughly how much; the token that tells the instance which device is
asking; and the whole of anything that is not sealed — signing in with a device the instance
already knows, your name there, and a room you make, join and ride in.

**What each kind of data does.** The *when* in every row is **only after you connect**:

| Data | What leaves the device, and to whom | When | How to delete it |
| --- | --- | --- | --- |
| This device's public key | sent to the instance you connected to, which keeps it on your account there, with when it was added and last used | when you press *Connect* | *Disconnect* makes this device forget the instance and ends this device's sign-in there, but the key stays on your account there. This version of the app cannot remove a device from your account: ask the instance's operator, as described under **Deleting what an instance holds** below |
| The name other riders see | sent to that instance each time you press *Connect* with a name typed. The instance keeps it with your account only the first time it sees this device, and ignores it after that. If your name there is ever changed, the instance also keeps each earlier name, and when it changed, with your account, for moderation | when you press *Connect* | this version of the app cannot change or remove it, or the earlier names: ask the instance's operator, as described under **Deleting what an instance holds** below |
| Your internet address, and your device or browser type | seen by the instance, and by Cloudflare on the way to the project's own instance, as by any server you connect to. The project's own instance does not write your address to its log or its database: it holds it in memory only, for at most an hour, to limit how many requests one address can make. Cloudflare keeps a record of each request to the project's instance — your IP address, the time, and your device or browser type — that our Cloudflare account can see for up to 7 days, as it does for a map request; we do not use it or share it. Anybody else's instance decides for itself | every time the app talks to the instance | the project's own instance keeps no copy of your address to delete, and Cloudflare's record ages out of what our Cloudflare account can see after 7 days — we cannot delete it on request. For anybody else's instance, ask its operator |
| What you sync: your rides, and what goes with them | **only if you sync** with the instance, which needs its card. **This version of the app does not offer *Sync* yet**; this row says what it will send, before a version that offers it does ([#1195](https://github.com/openzigs/onyourleft/issues/1195)). A sync sends each ride on this device that the instance does not hold, as a file this device writes from the ride (a ride imported from a GPX or TCX file is sent as a FIT file too, not as the original), with every sample, **its positions and heart rate included, not trimmed by your privacy zones**, because it is your own copy, and with a signed record that carries the ride's name, when it started and its time zone, its elapsed and moving time, its distance and its average power if it has one — signed with this device's key; each ride's write-up and side-camera report (sentences, and the summary of how your position changed — differences, never a picture); a short summary of each ride that this device writes from its numbers, with no position, date or name in it, so that a later analysis can look back at your history; your notes on your rides, your goals and the documents you added for the analysis; and your answer to *May be raced* for each ride. All of it is sealed for that instance alone, as described above. The instance keeps it with your account, and shows none of it to another rider: no other rider is sent your rides, and none is sent a position. A sync also brings to this device what another of your devices synced there | when you press *Sync* | delete a ride, note, goal or document on this device and then sync: the instance deletes it too, its original file with it, and keeps only a mark that it was deleted: a fingerprint of the file and when the instance received it, and nothing else of the ride. *Disconnect* and erasing this device do not reach what the instance holds; to have it all erased, ask the instance's operator, as described under **Deleting what an instance holds** below |
| Analysis jobs and write-ups | when you ask for an analysis, the ride's numbers go to your instance; the job, its progress and its write-up are kept for 7 days, and the finished write-up with your account, so another of your devices can show it. See **A ride analysed on your instance** below | when you press the button on a ride's page | erased with your account on the instance: ask the instance's operator, as described under **Deleting what an instance holds** below |
| In a room: power, cadence, the weight you declare, and your display name | **only if you make or join a private room** ([#784](https://github.com/openzigs/onyourleft/issues/784), [#785](https://github.com/openzigs/onyourleft/issues/785)) — a group ride or a race on one rider's route, joined by a code they share. While you ride in one, your power and cadence go to the instance running it twice a second — never your position: the room works out where you are from your power — and the weight you declare goes once as you join, for the room to simulate you, and is not shown to anybody. The code you type to join goes once, in the request and never in an address, and the instance keeps only a fingerprint of a room's code, never the code. The other riders in the room see where you are on the room's road, and your name; never your weight or your watts. The instance keeps, with your account, which rooms you made or joined | while you ride in a room; the code, when you press *Join the room* | your power, cadence and weight are not kept after the ride; to have the list of rooms you made or joined erased, ask the instance's operator to erase your account, as described under **Deleting what an instance holds** below |
| The route of a room you make | **only if you make a private room** ([#784](https://github.com/openzigs/onyourleft/issues/784)): the route you choose — its roads and heights, not its name and no times — goes to the instance, which shows it to the riders you share the room's code with. A route that starts, ends or passes inside one of your privacy zones is refused before anything is sent. The route is deleted from the instance when the room is over, and a room is over when a race in it has finished; when a group ride in it has had nobody in it for a minute; when a race in it was interrupted because the instance restarted; when nobody is riding in it a day after it was made, whether or not anybody ever joined it; or when you erase your account on that instance. Anybody still riding in the room when it ends rides on, but nobody else can join it | when you press *Make a room* | deleted by the instance when the room is over — within about a day of being made, unless somebody is riding in it then, and at once if you erase your account there; to have it deleted sooner, ask the instance's operator |
| Race results | **only if you ride a private race** ([#785](https://github.com/openzigs/onyourleft/issues/785)): when you cross the line, the instance keeps your result — your place, your time, your power-to-weight over the race (watts per kilogram, W/kg) and any plausibility flag the room raised, which says only the length of time over which your power-to-weight went past the room's ceiling — visible to that race's participants only, until your account on the instance is erased. Nobody can see a race's result until every rider is across the line or out of the race, and a race interrupted because the instance restarted publishes no result. Every rider in the race sees every rider's result, flags included; beside another rider it shows power-to-weight and never watts, and this device alone shows your own watts beside your own result. Nobody sees your weight | when you cross the line | ask the instance's operator to erase your account, as described under **Deleting what an instance holds** below. The other riders' results for that race stay, and show you as "a rider", with no name and nothing of yours |
| Your voice, in a room's voice chat | **never sent by this app.** Where an instance offers voice chat, it happens on **Discord**, a separate service you choose to use: Discord receives your voice, and other riders in the voice channel see your Discord username and picture. If you link your Discord account to your account on the instance, the instance keeps your Discord id with your account | only if you join the voice chat, or link your Discord account | leave the voice channel or unlink your Discord account; what Discord keeps is Discord's, under its own privacy policy |

**Public rooms are for adults.** Where an instance offers public rooms — rooms anybody on that
instance can join — they are **for people aged 18 or over only**, and you will be asked to confirm
your age yourself before joining one. The project's own instance does not offer public rooms, and
will not until its operator has completed the UK Online Safety Act's illegal-content risk and
children's access assessments ([#886](https://github.com/openzigs/onyourleft/issues/886)) and the EU
Digital Services Act's notice-and-action mechanism is in place
([#887](https://github.com/openzigs/onyourleft/issues/887)).

**Disconnecting.** *Disconnect* makes this device forget the instance's address and its sign-in to
it, and asks the instance to end that sign-in. Every ride stays on this device. What the instance
already holds stays there, rides you synced included.

**Your rides stay on this device.** Syncing copies them to the instance; it never moves them. A ride
the instance confirms it holds is still on this device afterwards, and a ride deleted on another of
your devices is hidden on the instance and kept on this one.

**Deleting what an instance holds.** Disconnecting is all this version of the app can do: it cannot
remove a device from your account on an instance, change or remove your name there, or erase your
account there. Ask the instance's operator to do them. For the project's own instance, that is this project's maintainer: ask privately by email, to
**matt@openzigs.ai**, as described under **Contact** below and not in a public issue, for any of them or for your account there to
be erased, until the app can do them itself. For anybody else's instance, ask whoever runs it.

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
  shown on its screen, or sent anywhere else** — not to us and not to any service — **unless you
  switched on sending the side camera's pictures to a computer of your own**, in which case each
  one goes to that computer instead of the tablet's model, as described under **Pictures sent to
  your own computer** below, and is still not kept on the tablet. What is kept is where the model found your ear, shoulder, elbow, wrist, hip, knee,
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
  For a side camera's pictures the question asks where your ear, shoulder, elbow, wrist, hip, knee,
  ankle, heel and toe are in the picture, as numbers. Nothing else — not your rides, not your position, not your heart rate, not a name, not an
  identifier, and not a filename. The picture is re-encoded from its pixels when it is taken, so it
  carries no location or device metadata.
- **Where it goes:** to the one address you typed, and nowhere else. The app refuses an address
  that is not on your own network — a private address such as `192.168.…` or `10.…`, a name ending
  in `.local`, or the address your own encrypted network (such as a WireGuard-based one) gives your
  computer. It will not send a picture to a service on the internet, and it will not follow a
  redirect somewhere else.
- **When:** only when you press the button that sends it — **or, if you switched on sending the
  side camera's pictures there, continuously while the side camera is filming**: every picture it
  takes, about five a second, goes to your computer as it arrives, one at a time, with any that
  arrive while your computer is still busy thrown away unsent. That is a second switch on the Camera
  page, separate from the first and off until you turn it on, and it takes effect the next time you
  pair a side camera. Nothing is ever sent on a timer of the app's own, and nothing is sent when you
  have not switched it on.
- **How:** over your own network. Unless your computer's address starts with `https://`, the
  picture is **not encrypted on the way**, so anyone who can watch your home network could see it.
  In the Android app the picture is sent by the app itself rather than by the web page inside it,
  because Android's web view refuses a plain `http://` request from a secure page; so in the
  Android app the address must be your computer's private address **written as numbers** (such as
  `192.168.1.20`), and a name, or the tablet's own address, is refused before anything is sent.
  The app does not send it through any tunnel or relay service; one that can read what it carries —
  Cloudflare Tunnel is the example we have ruled out by name — would put a photograph of you, in
  your home, on somebody else's servers.
- **What happens to it afterwards:** on this device, the picture is thrown away once it has been
  sent, unless you turned on "keep the pictures from this ride". On your computer, that is up to
  your computer and the software you installed on it — this app cannot see or delete a copy there.
- **Anyone else in the room is in the picture.** The app says so before the camera is ever turned
  on, and does not try to detect or blur anybody.

To stop it, switch it off or press **Forget this computer** on the Camera page. Nothing is sent
afterwards — including from a side camera that is already filming, whose next picture is not sent
and whose pictures are then not looked at for the rest of that session. Forgetting the computer
also switches off sending the side camera's pictures to it. [How to set up a computer of your own](analysis-on-your-own-computer.md) says what to
install, and what the risk of a downloaded model file is to that computer.

There is no option in this app to send a picture to a hosted AI service, and no such service is
built in, suggested or named.

## A ride analysed on your instance

**A ride analysed on your instance, when you ask for an analysis.** When you press the button on a
ride's page, that ride's numbers go to your instance: heart rate, cadence and power, your weight and
watts per kilogram, your threshold power, if you set one, how long the ride lasted, its distance,
and each section's gradient and total climb, and how it went section by section. If the side camera
filmed the ride, and you agreed to the camera, it also gets how a few measurements of your riding
position changed between the start and the end of filming. Never a picture. Your instance writes the
analysis with a model on its own machine, and the model may look up what is already on your
instance: short summaries of your recent rides, summaries of older rides, what you wrote about
your goals, your notes and documents, your saved workouts, and earlier write-ups. Nothing is sent
until you press the button. Once you have pressed it, the analysis can finish while the app is
closed.

- **Where it goes, and how:** to the instance you connected, over the same connection as everything
  else the app sends it. On the way it is encrypted end to end to your instance, so Cloudflare,
  which carries the traffic to the project's own instance, sees only ciphertext.
- **What it is not sent:** not a picture, and nothing made from one beyond those few differences;
  not your name, not where you rode — no position, no height above sea level — and not when.
- **What your instance keeps:** the analysis job — the ride's numbers it was sent, its progress and
  the write-up as it was written — for 7 days. The finished write-up is kept with your account so
  another of your devices can show it. The side camera's measurements are not kept with it. All of
  it is erased with your account there, which the instance's operator does when you ask, as
  described under **Deleting what an instance holds** above.
- **What the app keeps:** the write-up, only once it has passed this app's checks on what may be
  shown, saved with that ride on this device in place of any write-up it had before. If the
  write-up does not pass, is cancelled or does not finish, nothing is kept and an earlier write-up
  stays as it was. While it is being written, this device keeps only which job it is waiting for —
  never the ride's numbers or the model's words — so it can pick the job up when you open the ride
  again. That note is not in the account export, because it only lists analyses still in
  progress; it is removed when the analysis ends, when you delete the ride, or when you use *Erase
  everything*.
- **If you cancel:** your instance stops the analysis at its next step, and nothing of it is saved
  on this device.

## A ride sent to your own computer

**A ride sent to your own computer, when you ask for an analysis.** When you press the button on
a ride's page, that ride's numbers go to the computer you set up: heart rate, cadence and power,
your weight and watts per kilogram, your threshold power, if you set one, how long the ride
lasted, its distance, and each section's gradient and total climb, and how it went section by
section. If the side camera filmed the ride, and you agreed to the camera, it also gets how a few
measurements of your riding position changed between the start and the end of filming. Never a
picture. Nothing is sent until you press the button, and nothing is sent in the background.

- **Where it goes, and how:** to the same computer, at the same address, by the same rules as
  **Pictures sent to your own computer** above — only an address on your own network, never a
  redirect, and not encrypted on the way unless the address starts with `https://`. In the Android
  app it is sent by the app itself, to a private address written as numbers.
- **What it is not sent:** not a picture and nothing made from one beyond those few differences, not
  your name, not where you rode — no position, no height above sea level — and not when.
- **How:** as several short questions in a row, one for each section of the ride and one for the
  whole, each carrying the numbers it needs as text.
- **If you cancel:** the app stops waiting and keeps nothing. Your computer may carry on working on
  the question it was asked for a while — in the Android app the app cannot stop a question once it
  has been sent — and whatever it answers is ignored.
- **What happens to it afterwards:** on your computer, that is up to your computer and the software
  you installed on it — this app cannot see or delete a copy there.
- **What the app keeps:** the write-up your computer sends back, only once it has passed the app's
  checks on what may be shown, saved with that ride on this device in place of any write-up it had
  before. If the write-up does not pass, is cancelled or does not finish, nothing is kept and an
  earlier write-up stays as it was. It goes with the ride when you delete it, is in the account
  export, and *Erase everything* removes it. Nothing else your computer answers is kept.

## Questions sent to a service you chose, on your own key

This is the only way this app's own code sends anything to a service you chose on the internet, and it
is off until you turn it on — and off again whenever the app is opened. **It is never sent a picture.**

**This sends your ride to a service you have chosen, using your own key.** If you turn this on,
each time you ask for a ride analysis, that ride's numbers are sent to the address you entered,
using the key you entered: your heart rate, cadence and power, your weight and watts per kilogram,
your threshold power, if you set one, how long the ride lasted, its distance, and each section's
gradient and total climb, and how it went section by section. If the side camera filmed the ride,
it is also sent how a few measurements of your riding position changed between the start and the
end of filming. That is a company or a computer that is not yours
and not ours, and we cannot see what they do with it or how long they keep it. We cannot delete it
for you afterwards. Like any service you connect to, it also sees your internet address.

- **What is sent:** for a ride analysis, the ride's numbers above, as several short questions in a
  row — one for each section of the ride and one for the whole — each written by the app and
  carrying the numbers it needs as text, with the model name you typed. The measurements of your
  riding position go only if you also agreed to the camera. Separately, the Camera page's check of
  the connection sends a test question that asks the service to reply with one word, and carries no
  numbers from your rides.
- **What is not sent:** never a picture, and nothing made from one beyond those few differences in
  position. Not your name, not where you rode — no position, no height above sea level — not when,
  and not an identifier.
- **What is masked first:** before anything is sent to the service, e-mail addresses, phone
  numbers, links, street addresses, postcodes, coordinates written as text, the names you gave your
  privacy zones, and everything on your list of *Words to mask* in Settings are replaced with a
  placeholder such as `[email]` or `[place]`. A name is masked only if it is on that list: nothing
  can tell a person's or a place's name from any other word. Masking reduces what is sent; it does
  not guarantee that nothing personal gets through. *See what will be sent*, on a ride's page, shows
  exactly what will be sent after masking, and sends nothing. Your own computer is sent the text in
  full.
- **Your key:** the key you typed, sent in the request's `Authorization` header to the address you
  typed and to nowhere else. It is kept in this device's browser storage, is never put in a file the
  app exports, is never shown again once saved, and *Forget this service and key* or *Erase
  everything* removes it.
- **Where it goes:** to the one address you typed, which must start with `https://`, so what is sent
  and your key are encrypted on the way. The app will not follow a redirect somewhere else. No
  service is built in, suggested or named: you choose it, under your own agreement with whoever runs
  it.
- **When:** only when you press the button that sends it — on the Camera page for the test, on a
  ride's page for an analysis — and only after you have turned the hosted model on since the app was
  opened. The app checks that it is still on before every question of an analysis, so turning it off
  stops the next one. Nothing is sent on a timer or in the background.
- **If you cancel:** the app stops waiting, closes the connection and keeps nothing. The service has
  already been sent the ride's numbers by then, and may carry on for a while; whatever it answers is
  ignored.
- **What the service sees and keeps:** what it was sent, the model name, your key, and — as with any
  service you connect to — your internet address. It is a company or a computer that is not yours
  and not ours; we cannot see what it does with the request or how long it keeps it, and we cannot
  delete it for you afterwards.
- **What the app does with the answer:** for the test, it notes whether the service understood the
  question, and shows none of its words. For an analysis, it keeps the write-up the service sends
  back only once it has passed the app's checks on what may be shown, saved with that ride on this
  device in place of any write-up it had before, exactly as for **A ride sent to your own computer**
  above. Nothing else the service answers is kept.

To stop it, untick *Turn the hosted model on* or press **Forget this service and key** on the Camera
page. You do not need this: everything else in the app works without it, and a computer of your own
can do the same analysis.

## What the app does not do

- No advertising, and no advertising identifier.
- The app contains no analytics, no telemetry, no crash reporting and no session recording.
- No third-party SDK is linked into the app for any of those. One library the app does include —
  Google's MediaPipe, which runs the side camera's pose model on your tablet — contains a usage
  logger, and the app blocks every request it would make (see **A second phone you pair as a side
  camera** above).
- We never sell your data. The only sharing is the analysis you choose to send to a service you
  set up. Nothing is transmitted to us or to anybody else
  except the pictures and the rides you choose to send to your own computer, the questions and the
  rides you choose to send to a service of your own choosing, what you send to an instance you
  choose to connect to, and the map tile requests described above, whose record our Cloudflare account can see for up to 7 days and which we neither use nor
  share.
- No tracking across apps or sites.

## Deleting your data

Uninstalling the app removes everything it holds. Inside the app, **Files → Erase this device**
deletes every ride, route, segment, effort, workout and setting, and the signing key with them, and
makes this device forget any instance it was connected to, after you type a confirmation phrase.

Some things an erase cannot reach, and the app says so before you press it: files you have already
exported, a copy of a ride you have already given to somebody, a picture or a ride's numbers you
sent to your own computer, which is a copy that computer holds, a question or a ride's numbers you
sent to a service you chose, which is a copy that service holds, your account on an instance you
connected to, and anything it received, which is a copy that instance holds and which you ask its
operator to erase (see **Deleting what an instance holds**), and Cloudflare's record of recent map requests —
your IP address, the time, and your device or browser type — which we cannot delete on request and
which ages out of what our Cloudflare account can see after 7 days.

**Asking us to delete what we hold.** What this project holds about you is your account on the
project's own instance, if you connected to it: its device keys, your name there and any earlier
names, your account id and any Discord id you linked, which private rooms you made or joined, and
your results in any race you rode there — and, while a room you made is open, its route — and
everything you synced to it. Erasing your account there ends every room you made and deletes its route. Email **matt@openzigs.ai** to have it
deleted, until the app can erase an account on an instance itself.

## Children

The app is not directed at children. On its own it collects nothing from anybody, including them,
beyond the map tile requests described above, which you can turn off. Public rooms on an instance
are for adults aged 18 or over only, as described under **An instance you connect to**.

## Changes to this policy

This file is version-controlled. Its history is the change log, and every change to it is a public
commit in the repository above. The date at the top is the date of the last substantive change.

## Contact

For a request to delete what the project's own instance holds, a notice of illegal content, or a
complaint, write to [matt@openzigs.ai](mailto:matt@openzigs.ai). Do not put a request about your own
data in a public issue.

For anything that is not personal, open an issue at <https://github.com/openzigs/onyourleft/issues>.
For anything that is a security or privacy **vulnerability**, use
[private vulnerability reporting](https://github.com/openzigs/onyourleft/security/advisories/new)
rather than a public issue — `SECURITY.md` says why.
