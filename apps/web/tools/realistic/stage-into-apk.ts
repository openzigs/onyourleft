// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Put the owner's realistic page into a LOCAL debug APK — ADR 0026 D-12.
 *
 * ```bash
 * pnpm run build                                        # the product, into apps/web/dist
 * pnpm --filter @onyourleft/web run realistic:stage     # the harness, into apps/web/dist/harness/
 * ```
 *
 * then `cap sync android`, `gradlew assembleDebug` and `adb install`, and open
 * `/harness/realistic.html` in the app's own WebView with
 * `apps/mobile/tools/webview-probe.mjs` — `docs/validation/0002-android-shell-and-game.md`
 * Part Z has every command in order.
 *
 * ## Why this is the way the owner reaches it, and not a switch in the app
 *
 * D-12 decided it: *"reachable only from a harness page under `apps/web/browser/`
 * … and from no control in the shipped app"*, because *"there is no 'debug
 * build' of the web client to hide it behind, and the Android debug APK wraps
 * the same `apps/web/dist`"*. A hidden `localStorage` flag — the shape
 * `quality.ts` §`RIDER_SHADOW_MAP_STORAGE_KEY` takes for the shadow map — was
 * the other candidate, and it was not taken: it would be a way into a
 * half-built world from the shipped app, reachable by anybody who read the
 * source, which is exactly what D-12 closes.
 *
 * So: the product build, plus the harness build copied under `/harness/`,
 * synced into a **debug** APK on the developer's machine only. #457's spike
 * reached the tablet the same way and the owner ran it.
 *
 * ⚠️ **It cannot reach a rider by accident, for three separate reasons**:
 * `apps/web/dist` is ignored, so nothing staged can be committed; the next
 * `pnpm run build` empties `dist`, so nothing staged outlives the next build;
 * and `release.yml` builds a release from a clean checkout, which has never
 * had this run in it. The service worker is not in the way inside the shell —
 * it does not register there (ADR 0024 D-4).
 *
 * The harness build carries its own copy of `public/`, realistic set included
 * (`vite.browser.config.ts` §`publicDir`), so a staged debug APK is about
 * 31 MiB larger than the product's own: a local cost, on a build that ships to
 * nobody.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(WEB, 'dist');
/** Where in the app the harness is served from. */
const STAGED = 'harness';

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`build the product first (pnpm run build): ${DIST} has no index.html`);
  }
  const staging = mkdtempSync(join(tmpdir(), 'oyl-harness-'));
  try {
    const build = spawnSync(
      'pnpm',
      [
        'exec',
        'vite',
        'build',
        '--config',
        'vite.browser.config.ts',
        '--base',
        `/${STAGED}/`,
        '--outDir',
        staging,
        '--emptyOutDir',
      ],
      { cwd: WEB, stdio: 'inherit' },
    );
    if (build.status !== 0) throw new Error('the harness build failed');
    rmSync(join(DIST, STAGED), { recursive: true, force: true });
    cpSync(staging, join(DIST, STAGED), { recursive: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(
    `staged: ${join(DIST, STAGED, 'realistic.html')} — open it in the app as /${STAGED}/realistic.html`,
  );
}

if (process.argv[1]?.endsWith('stage-into-apk.ts') === true) {
  main();
}
