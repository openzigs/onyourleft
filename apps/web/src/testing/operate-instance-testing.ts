// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The REAL instance for the Operate area's tests (#2603): `apps/instance`'s
 * own handler, identity, Operate route (#2602) and a real SQLite file, reached
 * through each device's `send` with no network, as `moderation-port.test.ts`
 * reaches it. Test support, never shipped.
 *
 * The instance is started naming one device as `OYL_INSTANCE_OWNER_KEY` and
 * another as `OYL_INSTANCE_DEPUTY_KEY`, with approval required, so a third
 * device's account is a rider whose `moderatorRole` is `null`. Its operator
 * log is written the way a real writer writes it — through
 * `SqlStore.recordOperatorAction` on a second connection, closed before the
 * app reads.
 *
 * `apps/instance` is imported by a computed path, for `instance-port.test.ts`'s
 * reason; the shape it is used through is written down here.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toHex, unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';

import { createInstancePort, type InstanceStorage } from '../instance/instance-port';
import type { InstanceSend } from '../instance/instance-transport';
import { createModerationPort } from '../instance/moderation-port';
import type { OperatePortDependencies } from '../instance/operate-port';
import { readInstanceAccount } from '../instance/sign-in';
import { LOADED_LOCALLY } from '../instance/testing';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';

/** What a test writes to the operator log with, through the instance's own store. */
interface OperatorLogWriter {
  recordOperatorAction(
    entry: {
      actor:
        | { source: 'app'; athleteId: string }
        | { source: 'cli' }
        // #2641: the instance's own admin pages, by listener.
        | { source: 'admin_tunnel' | 'admin_loopback'; athleteId: string | null };
      action: string;
      at: number;
    },
    change: () => { outcome: 'done' | 'refused'; detail?: string | null; value: undefined },
  ): Promise<{ logId: number }>;
}

/** One backup run as the `backup` command records it (`apps/instance` §`BackupRun`). */
export type BackupRunWritten =
  | {
      readonly outcome: 'done';
      readonly at: number;
      readonly snapshot: string;
      readonly rows: number;
      readonly blobs: number;
      readonly databaseSha256: string;
      readonly sizeBytes: number;
      readonly offBox: 'copied' | 'failed' | 'not-configured';
      readonly removed: number;
      readonly backupsFreeBytes: number | null;
      readonly offBoxFreeBytes: number | null;
      readonly intervalSeconds: number | null;
    }
  | {
      readonly outcome: 'failed';
      readonly at: number;
      readonly error: string;
      readonly intervalSeconds: number | null;
    };

/** What a test writes backups and reads requests with, through the instance's own store (#2606). */
interface BackupWriter {
  recordBackup(
    run: BackupRunWritten,
    requestId?: number,
  ): Promise<{ readonly id: number; readonly served: boolean }>;
  pendingBackupRequest(): Promise<
    { readonly id: number; readonly requestedAt: number } | undefined
  >;
}

export interface OperateInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly clock: { ms: number };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  /** A handler answering, as this instance, one sealed inner route. */
  answeringAs(path: string, answer: () => Response): (request: Request) => Promise<Response>;
  freshRead<T>(read: (store: OperatorLogWriter & BackupWriter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options: {
    registration: 'approval' | 'open';
    moderators: { owner: string; deputy?: string };
    keyless?: boolean;
    withoutOperate?: boolean;
  }): Promise<OperateInstance>;
}

/** A path, not a URL: under jsdom a URL resolved here is `http:`, which the loader refuses. */
const INSTANCE_TESTING = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../instance/src/auth/identity-testing.ts',
);
const NOW = unixSeconds(1_790_000_000);

let loaded: IdentityTesting | undefined;
const worlds: OperateInstance[] = [];
const harnesses: StoreHarness[] = [];

async function identityTesting(): Promise<IdentityTesting> {
  loaded ??= (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
  return loaded;
}

/** Close every instance and device store this module opened: each test file's `afterEach`. */
export async function closeOperateWorlds(): Promise<void> {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
}

/** A device's `localStorage`, in memory. */
export function deviceStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export interface OperateDevice {
  /** What this device's operate port is built over: it seals, so it signs. */
  readonly dependencies: OperatePortDependencies;
  readonly publicKey: string;
  connect(): Promise<void>;
  /** This device's own id on the instance, once connected. */
  athleteId(): string;
}

/** A device with its own store and key, not yet connected. */
export async function anOperateDevice(
  send: InstanceSend,
  name: string,
  card: () => Promise<string | undefined>,
): Promise<OperateDevice> {
  const testing = await identityTesting();
  const store = createStoreHarness();
  harnesses.push(store);
  const storage = deviceStorage();
  const signingKey = () =>
    store.write(async (open) => {
      await ensureLocalAthlete(open, NOW);
      return ensureDeviceSigningKey(open, LOCAL_ATHLETE);
    });
  const dependencies: OperatePortDependencies = {
    storage,
    loadedFrom: LOADED_LOCALLY,
    signingKey,
    send,
    now: () => NOW * 1000,
  };
  const port = createInstancePort({
    ...dependencies,
    ensureLocalAthlete: () => store.write(async (open) => ensureLocalAthlete(open, NOW)),
  });
  return {
    dependencies,
    publicKey: toHex((await signingKey()).publicKey),
    connect: async () => {
      const outcome = await port.connect(testing.TEST_ORIGIN, name, await card());
      if (outcome.kind !== 'connected') throw new Error(`connect: ${JSON.stringify(outcome)}`);
    },
    athleteId: () => readInstanceAccount(storage)?.instanceAthleteId ?? '',
  };
}

export interface OperateWorld {
  readonly world: OperateInstance;
  /** Every request a device sent, by URL: the outer path only, since a sealed one is `/v1/sealed`. */
  readonly sent: string[];
  readonly owner: OperateDevice;
  readonly deputy: OperateDevice;
  /** An account waiting for approval: a rider whose `moderatorRole` is `null`. */
  readonly rider: OperateDevice;
  /** Approve {@link rider}, as the owner does from the Moderation screen. */
  readonly approveRider: () => Promise<void>;
  /** One more device connected as a new rider, whose account waits for approval (#2605). */
  readonly anotherRider: (name: string) => Promise<OperateDevice>;
}

/** An approval-required instance whose owner, deputy and one rider are each a device here. */
export async function operatedWorld(
  options: { readonly withoutOperate?: boolean } = {},
): Promise<OperateWorld> {
  const testing = await identityTesting();
  const started: { world?: OperateInstance } = {};
  const sent: string[] = [];
  const send: InstanceSend = (url, init) => {
    if (started.world === undefined) throw new Error('no instance yet');
    sent.push(url);
    return started.world.instance.handler(new Request(url, init));
  };
  const card = async (): Promise<string> => {
    if (started.world === undefined) throw new Error('no instance yet');
    return (await started.world.instanceKeys.show()).card;
  };
  const owner = await anOperateDevice(send, 'Owner', card);
  const deputy = await anOperateDevice(send, 'Deputy', card);
  const rider = await anOperateDevice(send, 'Rider', card);
  const world = await testing.startIdentityInstance({
    registration: 'approval',
    moderators: { owner: owner.publicKey, deputy: deputy.publicKey },
    ...(options.withoutOperate === true ? { withoutOperate: true } : {}),
  });
  started.world = world;
  worlds.push(world);
  await owner.connect();
  world.clock.ms += 60_000;
  await deputy.connect();
  world.clock.ms += 60_000;
  await rider.connect();
  return {
    world,
    sent,
    owner,
    deputy,
    rider,
    approveRider: async () => {
      const decided = await createModerationPort(owner.dependencies).decideRegistration(
        rider.athleteId(),
        'approve',
        'ok',
      );
      if (decided.kind !== 'done') throw new Error(`approve: ${JSON.stringify(decided)}`);
    },
    anotherRider: async (name) => {
      const device = await anOperateDevice(send, name, card);
      // An hour on: new accounts are limited per client address, and every
      // device here is the same address.
      world.clock.ms += 3_600_000;
      await device.connect();
      return device;
    },
  };
}

/** An instance with no `OYL_INSTANCE_SECRET_KEY`, which seals nothing, and its owner connected. */
export async function keylessOwner(): Promise<OperateDevice> {
  const testing = await identityTesting();
  const started: { world?: OperateInstance } = {};
  const send: InstanceSend = (url, init) => {
    if (started.world === undefined) throw new Error('no instance yet');
    return started.world.instance.handler(new Request(url, init));
  };
  const device = await anOperateDevice(send, 'Owner', () => Promise.resolve(undefined));
  const world = await testing.startIdentityInstance({
    registration: 'open',
    moderators: { owner: device.publicKey },
    keyless: true,
  });
  started.world = world;
  worlds.push(world);
  await device.connect();
  return device;
}

/** Write `count` operator log entries from the CLI, one a minute, as the operator's commands do. */
export async function writeOperatorEntries(world: OperateInstance, count: number): Promise<void> {
  await world.freshRead(async (store) => {
    for (let index = 0; index < count; index += 1) {
      await store.recordOperatorAction(
        { actor: { source: 'cli' }, action: 'backup', at: 1_790_001_000 + index * 60 },
        () => ({ outcome: 'done', detail: `blobs=${String(index)}`, value: undefined }),
      );
    }
  });
}

/** The instance's clock, in Unix seconds. */
export function instanceSeconds(world: OperateInstance): number {
  return Math.floor(world.clock.ms / 1000);
}

/**
 * A scheduled snapshot `ageSeconds` old by the instance's clock, as
 * `backup-loop` records one: six-hourly, its name made from its time.
 */
export function aSnapshot(
  world: OperateInstance,
  ageSeconds: number,
  extra: Partial<Extract<BackupRunWritten, { outcome: 'done' }>> = {},
): Extract<BackupRunWritten, { outcome: 'done' }> {
  const at = instanceSeconds(world) - ageSeconds;
  return {
    outcome: 'done',
    at,
    snapshot: `snapshot-${new Date(at * 1000).toISOString().replace(/[:.]/g, '-')}`,
    rows: 100 + ageSeconds,
    blobs: 7,
    databaseSha256: 'a'.repeat(64),
    sizeBytes: 2_000_000,
    offBox: 'copied',
    removed: 0,
    backupsFreeBytes: 9_000_000_000,
    offBoxFreeBytes: 9_000_000_000,
    intervalSeconds: 21_600,
    ...extra,
  };
}

/** Record each run, oldest first, as the `backup` service writes them. */
export async function writeBackups(
  world: OperateInstance,
  runs: readonly BackupRunWritten[],
): Promise<void> {
  await world.freshRead(async (store) => {
    for (const run of runs) await store.recordBackup(run);
  });
}

/**
 * Serve the waiting "back up now" as `backup-loop` does: the run's record and
 * the request marked served in one transaction. Throws when none waits.
 */
export async function serveBackupRequest(
  world: OperateInstance,
  run: BackupRunWritten,
): Promise<void> {
  await world.freshRead(async (store) => {
    const request = await store.pendingBackupRequest();
    if (request === undefined) throw new Error('no backup request is waiting');
    const { served } = await store.recordBackup(run, request.id);
    if (!served) throw new Error('the request was not served');
  });
}

/**
 * A `send` over `world` that counts every SEALED request whose inner path is
 * `path` — opened by the instance itself, since nobody between can read one —
 * and answers it as a route that does not exist.
 */
export function countingSealed(
  world: OperateInstance,
  path: string,
): { readonly send: InstanceSend; count(): number } {
  let count = 0;
  const counting = world.answeringAs(path, () => {
    count += 1;
    return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  });
  return { send: (url, init) => counting(new Request(url, init)), count: () => count };
}
