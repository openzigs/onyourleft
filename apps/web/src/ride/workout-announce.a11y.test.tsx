// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The workout messages a rider who cannot see the screen must hear — #394.
 *
 * ⚠️ **A safety question under CLAUDE.md §6**, not only a usability one: a
 * rider who cannot see that a workout fault has stopped the targets, or that
 * the block under their legs has just changed, is pedalling against a machine
 * they have no picture of.
 *
 * What these assertions can and cannot establish, stated rather than implied:
 *
 * | claim | here (jsdom) | browser gate | only a person with a screen reader |
 * |---|---|---|---|
 * | the message is a live region, with the right text | ✅ | | |
 * | the change is announced once, and not on first render | ✅ | | |
 * | the region is not hidden by CSS (a hidden one is silent) | ❌ no stylesheet | ✅ #401 | |
 * | TalkBack in the Capacitor WebView actually speaks it | | ❌ | ✅ `docs/validation/0003` (#393) |
 *
 * Each `live` has its own assertion, because one test covering two messages
 * passes while one of them regresses.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expandWorkout,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { athleteId as toAthleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { workoutStub } from '../workouts/testing';
import { mount, settle, type Mounted } from '../testing/mount';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import { WorkoutPanel } from './WorkoutPanel';

const ATHLETE = toAthleteId('athlete-a');
const blocks: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
];
const record: WorkoutRecord = {
  id: workoutId('w1'),
  createdBy: ATHLETE,
  name: 'Sweet spot',
  workout: { name: 'Sweet spot', blocks },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

const trainer: TrainerSnapshot = {
  paired: true,
  controllable: true,
  controlChoice: { kind: 'none' },
  canSetPower: true,
  canSimulate: false,
  powerRange: undefined,
  hasControl: true,
  target: { kind: 'none' },
  requested: undefined,
  lost: undefined,
  refusal: undefined,
  releaseFault: undefined,
};

const running = (overrides: Partial<RideWorkoutSnapshot> = {}): RideWorkoutSnapshot => ({
  name: 'Sweet spot',
  status: 'running',
  elapsedSeconds: 120,
  totalSeconds: 600,
  holdingWatts: 150,
  nowRiding: '10 min at 60%',
  fault: undefined,
  timeline: expandWorkout({ name: 'Sweet spot', blocks }),
  ...overrides,
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function panel(workout: RideWorkoutSnapshot | undefined, failingLibrary = false) {
  const port = workoutStub(ATHLETE, [record]);
  if (failingLibrary) port.failNextList();
  return (
    <WorkoutPanel
      trainer={trainer}
      workout={workout}
      port={port}
      thresholdPower={watts(250)}
      onStart={() => undefined}
      onEnd={() => undefined}
    />
  );
}

const announcer = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-oyl-announcer="workout"]');

describe('a workout fault is announced when it appears', () => {
  it('is a live region carrying the fault', async () => {
    mounted = await mount(panel(running({ fault: 'The trainer refused that target.' })));
    await settle();
    const fault = [...document.querySelectorAll('[role="status"]')].find((element) =>
      (element.textContent ?? '').includes('The trainer refused that target.'),
    );
    expect(fault, 'the workout fault is not in a live region').toBeDefined();
  });
});

describe('a library that could not be read is announced when it appears', () => {
  it('is a live region carrying the failure', async () => {
    mounted = await mount(panel(undefined, true));
    await settle();
    const fault = [...document.querySelectorAll('[role="status"]')].find((element) =>
      (element.textContent ?? '').includes('could not be read'),
    );
    expect(fault, 'the library failure is not in a live region').toBeDefined();
  });
});

describe('the block being ridden is announced when it CHANGES — not when it first renders', () => {
  it('says nothing for a workout already in progress, then exactly the new block once', async () => {
    mounted = await mount(panel(running()));
    await settle();
    // ⚠️ The half that fails if this is wired to PRESENCE: a region populated
    // at mount reads the block out the moment the panel appears.
    expect(announcer()?.textContent).toBe('');

    await mounted.rerender(panel(running({ elapsedSeconds: 121 })));
    await settle();
    expect(announcer()?.textContent, 'a tick with the same block announced').toBe('');

    await mounted.rerender(panel(running({ elapsedSeconds: 600, nowRiding: '5 min at 95%' })));
    await settle();
    expect(announcer()?.textContent).toBe('Now: 5 min at 95%');
  });

  it('is visually hidden by clip, never removed from the accessibility tree', async () => {
    mounted = await mount(panel(running()));
    await settle();
    const region = announcer();
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.className).toContain('oyl-visually-hidden');
    expect(region?.hasAttribute('hidden')).toBe(false);
    expect(region?.getAttribute('aria-hidden')).toBeNull();
    expect(region?.style.display).not.toBe('none');
  });
});

describe('no message depends on interrupting another — #394', () => {
  it('uses status regions only, in source order, and no alert', async () => {
    mounted = await mount(panel(running({ fault: 'The trainer refused that target.' })));
    await settle();
    await mounted.rerender(
      panel(running({ nowRiding: '5 min at 95%', fault: 'The trainer refused that target.' })),
    );
    await settle();
    // TalkBack ignores politeness, so nothing here may lean on `alert`.
    expect(document.querySelectorAll('[role="alert"], [aria-live="assertive"]')).toHaveLength(0);
    const regions = [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent ?? '',
    );
    // The block, then the fault: the order they are in the document is the
    // order a screen reader meets them.
    expect(regions.findIndex((text) => text.startsWith('Now:'))).toBeLessThan(
      regions.findIndex((text) => text.includes('refused')),
    );
  });
});

describe('no production path pre-empts with an alert — #394', () => {
  /**
   * Source scan. `role="alert"` is in this client twice, both #255's: a
   * refusal the pacer and the wind forms raise against the field that caused
   * it, associated by `aria-describedby`. Neither is a ride-state message and
   * neither is there to interrupt one. A THIRD is a decision, and this is
   * where it is seen.
   */
  const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const sources = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it('has exactly the two form refusals #255 placed, and nothing assertive', () => {
    const found: string[] = [];
    for (const file of sources(SOURCE_ROOT)) {
      const text = readFileSync(file, 'utf8');
      // As an attribute (after whitespace) — a comment quoting it in backticks
      // is prose, and `GameView.tsx` has one.
      const alerts = text.match(/\srole="alert"/g)?.length ?? 0;
      for (let index = 0; index < alerts; index += 1) found.push(relative(SOURCE_ROOT, file));
      expect(text, `${relative(SOURCE_ROOT, file)} sets aria-live="assertive"`).not.toMatch(
        /aria-live=["']assertive/,
      );
    }
    expect(found.sort()).toEqual(['game/GameView.tsx', 'game/GameView.tsx']);
  });
});
