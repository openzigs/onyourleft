# Exporting the demo as video

The demo (epic [#1643](https://github.com/openzigs/onyourleft/issues/1643)) renders to a video file
for social media and the README: WebM, and MP4 where the machine's encoder allows. The render is
offline and deterministic. It runs locally or on a standard GitHub runner, with no paid service
([#1655](https://github.com/openzigs/onyourleft/issues/1655)).

## Render one

```sh
pnpm --filter @onyourleft/web run build:demo
pnpm --filter @onyourleft/web run demo:video -- --preset climb --seconds 30 --size 1920x1080 --fps 30
```

This writes `apps/web/demo/dist/video/climb-1920x1080.webm`, and `climb-1920x1080.mp4` when the
machine's `ffmpeg` has `libx264`. It needs `ffmpeg` on the `PATH` and the pinned Chromium
(`pnpm --filter @onyourleft/web exec playwright install chromium`). Neither is shipped.

| Option | Values | Default |
|---|---|---|
| `--preset` | `climb`, `sprint`, `group`, `hill`, or `youtube`: the captioned feature tour | `climb` |
| `--seconds` | seconds of ride, positive; `seconds × fps` must be whole; not with `youtube`, whose length is its scenes' | `30` |
| `--fps` | whole frames a second, 1 to 60 | `30` |
| `--size` | `WIDTHxHEIGHT`, each even, 64 to 9998 | `1920x1080` |
| `--route` | a route `demo:bake` wrote into `demo/dist/routes/` | none: the synthetic road |
| `--out` | a directory | `apps/web/demo/dist/video` |
| `--mp4` | `auto`, `on` (fail without `libx264`), `off` | `auto` |

`--no-realistic` answers the realistic world's files with a 404, so the render draws the stylised
world the demo falls back to. The checks use it.

## The YouTube feature tour, with captions

```sh
pnpm --filter @onyourleft/web run build:demo
pnpm --filter @onyourleft/web run demo:video -- --preset youtube --size 1920x1080 --fps 30
```

writes `youtube-1920x1080.webm` (and `.mp4`): about 80 seconds of scenes with a title and captions
burned into the frames, then four seconds of the closing card
([#3074](https://github.com/openzigs/onyourleft/issues/3074)). With `--route <id>` the scenes marked
`route: true` ride that baked route, and their captions about map data are drawn; on the synthetic
road those captions are left out, because no map data is shown.

**The words are in [`apps/web/demo/captions/youtube.ts`](../apps/web/demo/captions/youtube.ts)**, one
scene a block: which preset it rides, for how many seconds, and each caption's start, length, text
and placement (a centred `title` or a lower third). Edit them there; no code changes. Every line must
be a claim the product makes on the day of the render. `src/demo/caption-claims.ts` refuses, in
`pnpm run test` and in `demo:video:check`:

- a caption naming a feature its scene does not show: `climb` needs the lead rider on a gradient of
  6 % or more for the caption's whole time, `group` needs two riders or more in the camera's frame for
  its whole time, and `map-data` a scene marked `route: true`;
- the load-metric trademarks, a competitor's name, and "validated", "accurate to" or "professional
  fit";
- captions that overlap or sit under a second apart, run past their scene, or stay up under three
  seconds.

The page draws the captions itself (`src/demo/caption-script.ts`, `DemoPage.tsx`), in the display
face on the HUD's opaque backing, sized to the frame's height so a 1080p video reads at 720p. The
title sits above the middle, the lower third between the HUD's bottom panels; neither covers a HUD
panel or the map credit. Each fades in and out over half a second. To preview a scene live, open the
built demo with `?captions=youtube&scene=<id>`: there a visitor who asked for reduced motion sees each
caption cut in and out instead.

The tour always ends on the closing card, which carries the project's address, and the map credit
when a scene rode a baked route.

## How it works, and why `ffmpeg`

`tools/demo/render-video.ts` opens the built demo with `?render`. That gives the page a clock that
moves only when the render steps it (`src/demo/render-clock.ts`). Each step is exactly `1000 / fps`
milliseconds of ride, however long the frame takes to draw. `page.screenshot` then captures the
whole frame as a PNG: the WebGL world, the ride HUD over it (`HudCore`, #1650) and its map credit.
The PNGs are piped into `ffmpeg`:

- **WebM**: VP9 (`libvpx-vp9`), constant quality, one thread.
- **MP4**: H.264 (`libx264`), one thread, `+faststart`.

The issue left the encoder to the pull request: WebCodecs in the page with a muxer, or frames piped
to `ffmpeg`. It is **`ffmpeg`**. WebCodecs encodes a canvas, and the HUD is DOM over the canvas, so
it would have to be drawn into the canvas a second time, which #1655 rules out. Screenshots already
hold both. `ffmpeg` is a tool on the machine that renders, so the project adds no dependency and no
licence or notice changes. The runner image has no `ffmpeg`, so CI installs it with `apt-get`.

In render mode the page shows the demo's label and the stage only. The heading, the status line,
the map-data disclosure and the source offer are for a visitor, and a video carries its own credit.
The stage is never moved down the quality ladder: a render is drawn at the rung it started on, the
realistic world's top unless that world could not load.

## Same input, same video

Two renders of the same request decode to the same frames: the page draws from the ride's time
alone, the realistic world loads whole before the first step, the fonts load first, and both
encoders run on one thread. On a Mac, two renders also wrote byte-identical WebM and MP4 files. The
check compares decoded frames and only prints whether the files themselves match, because a
different `ffmpeg` build may write different container bytes.

## A baked route's credit (ADR 0056 D-8)

With `--route`, every frame carries **© OpenStreetMap contributors** in the HUD's corner, burned into
the pixels (D-8.2). The video then ends with **four seconds of a closing card** (D-8.3) after the
ride's own seconds: the credit, ODbL §4.3's notice, and the OpenStreetMap copyright and ODbL
addresses written out, since a video cannot link. So a render of 30 seconds at 30 fps on a baked
route is 900 frames of ride and 120 of the card. A render whose route does not load is refused, not
rendered without its map data.

Whoever publishes such a video names the route data's release asset beside it (ADR 0056 D-4.3).
That release is not built yet ([#1932](https://github.com/openzigs/onyourleft/issues/1932)), so the
card does not carry its address.

## The checks

```sh
pnpm --filter @onyourleft/web run build:demo
pnpm --filter @onyourleft/web run demo:video:check
```

`tools/demo/demo-video.video.spec.ts`, run under `playwright.video.config.ts`, renders small,
short videos and reads each one back **from the file**:

- the frame count, by `ffprobe`: exactly `seconds × fps`, in each container;
- each frame's digest, by `ffmpeg -f framemd5`: two renders match at the first, middle and last
  frames;
- the HUD's primary readings, as a decoded pixel test against the panel's box;
- the credit's box on a baked route, against the same box on the synthetic road as the control;
- the closing card at the end of the baked route's video, and not at the end of the road's;
- the YouTube tour at 1280 × 720 and one frame a second: its script claims only what its scenes show,
  each caption's backing is in the pixels in the middle of its time and not the frame before or after
  it, and it covers no HUD panel; on the fixture route the map-data caption is drawn, no caption
  covers the credit, and the credit stays in the pixels under them;
- two renders of the tour, at 320 × 180, decode to the same frames, every one of them.

At 1280 × 720 two renders are not frame-identical: the world itself differs in a few pixels at the far
left horizon from a frame that varies (the climb preset's 83rd second, before #3074 too), and VP9
carries that into every later frame. So the every-frame comparison is made at the small size, where
the world is the same, and the caption checks at 720p read shares of colour.

The baked route is the synthetic corridor fixture, never OpenStreetMap data (ADR 0056 D-9). The
checks are not part of the browser gate and do not run on every pull request. They need `ffmpeg`.

## On GitHub

[`.github/workflows/demo-video.yml`](../.github/workflows/demo-video.yml), **Demo video**, runs by
hand (`workflow_dispatch`, with `seconds`, `size` and `fps` inputs), on `ubuntu-latest`. It runs
the checks, then renders the three presets and the YouTube tour in parallel on the synthetic road and uploads each as an
artefact, `demo-video-<preset>`. It uses no secret.

A pull request that changes the video tooling or the demo code the render drives
(`apps/web/src/demo/`, `apps/web/tools/demo/`, the demo's entry page and build config, and the gate
files the render imports; the workflow's `paths` list them) runs the checks only. Every other pull
request runs nothing here.

## Capture mode: the real app at 1080p60

The demo build cannot host the game screen (`tools/demo/forbidden-modules.ts` keeps the trainer,
the store and `net/` out of it), so the demo video's scenes (epic
[#3151](https://github.com/openzigs/onyourleft/issues/3151)) are recorded from the **real app** in
capture mode ([#3152](https://github.com/openzigs/onyourleft/issues/3152)).

```sh
pnpm --filter @onyourleft/web run capture -- --scene route-hud --seconds 20
```

This builds the app into `apps/web/capture/dist/app` and writes
`apps/web/capture/dist/route-hud-1920x1080-60fps.mp4`: H.264 High
profile, yuv420p, 1920×1080, 60 fps, CRF 16, `+faststart`. The issue allowed CRF 16 or at least
12 Mb/s; it is CRF 16, constant quality. The stylised world compresses well, so 20 s of `route-hud`
came to about 4.9 Mb/s on a Mac. It needs `ffmpeg` with `libx264` on the `PATH` and the pinned
Chromium, as the demo's render does. That run took four minutes for 1,200 frames.

| Option | Values | Default |
|---|---|---|
| `--scene` | `route-hud`, `delivery`, `lap-race`, `workout`, `pacer`, `free-ride` | `route-hud` |
| `--seconds` | seconds of ride, positive; `seconds × fps` must be whole | `20` |
| `--fps` | whole frames a second, 1 to 60 | `60` |
| `--size` | `WIDTHxHEIGHT`, each even, at least 64 | `1920x1080` |
| `--out` | a directory | `apps/web/capture/dist` |
| `--start` | `free-ride` only: where the ride starts, `<lat>,<lon>` in decimal degrees | none: required |
| `--archive` | `free-ride` only: a local copy of the basemap archive (`.pmtiles`) | none: required |
| `--script` | `youtube`: the whole video from its scene script, in place of `--scene` and `--seconds` (#3156) | none |

### How it works

`tools/capture/render-capture.ts` opens the built app (`apps/web/capture/dist/app`) in Chromium, answering
every file from disk and refusing every other origin, as the demo's render does. Before the app's
first script runs, `tools/capture/capture-clock.ts` replaces the page's `performance.now`, `Date`,
`requestAnimationFrame` and timers. The capture then:

1. imports a synthetic route through the Routes page's own form. It is eight invented kilometres
   from 0° 0° under the placeholder name *Capture loop*, so no real street or place is on screen.
   It also sets the rider's weight on the Settings page, so W/kg has one to read. Before that, the
   browser profile already holds the device's choices (#3175, below);
2. opens `#/game?capture=<scene>`, with `route=` the scene's built-in level or circuit when it
   names one, holds the clocks at 10:30 UTC on a midsummer morning, and presses that route's
   *Ride*;
3. runs animation frames at that one instant until the ride has drawn the **realistic** world
   (`render-capture.ts` §`warmUp`, #3175). None of these frames is in the video, and no ride time
   passes during them, so no frame of the stylised world the realistic one replaces is written.
   The timers keep real time until the first step, because the renderer's warm-up waits for the
   GPU on a timer. The capture stops if the realistic world has not arrived within two minutes;
4. for each frame, steps every clock by exactly `1000 / fps` ms, lets React commit, and screenshots
   the page: the WebGL world and the full `HudPanel` over it. The PNGs go to `ffmpeg`, through the
   demo's own encoder.

So frame *n* is the ride at *n / fps* seconds, however long the machine takes to draw it. The
capture stops if a step does not draw the world exactly once, or draws it in the stylised world
(`render-capture.ts` §`frameProblem`). Beside the video it writes the ride's
event log, `<scene>-<size>-<fps>fps.events.json` (#3153): the round's or race's seed and what it
dealt, each scripted press, each change of score, each lap and each workout block, with the frame
it happened on. Two captures of one scene are the same ride when their logs are equal.

### What `?capture=` is in the app

`src/game/capture-scene.ts` holds the switch and the scenes. A capture ride is a simulated ride
(`?simulate=`), built by `GameView.tsx` §`useSimulatedRide` with **no trainer port, no room, no
rooms and no Delivery round**. It never writes to a trainer, records nothing and posts nothing. It
differs in three ways:

- its power, cadence and heart rate follow the scene's script on the ride's clock, so the HUD shows
  numbers where a simulated ride shows dashes;
- the HUD carries no *Simulated ride* mark, because the video is the HUD a rider sees;
- the recorder's figures (*Moving*, *Elapsed*, the ride so far and *Calories*) are folded in memory
  from the same readings by `capture-recording.ts`, with the recorder's own `rideTotals`, and are
  dropped with the screen.

**Only the capture tool's build reads the switch.** `pnpm run capture` builds the app with
`vite build --mode capture`; every other build, every release among them, is `production`, where
`captureSceneFromHash` answers `undefined` before it reads the address, so a link carrying
`?capture=` opens an ordinary ride. The scenes are not in that bundle, and
`tools/capture/capture-stays-out.ts` fails a product build that carries one, finding the scene
table by the mark every scene's id begins with (`oyl-capture-scene:`), never by a name such as
`delivery` that the product carries anyway. The capture build is written to
`apps/web/capture/dist/app`, never to `apps/web/dist`, which is Capacitor's `webDir`, so an app
built by hand after a capture never reads `?capture=` (#3153).
`src/game/capture-wiring.test.tsx` proves the stepped clock, and `simulated-rider-wiring.test.tsx`
proves that a capture reaches no trainer and starts no recording. The instance scenes are #3155.

### Only the realistic world, and the whole HUD (#3175)

The owner, 2026-11-25: *"Ensure it only has the realistic world"* and *"make sure the video shows
all of the hud"*. A fresh browser profile reads every device setting as its default, and three
defaults are not that video: the realistic world is off (ADR 0026 D-3), the ride controls fade after
five seconds with no input, and a Delivery round draws its game strip, power and the round alone.

- **The device's choices.** `tools/capture/capture-device.ts` writes the realistic world *on*, the
  ride controls' auto-hide *off* and a Delivery round's HUD as *everything*, each through the
  function Settings writes it with, under its own key, into the profile's `localStorage` before the
  app's first page loads (Playwright's `storageState`). The app reads them as it reads any rider's;
  the game and the HUD have no capture branch for any of the three. No scene opts out, and neither
  `CaptureScene` nor a script's scene has a field to opt out with.
- **No stylised frame.** Each frame of a capture ride tells the capture tool which world the view
  drew (`window.__oylCapture.world`, read from the view itself, `port.ts` §`GameView.drawnWorld`).
  The warm-up waits for `realistic`, and the capture stops on any counted frame that is not.
- **The top rung, held.** A capture's frame times are the step's, not the device's: at 5 fps every
  frame is 200 ms, which the ladder reads as a device far too slow for realism. So a capture ride
  does not feed the quality ladder (`GameView.tsx`, beside `nextWorldQuality`), and stays on the
  realistic world's top rung for the whole scene.
- **The whole HUD.** On every captioned frame of a script, the page looks for every panel the
  scene's mode draws (`video-script.ts` §`scenePanels`): the readings, the totals, the elevation
  profile, the map and the ride controls, and the mode's own (the workout strip, the pacer's and
  the best ride's readings, the race's standings and item, the round's houses and throw buttons).
  The render stops on a frame where one is missing or faded. The closing card covers the frame and
  is not asked.

### Free ride (#3154)

```sh
pnpm --filter @onyourleft/web run capture -- --scene free-ride --seconds 40 \
  --start <lat>,<lon> --archive /path/to/basemap.pmtiles
```

- **Blocks from local disk.** The open world reads its blocks as range requests on the basemap
  archive's one URL (`world-data/corridor-source.ts`). The capture tool answers that URL from the
  `--archive` file (`render-capture.ts` §`archiveRange`), so nothing waits on the network. The URL
  is the one the capture build was made with (`map/basemap.ts` §`readBasemapConfig`), read as
  the build reads it: the environment and `apps/web`'s `.env`, `.env.local`, `.env.capture` and
  `.env.capture.local` files (`render-capture.ts` §`captureArchiveUrl`).
  The terrain archive is refused, so a capture's open-world road is flat.
- **The request log.** Beside the video, `<scene>-<size>-<fps>fps.requests.json` counts the app's
  files and the archive's ranges answered from this machine, and lists every other request by
  origin and path. Every request is answered or refused inside the browser
  (`context.route`), so none leaves the machine; the log says which were asked.
- **The start** is the command's, never one kept in this repository. The tool writes it into the
  game's address as `start=` beside `capture=`, and only the capture build reads it
  (`src/game/capture-free-ride.ts` §`captureOpenWorldStart`), as a pin on the picker's map would.
- **Junctions.** The scene presses *left* at the first junction after 2 s and *right* at the next,
  through the HUD's own turn buttons, one junction a press (`capture-scene.ts` §`CaptureCue`).
- **No real street or place names on screen** (the owner's rule of 2026-11-24). On a capture every
  street is shown by a placeholder from a fixed list (`capture-free-ride.ts`
  §`CAPTURE_STREET_NAMES`), on the road and in the junction prompt alike, through the session's one
  source of names (`open-world/session.ts` §`renamedStreets`). The minimap draws lines and no
  names, and the open world's card is *Open world*. The other scenes ride a synthetic route, a
  built-in level or a built-in circuit, whose names are this project's own.

**The final render uses the real basemap** (#3175): the project's basemap release on R2, the archive
`VITE_BASEMAP_PMTILES_URL` names, or a local extract of it around the start
(`pmtiles extract <release URL> extract.pmtiles --bbox=<west,south,east,north>`), handed to
`--archive`. A few kilometres square is enough for the scene's sixteen seconds. So the free ride
shows real roads, buildings and land use, with every street named by a placeholder.

The open world's invented test block (`src/game/open-world/fixture-testing.ts`
§`openWorldFixtureArchive`, no OpenStreetMap data) is for tests only: it can be written to a file
and handed to `--archive`, with `--start` at its start pin, to try the scene with no map at all, but
it has no buildings and is never the video's.

### The modes' scenes (#3153)

| Scene | Opens on | What is scripted |
|---|---|---|
| `delivery` | the first built-in level, *Morning Round*, 680 m in | the round's seed; a throw at each house as a rider aims it, so the parcel lands on the step |
| `lap-race` | the built-in circuit *Bellwether Loop* | the race's seed, five seeded bots (no instance), two laps; an item used once one is held, after its second |
| `workout` | the synthetic route | a tailored built-in (`#/ride?workout=built-in:sweet-spot-3x12&length=45&intensity=5`) from 10 s before its warm-up ends, its ERG target held at a 250 W threshold |
| `pacer` | the synthetic route | the pacer at 3.1 W/kg, and the rider's "own best" as a bundled synthetic ride at 31 km/h |

- **Seeds.** Delivery's round seed and the lap race's are drawn from `crypto.getRandomValues` at the
  press on every ride. A scene's `seed` is the only other source, and only the capture build reads a
  scene. `capture-modes-wiring.test.tsx` proves a release build, `?capture=` and all, and the capture
  build without `?capture=` still draw from crypto.
- **No rider data.** A capture keeps Delivery's week, the levels finished and the assist settings in
  an empty store in memory (`capture-scene.ts` §`captureStorage`), and never asks the store for a
  ghost: its ghost is the bundled synthetic one, or none. A capture writes nothing to a trainer.
- **The workout's trainer** is `capture-workout.ts`: it holds the ERG target and the power read is
  the target, as an ERG trainer makes it. Nothing is written to a device.
- **Laps.** A capture that crosses a course's line keeps its laps in memory with the recorder's own
  rule, so the lap panel shows them and *Lap* counts from the line.
- The lap race's countdown is ten seconds, and its first pick-up is a quarter of the way round, so
  on *Bellwether Loop* the item is used about 100 s into the ride. Capture the scene long enough.

### The scene script: the whole video, captioned (#3156)

```sh
pnpm --filter @onyourleft/web run capture -- --script youtube \
  --start <lat>,<lon> --archive /path/to/basemap.pmtiles
```

renders the whole video from **one scene script** and writes three files to
`apps/web/capture/dist`:

- `youtube-1920x1080-60fps.mp4`: every scene in order, as **one** H.264 file. Each scene is
  ridden in the real app in turn, and every frame goes into the same encoder, so nothing is joined
  or re-encoded. It is encoded as `youtube-1920x1080-60fps.partial.mp4` and renamed only once it
  holds every frame, so a render that stops part-way leaves an earlier video as it was;
- `youtube-1920x1080-60fps.srt`: every caption, timed in the whole video. The closing card's
  entry carries the map credit lines that the card shows;
- `youtube-1920x1080-60fps.chapters.txt`: the chapter list for the YouTube description
  (`0:00 On Your Left`, `0:10 The HUD`, …), one line per scene that starts a chapter.

The script rides the free ride, so it needs `--start` and `--archive` as that scene does.
`--size`, `--fps` and `--out` work as they do for one scene. Each scene's event and request logs
go in `youtube-scenes/<scene>/`.

**The words and scenes are in
[`apps/web/tools/capture/scripts/youtube.ts`](../apps/web/tools/capture/scripts/youtube.ts).**
Each scene is a capture scene, ridden from its start and written from `from` seconds in, for
a whole number of seconds. It may start a chapter, and it has captions. A caption has a
start, a length and its text. It is either placed (a centred `title`, a `lower-third`, or the
closing `card`) or a **callout**, which names the HUD panel it explains
(`video-script.ts` §`CALLOUT_PANELS`: `readings`, `gradient`, `calories`, `elevation`, `map`,
`workout`, `pacer`, `best`, `standings`, `item`, `houses`, `throw` and others). The owner approves
every line before the final render, as on #3074.

The epic's scenes 9 (group ride) and 11 (after the ride, the AI write-up) need a self-hosted
instance. They come from [#3155](https://github.com/openzigs/onyourleft/issues/3155), which the
owner holds, and are left out of the script; comments in the file mark where they go.

#### What a script may say

`tools/capture/video-script.ts` §`scriptProblems` checks the script before a frame is rendered.
`video-script.test.ts` holds every shipped script to the same check in `pnpm run test`. It refuses:

- a caption claiming a feature its scene does not ride: `delivery` (a built-in level with
  throws), `lap-race` (a built-in circuit's race), `workout`, `junction` (a free ride, from its
  first scripted turn on), `pacer`, and `instance`, which no capture scene rides until #3155.
  A callout to a panel that only one mode draws, such as the standings or the throw buttons, claims
  that mode, whatever the caption claims itself;
- a word for a feature only an instance runs ("AI", "instance") anywhere but a line of the closing
  card that begins "Optional on your own instance:". The AI pacer and AI bots exist but are not
  filmed until #3155, so the card may state them as optional and nothing else may name them;
- the load-metric trademarks, a competitor's name, and "validated", "accurate to" or "professional
  fit". The word list is `src/demo/caption-words.ts`, shared with the demo's tour;
- a caption up for under 3 or over 6 seconds, one that runs past its scene, or one less than a
  second from the next; a scene under 6 seconds; a chapter list that YouTube would not read (the
  first chapter at 0:00, three or more chapters, each 10 seconds or longer);
- lines under a caption's words on anything but a `title` or a `card`, and the logo on anything
  but a `title`.

#### The opening: the logo, and the platforms line (#3175)

The opening title is drawn under the project's logo, centred: `src/brand/logo-dark.webp`, the
app's own file, drawn no larger than its own 512 × 408 pixels (34 % of the frame's height, so
367 pixels tall at 1080p) and never scaled up, so it is sharp at 1080p and no cleaned copy is
needed. Its edge was checked on the dark frame: the sticker outline is clean, with no green-screen
halo. Beneath it is the owner's platforms line, **"On Android. Coming to iOS soon."**, which the
closing card carries too; `video-script.test.ts` pins the wording.

#### Captions and callouts are drawn by the page

Before each frame is taken, the caption on screen is laid out **in the page**, over the app, in the
HUD's tokens (`render-script.ts`):

1. the page measures the caption, the panel it explains (found by the HUD's class and the label a
   rider reads, never by position), the map credit and every other HUD panel;
2. `caption-layout.ts` §`placeCaption` chooses the place. A callout goes a gap outside the panel,
   or outside the panel the reading sits in, and slides toward the middle until it is clear. A lower
   third goes low and centred, and a title goes above the middle. Every place is inside the 5 %
   title-safe area and never over the map credit. A place over another HUD panel is used only when
   the frame has no other;
3. the page draws the caption there, with a leader line and a ring round the panel. Each caption
   fades in and out over half a second, but for a card that ends its scene: the closing card holds
   to the video's last frame.

The drawn box is then measured again. The render **stops** on any frame where a caption covers the
panel it explains or the map credit, or leaves the title-safe area. It also stops when a callout's
panel is not drawn, for example the standings below 1080p, where the HUD leaves them out, or the ride
controls once they have faded after five seconds without input. Such a video is never written.
`caption-layout.test.ts` sweeps the layout over five frame sizes and the HUD's measured 1080p boxes.

#### Known in the frames

- **Heights unavailable** shows through the free-ride scene. The capture refuses the terrain archive
  (#3154), so the open world's road is drawn level and the HUD says so. Hiding a true notice would
  show the product as it is not, so the scene keeps it.
  [#3173](https://github.com/openzigs/onyourleft/issues/3173) gives the capture a local terrain
  archive; #3175 left it there.
- **Single frames with no world drawn.** A capture of `route-hud` at 5 fps, from `main` before this
  change, has three frames in 200 where the world is not drawn: the sky is the page's background.
  This is a capture-mode defect from #3152:
  [#3172](https://github.com/openzigs/onyourleft/issues/3172).
