// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Nothing on the side camera's report path can reach a trainer** — #388's
 * criterion: *"no trainer control point, no ERG target and no resistance
 * setpoint is reachable from anything on this path. A test asserts it."*
 *
 * The report is read off pictures, and a picture is attacker-influenceable: a
 * sign held up in front of the camera, a pattern on a jersey. CLAUDE.md §6
 * treats trainer control as a safety issue, so the path from a picture to a
 * sentence on a ride's page must not pass anything that can write to a
 * machine. `analysis-safety.test.ts` makes the same argument for #387's
 * answer; this is its twin for the report.
 *
 * Two holds:
 *
 * 1. **The module graph.** Walking every relative import from each module on
 *    the path, transitively, reaches no module through which a trainer is
 *    written — `ride/controller`, `ride/trainer`, `game/gradient`,
 *    `game/trainer-port`, anything under `workout/`, or `@onyourleft/sensors`.
 *    The keeper reads the ride controller's snapshot through an interface it
 *    declares itself for exactly this reason.
 * 2. **The page.** The section renders no control at all
 *    (`detail/SideCameraSection.test.tsx`), so there is nothing on it to press.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importWalk, SOURCE_ROOT, specifiersIn } from './import-walk-testing';

/** Every module a side-camera report passes through, from pose numbers to the page. */
const REPORT_PATH = [
  'camera/side-report.ts',
  'camera/side-report-wording.ts',
  'camera/side-report-port.ts',
  'camera/side-report-keeper.ts',
  // #801: the pose summary's type, on the path from the report to the store.
  'camera/side-session-summary.ts',
  'detail/load.ts',
  'detail/SideCameraSection.tsx',
] as const;

/** The modules through which anything reaches a trainer's control point. */
const TRAINER_MODULE =
  /(?:^|\/)(?:ride\/(?:controller|trainer|RideSession)|game\/(?:gradient|trainer-port|GameView)|workout\/)|@onyourleft\/sensors/;

/**
 * The walk, shared with `no-picture-reachable.test.ts` since #799 —
 * `import-walk-testing.ts` is where it lives and says what it cannot see.
 */
const { closure } = importWalk();

describe('the report path reaches no trainer (#388, CLAUDE.md §6)', () => {
  it('has the modules it names, so the walk is not over nothing', () => {
    for (const path of REPORT_PATH) {
      expect(existsSync(join(SOURCE_ROOT, path)), path).toBe(true);
    }
    // The walk follows imports: the section reaches the wording file.
    expect(closure(['detail/SideCameraSection.tsx']).modules).toContain(
      'camera/side-report-wording.ts',
    );
    // And the keeper reaches the summary it writes (#801).
    expect(closure(['camera/side-report-keeper.ts']).modules).toContain(
      'camera/side-session-summary.ts',
    );
  });

  it('imports, directly or through anything it imports, no module that writes to a trainer', () => {
    const { modules, bare } = closure(REPORT_PATH);
    const reaching = [...modules, ...bare].filter((path) =>
      TRAINER_MODULE.test(path.replace(/\.tsx?$/, '')),
    );
    expect(reaching).toStrictEqual([]);
  });

  it('would notice a module on the path that did', () => {
    // The pattern is the rule; a pattern that matched nothing would pass above.
    for (const specifier of [
      'ride/controller',
      'ride/trainer',
      'game/gradient',
      'game/trainer-port',
      'workout/session',
      '@onyourleft/sensors/protocol',
    ]) {
      expect(TRAINER_MODULE.test(specifier), specifier).toBe(true);
    }
  });

  it('follows every spelling of an import, a dynamic one included (#561’s review)', () => {
    expect(
      specifiersIn(
        [
          "import { a } from './static';",
          "import './side-effect';",
          "export { b } from './re-export';",
          "const lazy = await import('../ride/controller');",
          "const spaced = import( './spaced' );",
        ].join('\n'),
      ),
    ).toStrictEqual(['./static', './side-effect', './re-export', '../ride/controller', './spaced']);
  });

  it('would notice it through an import two steps away, not only a direct one', () => {
    // `side-analysis.ts` is NOT on the path — it holds pictures — and it
    // reaches the link, which is how a walk proves it goes past one level.
    expect(closure(['camera/side-analysis.ts']).modules.size).toBeGreaterThan(3);
  });
});
