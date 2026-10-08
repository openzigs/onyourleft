// SPDX-License-Identifier: Apache-2.0

/**
 * A sealed step (#803): only the runner makes one, it is recognised by
 * identity rather than by shape, and its text cannot change after sealing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SOURCE_ROOT } from '../camera/import-walk-testing';
import { stripComments } from '../units/no-inline-units';
import type { RideAnalysisInput } from './input';
import type { ModelStepPort, StepRequest } from './model-step-port';
import { runAnalysis } from './runner';
import { isSealedStep, sealStep } from './sealed-step';
import { STILL_CLOCK } from './model-server-testing';

const STEP: StepRequest = {
  kind: 'section',
  system: 'You describe one section of a ride.',
  user: 'Section 1: {"minutes":20}',
  replySchema: { name: 'section_notes', schema: { type: 'object' } },
  maximumTokens: 200,
  temperature: 0.1,
};

describe('a sealed step', () => {
  it('is recognised by identity, never by shape', () => {
    const step = sealStep(STEP);
    expect(isSealedStep(step)).toBe(true);
    expect(isSealedStep({ ...step })).toBe(false);
    expect(isSealedStep(STEP)).toBe(false);
    expect(isSealedStep(undefined)).toBe(false);
    expect(isSealedStep('a string')).toBe(false);
  });

  it('is a frozen copy carrying only the fields a step declares', () => {
    const step = sealStep({ ...STEP, picture: new Uint8Array(4) } as unknown as StepRequest);
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.keys(step).sort()).toStrictEqual(
      ['kind', 'maximumTokens', 'replySchema', 'system', 'temperature', 'user'].sort(),
    );
    expect(step).toStrictEqual(STEP);
    const plain: StepRequest = {
      kind: STEP.kind,
      system: STEP.system,
      user: STEP.user,
      maximumTokens: STEP.maximumTokens,
      temperature: STEP.temperature,
    };
    expect(Object.keys(sealStep(plain))).not.toContain('replySchema');
  });
});

describe('the runner seals every step it sends', () => {
  it('hands the port only sealed steps, over a whole run', async () => {
    const seen: StepRequest[] = [];
    const port: ModelStepPort = {
      runModelStep: vi.fn(async (step: StepRequest) => {
        seen.push(step);
        return Promise.resolve({ kind: 'failed' as const, failure: 'unreachable' as const });
      }),
    };
    const input: RideAnalysisInput = {
      templateVersion: 'ride-analysis/1',
      ride: { movingMinutes: 40, distanceKilometres: 20 },
      rider: { massKilograms: 70, thresholdPower: null },
      whole: { power: { coverage: 1, mean: 180, max: 300 } },
      sections: [1, 2].map((index) => ({
        index,
        kind: 'flat' as const,
        minutes: 20,
        metrics: { power: { coverage: 1, mean: 180, max: 300 } },
      })),
    };
    await runAnalysis(input, { port, clock: STILL_CLOCK, signal: new AbortController().signal });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((step) => isSealedStep(step))).toBe(true);
  });
});

/** Every non-test production source under `src`, as paths relative to it. */
function productionSources(directory = SOURCE_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionSources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|-testing\.tsx?$/.test(entry.name)
      ? [relative(SOURCE_ROOT, path)]
      : [];
  });
}

/** The production modules, other than the sealer, whose code names `sealStep`. */
function sealers(paths: readonly string[], read: (path: string) => string): string[] {
  return paths
    .filter((path) => path !== join('ride-analysis', 'sealed-step.ts'))
    .filter((path) => /\bsealStep\b/.test(stripComments(read(path))));
}

describe('only the runner seals', () => {
  const read = (path: string): string => readFileSync(join(SOURCE_ROOT, path), 'utf8');

  it('has sources to scan', () => {
    expect(productionSources().length).toBeGreaterThan(100);
  });

  it('names sealStep in the runner and in no other production module', () => {
    expect(sealers(productionSources(), read)).toStrictEqual([join('ride-analysis', 'runner.ts')]);
  });

  it('would notice a second module that sealed a step of its own', () => {
    const planted: Record<string, string> = {
      [join('views', 'Planted.tsx')]:
        "import { sealStep } from '../ride-analysis/sealed-step';\nsealStep(step);",
      [join('views', 'Clean.tsx')]: '// sealStep is named only in a comment here',
    };
    expect(sealers(Object.keys(planted), (path) => planted[path] ?? '')).toStrictEqual([
      join('views', 'Planted.tsx'),
    ]);
  });
});
