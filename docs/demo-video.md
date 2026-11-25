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

This builds the app and writes `apps/web/capture/dist/route-hud-1920x1080-60fps.mp4`: H.264 High
profile, yuv420p, 1920×1080, 60 fps, CRF 16, `+faststart`. The issue allowed CRF 16 or at least
12 Mb/s; it is CRF 16, constant quality. The stylised world compresses well, so 20 s of `route-hud`
came to about 4.9 Mb/s on a Mac. It needs `ffmpeg` with `libx264` on the `PATH` and the pinned
Chromium, as the demo's render does. That run took four minutes for 1,200 frames.

| Option | Values | Default |
|---|---|---|
| `--scene` | `route-hud` | `route-hud` |
| `--seconds` | seconds of ride, positive; `seconds × fps` must be whole | `20` |
| `--fps` | whole frames a second, 1 to 60 | `60` |
| `--size` | `WIDTHxHEIGHT`, each even, at least 64 | `1920x1080` |
| `--out` | a directory | `apps/web/capture/dist` |

### How it works

`tools/capture/render-capture.ts` opens the built app (`apps/web/dist`) in Chromium, answering
every file from disk and refusing every other origin, as the demo's render does. Before the app's
first script runs, `tools/capture/capture-clock.ts` replaces the page's `performance.now`, `Date`,
`requestAnimationFrame` and timers. The capture then:

1. imports a synthetic route through the Routes page's own form. It is eight invented kilometres
   from 0° 0° under the placeholder name *Capture loop*, so no real street or place is on screen.
   It also sets the rider's weight on the Settings page, so W/kg has one to read;
2. opens `#/game?capture=<scene>`, holds the clocks at 10:30 UTC on a midsummer morning, and
   presses *Ride*;
3. runs animation frames at that one instant until the ride has drawn its world. None of these
   frames is in the video, and no ride time passes during them. The timers keep real time until
   the first step, because the renderer's warm-up waits for the GPU on a timer;
4. for each frame, steps every clock by exactly `1000 / fps` ms, lets React commit, and screenshots
   the page: the WebGL world and the full `HudPanel` over it. The PNGs go to `ffmpeg`, through the
   demo's own encoder.

So frame *n* is the ride at *n / fps* seconds, however long the machine takes to draw it. The
capture stops if a step does not draw the world exactly once.

### What `?capture=` is in the app

`src/game/capture-scene.ts` holds the switch and the scenes. A capture ride is a simulated ride
(`?simulate=`), built by `GameView.tsx` §`useSimulatedRide` with **no trainer port, no room, no
rooms and no Delivery round**. It never writes to a trainer, records nothing and posts nothing, and
it is as harmless in a release build as `?simulate=` is. It differs in three ways:

- its power, cadence and heart rate follow the scene's script on the ride's clock, so the HUD shows
  numbers where a simulated ride shows dashes;
- the HUD carries no *Simulated ride* mark, because the video is the HUD a rider sees;
- the recorder's figures (*Moving*, *Elapsed*, the ride so far and *Calories*) are folded in memory
  from the same readings by `capture-recording.ts`, with the recorder's own `rideTotals`, and are
  dropped with the screen.

A rider never sees the switch: it is typed into the address, and the tablet app has none.
`src/game/capture-wiring.test.tsx` proves the stepped clock, and `simulated-rider-wiring.test.tsx`
proves that a capture reaches no trainer and starts no recording. The other scenes (Delivery, lap
race, workouts, free ride and the instance) are #3153 to #3155.
