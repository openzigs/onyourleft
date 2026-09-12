# On Your Left

A free, open alternative to Strava + Zwift for cycling: ride tracking, indoor smart-trainer control,
and live sensor capture over Bluetooth Low Energy.

## Status

Early. The workspace, toolchain and quality gates exist; the product does not yet — see the
[open epics and issues](https://github.com/openzigs/onyourleft/issues).

The first milestone is deliberately small and entirely local: pair a Bluetooth trainer, record a
ride, store it and view it, with **no server, no account and no hosting bill**. Everything else
sequences after that.

## Scope

- Web app first, then mobile and desktop clients
- Smart trainer control (Wahoo KICKR and other FTMS trainers), including ERG mode
- Sensors: power meter pedals, heart rate monitors, cadence and speed
- Activity recording, FIT/GPX/TCX import and export, analysis
- Route planning, segments and leaderboards
- Local-first, with a self-hostable instance for anything that needs to be shared

Sensors and trainers connect over **Bluetooth Low Energy only**. ANT+ is out of scope permanently —
it is unreachable from any browser, has no iOS path at all, and its Shared Source License forbids
redistributing source containing the network key.

### Which browsers and devices this works on

The web client needs **Web Bluetooth**, which only Chrome-family browsers implement. **Safari and
Firefox do not have it at all** — on any platform, in any version — so the web client **cannot reach
an iPhone**, and Chrome on Linux needs `chrome://flags/#enable-experimental-web-platform-features`.
No browser can record in the background, so the tab has to stay open. Mobile and desktop clients are
the answer to all of that, and they come later.

### Planning a route

The **Routes** page imports a route from a GPX file, and **Draw a route** builds one here: place
waypoints in order and the roads between them are worked out for you. A leg you would rather draw
yourself stays a straight line, and the page says which legs are which — a freehand leg's distance
is a lower bound and nothing knows what surface it is.

Two things are worth knowing before you rely on the numbers:

- **Climbing is a computed opinion, and the page says whose.** It names the elevation dataset and
  its resolution, and the figure is summed over a stated, even sampling interval — a route summed
  from unevenly spaced samples reads much steeper than the same road summed properly, which is most
  of why two apps disagree about the same hill. Where the dataset has no height for part of the
  route, the profile shows the gap and says the climbing figure is **at least** that much rather
  than presenting it as a measurement.
- **Every control works from the keyboard.** Waypoints are a list you can select, nudge in four
  directions and delete, not only pins to drag. Clearing asks first, undo covers everything
  including the clear, and a half-drawn route survives closing the tab.

> ⚠️ **There is no routing service configured yet, so the roads between your waypoints cannot be
> worked out on this build.** Everything above is built and tested against a stand-in; what is
> missing is a running engine, which is
> [#53](https://github.com/openzigs/onyourleft/issues/53). The page says so rather than looking
> broken.

### Bringing your history in, and taking it out

The **Files** page imports FIT, GPX and TCX files and exports any ride on this device in the same
three formats. Choose as many files at once as you like, or point it at a **whole folder** and it
reads everything inside — an unzipped platform export is the case it is built for.

What to expect from a bulk import:

- **Every file is reported by name**, as imported, already here, or not imported with the reason.
  One file that cannot be read never stops the rest of the batch.
- **An archive contains things that are not rides** — a summary spreadsheet, compressed copies,
  media — and each of those is listed as not imported rather than silently skipped. Compressed
  rides (`.fit.gz`) are not read; unpack them first.
- **The same file imported twice does not become two rides.** A ride is recognised by the SHA-256 of
  the file's bytes, so re-importing an archive you have already brought in is safe.
- **Cancelling stops the import; it does not undo it.** Whatever had already been imported stays.
- Importing needs `crypto.subtle`, which browsers only provide over `https` or on `localhost`. Open
  the app from a file and the page will say so rather than offering a control that cannot work.

An **exported file contains your real track**, coordinate for coordinate. Privacy zones are for what
gets published, and nothing here is published — this is your own copy of your own data. FIT carries
everything this app stores; GPX and TCX each drop something, and the page says which before you
choose.

### If the tab closes mid-ride

A tab that has to stay open for four hours will sometimes be closed by accident, discarded by the
browser under memory pressure, or lost to a sleeping laptop. So the ride is written to local storage
**as it happens**.

The next time you open the ride screen it lists the rides this device is still holding and offers
each one back: **continue** it, **save** what there is to your activities, or **discard** it. A ride
you had already finished is offered save and discard but not continue — a finished ride still on the
device is one whose save failed, and you ended it on purpose.

The length each is offered with is *"up to"* a figure, and that wording is doing work: it is the
time from the start of the ride to its last checkpoint, read from one small indexed row rather than
by decoding every second, so a recording with a hole in it recovers a little less than it says.

> **At most eight seconds of a ride can be lost to a crash.**

That is the whole guarantee, and it is a number rather than a reassurance: five seconds between
checkpoints, two seconds during which a sensor reading may still arrive for a second already past,
and the one second currently being recorded. There is no server in this milestone, so there is no
backup, no re-upload and no support ticket — the copy on the device is the only copy in existence,
and everything else about the recorder follows from that.

That bound is about a crash, and a crash is not the only way to lose a second. If the device's
clock is corrected **backwards** mid-ride — an NTP step, or a laptop waking with the wrong time —
the ride loses roughly the seconds the clock rewinds, because readings stamped with the corrected
time land behind seconds already recorded and are dropped rather than overwriting them. That is what
keeps the recording in order, and the client counts both the steps and the samples they cost rather
than passing over them.

Two things the recovered ride keeps that a naive one would not: a sensor dropout comes back as
**missing data**, never as zeroes, and a pause comes back as a **pause** rather than as a dropout
that happens to look like one. If the device runs out of storage mid-ride the recording does not
stop — it keeps going in memory, keeps everything already written, and says so.

### What the numbers on the Analysis page mean

The **Analysis** page shows two things, and they are honest about what they are not.

**Time in zone** splits one ride's power and heart rate into training zones derived from a single
threshold. Every zone is a labelled row carrying its name, its range, the time spent in it and its
share, so nothing on the page is carried by colour alone. Two rules are stated on the page rather
than assumed: a reading exactly on a boundary belongs to the zone that *starts* there, and a second
the sensor never reported is in **no zone at all** rather than in the bottom one — a dead strap is
not an hour of recovery riding. The shares are of the time the sensor actually reported, and where
that is less than the ride's moving time the page says so and by how much.

Until you set your own threshold the page uses an assumed one, and it says the word "assumed" every
time. Zones from a guessed threshold are the right shape and the wrong numbers.

**Ride load** is one number for how hard a ride was: an hour at your threshold is 100, two hours at
threshold is 200, and an easy hour is much less than half of a hard one. It comes from your power
trace where you have one and from your heart rate where you do not, and the page says **which** —
the two share a scale without being the same measurement, so a power-derived 82 and a heart-rate-derived
79 are not directly comparable. A ride that lost part of its trace is scored on the part it kept,
and the page says how much that was rather than quietly counting the silence as zero watts.

**Your thresholds** are two numbers you can set on that page, and everything above is derived from
them. Until you set one, the page uses an assumed default and says the word "assumed" every time.
Clearing a box puts it back to the default. Neither number is sent anywhere.

**Fitness and fatigue** smooth that load two ways — over about six weeks and over about one — and
the gap between them is your **freshness**. The page says which way each is moving and by how much
over the last week, in words as well as on the chart. It does **not** tell you whether that is good:
fatigue rises because you trained, and three numbers are not enough to say more than that.

Two things it is honest about. Both averages start from zero on the day of your first ride, because
this device has no record of what you did before it — so the first few weeks are climbing out of
nothing rather than describing your training, and the page says so while that is true. And a ride
imported before this device measured load is not silently counted as a rest day: the page says how
many there are and offers to measure them, once.

**Duration personal bests** are the best average power you have held for each length of time,
anywhere in any ride on this device. A window is never bridged across a gap in the recording and
never spans two rides, so a best is always something you actually rode in one go — a ride with a
dropout in the middle contributes no long efforts rather than a made-up one. These are **not
segment bests**: "my best 20 minutes" and "my best on Box Hill" are different objects, and this
device does not hold the second kind yet.

### Riding in miles

**Settings** holds one switch: kilometres or miles. It covers distance, speed, climbing and weight
together — there is no way to have miles for distance and metres for climbing, and that is a
deliberate trade rather than an oversight. The current choice is always shown selected, because the
one thing worse than metric-only is a locale guess that silently reports every number in units you
do not use.

It changes how numbers are **shown** and nothing else. Every ride stays recorded exactly as it was —
in metres and metres per second, which is what the files on your device contain — and a FIT, GPX or
TCX file you export is unaffected, because those formats have their own unit rules and another
program reads them. The choice is stored with you rather than with the browser, so it travels in an
account export and comes back with it.

Which platform, in which phase, with which capabilities — and which of those gaps are **permanent**
rather than pending: [`docs/adr/0003-platform-support-matrix.md`](docs/adr/0003-platform-support-matrix.md).

## Technology

TypeScript on Node, in a pnpm workspace: a React web client under `apps/`, and reusable leaf
packages — domain types, FIT/GPX/TCX codec, BLE sensor layer, physics model, local store — under
`packages/`.

The layout and the boundaries between components: [`docs/architecture.md`](docs/architecture.md).
The choices, and what was rejected: [`docs/adr/0005-tech-stack.md`](docs/adr/0005-tech-stack.md).

## Getting started

Needs Node 24 and pnpm 11. Both are pinned by the repository — `.nvmrc` for Node, the
`packageManager` field for pnpm — so neither is a choice you have to make.

```bash
nvm install && nvm use        # or any version manager; `node --version` must report v24
corepack enable pnpm
pnpm install --frozen-lockfile

pnpm --filter @onyourleft/web run dev   # the browser client on http://localhost:5173
pnpm run test                           # every package, run once
pnpm run lint && pnpm run typecheck && pnpm run build
```

The repository's own rules — licence headers, the licence boundary, ADR numbering, the environment
template — are checked by scripts that need no toolchain at all:

```bash
pnpm run check:repo           # or run each script under scripts/ directly with bash
```

`CLAUDE.md` section 4 is the complete and current list of commands, including which ones do not
exist yet and why.

## Licence

Two licences, split along a deliberate boundary:

| What | Licence |
|---|---|
| The application — instance server, web app, deployed product | [`AGPL-3.0-or-later`](LICENSE) |
| Reusable leaf packages — domain types, FIT/GPX/TCX codec, BLE sensor layer | [`Apache-2.0`](LICENSES/Apache-2.0.txt) |

Anything not explicitly marked Apache-2.0 is AGPL-3.0-or-later.

The boundary is **structural**: everything under `packages/` is Apache-2.0 and everything under
`apps/` is AGPL-3.0-or-later, without exception. Which directory your change lands in decides its
licence, so the rule is checkable by path rather than by reading manifests — and a GPL or AGPL
dependency anywhere under `packages/` fails CI.

The AGPL means **nobody can run a closed hosted fork of this service** — including us. Anyone
running a modified instance owes its users the source. The permissive leaf packages mean the parts
worth reusing (a FIT codec, a BLE sensor abstraction) can be adopted by anyone, and carry an express
patent grant.

Reasoning, and what the choice forecloses: [`docs/adr/0001-licence.md`](docs/adr/0001-licence.md).

## Self-hosting

Self-hosting is a first-class, supported goal, not an afterthought — the architecture is one small
self-hostable instance rather than a single central service.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Commits are signed off under the DCO; there is no CLA, and
you keep your copyright.

## Relationship to Strava and Zwift

This project is not affiliated with, endorsed by, or derived from Strava or Zwift. It does not use
their APIs, code, assets or data, and it reimplements product concepts independently. You can bring
your own history in via standard FIT, GPX and TCX file import.
