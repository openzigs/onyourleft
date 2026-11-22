// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider the shell is handed at start-up is the rider's one Female / Male
 * choice, read through `riderChoiceOf` — the owner's ruling of 2026-11-20, and
 * review 6001493467's low finding on `main.tsx`.
 *
 * `main.tsx` runs on import, so its prop is read from the source, as
 * `camera/retired-hosted-key-main.test.ts` reads its own. The row it is
 * applied to is read the way `main.tsx` reads it: `ensureLocalAthlete` over
 * the real store, on a connection that never wrote, for a row as #2432 left
 * it — a calorie sex and no look. That row is where the two reads differ:
 * `riderChoiceOf` answers the sex, and `athlete?.riderBody` answers nothing,
 * so Settings would say *Not chosen* while the saved rides got the female
 * figure.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unixSeconds } from '@onyourleft/domain';
import { riderChoiceOf, type AthleteRecord } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { SOURCE_ROOT } from '../camera/import-walk-testing';
import { ensureLocalAthlete } from '../local-athlete';
import { stripComments } from '../units/no-inline-units';

const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/** A row written before the ruling: `calorieSex` set, `riderBody` never written. */
async function startUpRowWithOnlyTheCalorieSex(): Promise<AthleteRecord> {
  harness = createStoreHarness();
  await harness.write(async (store) => {
    const row = await ensureLocalAthlete(store, unixSeconds(1_700_000_000));
    await store.putAthlete({ ...row, calorieSex: 'female', birthYear: 1985 });
  });
  return harness.read(async (store) => ensureLocalAthlete(store, unixSeconds(1_800_000_000)));
}

describe('main.tsx hands the shell the rider’s one choice at start-up (#2839, 2026-11-20)', () => {
  it('as riderChoiceOf of the row render is given, and nothing else', () => {
    const props = [...main.matchAll(/\briderBody=\{([^}]*)\}/g)].map((match) => match[1]);
    expect(props).toStrictEqual(['riderChoiceOf(athlete)']);
    expect(main).toMatch(/async function render\(athlete: AthleteRecord \| undefined\)/);
  });

  it('which, for a row with only the calorie sex, is that sex — where the look alone is nothing', async () => {
    const athlete = await startUpRowWithOnlyTheCalorieSex();
    expect(athlete.riderBody).toBeUndefined();
    expect(riderChoiceOf(athlete)).toBe('female');
  });
});
