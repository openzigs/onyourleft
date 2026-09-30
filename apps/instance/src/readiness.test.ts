// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { assessReadiness, type ReadinessProbes } from './readiness.ts';

const healthy: ReadinessProbes = {
  database: () => Promise.resolve(true),
  migrations: () => Promise.resolve('at-head'),
  rooms: () => true,
};

describe('GET /ready’s judgement — #791 criterion 1, one test per failing condition', () => {
  it('is ready when the database answers, the migrations are at head and every worker lives', async () => {
    expect(await assessReadiness(healthy)).toEqual({
      ready: true,
      checks: { database: true, migrations: 'at-head', rooms: true },
    });
  });

  it('is not, with the database unreachable — a probe that throws counts as one that failed', async () => {
    const answer = await assessReadiness({
      ...healthy,
      database: () => Promise.reject(new Error('SQLITE_CANTOPEN')),
    });
    expect(answer).toMatchObject({ ready: false, checks: { database: false } });
  });

  it('is not, with migrations running, behind, or ahead of this build', async () => {
    for (const state of ['migrating', 'behind', 'ahead'] as const) {
      const answer = await assessReadiness({
        ...healthy,
        migrations: () => Promise.resolve(state),
      });
      expect(answer, state).toMatchObject({ ready: false, checks: { migrations: state } });
    }
  });

  it('is not, with a room worker dead', async () => {
    const answer = await assessReadiness({ ...healthy, rooms: () => false });
    expect(answer).toMatchObject({ ready: false, checks: { rooms: false } });
  });
});
