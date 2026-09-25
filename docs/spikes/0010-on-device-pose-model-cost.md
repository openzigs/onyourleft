# Spike 0010: What a pose model costs on the Pixel Tablet, and whose weights we may ship

- **Date measured**: **2026-09-25.** Every figure below was produced on that day on the tablet in §2.
  The licence texts in §3 were read on that day at the URLs given.
- **Issue**: [#385](https://github.com/openzigs/onyourleft/issues/385), the scope its 2026-09-25
  comment added: a pose model running **on the tablet**, its per-frame cost, its licence read at a
  first-party source, and its size. Feeds [#530](https://github.com/openzigs/onyourleft/issues/530).
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: _"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."_ §7 names a candidate for #530 **as a measurement**. It
  does not choose the model.

> ## ⚠️ The half of #385 this does NOT do
>
> #385 exists to measure **accuracy**: whether a _difference_ in a derived angle, within one
> session, with a rider side-on, is repeatable, and whether it tracks a known saddle-height change.
> **None of that was done.** Nobody can ride today, so there was no rider, no bicycle, no tripod
> phone and no perturbation. #385's repeatability, perturbation, stated-limit and what-would-lift-it
> criteria are **not met**, and the pull request that lands this file says `Refs #385` rather than a
> closing keyword for that reason.
>
> ⚠️ **Nothing measured here is a product claim.** The model was fed one still photograph over and
> over. The numbers say what the model **costs**. They say nothing about what it **resolves**, and
> [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) governs every word the app may say
> about a body whatever this file measures. No frontal-plane measurement was attempted.
>
> ⚠️ **Nothing was committed.** The weights, the runtimes and the test pages were in a temporary
> directory outside the workspace. No dependency was added to `apps/` or `packages/`, and no row was
> added to `ASSETS.toml`.

---

## 1. The question, and the answer in one paragraph

Can the tablet run a pose model on the side camera's pictures at about **5 per second, about
256 px** ([ADR 0033](../adr/0033-side-camera-link.md) D-3's figures, costed in its D-6) **while the trainer game
renders**, and is there a model whose weights this repository may ship?

**Yes, on both counts, with one condition.** Every model measured ran at 5 pictures a second beside
the game with **at most one frame over 20 ms in about 2 400** and a harness p99 of 16.8 ms, **as long as it ran in a Web
Worker on the CPU**. The same model on the page's main thread missed a vsync 191–203 times in 40 s.
The cheapest beside the ride was **MediaPipe Pose Landmarker lite on its CPU (XNNPACK/WASM)
delegate**, at **57.9 ms p50 and 73.6 ms p95** per picture in the stylised world and 65.8 / 80.6 ms
in the realistic one, and 68.0 / 83.0 ms inside the app's own WebView. **MoveNet Lightning on
TF.js WASM** came second, at 79.0 / 98.0 ms. Ten minutes beside the game changed neither the
inference time nor the frames, and the tablet stayed at thermal status 0. MoveNet's
weights licence, which [#328](https://github.com/openzigs/onyourleft/issues/328) left unconfirmed, is
**Apache 2.0 at Google's own Kaggle model page and in Google's own model card** (§3). BlazePose's
(MediaPipe's) is Apache 2.0 in its model card. RTMPose's weights have **no licence statement at the
source** and fail closed.

⚠️ **One number here surprised us, and it matters to #530.** The same inference costs **about three
times as much at 5 per second as it does back to back**: 78–94 ms against 29–38 ms, same model, same
worker, same picture (§5.3). A model's published frame rate is the wrong input for a 5-per-second
budget. Measure at the duty cycle you will run.

---

## 2. Conditions

| | |
| --- | --- |
| **Device** | Google Pixel Tablet (`tangorpro`), SoC **Google Tensor G2 (GS201)**, GPU **ARM Mali-G710** (`ANGLE (ARM, Mali-G710, OpenGL ES 3.2)`), 8 cores reported by `navigator.hardwareConcurrency`, 7.3 GiB RAM (`MemTotal 7619840 kB`) |
| **OS** | Android **17**, build **CP2A.260705.006** (`google/tangorpro/tangorpro:17/CP2A.260705.006/15641320:user/release-keys`) |
| **Browser** | **Chrome 153.0.8010.52** (V8 15.3.76.13). Chrome on this tablet requests the desktop site, so the page saw `X11; Linux x86_64` in its user agent |
| **WebView** | Android System WebView **153.0.8010.36**, inside the installed On Your Left debug build. §5.5 only |
| **Power and heat** | On AC (the dock), battery 100 %. Thermal status **0** before and after every run. `BIG` cluster 25–40 °C |
| **Page origin** | `http://localhost:8385`, served from the Mac over `adb reverse`. `localhost` is a secure context, so WebGPU was available. Not cross-origin isolated, so every WASM runtime ran **single-threaded**, which is what the shipped app would get today |
| **Input** | One photograph, **cropped and resized to 256 × 256 JPEG** (26 KB): a man riding a bicycle side-on, _Man riding bicycle (Unsplash).jpg_, Clem Onojeghuo, 2016, **CC0** on [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Man_riding_bicycle_(Unsplash).jpg). Not committed |
| **Picture rate** | **5 per second** from a `setInterval`. Each tick decodes the JPEG with `createImageBitmap` (as a picture arriving over ADR 0033's link would be decoded) and runs the model. At most one picture in flight. A tick that finds the model busy is counted as dropped. **No tick was dropped in any run** |
| **The game** | `apps/web/browser/realistic.html` from `main` at `2433827`, built by `vite.browser.config.ts`: the **product's own renderer** riding the owner's route at 9 m/s with the quality ladder held (`ladder=0`, `panel=0`), stylised world at its top rung (20 draw calls, a 1600 × 2296 drawing buffer, portrait), and the realistic world at its top rung. The pose code was a second module on the same page |
| **Cooldown** | 30 s between isolated runs, 45 s between runs beside the game |

**Warm-up.** Every run first loads the model and times it, then times the **first** inference
(shader compilation or WASM instantiation lands here), then discards 20 further inferences before
anything is recorded. The isolated runs then time **200 back-to-back** inferences ("burst"), then
**30 s at 5 per second** ("paced"). The runs beside the game skip the burst and run **40 s at 5 per
second**.

**Frames.** A `requestAnimationFrame` loop on the page records the interval between frames over the
same window as the paced run. At 60 Hz a healthy interval is 16.6 ms; one over 20 ms is a missed
vsync, one over 33.4 ms is two. The game harness also publishes its own frame-interval percentiles
over a 60 s window that overlaps the paced run.

---

## 3. The licences, read at first-party sources

| Model | Weights licence, **verbatim**, and where | Runtime and its licence (npm, read 2026-09-25) | Verdict under [ADR 0031](../adr/0031-model-licences-and-the-hosted-model-hole.md) D-2 / `ASSET004` |
| --- | --- | --- | --- |
| **MoveNet SinglePose Lightning / Thunder** (Google) | **Kaggle model page, author Google**: every instance, TF.js, TFLite and TF2 included, carries `"licenseName": "Apache 2.0"`, and the model description ends: _"## License — This model follows [*Apache 2.0*](https://www.apache.org/licenses/LICENSE-2.0). If you intend to use it beyond permissible usage, please consult with the model owners ahead of time."_ — read from `https://www.kaggle.com/api/v1/models/google/movenet/get`, the API behind [kaggle.com/models/google/movenet](https://www.kaggle.com/models/google/movenet). **Google's model card** ([PDF](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf), the one the Kaggle page links): _"Licensed Under Apache License, Version 2.0"_ | `@tensorflow/tfjs-core`, `-converter`, `-backend-wasm`, `-backend-webgl`, `-backend-webgpu` 4.22.0, `@tensorflow-models/pose-detection` 2.1.3: all **Apache-2.0** | **Permissive. Admissible anywhere.** This settles the question #328 left open: the licence is now read at Google's own pages rather than from redistributors |
| **MediaPipe Pose Landmarker lite / full** (BlazePose GHUM 3D, Google) | **Google's model card** ([PDF](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), the one [the Pose Landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) links as its model card, dated _"April, 16, 2021"_): _"LICENSED UNDER Apache License, Version 2.0"_. The `.task` files were fetched from `storage.googleapis.com/mediapipe-models/pose_landmarker/…/float16/latest/`, the URLs that guide gives | `@mediapipe/tasks-vision` **1.0.1**, **Apache-2.0**. The [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) repository's `LICENSE` is Apache 2.0 | **Permissive. Admissible anywhere.** ⚠️ The `.task` bundle holds **two** networks (`pose_detector.tflite`, `pose_landmarks_detector.tflite`). The card names BlazePose and GHUM and does not list the detector file by name. A reviewer committing one should decide whether that is enough, which is a narrower question than #328's |
| **RTMPose-t** (OpenMMLab, `rtmpose-t_simcc-body7_pt-body7_420e-256x192`) | **None stated.** The [RTMPose README](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose) lists the download and states no licence for the weights. The [mmpose `LICENSE`](https://github.com/open-mmlab/mmpose/blob/main/LICENSE) is Apache 2.0 (_"Copyright 2018-2020 Open-MMLab"_) and is a licence on the repository. The README says the model was _"trained on 7 public datasets"_: AI Challenger, MS COCO, CrowdPose, MPII, sub-JHMDB, Halpe, PoseTrack18. **Their terms were not read here** | `onnxruntime-web` 1.30.0, **MIT** | **Unclear, so it fails closed.** `ASSET004` would need a licence to put in the row, and the source states none for these bytes. Measured anyway, as the only non-Google option that is credible in a browser |
| **YOLO11 / YOLO26-pose** (Ultralytics) | The [ultralytics `LICENSE`](https://github.com/ultralytics/ultralytics/blob/main/LICENSE) is _"GNU AFFERO GENERAL PUBLIC LICENSE Version 3"_. The README offers an _"Ultralytics Enterprise License"_ as the alternative | — | **Copyleft. Refused** by ADR 0031 D-2 by name (it lists YOLO26 as its AGPL example). **Not measured** |

**Two sentences that are not licence terms, recorded so nobody mistakes them for terms.** Both
Google model cards list, under _out-of-scope_ uses, _"Any form of surveillance or identity
recognition is explicitly out of scope and not enabled by this technology"_. The BlazePose card also
says _"The model is not intended for human life-critical decisions. The primary intended application
is entertainment."_ These are intended-use statements in a model card. They are not conditions of
the Apache grant, so ADR 0031 D-2's _use-restricted_ row does not catch them. They agree with what
ADR 0030 already requires the app to say, and a reviewer of #530 should read them anyway. Kaggle's
_"If you intend to use it beyond permissible usage, please consult with the model owners"_ adds no
term either. "Permissible usage" is what Apache 2.0 permits.

### Sizes

| Model | Weights as fetched | Runtime bytes the page loads |
| --- | --: | --- |
| MoveNet Lightning (TF.js graph model, v4) | **4.82 MB** (`model.json` 168 KB + two shards 4.65 MB). Kaggle also offers TFLite int8 at 2.89 MB and float16 at 4.76 MB | TF.js core, converter, WASM backend and `pose-detection`: **0.95 MB** minified JS (0.23 MB gzip) + `tfjs-backend-wasm-simd.wasm` **0.42 MB** |
| MoveNet Thunder (TF.js, v4) | **12.65 MB** | same |
| Pose Landmarker lite (`.task`, float16) | **5.78 MB** (detector 2.96 MB + landmarks 2.82 MB) | `@mediapipe/tasks-vision`: **0.15 MB** JS + `vision_wasm_internal.wasm` **11.0 MB** (3.4 MB gzip). The WASM is the same for CPU and GPU delegates |
| Pose Landmarker full (`.task`, float16) | **9.40 MB** (detector 2.96 MB + landmarks 6.44 MB) | same |
| RTMPose-t (ONNX, float32) | **13.35 MB** | `onnxruntime-web`: `ort-wasm-simd-threaded.wasm` **14 MB**, or the WebGPU (`jsep`) build **27 MB** |

SHA-256 of what was fetched, so a later reader can tell whether they are measuring the same bytes:
MoveNet Lightning TF.js archive `28b9a96d…61765`, Thunder `9ab8399b…7e522`, `pose_landmarker_lite.task`
`59929e1d…0574a`, `pose_landmarker_full.task` `4eaa5eb7…4ad`, RTMPose-t zip `937003a7…805cb`. ⚠️ The
MediaPipe URLs end in `latest/`, so the same URL can serve other bytes later.

---

## 4. Isolated: the page doing nothing else (Chrome, main thread)

200 back-to-back inferences after 20 discarded, then 30 s at 5 per second. Milliseconds. "Key
points" is how many of the model's points came back above its own confidence threshold (0.3 for
MoveNet and RTMPose, visibility 0.5 for MediaPipe) on the last burst frame. It is a sanity check that
the model saw a person. It is not an accuracy figure.

| Model | Backend | Load | First inference | **Burst p50 / p95** | Paced p50 / p95 (5 per s) | Key points |
| --- | --- | --: | --: | --: | --: | --: |
| MoveNet Lightning | TF.js WebGL | 133 | 4 296 | 52.7 / 70.7 | 114.8 / 138.8 | **5 of 17** |
| MoveNet Lightning | TF.js WASM | 134 | 110 | **29.0 / 32.1** | 101.3 / 117.7 | 17 of 17 |
| MoveNet Lightning | TF.js WebGPU | 144 | 1 359 | 29.7 / 35.9 | 71.8 / 98.6 | 17 of 17 |
| MoveNet Thunder | TF.js WebGL | 269 | 3 292 | 63.0 / 78.2 | 113.6 / 134.9 | **0 of 17** |
| MoveNet Thunder | TF.js WASM | 248 | 195 | 101.9 / 105.2 | 127.5 / 145.8 | 17 of 17 |
| MoveNet Thunder | TF.js WebGPU | 194 | 220 | 52.2 / 62.2 | 75.3 / 97.8 | 17 of 17 |
| Pose Landmarker lite | MediaPipe GPU (WebGL2) | 473 | 1 791 | 42.8 / 80.5 | 103.4 / 125.1 | 33 of 33 |
| Pose Landmarker lite | MediaPipe CPU (XNNPACK) | 385 | 299 | **29.1 / 30.9** | 104.5 / 116.8 | 33 of 33 |
| Pose Landmarker full | MediaPipe GPU (WebGL2) | 459 | 723 | 45.1 / 93.9 | 110.9 / 139.7 | 32 of 33 |
| Pose Landmarker full | MediaPipe CPU (XNNPACK) | 428 | 340 | 43.7 / 45.2 | 98.4 / 133.1 | 32 of 33 |
| RTMPose-t | ONNX Runtime WASM | 1 249 | 204 | 45.3 / 46.5 | 93.6 / 125.3 | 17 of 17 |
| RTMPose-t | ONNX Runtime WebGPU | 1 399 | 2 003 | 89.4 / 100.7 | 123.0 / 149.3 | 17 of 17 |

With no model, the page's frames were 16.6 / 16.7 / 16.8 ms (p50 / p95 / p99). With any of these on
the **main thread**, 144–151 of the ~150 inferences each cost one or more missed vsyncs, and the
frame p95 rose to 50–115 ms. The main thread is not where this belongs. §5 moves it off.

⚠️ **TF.js's WebGL backend gets MoveNet wrong on this GPU.** Lightning returned 5 of 17 points and
Thunder none, on the same picture where the WASM and WebGPU backends returned all 17. It is also the
slowest backend for both. This looks like a precision problem in the WebGL path on the Mali-G710.
The cause was not investigated. **Do not use TF.js WebGL for MoveNet on this device.**

---

## 5. Beside the ride: the game rendering, the model in a Web Worker

The number #385 asks for: the model's cost **with the renderer running**, not in isolation. Each row
is one page: the product's renderer riding, plus 40 s of pictures at 5 per second. The model runs in
a Web Worker (a classic worker, because MediaPipe's loader uses `importScripts`) unless the row says
_main_.

### 5.1 The stylised world (the default, and the precached world)

| Model | Backend | Where | **Inference p50 / p95** | Decode p50 | Frames p50 / p95 / p99 | Frames > 20 ms | > 33 ms | Harness p50 / p90 / p99 |
| --- | --- | --- | --: | --: | --: | --: | --: | --: |
| _none_ (first run) | | | | | 16.6 / 16.7 / 16.8 | 0 | 0 | 16.6 / 16.7 / 16.8 |
| **Pose Landmarker lite** | **MediaPipe CPU** | **worker** | **57.9 / 73.6** | 4.2 | 16.6 / 16.7 / 16.8 | **0** | **0** | 16.6 / 16.7 / 16.8 |
| MoveNet Lightning | TF.js WASM | worker | 79.0 / 98.0 | 4.2 | 16.6 / 16.7 / 16.8 | 0 | 0 | 16.6 / 16.7 / 16.8 |
| RTMPose-t | ORT WASM | worker | 67.2 / 87.9 | 4.0 | 16.6 / 16.7 / 16.8 | 1 | 0 | 16.6 / 16.7 / 16.8 |
| Pose Landmarker full | MediaPipe CPU | worker | 76.2 / 93.3 | 4.0 | 16.6 / 16.7 / 16.8 | 0 | 0 | 16.6 / 16.7 / 16.8 |
| MoveNet Lightning | TF.js WebGPU | worker | 49.1 / 59.7 | 4.2 | 16.6 / 16.7 / 17.1 | **21** | 1 | 16.6 / 16.7 / 16.9 |
| Pose Landmarker lite | MediaPipe GPU | worker | 61.2 / 77.5 | 4.3 | 16.6 / 16.7 / 16.9 | 6 | 1 | 16.6 / 16.7 / 16.8 |
| MoveNet Thunder | TF.js WebGPU | worker | 73.1 / 85.4 | 3.8 | 16.6 / **33.2** / 33.3 | **121** | 9 | 16.6 / 16.7 / **33.3** |
| MoveNet Lightning | TF.js WASM | **main** | 56.7 / 76.4 | 4.3 | 16.6 / **49.9** / 66.5 | **203** | **127** | 16.6 / 16.7 / **50.0** |
| Pose Landmarker lite | MediaPipe CPU | **main** | 49.4 / 68.1 | 4.0 | 16.6 / **33.3** / 49.9 | **191** | **72** | 16.6 / 16.7 / **49.9** |
| _none_ (last run) | | | | | 16.6 / 16.7 / 16.8 | 0 | 0 | 16.6 / 16.7 / 16.8 |

About 2 400 frames were recorded per row. No run was over-budget on pictures: **no picture was
dropped** by the at-most-one-in-flight rule in any row.

### 5.2 The realistic world (the rung a rider opts into)

| Model | Backend | Where | Inference p50 / p95 | Frames p50 / p95 / p99 | > 20 ms | Harness p50 / p90 / p99 |
| --- | --- | --- | --: | --: | --: | --: |
| _none_ | | | | 16.6 / 16.7 / 16.8 | 0 | 16.6 / 16.7 / 16.8 |
| **Pose Landmarker lite** | **MediaPipe CPU** | **worker** | **65.8 / 80.6** | 16.6 / 16.7 / 16.8 | **0** | 16.6 / 16.7 / 16.8 |
| MoveNet Lightning | TF.js WASM | worker | 80.1 / 102.0 | 16.6 / 16.7 / 16.8 | 0 | 16.6 / 16.7 / 16.8 |

### 5.3 Why the same model costs three times as much at 5 per second

The paced inference times above are two to four times the burst times in §4. To tell what was
causing it, the same model was run in the same worker on an otherwise idle page, with the decode
taken out (`reuse`: one bitmap for every picture):

| Model (CPU, worker, idle page) | Burst p50 | 5 per s, fresh picture each time | 5 per s, same picture | **30 per s, same picture** |
| --- | --: | --: | --: | --: |
| MoveNet Lightning, TF.js WASM | 37.9 | 94.4 | 83.1 | **36.7** |
| Pose Landmarker lite, MediaPipe CPU | 29.7 | 78.0 | — | **29.0** |

The decode is not the cause (6.6 ms, and removing it moved 94 to 83). **The rate is the cause.** At
30 per second the paced number matches the burst. At 5 per second the same work takes 2.3 to 2.7
times as long. The likely mechanism is the CPU governor and scheduler: an 80 % idle thread is left
on a slow core or at a low clock. **That mechanism was not measured**, only the effect. Sampling
`scaling_cur_freq` over `adb` was too coarse to tell. The effect **shrinks beside the game**
(58–80 ms rather than 78–105), consistent with the renderer keeping the clocks up.

What this means for #530: the per-picture figure that belongs in a budget is the **paced one beside
the game**, not the burst one and not a published frame rate. #328's _"~34 FPS in-browser on Android"_
for MoveNet is a continuous frame rate, the kind of figure this section shows does not carry over to
5 per second.

### 5.4 Ten minutes beside the game

Pose Landmarker lite, MediaPipe CPU, in a worker, beside the stylised game, **600 s at 5 per
second**: 2 999 pictures, **none dropped**.

| Minute | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Inference p50 (ms) | 72.8 | 67.7 | 65.2 | 65.7 | 64.4 | 65.1 | 65.8 | 64.4 | 64.3 | 64.7 |
| Inference p95 (ms) | 87.7 | 82.0 | 79.2 | 79.9 | 79.8 | 79.7 | 79.0 | 79.2 | 77.7 | 79.6 |
| Frames > 20 ms | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Over the whole run: inference **65.8 / 80.9 / 86.6 ms** (p50 / p95 / p99), max 104.3 ms. Frames
16.6 / 16.7 / 16.8 ms over **36 071** frames, **none over 20 ms**, max 18.0 ms. Thermal status **0**
at every sample. `BIG` cluster 35–38 °C, battery 22.1 °C, on AC. Nothing drifted upward. The first
minute is the slowest. Ten minutes on a docked tablet is not #247's sixty on the device floor.

### 5.5 The same, inside the app's own WebView

The installed app (`dev.openzigs.onyourleft`, a debug build) has an inspectable WebView. Its page
was navigated over DevTools to the same test pages, then **navigated back to `https://localhost/`
afterwards**. User agent: `Mozilla/5.0 (Linux; Android 17; Pixel Tablet Build/CP2A.260705.006; wv)
… Chrome/153.0.8010.36`. The drawing buffer was 1600 × 2560, because the app runs full-screen.

| Model | Backend | Where | Page | Inference p50 / p95 | Frames p50 / p95 / p99 | > 20 ms |
| --- | --- | --- | --- | --: | --: | --: |
| Pose Landmarker lite | MediaPipe CPU | worker | idle: burst **30.1 / 32.0**, paced | 80.0 / 94.6 | 16.6 / 16.7 / 16.7 | 0 |
| MoveNet Lightning | TF.js WASM | worker | idle: burst **37.4 / 43.5**, paced | 95.9 / 120.3 | 16.6 / 16.7 / 16.7 | 0 |
| _none_ | | | stylised game | | 16.6 / 16.7 / 16.8 | 0 |
| **Pose Landmarker lite** | **MediaPipe CPU** | **worker** | stylised game | **68.0 / 83.0** | 16.6 / 16.7 / 16.7 | **0** |
| MoveNet Lightning | TF.js WASM | worker | stylised game | 80.3 / 101.2 | 16.6 / 16.7 / 16.8 | 0 |
| Pose Landmarker lite | MediaPipe CPU | **main** | stylised game | 77.2 / 87.7 | 16.6 / **66.5** / 83.1 | **198** |

**The WebView agrees with Chrome** within a few milliseconds on every row that was run in both.

**And here `dumpsys gfxinfo` does read the page**, which makes it the same instrument #323 used.
The counter was reset at the start of each of four runs, and each run is one page load plus 40 s
of riding. Milliseconds:

| Run, in order | Frames | Frame p50 / p90 / p95 / p99 | GPU p50 / p90 / p99 | Janky |
| --- | --: | --: | --: | --: |
| _none_ | 4 037 | 10 / 12 / 13 / 20 | 3 / 3 / 12 | 0.05 % |
| Pose Landmarker lite, CPU, worker | 4 037 | 13 / 22 / 22 / 23 | 4 / 13 / 15 | 0.10 % |
| MoveNet Lightning, WASM, worker | 4 035 | 13 / 21 / 22 / 24 | 4 / 12 / 16 | 0.12 % |
| _none_ | 4 035 | 12 / 18 / 22 / 23 | 3 / 9 / 15 | 0.07 % |

With a model in a worker the frame p50 was **13 ms**. The two controls read 10 and 12 ms. So the
model adds **1 to 3 ms at the p50**. At the p90 the two controls themselves differ by 6 ms, which is
as large as the model's apparent effect, so the p90 does not separate them. One run per row. These
frames are the harness's ride. #323 measured a live ride with a trainer and the HUD, and read
**24 ms** p50. This scene reads 10–12 ms, so the two are not the same load.

---

## 6. Against #323's 24 ms, and what share of the budget

[#323](https://github.com/openzigs/onyourleft/issues/323) measured **24 ms frame p50** during a live
ride on this tablet, with `dumpsys gfxinfo` on the app's WebView. ⚠️ **Most of this spike's frame
figures are a different measurement and must not be compared with that one as if they were the
same.** In §4, §5.1–§5.4 and most of §5.5, the frame figure is the interval between
`requestAnimationFrame` callbacks. That is vsync-paced and reads 16.6 ms whenever no frame is
missed, so it measures **whether a frame was missed**, not how much of the 16.7 ms the CPU used.
(`dumpsys gfxinfo com.android.chrome` reports Chrome's own browser UI rather than the page, so it
could not stand in for Chrome.) **The one like-for-like figure is §5.5's `gfxinfo` table, in the
app's WebView**, and its scene is lighter than #323's: 10–12 ms p50 with no model, against 24 ms.

What the figures do say:

- **In a worker on the CPU, the model cost the render thread no frames, measured.** Zero frames over
  20 ms in ~2 400 per run, the same as the no-model control, in both worlds, in Chrome and in the
  app's WebView, and in 36 071 frames over ten minutes. The harness's own p99 did not move. In
  `gfxinfo` terms the frame p50 rose from 10–12 ms to 13 ms. If that 1–3 ms carries over, #323's
  24 ms ride would still be under a 33 ms frame, **but that was not measured on #323's load.** The
  worker ran on another of the eight cores. What it costs is **one core for ~58–80 ms of every
  200 ms**: 29–40 % of one core at the p50, 37–51 % at the p95.
- **On the main thread, the model cannot fit at all.** 49–57 ms p50 per picture is **2.0–2.4 times
  #323's whole 24 ms frame**, or 3.0–3.4 times a 16.7 ms vsync. Every picture costs the ride two to
  four frames, which is what the 191–203 missed vsyncs in 40 s are.
- **On the GPU, it is not free either, despite #323's _"the GPU is idle"_.** MoveNet on WebGPU and
  MediaPipe's GPU delegate, both in a worker, were the only worker rows that cost the renderer frames:
  6–21 missed vsyncs for the small models and 121 for MoveNet Thunder. The CPU path was the one that
  did not touch the ride. This is the opposite of what #328's reasoning predicts, and it is measured
  on one device, in Chrome, with one scene.

⚠️ **Heat over a whole ride is the part this does not settle.** #247's 60-minute run on the device
floor has still not been done, so these numbers stack on a budget nobody has characterised over time.
§5.4 is ten minutes, not sixty, in Chrome, on a docked tablet on AC.

---

## 7. The candidate for #530, as a measurement

**MediaPipe Pose Landmarker lite, CPU delegate, in a Web Worker.** Of the configurations measured, it
was:

- the **cheapest per picture beside the ride** in both worlds (57.9 / 73.6 ms stylised, 65.8 / 80.6 ms
  realistic, p50 / p95), and in the app's own WebView (68.0 / 83.0 ms), steady over ten minutes;
- one of the configurations that **cost the ride no frames** (with MoveNet Lightning WASM and the
  full model);
- **Apache 2.0** in Google's own model card (§3);
- the one whose landmarks include the **heel and foot index**, which MoveNet's 17 COCO points do not.
  A sagittal ankle angle needs a foot segment. MoveNet stops at the ankle.

What it costs that the runner-up does not: **11 MB of WASM** (3.4 MB gzip) against TF.js's 0.42 MB,
plus a 5.78 MB model against 4.82 MB, all of which #530 would ship or fetch under
[ADR 0024](../adr/0024-offline-and-caching-posture.md)'s rules. It also needs a **classic** worker.
And the two-network `.task` bundle is the licence question §3 leaves for whoever commits it.

**Runner-up: MoveNet Lightning on TF.js WASM in a worker**: 79.0 / 98.0 ms beside the ride, no
frames lost, Apache 2.0 at Kaggle and in its card, a much smaller runtime, and 17 points with no
foot. Not TF.js WebGL, which returned wrong points on this GPU (§4).

This is a measurement of cost and licence. **It says nothing about which model resolves a knee angle
better from the side**, which is the question #385 exists to answer and could not answer today.

---

## 8. What was not measured, and why

| Not measured | Why |
| --- | --- |
| **Accuracy of any kind**: repeatability, the saddle-height perturbation, keypoint error | Nobody can ride today. There was no rider, no bicycle and no tripod phone. This is the half of #385 that remains |
| **Every configuration in the app's own WebView** | §5.5 ran the two leading models and one main-thread control there. The rest ran in Chrome only. Where both were run they agreed within a few milliseconds |
| **The app itself doing the analysis** | The WebView was pointed at the test page, **not at the app**. The product's ride, with a trainer connected, the HUD, the recorder and the ADR 0033 link all running, was not the load. §5 used the product's renderer and nothing else of the product |
| **#323's 24 ms load** | The one `gfxinfo` comparison (§5.5) is on a scene that reads 10–12 ms with no model. Whether a model adds the same 1–3 ms to a 24 ms ride is not measured |
| **The real capture path** | Pictures were one decoded JPEG, over and over. There was no camera, no phone, no [ADR 0033](../adr/0033-side-camera-link.md) link and no AES-GCM open per picture. The decode (about 4 ms beside the ride) is in the figures. The link's cost is not |
| **Memory, reliably** | `performance.memory` did not move from 9.5 MiB and is useless here. Peak RSS of the page's renderer process, sampled over `adb` every ~5 s, was 166–179 MiB with no model beside the stylised game and 211–307 MiB with one. The GPU process rose by ~150–240 MiB with a WebGPU model. Those are one sample each and noisy. Treat them as order of magnitude |
| **Multi-threaded WASM** | The page was not cross-origin isolated, like the shipped app, so no `SharedArrayBuffer` and every WASM runtime ran on one thread. With isolation, XNNPACK and ONNX Runtime can use more cores. That is a different budget and a different ADR 0024 question |
| **Other models**: MoveNet MultiPose, PoseNet, BlazePose heavy, ViTPose, RTMPose-s and larger, TFLite through a Capacitor plugin | Out of scope for a browser-path spike, or strictly slower than something measured, or AGPL (YOLO) |
| **Sixty minutes** | See §6. #247 |

---

## 9. How to reproduce

Nothing here is committed. The method, so it can be repeated:

1. Build the harness: `pnpm --filter @onyourleft/web exec vite build --config vite.browser.config.ts`.
2. In a directory outside the workspace, `npm install` `@tensorflow/tfjs-core`, `-converter`,
   `-backend-wasm`, `-backend-webgl`, `-backend-webgpu` (4.22.0), `@tensorflow-models/pose-detection`
   2.1.3, `@mediapipe/tasks-vision` 1.0.1 and `onnxruntime-web` 1.30.0. Bundle one page module and one
   **classic** worker with esbuild, aliasing `@mediapipe/pose` (an optional import of
   `pose-detection`) to an empty module.
3. Fetch the weights from the URLs in §3. The Kaggle archive URLs are
   `https://www.kaggle.com/api/v1/models/google/movenet/tfJs/singlepose-{lightning,thunder}/4/download`.
4. Serve the harness's `dist`, the bundles, the WASM directories and the weights from one origin on
   port 8385. Inject the page module into a copy of `realistic.html`. Pass its settings in the
   **hash**, because the harness refuses unknown query parameters.
5. `adb reverse tcp:8385 tcp:8385`, open a Chrome tab on the tablet, `adb forward tcp:9222
   localabstract:chrome_devtools_remote`, and drive the tab with `Page.navigate`. `/json/new` is
   refused by Chrome on Android. Post each run's JSON back to the server.
6. For §5.5, forward `localabstract:webview_devtools_remote_<pid>` for the app (a debug build),
   bring it to the foreground (a backgrounded app's DevTools socket does not answer), navigate its
   page the same way, and **navigate it back to `https://localhost/`** afterwards. Reset
   `dumpsys gfxinfo dev.openzigs.onyourleft` before each run and read it after.
7. Keep the screen on for the session with `svc power stayon true` and **put it back afterwards**.
   `settings put global stay_on_while_plugged_in 0` was the value found, and was restored, as were
   the `adb reverse` and `adb forward` rules. Nothing was installed on the tablet.
