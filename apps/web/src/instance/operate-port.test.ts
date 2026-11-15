// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Operate area's port (#2603) against the REAL instance
 * (`testing/operate-instance-testing.ts`): its own handler, identity, Operate route (#2602) and
 * a real SQLite file, with an owner, a deputy and a rider each a device here,
 * and the operator log written through the instance's own store on another
 * connection.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { INSTANCE_SESSION_STORAGE_KEY } from './instance-port';
import type { InstanceSend } from './instance-transport';
import {
  createOperatePort,
  OPERATOR_LOG_PAGE,
  type OperateBackupsRead,
  type OperateStatusRead,
  type OperatorLogRead,
} from './operate-port';
import {
  aSnapshot,
  closeOperateWorlds,
  countingSealed,
  deviceStorage,
  instanceSeconds,
  keylessOwner,
  operatedWorld,
  roomMadeBy,
  writeBackups,
  writeOperatorEntries,
} from '../testing/operate-instance-testing';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

afterEach(async () => {
  await closeOperateWorlds();
  vi.restoreAllMocks();
});

function asPage(read: OperatorLogRead) {
  if (read.kind !== 'page') throw new Error(`not a page of the log: ${read.kind}`);
  return read;
}

describe('who owns the instance — #2603', () => {
  it('is the owner alone: the deputy and a rider, pending or approved, are not', async () => {
    const { owner, deputy, rider, approveRider } = await operatedWorld();
    expect(await createOperatePort(owner.dependencies).standing()).toBe('owner');
    // The deputy is a moderator and NOT the operator (ADR 0046 D-9 Q9).
    expect(await createOperatePort(deputy.dependencies).standing()).toBe('not-owner');
    // Pending: refused about its own account before any route.
    expect(await createOperatePort(rider.dependencies).standing()).toBe('not-owner');
    await approveRider();
    // Approved: `moderatorRole` is `null`.
    expect(await createOperatePort(rider.dependencies).standing()).toBe('not-owner');
  });

  it('sends nothing on a device connected to no instance', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const port = createOperatePort({
      storage: deviceStorage(),
      send,
      loadedFrom: LOADED_LOCALLY,
      signingKey: () => Promise.reject(new Error('no key is asked for')),
    });
    expect(await port.standing()).toBe('signed-out');
    expect(await port.log()).toEqual({ kind: 'signed-out' });
    expect(send).not.toHaveBeenCalled();
  });

  it('asks nothing of the instance from a copy of the app a website served (ADR 0047 D-11)', async () => {
    const { owner, world } = await operatedWorld();
    const counted = countingSealed(world, '/v1/operate/log');
    const port = createOperatePort({
      ...owner.dependencies,
      loadedFrom: LOADED_FROM_A_WEBSITE,
      send: counted.send,
    });
    expect(await port.standing()).toBe('no-keys');
    expect(await port.log()).toEqual({ kind: 'no-keys' });
    expect(counted.count()).toBe(0);
  });

  it('is no-keys on a device connected to an instance that holds no keys, which seals nothing', async () => {
    const device = await keylessOwner();
    const port = createOperatePort(device.dependencies);
    expect(await port.standing()).toBe('no-keys');
    expect(await port.log()).toEqual({ kind: 'no-keys' });
  });

  it('is signed-out when the instance no longer accepts this device’s session', async () => {
    const { owner } = await operatedWorld();
    const { storage } = owner.dependencies;
    const held = JSON.parse(storage.getItem(INSTANCE_SESSION_STORAGE_KEY) ?? 'null') as {
      token: string;
    };
    storage.setItem(
      INSTANCE_SESSION_STORAGE_KEY,
      JSON.stringify({ ...held, token: 'a-session-the-instance-never-issued' }),
    );
    const port = createOperatePort(owner.dependencies);
    expect(await port.standing()).toBe('signed-out');
    expect(await port.log()).toEqual({ kind: 'signed-out' });
  });

  // #957's review: a proxy's own 404 or 403 is a page of HTML, not the instance's answer.
  it.each([
    ['a bare HTML 404', 404, '<html><body>Not Found</body></html>', 'text/html'],
    ['a 404 with another code', 404, '{"error":{"code":"no_route"}}', 'application/json'],
    ['a 403 with another code', 403, '{"error":{"code":"forbidden"}}', 'application/json'],
  ] as const)(
    'reads %s as unreachable, never as "not the owner"',
    async (_name, status, body, type) => {
      const { owner, world } = await operatedWorld();
      const proxied = createOperatePort({
        ...owner.dependencies,
        // The keys are the instance's own, so the device seals; everything
        // else is answered by the proxy.
        send: (url, init) =>
          new URL(url).pathname === '/v1/instance/keys'
            ? world.instance.handler(new Request(url, init))
            : Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })),
      });
      expect(await proxied.standing()).toBe('unreachable');
      expect(await proxied.log()).toEqual({ kind: 'unreachable' });
      // The control: the instance itself still says who owns it.
      expect(await createOperatePort(owner.dependencies).standing()).toBe('owner');
    },
  );
});

describe('the operator log — #2602, #2603', () => {
  it(`is read newest first, ${String(OPERATOR_LOG_PAGE)} at a time, and the next page reaches the rest exactly once`, async () => {
    const { owner, world } = await operatedWorld();
    await writeOperatorEntries(world, OPERATOR_LOG_PAGE + 2);
    const port = createOperatePort(owner.dependencies);
    const first = asPage(await port.log());
    expect(first.entries).toHaveLength(OPERATOR_LOG_PAGE);
    expect(first.entries[0]).toEqual({
      id: OPERATOR_LOG_PAGE + 2,
      at: new Date((1_790_001_000 + (OPERATOR_LOG_PAGE + 1) * 60) * 1000).toISOString(),
      source: 'cli',
      action: 'backup',
      detail: `blobs=${String(OPERATOR_LOG_PAGE + 1)}`,
      outcome: 'done',
    });
    const ids = first.entries.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((left, right) => right - left));
    expect(first.next).not.toBeNull();
    const second = asPage(await port.log(first.next ?? ''));
    expect(second.entries.map((entry) => entry.id)).toEqual([2, 1]);
    expect(second.next).toBeNull();
  });

  it('shows an entry the app’s Operate area wrote, by source', async () => {
    const { owner, world } = await operatedWorld();
    await world.freshRead((store) =>
      store.recordOperatorAction(
        {
          actor: { source: 'app', athleteId: owner.athleteId() },
          action: 'room_open',
          at: 1_790_004_000,
        },
        () => ({ outcome: 'done', detail: 'ride', value: undefined }),
      ),
    );
    expect(asPage(await createOperatePort(owner.dependencies).log()).entries).toEqual([
      {
        id: 1,
        at: new Date(1_790_004_000 * 1000).toISOString(),
        source: 'app',
        action: 'room_open',
        detail: 'ride',
        outcome: 'done',
      },
    ]);
  });

  it('shows the instance’s admin pages’ entries, which name the owner or nobody, by listener (#2641)', async () => {
    const { owner, world } = await operatedWorld();
    await world.freshRead(async (store) => {
      await store.recordOperatorAction(
        {
          actor: { source: 'admin_tunnel', athleteId: owner.athleteId() },
          action: 'admin_sign_in',
          at: 1_790_004_000,
        },
        () => ({ outcome: 'done', detail: 'code', value: undefined }),
      );
      await store.recordOperatorAction(
        {
          actor: { source: 'admin_loopback', athleteId: null },
          action: 'admin_refused',
          at: 1_790_004_060,
        },
        () => ({ outcome: 'refused', detail: 'code,refused=3', value: undefined }),
      );
    });
    expect(asPage(await createOperatePort(owner.dependencies).log()).entries).toEqual([
      {
        id: 2,
        at: new Date(1_790_004_060 * 1000).toISOString(),
        source: 'admin_loopback',
        action: 'admin_refused',
        detail: 'code,refused=3',
        outcome: 'refused',
      },
      {
        id: 1,
        at: new Date(1_790_004_000 * 1000).toISOString(),
        source: 'admin_tunnel',
        action: 'admin_sign_in',
        detail: 'code',
        outcome: 'done',
      },
    ]);
  });

  it('is never read for the deputy or a rider, whom the instance answers as no route', async () => {
    const { deputy, rider, world, approveRider } = await operatedWorld();
    await writeOperatorEntries(world, 2);
    expect(await createOperatePort(deputy.dependencies).log()).toEqual({ kind: 'not-owner' });
    expect(await createOperatePort(rider.dependencies).log()).toEqual({ kind: 'not-owner' });
    await approveRider();
    expect(await createOperatePort(rider.dependencies).log()).toEqual({ kind: 'not-owner' });
  });

  it('is no-keys on an instance handed no Operate area (#2602’s unavailable)', async () => {
    const { owner } = await operatedWorld({ withoutOperate: true });
    expect(await createOperatePort(owner.dependencies).log()).toEqual({ kind: 'no-keys' });
  });

  it('sends nothing for a cursor the instance could not have written', async () => {
    const { owner, sent } = await operatedWorld();
    const port = createOperatePort(owner.dependencies);
    sent.length = 0;
    expect(await port.log('not a cursor!')).toEqual({ kind: 'unreachable' });
    expect(sent).toEqual([]);
  });

  it.each([
    ['a detail that is free text', { detail: 'sk-ant secret here' }],
    ['a detail that is a decimal', { detail: 'lat=51.5' }],
    ['a detail that is signed', { detail: 'lon=-0' }],
    ['an unknown outcome', { outcome: 'maybe' }],
    ['an unknown source', { source: 'web' }],
    ['a time that is not ISO 8601', { at: 'yesterday' }],
    ['a time that is not the instance’s own form of it', { at: '2026-11-14 09:00' }],
    ['an id that is not a count', { id: 0 }],
    ['an action that is not a name', { action: 'Back Up' }],
  ] as const)('shows no page that holds %s', async (_name, change) => {
    const { owner, world } = await operatedWorld();
    const good = {
      id: 1,
      at: '2026-11-14T09:00:00.000Z',
      source: 'cli',
      action: 'backup',
      detail: 'blobs=1',
      outcome: 'done',
    };
    const answered = (entries: readonly unknown[]) =>
      createOperatePort({
        ...owner.dependencies,
        send: (url, init) =>
          world.answeringAs('/v1/operate/log', () => Response.json({ entries, cursor: null }))(
            new Request(url, init),
          ),
      });
    // The control: the same answer with the good row is a page.
    expect(asPage(await answered([good]).log()).entries).toHaveLength(1);
    expect(await answered([good, { ...good, id: 2, ...change }]).log()).toEqual({
      kind: 'unreachable',
    });
  });
});

describe('the instance’s status — #2604', () => {
  function asStatus(read: OperateStatusRead) {
    if (read.kind !== 'status') throw new Error(`not a status: ${read.kind}`);
    return read;
  }

  it('reads the owner the instance’s counts, as the instance holds them, and nobody else anything', async () => {
    const { owner, deputy, rider, approveRider } = await operatedWorld();
    const before = asStatus(await createOperatePort(owner.dependencies).status());
    // The owner and the deputy are active; the rider awaits approval.
    expect(before.counts.athletes).toEqual({ active: 2, pending: 1, suspended: 0 });
    expect(before.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(before.upstream).toBe(true);
    expect(before.tunnel).toEqual({ state: 'unknown' });
    expect(before.lastBackup).toBeNull();
    expect(before.keys).toBe('ready');
    await approveRider();
    const after = asStatus(await createOperatePort(owner.dependencies).status());
    expect(after.counts.athletes).toEqual({ active: 3, pending: 0, suspended: 0 });
    // The deputy is a moderator and NOT the operator; an approved rider is a rider.
    expect(await createOperatePort(deputy.dependencies).status()).toEqual({ kind: 'not-owner' });
    expect(await createOperatePort(rider.dependencies).status()).toEqual({ kind: 'not-owner' });
  });

  it('is no-keys on an instance with no OYL_INSTANCE_SECRET_KEY', async () => {
    const device = await keylessOwner();
    expect(await createOperatePort(device.dependencies).status()).toEqual({ kind: 'no-keys' });
  });

  /** A status as the instance writes it, every field well-formed. */
  const GOOD = {
    ready: true,
    checks: { database: true, migrations: 'at-head', rooms: true },
    version: '1.2.3',
    commit: '0123456789abcdef0123456789abcdef01234567',
    upstream: true,
    registration: 'approval',
    uptimeSeconds: 60,
    disk: [{ holds: 'database', freeBytes: 1, totalBytes: 2, low: false }],
    lastBackup: null,
    tunnel: { state: 'ready', connections: 4 },
    counts: {
      athletes: { active: 1, pending: 0, suspended: 0 },
      roomsOpen: 0,
      analysis: { queued: 0, running: 0 },
    },
    keys: 'ready',
  };

  async function answeredWith(body: unknown): Promise<OperateStatusRead> {
    const { owner, world } = await operatedWorld();
    return createOperatePort({
      ...owner.dependencies,
      send: (url, init) =>
        world.answeringAs('/v1/operate/status', () => Response.json(body))(new Request(url, init)),
    }).status();
  }

  it('carries nothing the instance sent beyond its own fields', async () => {
    const read = asStatus(await answeredWith({ ...GOOD, secretKey: 'MARKER-2604' }));
    expect(read.tunnel).toEqual({ state: 'ready', connections: 4 });
    expect(JSON.stringify(read)).not.toContain('MARKER-2604');
  });

  it.each([
    ['a commit that is not 40 hex', { commit: 'main' }],
    ['a commit that carries a path', { commit: `${'a'.repeat(40)}/../x` }],
    ['a version that is free text', { version: 'see https://example.com' }],
    ['an unknown registration mode', { registration: 'anyone' }],
    ['a count that is not whole', { uptimeSeconds: 1.5 }],
    ['a negative count', { counts: { ...GOOD.counts, roomsOpen: -1 } }],
    ['an unknown keys state', { keys: 'MARKER-key-value' }],
    ['a ready tunnel with no count', { tunnel: { state: 'ready', connections: null } }],
    ['a disk that names a path', { disk: [{ ...GOOD.disk[0], holds: '/data' }] }],
    [
      'a backup whose time is not ISO 8601',
      { lastBackup: { at: 'today', offBox: 'copied', intervalSeconds: 1 } },
    ],
  ] as const)('shows no status that holds %s', async (_name, change) => {
    // The control: the same answer, well-formed, is a status.
    expect((await answeredWith(GOOD)).kind).toBe('status');
    expect(await answeredWith({ ...GOOD, ...change })).toEqual({ kind: 'unreachable' });
  });
});

describe('the backups, and “back up now” — #2606, #2607', () => {
  function asBackups(read: OperateBackupsRead) {
    if (read.kind !== 'backups') throw new Error(`not the backups: ${read.kind}`);
    return read;
  }

  /** `apps/instance` §`MESSAGES.too_many`, the sentence the instance refuses with. */
  const TOO_MANY =
    'A backup is already waiting, or one was made in the last 15 minutes. Nothing was asked for: each extra backup removes an older one.';

  it('reads the owner the records newest first, with their ages, as the instance holds them', async () => {
    const { owner, world } = await operatedWorld();
    await writeBackups(world, [
      aSnapshot(world, 12 * 3600, { offBox: 'failed' }),
      {
        outcome: 'failed',
        at: instanceSeconds(world) - 6 * 3600,
        error: 'ENOSPC',
        intervalSeconds: 21_600,
      },
      aSnapshot(world, 3600),
    ]);
    const read = asBackups(await createOperatePort(owner.dependencies).backups());
    expect(read.pendingSince).toBeNull();
    expect(read.records.map((each) => [each.outcome, each.ageSeconds])).toEqual([
      ['done', 3600],
      ['failed', 6 * 3600],
      ['done', 12 * 3600],
    ]);
    expect(read.records[0]).toEqual({
      outcome: 'done',
      id: 3,
      at: new Date((instanceSeconds(world) - 3600) * 1000).toISOString(),
      ageSeconds: 3600,
      snapshot: aSnapshot(world, 3600).snapshot,
      rows: 100 + 3600,
      blobs: 7,
      sizeBytes: 2_000_000,
      offBox: 'copied',
      intervalSeconds: 21_600,
      requested: false,
    });
    expect(read.records[1]).toMatchObject({ outcome: 'failed', error: 'ENOSPC' });
    // The SHA-256 and the free space are the instance's, not the screen's.
    expect(JSON.stringify(read)).not.toContain('a'.repeat(64));
  });

  it('asks once: the request waits, is logged, and a second ask is refused with the instance’s own sentence', async () => {
    const { owner, world } = await operatedWorld();
    const port = createOperatePort(owner.dependencies);
    const asked = await port.backUpNow();
    expect(asked).toEqual({
      kind: 'requested',
      requestedAt: new Date(instanceSeconds(world) * 1000).toISOString(),
    });
    // Read back through the instance: the request waits, in the store and in the route.
    expect(
      await world.freshRead(async (store) => (await store.pendingBackupRequest()) !== undefined),
    ).toBe(true);
    expect(asBackups(await port.backups()).pendingSince).toBe(
      asked.kind === 'requested' ? asked.requestedAt : 'never',
    );
    expect(await port.backUpNow()).toEqual({ kind: 'refused', sentence: TOO_MANY });
    // The operator log, read through `GET /v1/operate/log`: asked, then refused.
    const log = await port.log();
    if (log.kind !== 'page') throw new Error(`no log: ${log.kind}`);
    expect(log.entries.map((entry) => [entry.action, entry.source, entry.outcome])).toEqual([
      ['backup_requested', 'app', 'refused'],
      ['backup_requested', 'app', 'done'],
    ]);
  });

  it.each(['deputy', 'rider'] as const)(
    'reads the %s nothing, and their “back up now” asks for nothing and logs nothing',
    async (who) => {
      const operated = await operatedWorld();
      if (who === 'rider') await operated.approveRider();
      const port = createOperatePort(operated[who].dependencies);
      expect(await port.backups()).toEqual({ kind: 'not-owner' });
      expect(await port.backUpNow()).toEqual({ kind: 'not-owner' });
      // Read back through the instance's store and the owner's log: nothing changed.
      expect(
        await operated.world.freshRead((store) => store.pendingBackupRequest()),
      ).toBeUndefined();
      const log = await createOperatePort(operated.owner.dependencies).log();
      expect(log).toEqual({ kind: 'page', entries: [], next: null });
    },
  );

  it('is no-keys on an instance with no OYL_INSTANCE_SECRET_KEY, and on one with no Operate area', async () => {
    const device = await keylessOwner();
    expect(await createOperatePort(device.dependencies).backups()).toEqual({ kind: 'no-keys' });
    expect(await createOperatePort(device.dependencies).backUpNow()).toEqual({ kind: 'no-keys' });
    const { owner } = await operatedWorld({ withoutOperate: true });
    expect(await createOperatePort(owner.dependencies).backups()).toEqual({ kind: 'no-keys' });
  });

  it('has no way to restore: the port asks for backups and nothing else that changes one', async () => {
    const { owner } = await operatedWorld();
    const methods = Object.keys(createOperatePort(owner.dependencies)).sort();
    // #2611's are the AI backend's and #2612's the rooms': none of them touches a backup.
    expect(methods).toEqual([
      'analysis',
      'backUpNow',
      'backups',
      'checkModel',
      'clearAnalysis',
      'endRoom',
      'jobs',
      'localModels',
      'log',
      'rooms',
      'setAnalysis',
      'standing',
      'status',
    ]);
  });

  /** A record as the instance writes it, every field well-formed. */
  const GOOD = {
    id: 1,
    at: '2026-11-14T20:00:00.000Z',
    ageSeconds: 60,
    outcome: 'done',
    error: null,
    snapshot: 'snapshot-2026-11-14T20-00-00-000Z',
    rows: 10,
    blobs: 2,
    databaseSha256: 'b'.repeat(64),
    sizeBytes: 1000,
    offBox: 'copied',
    removed: 0,
    freeBytes: { backups: 1, offBox: 1 },
    intervalSeconds: 21_600,
    requested: false,
  };

  async function answeredWith(
    answer: () => Response,
    method: 'backups' | 'backUpNow' = 'backups',
  ): Promise<unknown> {
    const { owner, world } = await operatedWorld();
    const port = createOperatePort({
      ...owner.dependencies,
      send: (url, init) => world.answeringAs('/v1/operate/backups', answer)(new Request(url, init)),
    });
    return method === 'backups' ? port.backups() : port.backUpNow();
  }

  it.each([
    [
      'an error that is a message, which may name a path',
      { outcome: 'failed', error: 'ENOENT: /srv/backups' },
    ],
    ['a snapshot that is a path', { snapshot: '/srv/backups/snapshot-2026-11-14T20-00-00-000Z' }],
    ['a snapshot that climbs out', { snapshot: 'snapshot-../../etc' }],
    ['a done run with no snapshot', { snapshot: null }],
    ['an unknown off-box outcome', { offBox: 'maybe' }],
    ['an age that is not whole', { ageSeconds: 1.5 }],
    ['a time that is not ISO 8601', { at: 'today' }],
  ] as const)('shows no backups when a record holds %s', async (_name, change) => {
    const body = (records: unknown[]) => () => Response.json({ backups: records, pending: null });
    // The control: the same answer, well-formed, is the backups.
    expect(await answeredWith(body([GOOD]))).toMatchObject({ kind: 'backups' });
    expect(await answeredWith(body([GOOD, { ...GOOD, id: 2, ...change }]))).toEqual({
      kind: 'unreachable',
    });
  });

  it.each([
    ['a pending request that names no time', { requestedAt: null }],
    ['a pending request that is not an object', 'now'],
  ] as const)('shows no backups when the answer holds %s', async (_name, pending) => {
    expect(await answeredWith(() => Response.json({ backups: [GOOD], pending }))).toEqual({
      kind: 'unreachable',
    });
  });

  it('does not take a 202 that names no time as a request made', async () => {
    const accepted = (body: unknown) => () => Response.json(body, { status: 202 });
    expect(
      await answeredWith(accepted({ requestedAt: '2026-11-14T20:00:00.000Z' }), 'backUpNow'),
    ).toEqual({ kind: 'requested', requestedAt: '2026-11-14T20:00:00.000Z' });
    expect(await answeredWith(accepted({}), 'backUpNow')).toEqual({ kind: 'unreachable' });
  });

  it('reads a failed run whose error name the instance may write, such as one starting with _', async () => {
    const failed = { ...GOOD, outcome: 'failed', snapshot: null, error: '_Odd9' };
    expect(
      await answeredWith(() => Response.json({ backups: [failed], pending: null })),
    ).toMatchObject({ kind: 'backups' });
  });

  it.each([
    ['a key', 'Refused: the key is 0123456789abcdef0123456789abcdef.'],
    ['a coordinate', 'Refused near 51.5007, -0.1246.'],
    ['markup', 'Refused <img src=x onerror=alert(1)>'],
  ])('shows the app’s own sentence, not a refusal that carries %s', async (_name, message) => {
    const refused = await answeredWith(
      () => Response.json({ error: { code: 'too_many', message } }, { status: 429 }),
      'backUpNow',
    );
    expect(refused).toMatchObject({ kind: 'refused' });
    expect(JSON.stringify(refused)).not.toContain(message);
    // The control: the instance's own sentence is shown as it is.
    expect(
      await answeredWith(
        () => Response.json({ error: { code: 'too_many', message: TOO_MANY } }, { status: 429 }),
        'backUpNow',
      ),
    ).toEqual({ kind: 'refused', sentence: TOO_MANY });
  });
});

describe('the AI backend’s reads and writes — #2609, #2610, #2611', () => {
  it('reads the settings, saves a switch and reads it back, and returns to .env, over the real instance', async () => {
    const { owner } = await operatedWorld();
    const port = createOperatePort(owner.dependencies);
    const before = await port.analysis();
    expect(before).toEqual({
      kind: 'analysis',
      local: {
        url: null,
        model: null,
        reasoningTokens: null,
        offered: true,
        othersMayUse: false,
        setIn: 'none',
        state: 'not-set',
      },
      hosted: { offered: true, operatorKey: 'none', operatorKeyOrigin: null },
    });
    const saved = await port.setAnalysis({ offerHosted: false, othersLocal: true });
    expect(saved.kind).toBe('analysis');
    // Read back on a fresh request, not the save's own answer.
    const after = await port.analysis();
    if (after.kind !== 'analysis') throw new Error(after.kind);
    expect([after.hosted.offered, after.local.othersMayUse]).toEqual([false, true]);
    const cleared = await port.clearAnalysis();
    if (cleared.kind !== 'analysis') throw new Error(cleared.kind);
    expect([cleared.hosted.offered, cleared.local.othersMayUse]).toEqual([true, false]);
  });

  it('is told which field a save was refused for, and nothing else', async () => {
    const { owner } = await operatedWorld();
    expect(
      await createOperatePort(owner.dependencies).setAnalysis({ localModel: 'two words' }),
    ).toEqual({
      kind: 'refused',
      fields: ['localModel'],
    });
  });

  it('reads the local models, a check and the jobs as the instance writes them, with no local server set', async () => {
    const { owner } = await operatedWorld();
    const port = createOperatePort(owner.dependencies);
    expect(await port.localModels()).toEqual({
      kind: 'models',
      state: 'no-address',
      version: null,
      models: [],
    });
    expect(await port.checkModel('some-model')).toEqual({ kind: 'checked', outcome: 'no-address' });
    const jobs = await port.jobs();
    expect(jobs.kind).toBe('jobs');
    if (jobs.kind === 'jobs') expect(jobs.counts.queued).toBe(0);
  });

  it('reads nothing of the AI backend for the deputy or a rider, whom the instance answers as no route', async () => {
    const { deputy, rider, approveRider } = await operatedWorld();
    await approveRider();
    for (const device of [deputy, rider]) {
      const port = createOperatePort(device.dependencies);
      expect(await port.analysis()).toEqual({ kind: 'not-owner' });
      expect(await port.localModels()).toEqual({ kind: 'not-owner' });
      expect(await port.checkModel('m')).toEqual({ kind: 'not-owner' });
      expect(await port.jobs()).toEqual({ kind: 'not-owner' });
      expect(await port.setAnalysis({ othersLocal: true })).toEqual({ kind: 'not-owner' });
    }
  });

  it('sends no check for a name the instance would refuse', async () => {
    const { owner, world } = await operatedWorld();
    const counted = countingSealed(world, '/v1/operate/analysis/check');
    const port = createOperatePort({ ...owner.dependencies, send: counted.send });
    expect(await port.checkModel('two words')).toEqual({ kind: 'unreachable' });
    expect(counted.count()).toBe(0);
  });

  async function answered(
    path: string,
    body: unknown,
    read: (port: ReturnType<typeof createOperatePort>) => Promise<unknown>,
  ) {
    const { owner, world } = await operatedWorld();
    return read(
      createOperatePort({
        ...owner.dependencies,
        send: (url, init) =>
          world.answeringAs(path, () => Response.json(body))(new Request(url, init)),
      }),
    );
  }

  const MODEL = {
    name: 'alpha:14b',
    sizeBytes: 9_000_000_000,
    parameters: '14.8B',
    quantisation: 'Q4_K_M',
    tools: 'listed',
    gpu: 'part',
    gpuPercent: 62,
  };

  it.each([
    ['a model whose name is markup', { ...MODEL, name: '<img src=x>' }],
    ['an unknown fit', { ...MODEL, gpu: 'most' }],
    ['a percent over 100', { ...MODEL, gpuPercent: 101 }],
    ['parameters that are free text', { ...MODEL, parameters: 'see https://example.com' }],
  ] as const)('shows no list that holds %s', async (_name, model) => {
    const read = (port: ReturnType<typeof createOperatePort>) => port.localModels();
    const good = { state: 'ollama', version: '0.12.6', models: [MODEL] };
    expect(
      ((await answered('/v1/operate/analysis/models', good, read)) as { kind: string }).kind,
    ).toBe('models');
    expect(
      await answered('/v1/operate/analysis/models', { ...good, models: [model] }, read),
    ).toEqual({
      kind: 'unreachable',
    });
  });

  it('carries no field of a job or the settings beyond its own: no athlete, no key', async () => {
    const job = {
      kind: 'write-up',
      source: 'local',
      status: 'failed',
      failure: 'model-unreachable',
      createdAt: '2026-11-14T09:00:00.000Z',
      endedAt: '2026-11-14T09:01:00.000Z',
      whose: 'other',
      athleteId: 'MARKER-athlete-2611',
    };
    const jobs = await answered(
      '/v1/operate/analysis/jobs',
      {
        counts: { queued: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0, withheld: 0 },
        failures: [{ code: 'model-unreachable', count: 1 }],
        recent: [job],
      },
      (port) => port.jobs(),
    );
    expect((jobs as { kind: string }).kind).toBe('jobs');
    expect(JSON.stringify(jobs)).not.toContain('MARKER-athlete-2611');
    const settings = await answered(
      '/v1/operate/analysis',
      {
        local: {
          url: 'http://ollama:11434/v1',
          model: 'alpha:14b',
          reasoningTokens: null,
          offered: true,
          othersMayUse: false,
          setIn: 'app',
          state: 'on',
        },
        hosted: {
          offered: true,
          operatorKey: 'held',
          operatorKeyOrigin: 'https://models.example',
          key: 'sk-MARKER-2611',
        },
      },
      (port) => port.analysis(),
    );
    expect((settings as { kind: string }).kind).toBe('analysis');
    expect(JSON.stringify(settings)).not.toContain('sk-MARKER-2611');
  });

  it('never carries the user and password of a local server address that has them (#2611)', async () => {
    const settings = await answered(
      '/v1/operate/analysis',
      {
        local: {
          url: 'http://MARKER-user:MARKER-pass@ollama:11434/v1',
          model: null,
          reasoningTokens: null,
          offered: true,
          othersMayUse: false,
          setIn: 'env',
          state: 'not-base-url',
        },
        hosted: { offered: true, operatorKey: 'none', operatorKeyOrigin: null },
      },
      (port) => port.analysis(),
    );
    expect(JSON.stringify(settings)).not.toContain('MARKER');
    expect(JSON.stringify(settings)).toContain('http://ollama:11434/v1');
  });
});

describe('the open rooms, and ending one — #2612', () => {
  /** A room as the instance writes one, every field well-formed. */
  const ROOM = {
    roomId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    shortCode: 'a1b2c3',
    kind: 'race',
    visibility: 'private',
    phase: 'riding',
    openedAt: '2026-11-14T19:30:00.000Z',
    host: 'Ann',
    riders: ['Ann', null],
    riderCount: 2,
  };

  async function roomsAnswered(answer: () => Response): Promise<unknown> {
    const { owner, world } = await operatedWorld();
    return createOperatePort({
      ...owner.dependencies,
      send: (url, init) => world.answeringAs('/v1/operate/rooms', answer)(new Request(url, init)),
    }).rooms();
  }

  it('carries the room’s own fields and nothing else the instance sent beside them', async () => {
    const read = await roomsAnswered(() =>
      Response.json({ rooms: [{ ...ROOM, distanceMetres: 1234.5, powerWatts: 317 }] }),
    );
    expect(read).toEqual({
      kind: 'rooms',
      rooms: [
        {
          roomId: ROOM.roomId,
          shortCode: 'a1b2c3',
          kind: 'race',
          visibility: 'private',
          phase: 'riding',
          openedAt: ROOM.openedAt,
          host: 'Ann',
          riders: ['Ann', null],
        },
      ],
    });
  });

  it.each([
    ['a count that is not its riders’', { riderCount: 3 }],
    ['a name longer than any the instance takes', { riders: ['x'.repeat(65), null] }],
    ['a rider who is a number', { riders: [42, null] }],
    ['a phase it does not know', { phase: 'paused' }],
    ['a short code that is not one', { shortCode: 'A1 B2' }],
    ['an id that is a path', { roomId: '../a1b2' }],
  ] as const)('shows no rooms when a room holds %s', async (_name, change) => {
    const body = (rooms: unknown[]) => () => Response.json({ rooms });
    // The control: the same answer, well-formed, is the rooms.
    expect(await roomsAnswered(body([ROOM]))).toMatchObject({ kind: 'rooms' });
    expect(await roomsAnswered(body([ROOM, { ...ROOM, ...change }]))).toEqual({
      kind: 'unreachable',
    });
  });

  it('sends no end for a room id the instance could not have written, or a reason it does not take', async () => {
    const { owner, sent } = await operatedWorld();
    const port = createOperatePort(owner.dependencies);
    const before = sent.length;
    expect(await port.endRoom('../etc', 'other', 'abc')).toEqual({ kind: 'not-ended' });
    expect(await port.endRoom(ROOM.roomId, 'because' as 'other', 'a1b2c3')).toEqual({
      kind: 'not-ended',
    });
    expect(sent.length).toBe(before);
  });

  it('is told an end the owner’s own instance refused, for a wrong code, as not ended', async () => {
    const { owner, rider, approveRider, world } = await operatedWorld();
    await approveRider();
    const room = await roomMadeBy(world, rider.athleteId(), 'race');
    const port = createOperatePort(owner.dependencies);
    expect(await port.endRoom(room, 'other', 'zzzzzz')).toEqual({ kind: 'not-ended' });
    const read = await port.rooms();
    expect(read.kind === 'rooms' ? read.rooms.map((each) => each.roomId) : read).toEqual([room]);
    expect(await port.endRoom(room, 'other', room.slice(0, 6))).toMatchObject({ kind: 'ended' });
    expect(await port.rooms()).toEqual({ kind: 'rooms', rooms: [] });
  });
});
