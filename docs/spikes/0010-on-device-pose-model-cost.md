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

⚠️ **This follows ADR 0033 D-6, which says the analysis runs _during_ the ride** (nothing is shown
until after it). #385's 2026-09-25 comment asks for the cost _"with the renderer idle (analysis is
post-ride)"_, and #530's acceptance criterion still reads _"Analysis runs **after the ride**, never
during it"_. Both predate ADR 0033 ([#533](https://github.com/openzigs/onyourleft/pull/533)), whose
own table of what it changes in #530 says the during-the-ride ruling replaces that criterion. So the
budget below is the during-the-ride one. **If #530 is instead built as a post-ride batch**, pictures
would be processed back to back and the **burst** figures in §4 (29–38 ms for the cheapest models)
are the ones to budget with, not the paced ones. That would reverse §5.3's advice.

**Yes, on both counts, with one condition.** Every model measured ran at 5 pictures a second beside
the game with **at most one frame over 20 ms in about 2 400** and a harness p99 of 16.8 ms, **as long as it ran in a Web
Worker on the CPU**. The same model on the page's main thread missed a vsync 191–203 times in 40 s.
The cheapest beside the ride was **MediaPipe Pose Landmarker lite on its CPU (XNNPACK/WASM)
delegate**. Over the **ten-minute soak** beside the stylised game it read **65.8 ms p50 and 80.9 ms
p95** per picture (§5.4), and that is the figure to budget with. Its best single 40 s run read 57.9 /
73.6 ms (§5.1). It read 65.8 / 80.6 ms in the realistic world and 68.0 / 83.0 ms inside the app's own
WebView. **MoveNet Lightning on TF.js WASM** came second, at 79.0 / 98.0 ms. **Within** the
ten-minute soak nothing drifted upward after the first minute, in inference time or in frames, and
the tablet stayed at thermal status 0. Across runs the same configuration differed by about 14 % at
the p50 (57.9 against 65.8 ms). MoveNet's
weights licence, which [#328](https://github.com/openzigs/onyourleft/issues/328) left unconfirmed, is
**Apache 2.0 at Google's own Kaggle model page and in Google's own model card** (§3). BlazePose's
(MediaPipe's) is Apache 2.0 in its model card. RTMPose's weights have **no licence statement at the
source** and fail closed.

⚠️ **One number here surprised us, and it matters to #530.** The same inference costs **2.3 to 2.7
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
| **Picture rate** | **5 per second** from a `setInterval`. Each tick decodes the JPEG with `createImageBitmap` (as a picture arriving over ADR 0033's link would be decoded) and runs the model. At most one picture in flight. A tick that finds the model busy is counted as dropped. **No tick was dropped in any run**. ⚠️ This is not quite ADR 0033 D-6's rule, which allows one picture **waiting** as well as the one in flight, with a newer arrival replacing the waiting one. The harness kept none waiting. Nothing was dropped, so no figure here would change, but it is not the pipeline #530 will build |
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
| **MediaPipe Pose Landmarker lite / full** (BlazePose GHUM 3D, Google) | **Google's model card** ([PDF](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), the one [the Pose Landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) links as its model card, dated _"April, 16, 2021"_): _"LICENSED UNDER Apache License, Version 2.0"_. The `.task` files were fetched from `storage.googleapis.com/mediapipe-models/pose_landmarker/…/float16/latest/`, the URLs that guide gives | `@mediapipe/tasks-vision` **1.0.1**, **Apache-2.0**. The [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) repository's `LICENSE` is Apache 2.0 | **Permissive. Admissible anywhere.** ⚠️ The `.task` bundle holds **two** networks (`pose_detector.tflite`, `pose_landmarks_detector.tflite`). The card names BlazePose and GHUM and does not list the detector file by name. A reviewer committing one should decide whether that is enough, which is a narrower question than #328's. Evidence found in review, both ways. **Against**: the card describes the **landmark** network only. Its inputs are _"Regions in the video frames where a person has been detected"_, and its sizes (_"Lite (3MB size), Full (6 MB size) and Heavy (26 MB size)"_) match `pose_landmarks_detector.tflite` at 2.82 / 6.44 MB, not the bundle. The build strings embedded in the two networks, `blazepose_ghum_39kp_lite_oss_2021_07_02` and `blazepose_detector_eff_retina_4kp_sparse_…_2021_10_18`, are **both dated after the card's April 16, 2021**, so the card cannot have named these exact bytes. **For**: Google's own legacy index, `google-ai-edge/mediapipe` `docs/solutions/models.md` §Pose, lists the _"Pose detection model"_ (`storage.googleapis.com/mediapipe-assets/pose_detection.tflite`) with the landmark models under one _"Model card"_ link (`mediapipe.page.link/blazepose-mc`). That is first-party evidence that Google files the detector under this card. The standalone file is 2 959 046 bytes against the bundled 2 959 078, so the two are probably one network with different metadata. **That was not verified.** The question stays with whoever commits the file, under `ASSET004` |
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

SHA-256 of what was fetched, so a later reader can tell whether they are measuring the same bytes.
After review every file was fetched again on 2026-09-25 and re-hashed, and each matched the bytes
that were measured. ⚠️ An earlier version of this paragraph abbreviated the digests and misprinted the
lite `.task`'s as ending `…0574a`. The full digests:

| File | Bytes | SHA-256 |
| --- | --: | --- |
| MoveNet Lightning TF.js archive (v4) | 4 333 929 | `28b9a96dde847d2c5dd0d44ddd131d6dfd388b8a014a4535dc31b4059ce61765` |
| MoveNet Thunder TF.js archive (v4) | 11 599 609 | `9ab8399bc82cd3c5cc0b61ea3b397512b73dde920590ac869872637eff97e522` |
| `pose_landmarker_lite.task` | 5 777 746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `pose_landmarker_full.task` | 9 398 198 | `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` |
| RTMPose-t ONNX SDK zip | 12 547 710 | `937003a70832d9cc34ea16927f504792f3133e92dda1b9c626236bbbe9e805cb` |

⚠️ The MediaPipe URLs end in `latest/`, so the same URL can serve other bytes later.

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

⚠️ **TF.js's WebGL backend returned far fewer confident points for MoveNet on this GPU.** On the one
test picture Lightning returned 5 of 17 points above the 0.3 confidence threshold, and Thunder 0,
where the WASM and WebGPU backends returned 17 of 17. That is a count of confident points on one
picture, not a measured position error. For Lightning, WebGL was also the slowest backend (52.7 ms
burst against 29.0–29.7). For Thunder it was not: 63.0 ms burst, faster than WASM's 101.9 though
slower than WebGPU's 52.2. It may be a precision problem in the WebGL path on the Mali-G710. The
cause was not investigated. **Do not use TF.js WebGL for MoveNet on this device.**

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

### 5.3 Why the same model costs 2.3 to 2.7 times as much at 5 per second

The paced inference times beside the game in §5.1 are about 1.4 to 2.7 times the burst times in §4:
Lightning WASM 79.0 / 29.0 = 2.7, Pose Landmarker lite 57.9 / 29.1 = 2.0, full 76.2 / 43.7 = 1.7,
RTMPose-t 67.2 / 45.3 = 1.5, Thunder WebGPU 73.1 / 52.2 = 1.4. The effect is largest for the smallest
models, which is what a governor clocking down between short bursts of work would produce. To tell what was
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
model **appears** to add 1 to 3 ms at the p50. At the p90 the two controls themselves differ by 6 ms,
which is as large as the model's apparent effect, so the p90 does not separate them. **Nor does the
p95**: the second control reads 22 there, the same as both model rows. ⚠️ Read the 1–3 ms with four
caveats. (1) About 4 036 frames at 60 Hz is about 67 s, so each counter window also holds the page
load and roughly 27 s outside the 40 s inference window, which dilutes the model's share. (2) The
controls drifted from 10 to 12 ms between the first run and the last, and a 1–3 ms effect is at the
level of that drift. (3) There is one run per row. (4) So "1 to 3 ms" is a reading of one sample
each, not a firm result. These
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
  worker presumably ran on another core. No affinity or per-core load was sampled, and the Tensor
  G2's cores are not alike (2 + 2 + 4), so which cluster it landed on is exactly what §5.3 suspects
  decides the cost. What it costs is **one core for ~58–80 ms of every
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

- the **cheapest per picture beside the ride** in both worlds: 65.8 / 80.9 ms p50 / p95 over the
  ten-minute soak in the stylised world (57.9 / 73.6 ms in its best 40 s run), 65.8 / 80.6 ms in the
  realistic world, and 68.0 / 83.0 ms in the app's own WebView, with no upward drift within the
  soak;
- one of the configurations that **cost the ride no frames** (with MoveNet Lightning WASM and the
  full model);
- **Apache 2.0** in Google's own model card (§3);
- the one whose landmarks include the **heel and foot index**, which MoveNet's 17 COCO points do not.
  A sagittal ankle angle needs a foot segment. MoveNet stops at the ankle.

What it costs that the runner-up does not: **11 MB of WASM** (3.4 MB gzip) against TF.js's 0.42 MB,
plus a 5.78 MB model against 4.82 MB. The size gap between the two candidates is **mostly the
runtime, not the model**. It also needs a **classic** worker. And the two-network `.task` bundle is
the licence question §3 leaves for whoever commits it.

⚠️ **Two consequences #530 has to decide rather than inherit:**

- **The precache.** [ADR 0024](../adr/0024-offline-and-caching-posture.md) D-2 derives the precache
  from the build's output (`apps/web/tools/precache/precache.ts`), and its only exclusions are
  `.map`, `sw.js` and `realistic/`. So an 11.0 MB `vision_wasm_internal.wasm` and a 5.78 MB `.task`
  placed in `dist` would be precached for **every** rider on their first visit, camera or not, with
  no edit anywhere. ADR 0024 records the whole first visit today as 1 363 395 bytes on the wire.
  About 3.4 MB of gzipped WASM plus about 5.5 MB of float16 weights, which barely compress, is
  roughly a seven-fold increase. That is the trade [ADR 0026](../adr/0026-realistic-game-world.md)
  D-7 made an explicit exclusion for, and #530 has to make it one way or the other on purpose.
- **The origin.** The runtime and the weights must be served from **the app's own origin**. They must
  never be fetched from a CDN (MediaPipe's `FilesetResolver.forVisionTasks` is normally pointed at
  jsDelivr) or from the guide's `storage.googleapis.com/…/latest/` model URLs. Either would be
  off-device egress under the no-network promise (`apps/web/src/privacy/no-network.test.ts`
  §`PERMITTED_NETWORK_CALLS`), and a `latest/` URL cannot be pinned (§3). Self-hosting makes the
  WASM a committed binary or a build output, with its own `ASSETS.toml` / `ASSET001` consequences.

**Runner-up: MoveNet Lightning on TF.js WASM in a worker**: 79.0 / 98.0 ms beside the ride, no
frames lost, Apache 2.0 at Kaggle and in its card, a much smaller runtime, and 17 points with no
foot. Not TF.js WebGL, which returned 5 and 0 of 17 points above threshold on this GPU where the
other backends returned 17 (§4).

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
