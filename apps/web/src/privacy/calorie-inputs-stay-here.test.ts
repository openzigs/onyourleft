// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's sex and year of birth (#2432) never leave the device except in
 * their own account export — the owner's ruling of 2026-11-09 on #2430.
 *
 * Two halves, each with its limit stated:
 *
 * - **By behaviour**: the ride-analysis input, which an instance's write-up
 *   (`ride-analysis/instance-analysis.ts`) and a synced ride summary
 *   (`ride-analysis/ride-summary.ts`) are both built from, is read through
 *   the real store for a rider who has set both, and carries neither. The sync
 *   bodies themselves are held in `instance/sync.test.ts` §"the calorie inputs
 *   never leave the device through a sync".
 * - **By source**: no module that builds an instance-bound or model-bound body
 *   names either field. This is what catches a future body that reads the row
 *   and copies them, which no behavioural test written today can foresee; it
 *   cannot catch a spread of the whole athlete row, which the behavioural half
 *   and `export-everything.ts`' named-fields rule are for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unixSeconds } from '@onyourleft/domain';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRideInput } from '../ride-analysis/read-input';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('the calorie inputs stay on the device (#2432)', () => {
  it('are in no ride-analysis input, which a write-up and a synced summary are built from', async () => {
    const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    await harness.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
      await store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 });
    });

    const input = await harness.read(async (store) =>
      readRideInput(store, ATHLETE_A, ride.id, { templateVersion: 't', cameraConsented: true }),
    );
    expect(input).toBeDefined();
    const sent = JSON.stringify(input);
    expect(sent).not.toContain('calorieSex');
    expect(sent).not.toContain('birthYear');
    expect(sent).not.toContain('female');
    expect(sent).not.toContain('1985');
  });

  it('are named by no module that builds a body for an instance or a model', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const roots = [
      join(here, '..', 'instance'),
      join(here, '..', 'net'),
      join(here, '..', 'ride-analysis'),
      join(here, '..', '..', '..', '..', 'packages', 'analysis', 'src'),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sources(root)) {
        if (/\b(calorieSex|birthYear)\b/.test(readFileSync(file, 'utf8'))) {
          offenders.push(relative(here, file));
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });
});

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}
