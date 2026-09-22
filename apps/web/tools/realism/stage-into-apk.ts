// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Put the realism spike page into a LOCAL debug APK's web assets — #457.
 *
 * ```bash
 * pnpm run build                                  # the product, into apps/web/dist
 * node apps/web/tools/realism/stage-into-apk.ts   # the spike, into apps/web/dist/spike/
 * ```
 *
 * then `cap sync android`, `gradlew assembleDebug` and `adb install`, and open
 * the page with `apps/mobile/tools/webview-probe.mjs` — the spike write-up
 * §"Build and install" has every command in order.
 *
 * ## Why a staged debug APK, and not a route in the app or Chrome on the tablet
 *
 * - **Not Chrome.** What #431 decides is what the APP can draw, and the app is
 *   a WebView: the same engine as Chrome, but a different process, a different
 *   compositor path and different flags. `dumpsys gfxinfo` is read against the
 *   app's own package. A Chrome number would be a number about another program.
 * - **Not a route in the product.** A debug-only route is still product code:
 *   it is in `index.html`'s module graph, in the precache, and in every build
 *   whether or not anybody sets the flag. The spike must not change the
 *   product's default path at all, so the page is never in the product build.
 * - **So: the product build, plus the spike's harness build copied under
 *   `/spike/`, synced into a DEBUG APK on the developer's machine only.** The
 *   staged files never reach the repository (`apps/web/dist` is ignored) and
 *   never reach a release (`release.yml` builds from a clean checkout). The
 *   next `pnpm run build` empties `dist` and the spike is gone.
 *
 * The service worker is not in the way: it refuses to register inside the
 * Android shell (ADR 0024 D-4), so `/spike/realism.html` is served straight
 * from the APK's assets by Capacitor.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(WEB, 'dist');

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`build the product first (pnpm run build): ${DIST} has no index.html`);
  }
  if (!existsSync(join(WEB, 'tools', 'realism', 'build', 'processed', 'manifest.json'))) {
    throw new Error('fetch and process the assets first: fetch-assets.ts, then process-assets.ts');
  }
  const staging = mkdtempSync(join(tmpdir(), 'oyl-realism-'));
  const build = spawnSync(
    'pnpm',
    [
      'exec',
      'vite',
      'build',
      '--config',
      'vite.browser.config.ts',
      '--base',
      '/spike/',
      '--outDir',
      staging,
      '--emptyOutDir',
    ],
    { cwd: WEB, stdio: 'inherit' },
  );
  if (build.status !== 0) throw new Error('the harness build failed');
  rmSync(join(DIST, 'spike'), { recursive: true, force: true });
  cpSync(staging, join(DIST, 'spike'), { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  console.log(
    `staged: ${join(DIST, 'spike', 'realism.html')} — open it in the app as /spike/realism.html`,
  );
}

if (process.argv[1]?.endsWith('stage-into-apk.ts') === true) {
  main();
}
