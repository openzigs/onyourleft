# Spike 0024's code and results (never merged)

The write-up is `docs/spikes/0024-webgpu-renderer-on-the-realistic-world.md` on `main`. This branch
holds what made its numbers. **It is not merged and must not be.**

- `apps/web/browser/webgpu.html`, `apps/web/browser/webgpu/`, `apps/web/vite.webgpu.config.ts`: the
  harness page, the `three` shim that swaps the renderer, the optional layers, and the two
  one-renderer builds for the JavaScript size.
- `apps/web/src/game/spike-0024-nodes.ts` and the patch to `three-renderer.ts`: the TSL ports.
- `apps/mobile/android/app/build.gradle`, `strings.xml`: the spike APK's own application id,
  `dev.openzigs.onyourleft.webgpuspike`, so it installs beside the app and never over it.
- `spike-0024/scripts/`: `serve.sh` + `mac.sh` + `run.mjs` (the Mac set), `mac-table.py`,
  `js-size.mjs` (W7), `gate-probe.mjs` (the browser gate's browser), `count-move.py` (the cost of a
  move), and `tablet/` (`build.sh`, `chain.sh`, `chain2.sh`, `run.sh`, `cool.sh`, `coldstart.sh`,
  `analyse.py`, `table.py`, the W1 probe and the frame counter).
- `spike-0024/results/`: `mac/` (the one sitting that counts; `sitting-1-discarded.txt` is the
  console of the sitting that was thrown away; its JSON files were overwritten by the second sitting and are not kept), `mac-first-paint/`, `tablet/` (one directory a run;
  `latency.txt.gz` is SurfaceFlinger's raw present times), `js-size.txt`, `gate-probe.txt`,
  `count-move.txt`, `screenshots-sha256.txt`.

**No image is in this branch** (owner ruling, 2026-10-12). The screenshots are on the Mac that made
them, outside the repository, and the write-up names each with its SHA-256.
