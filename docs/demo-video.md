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
| `--preset` | `climb`, `sprint`, `group` | `climb` |
| `--seconds` | seconds of ride, positive; `seconds × fps` must be whole | `30` |
| `--fps` | whole frames a second, 1 to 60 | `30` |
| `--size` | `WIDTHxHEIGHT`, each even, 64 to 9998 | `1920x1080` |
| `--route` | a route `demo:bake` wrote into `demo/dist/routes/` | none: the synthetic road |
| `--out` | a directory | `apps/web/demo/dist/video` |
| `--mp4` | `auto`, `on` (fail without `libx264`), `off` | `auto` |

`--no-realistic` answers the realistic world's files with a 404, so the render draws the stylised
world the demo falls back to. The checks use it.

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
- the closing card at the end of the baked route's video, and not at the end of the road's.

The baked route is the synthetic corridor fixture, never OpenStreetMap data (ADR 0056 D-9). The
checks are not part of the browser gate and do not run on every pull request. They need `ffmpeg`.

## On GitHub

[`.github/workflows/demo-video.yml`](../.github/workflows/demo-video.yml), **Demo video**, runs by
hand (`workflow_dispatch`, with `seconds`, `size` and `fps` inputs), on `ubuntu-latest`. It runs
the checks, then renders the three presets in parallel on the synthetic road and uploads each as an
artefact, `demo-video-<preset>`. It uses no secret.

A pull request that changes the video tooling or the demo code the render drives
(`apps/web/src/demo/`, `apps/web/tools/demo/`, the demo's entry page and build config, and the gate
files the render imports; the workflow's `paths` list them) runs the checks only. Every other pull
request runs nothing here.
