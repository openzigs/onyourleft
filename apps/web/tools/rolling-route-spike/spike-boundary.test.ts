// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882: the spike lands no product code. Its acceptance criterion is that no
 * prototype code lands on `main` as product code, so:
 *
 * - **Nothing the app ships names this directory.** No module under
 *   `apps/web/src/` that is not a test, so Vite, which bundles from
 *   `index.html`, never reaches it.
 * - **No spike module reaches a trainer module** by any static import chain
 *   (the epic's hard rule: nothing on an import path that can reach the
 *   trainer), by the walk `lap-race-cannot-reach-trainer.test.ts` uses.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  forbiddenInTheTree,
  modulesUnder,
  seamViolations,
  walk,
} from '../../src/game/cannot-reach-trainer-testing';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const SPIKE = 'apps/web/tools/rolling-route-spike';

/** Every module under `apps/web/src`, tests and test support left out. */
function shipped(directory = 'apps/web/src'): string[] {
  return readdirSync(join(REPOSITORY, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) return shipped(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe('the rolling-route spike’s boundary (#2882)', () => {
  it('is imported by no module the app ships', () => {
    const modules = shipped();
    expect(modules.length).toBeGreaterThan(500);
    const naming = modules.filter((path) =>
      readFileSync(join(REPOSITORY, path), 'utf8').includes('rolling-route-spike'),
    );
    expect(naming).toEqual([]);
  });

  it('reaches no trainer module from any spike module, by any static import chain', () => {
    // The build's config is not a module of the spike's: it names the page's directory.
    const roots = modulesUnder(SPIKE).filter((path) => !path.endsWith('/vite.config.ts'));
    expect(roots).toContain(`${SPIKE}/rolling-profile.ts`);
    expect(roots).toContain(`${SPIKE}/page/main.ts`);
    expect(roots).toContain(`${SPIKE}/page/plan-worker.ts`);
    const { modules } = walk(roots);
    // Not vacuous: the walk went through the renderer and the planners the page drives.
    expect(modules).toContain('apps/web/src/game/three-renderer.ts');
    expect(modules).toContain('apps/web/src/game/footprint-buildings.ts');
    expect(seamViolations(roots, forbiddenInTheTree())).toEqual([]);
  });
});
