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
 * must reach no module through which a trainer is written. Since #1094 the
 * runner, the templates and the screen are in `@onyourleft/analysis`, and
 * every module of that package is walked too, by the same derivation.
 */

import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_ROOT,
  importWalk,
  readFromDisk,
  SOURCE_ROOT,
} from '../camera/import-walk-testing';

/** The modules through which anything reaches a trainer's control point — as the report's walk names them. */
const TRAINER_MODULE =
  /(?:^|\/)(?:ride\/(?:controller|trainer|RideSession)|game\/(?:gradient|trainer-port|GameView)|workout\/)|@onyourleft\/sensors/;

/** Every non-test module under `directory`, a path from `src`, at any depth. */
function modulesUnder(directory: string): string[] {
  return readdirSync(join(SOURCE_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      return modulesUnder(path);
    }
    return /\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !/(?:^|-)testing\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Every non-test module under `ride-analysis/`, and every one of `@onyourleft/analysis` (#1094). */
const ANALYSIS_MODULES = [...modulesUnder('ride-analysis'), ...modulesUnder(ANALYSIS_ROOT)].sort();

function trainerModulesReachedFrom(
  walk: ReturnType<typeof importWalk>,
  roots: readonly string[],
): readonly string[] {
  const { modules, bare } = walk.closure(roots);
  return [...modules, ...bare].filter((path) => TRAINER_MODULE.test(path.replace(/\.tsx?$/, '')));
}

describe('the ride analysis reaches no trainer (#811, CLAUDE.md §6)', () => {
  it('walks the templates, the input and the instance ask, so the walk is not over nothing', () => {
    // #1103 removed the device's own runner and its port, and the ask and the
    // press that started it (`runner.ts`, `model-step-port.ts`,
    // `own-computer-step.ts`, `ride-analysis.ts`, `RideWriteUpControl.tsx`).
    // What is left builds a ride's input and screens a write-up, and the
    // instance's ask (#1102) is the one press.
    expect(ANALYSIS_MODULES).toEqual(
      expect.arrayContaining([
        `${ANALYSIS_ROOT}/template/template.ts`,
        `${ANALYSIS_ROOT}/input.ts`,
        `${ANALYSIS_ROOT}/screen/write-up-screen.ts`,
        'ride-analysis/instance-analysis.ts',
        'ride-analysis/InstanceWriteUpControl.tsx',
      ]),
    );
    // And past one level: a template reaches the screen's matchers through the screen.
    expect(importWalk().closure([`${ANALYSIS_ROOT}/template/template.ts`]).modules).toContain(
      `${ANALYSIS_ROOT}/screen/angle-claims.ts`,
    );
  });

  it('imports, directly or through anything it imports, no module that writes to a trainer', () => {
    expect(trainerModulesReachedFrom(importWalk(), ANALYSIS_MODULES)).toStrictEqual([]);
  });

  // #1487: it walks the whole tree once per planted target, five walks, so it
  // grows with the tree. Under coverage in the Nightly heavy checks this FILE
  // took 3 580, 3 664 and 4 742 ms green (runs 39357862473, 39360199189,
  // 39330750143) and this case passed Vitest's 5 s default, the file at 6 621,
  // 6 686 and 6 896 ms (39323488275, 39327178765, 39398792602); 383 ms locally
  // without coverage. So about three times the slowest of all of those, as
  // docs/agents/ci.md §4c asks. It is a timeout, not a performance claim.
  it('goes red on a planted import of the ride controller, however far down', () => {
    // A template's own source with one line added, and — separately — the
    // same line two modules away, in the screen it imports.
    const planted = (target: string) => (path: string) => {
      const source = readFromDisk(path);
      // The specifier is relative to the planted module, wherever it is (#1094).
      const controller = posix.relative(
        posix.join(SOURCE_ROOT, posix.dirname(target)),
        posix.join(SOURCE_ROOT, 'ride/controller'),
      );
      return path === target && source !== undefined
        ? `${source}\nimport { createRideController } from '${controller}';\n`
        : source;
    };
    // And in the instance's ask and its press (#1102).
    for (const target of [
      `${ANALYSIS_ROOT}/template/template.ts`,
      `${ANALYSIS_ROOT}/screen/write-up-screen.ts`,
      'ride-analysis/instance-analysis.ts',
      'ride-analysis/InstanceWriteUpControl.tsx',
    ]) {
      expect(
        trainerModulesReachedFrom(importWalk(planted(target)), ANALYSIS_MODULES),
        target,
      ).toContain('ride/controller.ts');
    }
  }, 20_000);
});
