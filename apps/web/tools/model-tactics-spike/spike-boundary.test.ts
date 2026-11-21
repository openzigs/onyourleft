// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: the spike stays out of the shipped bundle and the ride path, and
 * cannot reach the trainer.
 *
 * - **Nothing the app ships imports it.** No module under `apps/web/src/`
 *   that is not a test names this directory, so Vite, which bundles from
 *   `index.html`, never reaches it. Since #2710 no test under `src/` names
 *   it either: `lap-race-wiring.test.tsx` rides its model-mode cases through
 *   the shipped race (`src/game/lap-race/model-race.ts`).
 * - **No spike module reaches a trainer module** by any static import chain:
 *   the walk `lap-race-cannot-reach-trainer.test.ts` uses, over the spike's
 *   own modules, which reach the race step under `src/` in turn. That file is
 *   not changed by #2616.
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
const SPIKE = 'apps/web/tools/model-tactics-spike';

/** Every module under `apps/web/src`, tests and test support left out. */
function shipped(directory = 'apps/web/src'): string[] {
  return readdirSync(join(REPOSITORY, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) return shipped(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe('the model-tactics spike’s boundary (#2616)', () => {
  it('is imported by no module the app ships', () => {
    const modules = shipped();
    expect(modules.length).toBeGreaterThan(500);
    const naming = modules.filter((path) =>
      readFileSync(join(REPOSITORY, path), 'utf8').includes('model-tactics-spike'),
    );
    expect(naming).toEqual([]);
  });

  it('reaches no trainer module from any spike module, by any static import chain', () => {
    const roots = modulesUnder(SPIKE);
    expect(roots).toContain(`${SPIKE}/adapter.ts`);
    expect(roots).toContain(`${SPIKE}/live.ts`);
    // #2838: the scoring harness is under the same roof, and held to the same rule.
    expect(roots).toContain(`${SPIKE}/harness/main.ts`);
    const { modules } = walk(roots);
    // Not vacuous: the walk went through the race step the adapter rides,
    // and the pacer's director the harness rides.
    expect(modules).toContain('apps/web/src/game/lap-race/ride-race.ts');
    expect(modules).toContain('apps/web/src/game/model-pacer.ts');
    expect(seamViolations(roots, forbiddenInTheTree())).toEqual([]);
  });
});
