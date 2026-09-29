// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one public projection, and the display name it carries (#774).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../store/node-sqlite.ts';
import { createStoreHarness, type StoreHarness } from '../store/testing/index.ts';
import { ATHLETE_COLUMNS, publicAthlete } from './public-athlete.ts';
import { startIdentityInstance, testDevice, type IdentityInstance } from './identity-testing.ts';

let harness: StoreHarness | undefined;
let world: IdentityInstance | undefined;
afterEach(async () => {
  await harness?.destroy();
  await world?.close();
  harness = undefined;
  world = undefined;
});

const codeOf = (body: unknown): unknown => (body as { error?: { code?: unknown } }).error?.code;

describe('the public projection of an athlete (#774)', () => {
  it('classifies every column the migrated athlete table has, public or private, and no other', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    const database = openDatabase(harness.path);
    let columns: string[];
    try {
      columns = (
        database.prepare(`SELECT name FROM pragma_table_info('athlete') ORDER BY name`).all() as {
          name: string;
        }[]
      ).map((row) => row.name);
    } finally {
      database.close();
    }
    expect(columns.length).toBeGreaterThan(0);
    expect(Object.keys(ATHLETE_COLUMNS).sort()).toEqual(columns);
  });

  it('carries exactly the public columns, whatever else the row holds', () => {
    const projected = publicAthlete({
      id: 'athlete-a',
      displayName: 'Anna',
      createdAt: 1_790_000_000,
      registrationState: 'active',
    });
    expect(projected).toEqual({ athleteId: 'athlete-a', displayName: 'Anna' });
    const publicColumns = Object.entries(ATHLETE_COLUMNS)
      .filter(([, kind]) => kind === 'public')
      .map(([column]) => column);
    expect(Object.keys(projected)).toHaveLength(publicColumns.length);
  });
});

describe('changing a display name (#774)', () => {
  async function signedIn() {
    world = await startIdentityInstance();
    const session = await world.signIn(await testDevice(), { displayName: 'Anna' });
    return {
      w: world,
      token: session.body.sessionToken as string,
      athleteId: session.body.athleteId as string,
    };
  }

  it('checks the name, and names the field and the rule when it refuses', async () => {
    const { w, token } = await signedIn();
    const answer = await w.call('POST', '/v1/auth/display-name', {
      token,
      body: { displayName: `An${String.fromCodePoint(0x202e)}na` },
    });
    expect(answer.status).toBe(400);
    const fields = (answer.body as { error: { fields: { field: string; problem: string }[] } })
      .error.fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]?.field).toBe('displayName');
    expect(fields[0]?.problem).toMatch(/bidirectional/);
  });

  it('is rate-limited, and keeps every earlier name for moderation (#789)', async () => {
    const { w, token, athleteId } = await signedIn();
    for (const name of ['Bea', 'Cat', 'Dee']) {
      const answer = await w.call('POST', '/v1/auth/display-name', {
        token,
        body: { displayName: name },
      });
      expect(answer.status, name).toBe(200);
      w.clock.ms += 1000;
    }
    const over = await w.call('POST', '/v1/auth/display-name', {
      token,
      body: { displayName: 'Eve' },
    });
    expect(over.status).toBe(429);
    expect(codeOf(over.body)).toBe('rate_limited');
    expect((await w.freshRead((store) => store.getAthlete(athleteId)))?.displayName).toBe('Dee');
    const trail = await w.freshRead((store) => store.listDisplayNameChanges(athleteId));
    expect(trail.map((change) => change.previousName)).toEqual(['Anna', 'Bea', 'Cat']);

    w.clock.ms += 24 * 60 * 60 * 1000;
    expect(
      (await w.call('POST', '/v1/auth/display-name', { token, body: { displayName: 'Eve' } }))
        .status,
    ).toBe(200);
    expect((await w.call('GET', '/v1/auth/session', { token })).body).toEqual({
      athleteId,
      displayName: 'Eve',
    });
  });
});
