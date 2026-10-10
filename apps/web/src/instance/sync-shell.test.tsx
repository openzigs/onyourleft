// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Sync, through the real shell** (#1195): the real `AppShell` at the
 * Instance route, handed an instance port and a sync port built as `main.tsx`
 * builds them — over this device's `localStorage` and a real IndexedDB — and
 * the REAL instance on the other end of the wire (its handler, identity,
 * SQLite file and blob store), reached only through the one instance module.
 *
 * The press is the rider's: *Sync now* is clicked in the rendered screen, and
 * every claim is read back through the store on a fresh connection.
 *
 * - A rider with no instance sees nothing and sends nothing.
 * - A device signed in with no card is not offered sync, and sends no sealed
 *   request and no plaintext fallback.
 * - The device stays canonical (ADR 0036 D-3): a ride deleted here is not
 *   pulled back; a tombstone from another device leaves the local ride; a ride
 *   pushed and confirmed is still here; a pulled record whose file does not
 *   verify writes nothing (ADR 0014 D-6).
 * - A key is admitted only after the rider confirms it on this device, never
 *   because the instance listed it.
 * - Saved workouts go both ways (#1100, the owner's ruling of 2026-10-10):
 *   one saved on another device is brought back; one deleted here is deleted
 *   there and never brought back; this device's change wins over another's;
 *   another device's delete leaves the copy here; and a workout the instance
 *   holds that this program would not read writes nothing here.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toHex, unixSeconds, type WorkoutBlock } from '@onyourleft/domain';
import {
  activityId as toActivityId,
  ensureDeviceSigningKey,
  webCryptoSha256,
  type ActivityId,
  type WorkoutRecord,
} from '@onyourleft/store';
import {
  createStoreHarness,
  type PersistentStore,
  type StoreHarness,
  workoutFor,
} from '@onyourleft/store/testing';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { rideSummaryOf } from '../ride-analysis/ride-summary';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';
import { importActivityFiles } from '../transfer/import-batch';
import {
  ADMIT_CONFIRM_LABEL,
  ADMIT_CONTROL_LABEL,
  KEYS_HEADING,
  SYNC_CONTROL_LABEL,
  SYNC_HEADING,
} from '../views/SyncPanel';
import { INSTANCE_KEY_TEXT } from './instance-pin';
import { createInstancePort, type InstancePort, type InstanceStorage } from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createSyncPort, type SyncPort } from './sync-port';
import { LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  readonly blobs: Map<string, Uint8Array>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    bodyLimitBytes?: number;
    syncStoreSeenBy?: (store: InstanceSyncStore) => InstanceSyncStore;
  }): Promise<IdentityInstance>;
}

/** The two calls of the instance's SQL store a test writes a hand-edited item through. */
interface InstanceSyncStore {
  putSyncItem(item: {
    readonly athleteId: string;
    readonly kind: string;
    readonly key: string;
    readonly body: Uint8Array;
    readonly digest: string;
    readonly now: number;
  }): Promise<'stored' | 'unchanged'>;
}

// jsdom's `URL` stands in for Node's here, so paths are joined rather than resolved as URLs.
const HERE = dirname(fileURLToPath(import.meta.url));
const INSTANCE = (path: string): string => join(HERE, '../../../instance/src', path);
const CORPUS = join(HERE, '../../../../packages/fit/fixtures/corpus');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const NOW = unixSeconds(1_790_000_000);
/**
 * Each case drives the real shell against the real instance: 0.6 s to 2.7 s
 * locally (a Mac, 2026-10-09, no coverage), and coverage and the slower CI
 * runner each slow a case two to three times (docs/agents/ci.md §4c), which
 * would put the slowest past Vitest's 5 s default. About seven times the
 * slowest local figure; nothing is trimmed from what is driven.
 */
const SHELL_CASE_MS = 20_000;

let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];
let mounted: Mounted | undefined;

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

async function world(
  syncStoreSeenBy?: (store: InstanceSyncStore) => InstanceSyncStore,
): Promise<IdentityInstance> {
  const started = await testing.startIdentityInstance({
    bodyLimitBytes: 1024 * 1024,
    ...(syncStoreSeenBy === undefined ? {} : { syncStoreSeenBy }),
  });
  worlds.push(started);
  return started;
}

/** Every request, handed to the instance's own handler — and counted. */
function wire(on: IdentityInstance): InstanceSend & ReturnType<typeof vi.fn> {
  return vi.fn((url: string, init: RequestInit) => on.instance.handler(new Request(url, init)));
}

const paths = (send: ReturnType<typeof wire>): string[] =>
  (send.mock.calls as [string, RequestInit][]).map(
    ([url, init]) => `${init.method ?? 'GET'} ${new URL(url).pathname}`,
  );

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

interface Device {
  readonly harness: StoreHarness;
  readonly instance: InstancePort;
  readonly sync: SyncPort;
  /** The open store handle the ports use; opened again after each read-back. */
  reopen(): Promise<void>;
}

/** A device as `main.tsx` builds one: an instance port and a sync port over one store. */
async function device(send: InstanceSend, storage: InstanceStorage): Promise<Device> {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  const reopen = (): Promise<void> =>
    harness.write((store) => {
      open = store;
      return Promise.resolve();
    });
  await reopen();
  const store = (): PersistentStore => {
    if (open === undefined) throw new Error('no store open');
    return open;
  };
  const signingKey = () => ensureDeviceSigningKey(store(), LOCAL_ATHLETE, { now: () => NOW });
  const sealing = { storage, loadedFrom: LOADED_LOCALLY, signingKey, send, now: () => NOW * 1000 };
  return {
    harness,
    reopen,
    instance: createInstancePort({
      ...sealing,
      ensureLocalAthlete: () => ensureLocalAthlete(store(), NOW),
    }),
    sync: createSyncPort({
      ...sealing,
      store,
      athleteId: LOCAL_ATHLETE,
      timeZone: 'Europe/London',
      rideSummary: (id) => rideSummaryOf(store(), LOCAL_ATHLETE)(id),
      newDocumentId: () => crypto.randomUUID(),
    }),
  };
}

let rideCounter = 0;
async function importRides(on: Device, names: readonly string[]): Promise<ActivityId[]> {
  await on.harness.write((store) => ensureLocalAthlete(store, NOW));
  const report = await on.harness.write((store) =>
    importActivityFiles({
      sources: names.map((name) => ({
        fileName: name,
        bytes: () => Promise.resolve(new Uint8Array(readFileSync(join(CORPUS, name)))),
      })),
      store,
      athleteId: LOCAL_ATHLETE,
      newActivityId: () => toActivityId(`ride-${String((rideCounter += 1))}`),
      now: () => NOW,
      digest: async (bytes) => toHex(await webCryptoSha256(bytes)),
      timeZone: 'Europe/London',
    }),
  );
  expect(report.imported, JSON.stringify(report.outcomes)).toBe(names.length);
  return report.outcomes.map((outcome) => outcome.activityId as ActivityId);
}

/** The rides on a device, read back on a FRESH connection. */
async function ridesOn(on: Device): Promise<string[]> {
  const ids = await on.harness.read(async (store) =>
    (
      await store.listActivitySummaries(LOCAL_ATHLETE, {
        orderBy: 'startedAt',
        direction: 'ascending',
        limit: 50,
      })
    ).map((ride) => ride.id as string),
  );
  await on.reopen();
  return ids.sort();
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').trim() === text,
  );
}

async function showShell(on: Device): Promise<void> {
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(
    <AppShell capabilities={NO_BLUETOOTH} instance={on.instance} sync={on.sync} />,
  );
  await settle();
  await settle();
}

/** The sync panel, by its heading. */
function syncPanel(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('section')].find(
    (section) => section.querySelector('h2')?.textContent === SYNC_HEADING,
  );
}

/** Press *Sync now* in the rendered screen, and wait for what it says. */
async function pressSync(): Promise<string> {
  const control = buttonNamed(SYNC_CONTROL_LABEL);
  expect(control, 'no Sync now control on the screen').toBeDefined();
  await act(async () => {
    control?.click();
    await Promise.resolve();
  });
  for (let turn = 0; turn < 200; turn += 1) {
    await settle();
    if (buttonNamed(SYNC_CONTROL_LABEL)?.disabled === false) break;
  }
  return syncPanel()?.querySelector('[role="status"]')?.textContent ?? '';
}

/** Connect `on` with the instance's card, from a copy of the app opened locally. */
async function connectWithCard(on: Device, w: IdentityInstance, name: string): Promise<void> {
  const card = (await w.instanceKeys.show()).card;
  expect(await on.instance.connect(testing.TEST_ORIGIN, name, card)).toMatchObject({
    kind: 'connected',
  });
}

/** A second device of the same athlete, linked with a code and card the first shows. */
async function linkSecond(first: Device, send: InstanceSend): Promise<Device> {
  const offer = await first.instance.linkCode();
  if (offer.kind !== 'shown') throw new Error(`no link code: ${JSON.stringify(offer)}`);
  const second = await device(send, mapStorage());
  expect(await second.instance.link(offer.offer)).toMatchObject({ kind: 'connected' });
  return second;
}

const publicKeyOf = async (on: Device): Promise<string> =>
  on.harness.write(async (store) =>
    toHex((await ensureDeviceSigningKey(store, LOCAL_ATHLETE, { now: () => NOW })).publicKey),
  );

describe('a rider with no instance sees nothing (#1195)', () => {
  it(
    'draws no sync control and no sync sentence, and sends nothing, on the Instance screen and Home',
    async () => {
      const w = await world();
      const send = wire(w);
      const on = await device(send, localStorage);
      const syncs = vi.spyOn(on.sync, 'sync');
      await showShell(on);
      expect(document.body.textContent).toContain('Connect');
      expect(buttonNamed(SYNC_CONTROL_LABEL)).toBeUndefined();
      expect(
        [...document.querySelectorAll('h2')].map((heading) => heading.textContent),
      ).not.toContain(SYNC_HEADING);
      globalThis.location.hash = '#/';
      await settle();
      await settle();
      expect(buttonNamed(SYNC_CONTROL_LABEL)).toBeUndefined();
      expect(syncs).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
    SHELL_CASE_MS,
  );
});

describe('a device with no card does not sync (#1195, ADR 0047 D-14 Q1)', () => {
  it(
    'offers no sync, says the card sentence, and sends no sealed request and no plaintext sync call',
    async () => {
      const w = await world();
      const send = wire(w);
      const on = await device(send, localStorage);
      await connectWithCard(on, w, 'Anna');
      await on.instance.disconnect();
      // Signed in again with only the address: a key the instance holds, no pin kept.
      expect(await on.instance.connect(testing.TEST_ORIGIN, 'Anna')).toMatchObject({
        kind: 'connected',
      });
      send.mockClear();
      await showShell(on);
      expect(document.body.textContent).toContain('Connected');
      expect(buttonNamed(SYNC_CONTROL_LABEL)).toBeUndefined();
      expect(syncPanel()?.textContent).toContain(INSTANCE_KEY_TEXT['needs-card']);
      // The port refuses too, with the same sentence, having sent nothing.
      expect(await on.sync.sync()).toEqual({
        kind: 'refused',
        text: INSTANCE_KEY_TEXT['needs-card'],
      });
      expect(paths(send).filter((path) => /sealed|\/v1\/sync\//.test(path))).toEqual([]);
    },
    SHELL_CASE_MS,
  );
});

describe('the device stays canonical, through the real shell (#1195, ADR 0036 D-3)', () => {
  it(
    'keeps a pushed ride, never pulls back a ride deleted here, and keeps a ride another device deleted',
    async () => {
      const w = await world();
      const send = wire(w);
      const here = await device(send, localStorage);
      const [kept, deleted] = await importRides(here, [
        'nominal-outdoor-ride.fit',
        'paused-laps.fit',
      ]);
      await connectWithCard(here, w, 'Anna');
      await showShell(here);

      // Pushed and confirmed by the instance: still on this device.
      expect(await pressSync()).toContain('Sent 2 rides.');
      expect(await ridesOn(here)).toEqual([kept, deleted].sort());

      // Deleted here, then synced: deleted there, and not pulled back.
      await here.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, deleted!));
      expect(await pressSync()).toContain('Deleted 1 thing on the instance that you deleted here.');
      expect(await ridesOn(here)).toEqual([kept]);
      expect(await pressSync()).toContain('Everything was already in sync.');
      expect(await ridesOn(here)).toEqual([kept]);

      // Another device of the same athlete deletes the kept ride on the instance.
      const other = await linkSecond(here, send);
      expect((await other.sync.admitKey(await publicKeyOf(here))).kind).toBe('admitted');
      const pulled = await other.sync.sync();
      expect(pulled).toMatchObject({ kind: 'synced', report: { pulled: 1, failures: [] } });
      await other.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, kept!));
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { deletedOnInstance: 1 },
      });

      // A tombstone from another device leaves the local ride, read back through the store.
      expect(await pressSync()).toContain('Another device deleted 1 thing you still have here.');
      expect(await ridesOn(here)).toEqual([kept]);
    },
    SHELL_CASE_MS,
  );

  it(
    'writes nothing from a pulled ride whose file does not verify',
    async () => {
      const w = await world();
      const send = wire(w);
      const here = await device(send, localStorage);
      await connectWithCard(here, w, 'Anna');
      await ridesOn(here);
      const other = await linkSecond(here, send);
      expect((await here.sync.admitKey(await publicKeyOf(other))).kind).toBe('admitted');
      await importRides(other, ['nominal-outdoor-ride.fit']);
      expect(await other.sync.sync()).toMatchObject({ kind: 'synced', report: { pushed: 1 } });
      // The instance's copy of the file, changed by a byte after it was stored.
      expect(w.blobs.size).toBe(1);
      for (const [key, bytes] of w.blobs) {
        const changed = bytes.slice();
        changed[changed.length - 3] = (changed[changed.length - 3] ?? 0) ^ 0xff;
        w.blobs.set(key, changed);
      }
      await showShell(here);
      expect(await pressSync()).toContain('One thing did not sync.');
      expect(await ridesOn(here)).toEqual([]);
      // And it was the verification that refused it — the key is admitted.
      const again = await here.sync.sync();
      expect(again).toMatchObject({
        kind: 'synced',
        report: { pulled: 0, failures: [{ kind: 'activity', reason: 'content-mismatch' }] },
      });
      expect(await ridesOn(here)).toEqual([]);
    },
    SHELL_CASE_MS,
  );
});

describe('admitting a key (#1195, #898)', () => {
  it(
    'takes no ride signed by a key the instance lists until the rider confirms it here',
    async () => {
      const w = await world();
      const send = wire(w);
      const here = await device(send, localStorage);
      await connectWithCard(here, w, 'Anna');
      const other = await linkSecond(here, send);
      const [theirs] = await importRides(other, ['paused-laps.fit']);
      expect(await other.sync.sync()).toMatchObject({ kind: 'synced', report: { pushed: 1 } });

      await showShell(here);
      const said = await pressSync();
      expect(said).toContain('One thing did not sync.');
      expect(document.body.textContent).toContain(KEYS_HEADING);
      // Listed by the instance, not admitted here: no pulled record written.
      expect(await ridesOn(here)).toEqual([]);
      const trusted = async () =>
        here.harness.write((store) => store.listTrustedDeviceKeys(LOCAL_ATHLETE));
      expect(await trusted()).toEqual([]);

      // The rider's first press only asks.
      await act(async () => {
        buttonNamed(ADMIT_CONTROL_LABEL)?.click();
        await Promise.resolve();
      });
      await settle();
      expect(await trusted()).toEqual([]);
      // Confirmed: admitted, and the next sync takes the ride.
      await act(async () => {
        buttonNamed(ADMIT_CONFIRM_LABEL)?.click();
        await Promise.resolve();
      });
      await settle();
      await settle();
      expect((await trusted()).map((row) => row.publicKey)).toEqual([await publicKeyOf(other)]);
      expect(await pressSync()).toContain('Brought back 1 ride.');
      expect(await ridesOn(here)).toEqual([theirs]);
    },
    SHELL_CASE_MS,
  );
});

describe('saved workouts go both ways, through the real shell (#1100, the owner’s ruling of 2026-10-10)', () => {
  /** The saved workouts on a device, read back on a FRESH connection, by name. */
  async function workoutsOn(on: Device): Promise<string[]> {
    const names = await on.harness.read(async (store) =>
      (await store.listWorkouts(LOCAL_ATHLETE)).map((row) => row.name),
    );
    await on.reopen();
    return names.sort();
  }

  const renamed = (record: WorkoutRecord, name: string): WorkoutRecord => ({
    ...record,
    name,
    workout: { ...record.workout, name },
  });

  const named = async (on: Device, id: WorkoutRecord['id']): Promise<WorkoutRecord> => {
    const held = await on.harness.write((store) => store.getWorkout(LOCAL_ATHLETE, id));
    if (held === undefined) throw new Error(`no workout ${id}`);
    return held;
  };

  it(
    'brings back a workout saved on another device, and keeps it when that device deletes it',
    async () => {
      const w = await world();
      const send = wire(w);
      const here = await device(send, localStorage);
      await connectWithCard(here, w, 'Anna');
      const other = await linkSecond(here, send);
      const theirs = workoutFor(LOCAL_ATHLETE, { name: 'Saved on the other device' });
      await other.harness.write((store) => store.putWorkout(theirs));
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { workoutsPushed: 1, failures: [] },
      });

      // (a) Saved on another device: brought back here.
      await showShell(here);
      expect(await pressSync()).toContain('Brought back 1 saved workout.');
      expect(await workoutsOn(here)).toEqual(['Saved on the other device']);
      expect((await named(here, theirs.id)).workout).toStrictEqual(theirs.workout);

      // (e) The other device deletes it: it stays here.
      await other.harness.write((store) => store.deleteWorkout(LOCAL_ATHLETE, theirs.id));
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { workoutsDeletedOnInstance: 1 },
      });
      expect(await pressSync()).toContain('Another device deleted 1 thing you still have here.');
      expect(await workoutsOn(here)).toEqual(['Saved on the other device']);
      expect(await pressSync()).toContain('Another device deleted 1 thing you still have here.');
      expect(await workoutsOn(here)).toEqual(['Saved on the other device']);
    },
    SHELL_CASE_MS,
  );

  it(
    'sends this device’s change over another device’s, and deletes there what was deleted here, for good',
    async () => {
      const w = await world();
      const send = wire(w);
      const here = await device(send, localStorage);
      await connectWithCard(here, w, 'Anna');
      const mine = workoutFor(LOCAL_ATHLETE, { name: 'Mine' });
      await here.harness.write((store) => store.putWorkout(mine));
      await showShell(here);
      expect(await pressSync()).toContain('Sent 1 saved workout.');

      const other = await linkSecond(here, send);
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { workoutsPulled: 1, failures: [] },
      });

      // (c) Changed there, and changed here: this device's change wins.
      await other.harness.write((store) => store.putWorkout(renamed(mine, 'Changed there')));
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { workoutsPushed: 1 },
      });
      await here.harness.write((store) => store.putWorkout(renamed(mine, 'Changed here')));
      const said = await pressSync();
      expect(said).toContain('Sent 1 saved workout.');
      expect(said).not.toContain('Brought back');
      expect(await workoutsOn(here)).toEqual(['Changed here']);
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { workoutsPulled: 1 },
      });
      expect(await workoutsOn(other)).toEqual(['Changed here']);

      // (b) Deleted here, then synced: deleted there, and never brought back.
      await here.harness.write((store) => store.deleteWorkout(LOCAL_ATHLETE, mine.id));
      expect(await pressSync()).toContain('Deleted 1 thing on the instance that you deleted here.');
      expect(await workoutsOn(here)).toEqual([]);
      expect(await pressSync()).toContain('Everything was already in sync.');
      expect(await workoutsOn(here)).toEqual([]);
      // The other device keeps its copy (rule 9's unsigned delete) and does
      // not send it back, so it does not come back here either.
      expect(await other.sync.sync()).toMatchObject({
        kind: 'synced',
        report: { workoutsHiddenOnInstance: 1, workoutsPushed: 0 },
      });
      expect(await pressSync()).toContain('Everything was already in sync.');
      expect(await workoutsOn(here)).toEqual([]);
    },
    SHELL_CASE_MS,
  );

  it(
    'writes nothing here from a workout on the instance this program would not read',
    async () => {
      let instanceStore: InstanceSyncStore | undefined;
      let athleteOnInstance: string | undefined;
      const w = await world((store) => {
        instanceStore = store;
        // Learn the athlete's id on the instance from the first item it stores.
        return new Proxy(store, {
          get: (target, property) => {
            const value = Reflect.get(target, property) as unknown;
            if (property === 'putSyncItem') {
              return (item: Parameters<InstanceSyncStore['putSyncItem']>[0]) => {
                athleteOnInstance ??= item.athleteId;
                return target.putSyncItem(item);
              };
            }
            return typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
        });
      });
      const send = wire(w);
      const here = await device(send, localStorage);
      await connectWithCard(here, w, 'Anna');
      await here.harness.write((store) =>
        store.putWorkout(workoutFor(LOCAL_ATHLETE, { name: 'Good' })),
      );
      await showShell(here);
      expect(await pressSync()).toContain('Sent 1 saved workout.');
      expect(athleteOnInstance).toBeDefined();

      // Two rows written straight into the instance's store, as a hand edit would.
      const intervals: WorkoutBlock = {
        kind: 'intervals',
        repeats: 100,
        hardSeconds: 1,
        hardTarget: 1,
        easySeconds: 1,
        easyTarget: 0.5,
      } as unknown as WorkoutBlock;
      const bodies: readonly (readonly [string, string])[] = [
        [
          'workout-unknown-key',
          JSON.stringify({
            onYourLeftWorkout: 1,
            name: 'Extra',
            blocks: [{ kind: 'steady', seconds: 60, target: 0.5 }],
            resistanceOverride: 400,
          }),
        ],
        [
          'workout-over-the-bound',
          JSON.stringify({
            onYourLeftWorkout: 1,
            name: 'Too long',
            blocks: Array.from({ length: 51 }, () => intervals),
          }),
        ],
      ];
      for (const [key, body] of bodies) {
        const bytes = new TextEncoder().encode(body);
        await instanceStore!.putSyncItem({
          athleteId: athleteOnInstance!,
          kind: 'workout',
          key,
          body: bytes,
          digest: toHex(await webCryptoSha256(bytes)),
          now: NOW,
        });
      }

      // (d) Reported as not synced, and nothing written: no workout, no base row.
      expect(await pressSync()).toContain('2 things did not sync.');
      expect(await workoutsOn(here)).toEqual(['Good']);
      const base = await here.harness.read((store) => store.listSyncBase(LOCAL_ATHLETE));
      await here.reopen();
      expect(base.filter((row) => row.kind === 'workout').map((row) => row.key)).toHaveLength(1);
      const again = await here.sync.sync();
      expect(again).toMatchObject({
        kind: 'synced',
        report: {
          workoutsPulled: 0,
          failures: [
            { kind: 'workout', key: 'workout-over-the-bound', reason: 'not-a-workout' },
            { kind: 'workout', key: 'workout-unknown-key', reason: 'not-a-workout' },
          ],
        },
      });
      expect(await workoutsOn(here)).toEqual(['Good']);
    },
    SHELL_CASE_MS,
  );
});
