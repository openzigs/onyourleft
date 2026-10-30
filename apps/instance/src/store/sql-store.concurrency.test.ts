// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Two writers at once, and no `SQLITE_BUSY` reaches a caller** (#769).
 *
 * Two connections in two THREADS — `node:sqlite` is synchronous, so two
 * connections in one thread never actually contend — each writing athletes
 * and device keys to one file as fast as they can. With WAL, the busy timeout,
 * IMMEDIATE transactions (`node-sqlite.ts`) and the retry of a start that met
 * the lock anyway (`busy-retry.ts`), every write lands.
 *
 * ⚠️ **Without the retry this case failed on a loaded runner** (#985, run
 * 36884103033: `[ 'database is locked' ]` after 11 964 ms): the busy timeout
 * is not fair, and one writer missed the lock for its whole five seconds.
 * `busy-retry.test.ts` holds the retry deterministically.
 *
 * ⚠️ **A red here under load may be a TIMEOUT, not "database is locked".**
 * With the retry, one write can now wait about 21 s (four 5 s busy timeouts
 * and the pauses between) before it gives up, inside these cases' 30 s. A
 * writer starved that long fails the case on Vitest's clock first, so read
 * the failure: a timeout is the same defect as the error, arriving slower.
 *
 * The control runs the same two writers with the busy timeout at nought and
 * no retry, and requires `SQLITE_BUSY` (in SQLite's words, "database is
 * locked") to reach a caller: without it this test would be green on a
 * machine where the two threads simply never overlapped.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './node-sqlite.ts';
import { openSqlStore } from './open-sql-store.ts';
import type { RaceJob, RaceReport } from './testing/racing-identity-testing.ts';

const WRITES_PER_THREAD = 300;
const WORKER = new URL('./testing/concurrent-writer-testing.ts', import.meta.url);

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

/**
 * The control's writers write longer: whether two threads collide is timing,
 * and on a busy two-core machine (#780's room tests share the run) 300 writes
 * each could finish without overlapping — the control then passed nothing.
 */
const CONTROL_WRITES_PER_THREAD = 3_000;

function writer(
  path: string,
  prefix: string,
  busyTimeoutMilliseconds?: number,
  count = WRITES_PER_THREAD,
  busyRetryDelaysMilliseconds?: readonly number[],
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { path, prefix, count, busyTimeoutMilliseconds, busyRetryDelaysMilliseconds },
    });
    worker.once('message', (errors: string[]) => resolve(errors));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`The writer exited with ${code}.`));
    });
  });
}

async function migrated(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-concurrency-'));
  const path = join(directory, 'instance.sqlite');
  await (await openSqlStore(path)).close();
  return path;
}

describe('two writers on one database (#769)', () => {
  it('both land every write, and no SQLITE_BUSY escapes', { timeout: 30_000 }, async () => {
    const path = await migrated();
    const errors = await Promise.all([writer(path, 'left'), writer(path, 'right')]);
    expect(errors.flat()).toEqual([]);
    const store = await openSqlStore(path);
    for (const prefix of ['left', 'right']) {
      for (const index of [0, WRITES_PER_THREAD - 1]) {
        expect(await store.listDeviceKeys(`${prefix}-${index}`)).toHaveLength(1);
      }
    }
    await store.close();
  });

  it(
    'is a test that can fail: with no busy timeout and no retry, SQLITE_BUSY does escape (the control)',
    { timeout: 30_000 },
    async () => {
      const path = await migrated();
      const errors = await Promise.all([
        writer(path, 'left', 0, CONTROL_WRITES_PER_THREAD, []),
        writer(path, 'right', 0, CONTROL_WRITES_PER_THREAD, []),
      ]);
      expect(errors.flat().some((message) => /database is locked/.test(message))).toBe(true);
    },
  );
});

/**
 * The #867 rules across CONNECTIONS (#889's review). The route tests order a
 * race inside one process; what makes the rule hold between two processes on
 * one file is that each check runs in the transaction that writes AND that
 * the transaction takes the write lock when it begins (`node-sqlite.ts`
 * rewrites Kysely's bare `begin` to `BEGIN IMMEDIATE`). Two threads, one
 * connection each, meet at a barrier before every athlete.
 *
 * The control runs the same race over connections whose transactions begin
 * DEFERRED, and requires it to go wrong somewhere — without it, a green run
 * could be two threads that never overlapped. ⚠️ In WAL mode "wrong" shows
 * as `SQLITE_BUSY` reaching a caller, NOT as a lost update: a DEFERRED
 * transaction that read under one snapshot and then tries to write after the
 * other committed cannot be upgraded, and SQLite refuses it at once rather
 * than wait out the busy timeout. So the control counts errors as well as
 * broken outcomes, and it is the errors that fire: measured 2026-09-29, 46
 * and 48 "database is locked" errors over 60 revoke and 60 rename races,
 * and no broken outcome in either.
 */
const RACERS = 60;
const RACER = new URL('./testing/racing-identity-testing.ts', import.meta.url);

/** `racing-identity-testing.ts` §`redeemFixture`, copied: importing it would run the racer. */
function redeemFixture(athleteId: string): {
  tokenSha256: string;
  codeSha256: string;
  address: string;
} {
  const hex = (prefix: string): string =>
    `${prefix}${athleteId.replace(/\D/g, '').padStart(6, '0')}`.padEnd(64, '0');
  return { tokenSha256: hex('aa'), codeSha256: hex('cc'), address: `${athleteId}@example.org` };
}

function racer(job: Omit<RaceJob, 'side'>, side: 0 | 1): Promise<RaceReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(RACER, { workerData: { ...job, side } satisfies RaceJob });
    worker.once('message', (report: RaceReport) => resolve(report));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`The racer exited with ${code}.`));
    });
  });
}

async function racers(operation: RaceJob['operation'], deferred: boolean) {
  const path = await migrated();
  const store = await openSqlStore(path);
  for (let index = 0; index < RACERS; index += 1) {
    const athleteId = `racer-${index}`;
    await store.putAthlete({
      id: athleteId,
      displayName: 'Racer',
      createdAt: 1,
      registrationState: 'active',
    });
    for (const side of [0, 1]) {
      await store.putDeviceKey({
        publicKey: `key-${side}-of-${athleteId}`,
        athleteId,
        addedAt: 1,
        revokedAt: null,
      });
    }
    // Two of the window's three renames already spent: one slot left.
    for (const at of [10, 20]) {
      await store.renameAthlete(athleteId, `Earlier ${at}`, at, { count: 99, windowSeconds: 1 });
    }
    if (operation === 'redeem') {
      // An established address (confirmed at 1, past its hold at 10), a code,
      // and a token mailed to the address (#1194).
      const fixture = redeemFixture(athleteId);
      await store.putEmailConfirmation({
        tokenSha256: fixture.tokenSha256.replace(/^aa/, 'bb'),
        athleteId,
        address: fixture.address,
        expiresAt: 1_000,
        requestedByKey: `key-0-of-${athleteId}`,
      });
      await store.confirmRecoveryEmail(
        athleteId,
        fixture.tokenSha256.replace(/^aa/, 'bb'),
        1,
        `key-0-of-${athleteId}`,
        2,
      );
      await store.putEmailRecoveryToken({
        tokenSha256: fixture.tokenSha256,
        athleteId,
        expiresAt: 1_000,
        address: fixture.address,
      });
    }
  }
  await store.close();
  if (operation === 'redeem') {
    const database = openDatabase(path);
    try {
      for (let index = 0; index < RACERS; index += 1) {
        const athleteId = `racer-${index}`;
        database
          .prepare('INSERT INTO recovery_code VALUES (?, ?, 1, NULL)')
          .run(redeemFixture(athleteId).codeSha256, athleteId);
      }
    } finally {
      database.close();
    }
  }
  const job = {
    path,
    count: RACERS,
    operation,
    deferred,
    gate: new SharedArrayBuffer(RACERS * Int32Array.BYTES_PER_ELEMENT),
  };
  const [left, right] = await Promise.all([racer(job, 0), racer(job, 1)]);
  const fresh = await openSqlStore(path);
  const after = [];
  for (let index = 0; index < RACERS; index += 1) {
    const athleteId = `racer-${index}`;
    after.push({
      outcomes: [left.outcomes[index], right.outcomes[index]].sort(),
      liveKeys: (await fresh.listDeviceKeys(athleteId)).filter((key) => key.revokedAt === null)
        .length,
      renames: (await fresh.listDisplayNameChanges(athleteId)).length,
      addresses: (await fresh.listRecoveryEmails(athleteId)).length,
      tokenUsedAt: (await fresh.listEmailRecoveryTokens(athleteId))[0]?.usedAt ?? null,
    });
  }
  await fresh.close();
  return { errors: [...left.errors, ...right.errors], after };
}

describe('the #867 rules hold between two connections on one file (#889)', () => {
  it(
    'revoking the last two keys at once leaves every athlete a key',
    { timeout: 60_000 },
    async () => {
      const { errors, after } = await racers('revoke', false);
      expect(errors).toEqual([]);
      for (const athlete of after) {
        expect(athlete.outcomes).toEqual(['last_device', 'revoked']);
        expect(athlete.liveKeys).toBe(1);
      }
    },
  );

  it('renaming into the last slot at once lands one rename', { timeout: 60_000 }, async () => {
    const { errors, after } = await racers('rename', false);
    expect(errors).toEqual([]);
    for (const athlete of after) {
      expect(athlete.outcomes).toEqual(['rate_limited', 'renamed']);
      expect(athlete.renames).toBe(3);
    }
  });

  it(
    'a mailed token redeemed as its address is cleared: whichever transaction runs second loses (#1194)',
    { timeout: 60_000 },
    async () => {
      const { errors, after } = await racers('redeem', false);
      expect(errors).toEqual([]);
      for (const athlete of after) {
        expect(athlete.addresses).toBe(0);
        // The redemption ran first (it spent the token at 50, and the clear
        // then had nothing left to void) and took it; or the clear ran first
        // (voiding it at 60) and the redemption is `unbound`. Never a token
        // taken from an address already gone.
        if (athlete.tokenUsedAt === 50) expect(athlete.outcomes).toEqual(['cleared', 'taken']);
        else {
          expect(athlete.tokenUsedAt).toBe(60);
          expect(athlete.outcomes).toEqual(['cleared', 'unbound']);
        }
      }
    },
  );

  it(
    // Under WAL the race surfaces as SQLITE_BUSY (counted in `errors`), not as
    // a lost update; either one satisfies the control.
    'is a test that can fail: with DEFERRED transactions the same races go wrong (the control)',
    { timeout: 60_000 },
    async () => {
      for (const operation of ['revoke', 'rename'] as const) {
        const { errors, after } = await racers(operation, true);
        const broken = after.filter((athlete) =>
          operation === 'revoke' ? athlete.liveKeys !== 1 : athlete.renames !== 3,
        );
        expect(errors.length + broken.length, operation).toBeGreaterThan(0);
      }
    },
  );
});
