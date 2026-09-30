// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Nothing the ride analysis is made of can reach a trainer** — #811's
 * criterion, the twin of `camera/side-report-safety.test.ts` for the runner.
 *
 * A model's reply is untrusted input (ADR 0029 D-8), and CLAUDE.md §6 treats
 * trainer control as a safety issue: the path from a reply to a write-up must
 * not pass anything that can write to a machine. So every module under
 * `ride-analysis/` — derived from the directory, not listed, so a module #802
 * or #803 adds there is walked the day it lands — is walked transitively, and
 * must reach no module through which a trainer is written.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importWalk, readFromDisk, SOURCE_ROOT } from '../camera/import-walk-testing';

/** The modules through which anything reaches a trainer's control point — as the report's walk names them. */
const TRAINER_MODULE =
  /(?:^|\/)(?:ride\/(?:controller|trainer|RideSession)|game\/(?:gradient|trainer-port|GameView)|workout\/)|@onyourleft\/sensors/;

/** Every non-test module under `ride-analysis/`. */
const ANALYSIS_MODULES = readdirSync(join(SOURCE_ROOT, 'ride-analysis'))
  .filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-testing\.tsx?$/.test(name),
  )
  .map((name) => `ride-analysis/${name}`)
  .sort();

function trainerModulesReachedFrom(
  walk: ReturnType<typeof importWalk>,
  roots: readonly string[],
): readonly string[] {
  const { modules, bare } = walk.closure(roots);
  return [...modules, ...bare].filter((path) => TRAINER_MODULE.test(path.replace(/\.tsx?$/, '')));
}

describe('the ride analysis reaches no trainer (#811, CLAUDE.md §6)', () => {
  it('walks the runner and its port, so the walk is not over nothing', () => {
    expect(ANALYSIS_MODULES).toEqual(
      expect.arrayContaining([
        'ride-analysis/runner.ts',
        'ride-analysis/model-step-port.ts',
        'ride-analysis/template.ts',
        'ride-analysis/input.ts',
        'ride-analysis/own-computer-step.ts',
        // #804: the ask, its port and the press on the ride's page.
        'ride-analysis/ride-analysis.ts',
        'ride-analysis/ride-analysis-port.ts',
        'ride-analysis/RideWriteUpControl.tsx',
      ]),
    );
    // And past one level: the runner reaches the screen's matchers through the screen.
    expect(importWalk().closure(['ride-analysis/runner.ts']).modules).toContain(
      'camera/angle-claims.ts',
    );
  });

  it('imports, directly or through anything it imports, no module that writes to a trainer', () => {
    expect(trainerModulesReachedFrom(importWalk(), ANALYSIS_MODULES)).toStrictEqual([]);
  });

  it('goes red on a planted import of the ride controller, however far down', () => {
    // The runner's own source with one line added, and — separately — the same
    // line two modules away, in the screen it imports.
    const planted = (target: string) => (path: string) => {
      const source = readFromDisk(path);
      return path === target && source !== undefined
        ? `${source}\nimport { createRideController } from '../ride/controller';\n`
        : source;
    };
    // #802: and in the step port to the rider's own computer.
    for (const target of [
      'ride-analysis/runner.ts',
      'camera/write-up-screen.ts',
      'ride-analysis/own-computer-step.ts',
      // #804: the ask and the press.
      'ride-analysis/ride-analysis.ts',
      'ride-analysis/RideWriteUpControl.tsx',
    ]) {
      expect(
        trainerModulesReachedFrom(importWalk(planted(target)), ANALYSIS_MODULES),
        target,
      ).toContain('ride/controller.ts');
    }
  });
});
