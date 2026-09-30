// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the instance may be sent riders yet — `GET /ready` (#791) — as
 * opposed to whether it is running at all, which is `GET /health`.
 *
 * Three checks, each its own line in the answer so an operator reads which
 * failed: the **database** answers a read; its **migrations** are at the head
 * this build expects (`serve.ts` waits, with this false, while `migrate` is
 * running — which is what a box coming back from a reboot looks like); and
 * every **room worker** is alive. Room admission asks the same question and
 * refuses a socket until it is true (`room/node/router.ts`).
 *
 * A check that throws is a check that failed: the answer never takes the
 * instance down with it.
 */

export type MigrationState = 'at-head' | 'migrating' | 'behind' | 'ahead';

export interface ReadinessProbes {
  readonly database: () => Promise<boolean>;
  readonly migrations: () => Promise<MigrationState>;
  readonly rooms: () => boolean;
}

export interface Readiness {
  readonly ready: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly migrations: MigrationState | 'unknown';
    readonly rooms: boolean;
  };
}

async function safely<T>(probe: () => Promise<T> | T, failed: T): Promise<T> {
  try {
    return await probe();
  } catch {
    return failed;
  }
}

export async function assessReadiness(probes: ReadinessProbes): Promise<Readiness> {
  const [database, migrations, rooms] = await Promise.all([
    safely(probes.database, false),
    safely<MigrationState | 'unknown'>(probes.migrations, 'unknown'),
    safely(probes.rooms, false),
  ]);
  return {
    ready: database && migrations === 'at-head' && rooms,
    checks: { database, migrations, rooms },
  };
}
