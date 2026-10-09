// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Moderation screen's port (#955) against the REAL instance:
 * `apps/instance`'s own handler, its identity and moderation routes (#891) and
 * a real SQLite file, reached through {@link ModerationPortDependencies.send}
 * with no network, as `instance-port.test.ts` reaches it. The moderator is
 * THIS device: its store's own WebCrypto key is the one the instance is
 * started naming as `OYL_INSTANCE_OWNER_KEY` — and, as on the project's
 * instance since #905, there is no deputy.
 *
 * `apps/instance` is imported by a computed path, for `instance-port.test.ts`'s
 * reason; the shape it is used through is written down here.
 */

import { toHex, unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { createInstancePort, type InstanceStorage } from './instance-port';
import { LOADED_LOCALLY } from './testing';
import type { InstanceSend } from './instance-transport';
import { readInstanceAccount } from './sign-in';
import {
  createModerationPort,
  isConflict,
  MODERATION_LOG_PAGE,
  MODERATION_REFUSAL_TEXT,
  NOTHING_CHANGED_TEXT,
  SUSPENDED_PAGE,
  type ModerationPort,
  type ModerationPortDependencies,
  type ModerationRead,
} from './moderation-port';

interface TestDevice {
  readonly publicKey: string;
}

interface ModerationInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly clock: { ms: number };
  /** The instance's card (#1190): a new key registers only sealed (#1192). */
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  /** A handler answering, as this instance, one sealed inner route (#1192). */
  answeringAs(path: string, answer: () => Response): (request: Request) => Promise<Response>;
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string },
  ): Promise<{ status: number; body: unknown }>;
  signIn(
    device: TestDevice,
    extra?: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  testDevice(): Promise<TestDevice>;
  startIdentityInstance(options: {
    registration: 'approval' | 'open';
    moderators: { owner: string };
  }): Promise<ModerationInstance>;
}

const INSTANCE_TESTING = new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
const worlds: ModerationInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

function deviceStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** A rider signed in with a key of their own, straight through the instance. */
interface Rider {
  readonly athleteId: string;
  readonly token: string;
  readonly recoveryCodes: readonly string[];
}

interface World {
  readonly world: ModerationInstance;
  readonly send: InstanceSend & ReturnType<typeof vi.fn>;
  /** This device's moderation port — the device the instance names as moderator. */
  readonly moderator: ModerationPort;
  /** This device's port's dependencies, for a port over a `send` a test wraps. */
  readonly moderatorDependencies: ModerationPortDependencies;
  /** The moderator's own id on the instance. */
  readonly me: string;
  /** Another device's port: an account waiting for approval, then an ordinary rider. */
  readonly ordinary: ModerationPort;
  readonly ordinaryId: string;
  readonly rider: (displayName: string) => Promise<Rider>;
}

interface Device {
  readonly storage: InstanceStorage;
  /** What this device's moderation port is built over (#1192: it seals, so it signs). */
  readonly dependencies: ModerationPortDependencies;
  readonly publicKey: string;
  connect(): Promise<void>;
  /** This device's own id on the instance, once connected. */
  athleteId(): string;
}

/** A device with its own store and key, not yet connected. `card` is the instance's, once it has started. */
async function aDevice(
  send: InstanceSend,
  name: string,
  card: () => Promise<string>,
): Promise<Device> {
  const store = createStoreHarness();
  harnesses.push(store);
  const storage = deviceStorage();
  const signingKey = () =>
    store.write(async (open) => {
      await ensureLocalAthlete(open, NOW);
      return ensureDeviceSigningKey(open, LOCAL_ATHLETE);
    });
  const dependencies: ModerationPortDependencies = {
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
    storage,
    dependencies,
    publicKey: toHex((await signingKey()).publicKey),
    connect: async () => {
      // With the instance's card: a new key registers only sealed (#1192).
      const outcome = await port.connect(testing.TEST_ORIGIN, name, await card());
      if (outcome.kind !== 'connected') throw new Error(`connect: ${JSON.stringify(outcome)}`);
    },
    athleteId: () => readInstanceAccount(storage)?.instanceAthleteId ?? '',
  };
}

/**
 * An approval-required instance (#775) whose moderator is THIS device, and a
 * second device whose account is waiting for approval.
 */
async function moderatedWorld(): Promise<World> {
  // The key is minted before the instance starts, because the instance is
  // started naming it — exactly as an operator names `OYL_INSTANCE_OWNER_KEY`.
  const started: { world?: ModerationInstance } = {};
  const send = vi.fn((url: string, init: RequestInit) => {
    if (started.world === undefined) throw new Error('no instance yet');
    return started.world.instance.handler(new Request(url, init));
  });
  const card = async (): Promise<string> => {
    if (started.world === undefined) throw new Error('no instance yet');
    return (await started.world.instanceKeys.show()).card;
  };
  const moderatorDevice = await aDevice(send, 'Moderator', card);
  const waitingDevice = await aDevice(send, 'Waiting', card);
  const world = await testing.startIdentityInstance({
    registration: 'approval',
    moderators: { owner: moderatorDevice.publicKey },
  });
  started.world = world;
  worlds.push(world);
  const opened = world;
  await moderatorDevice.connect();
  opened.clock.ms += 60_000;
  await waitingDevice.connect();
  return {
    world: opened,
    send,
    me: moderatorDevice.athleteId(),
    moderator: createModerationPort(moderatorDevice.dependencies),
    moderatorDependencies: moderatorDevice.dependencies,
    ordinary: createModerationPort(waitingDevice.dependencies),
    ordinaryId: waitingDevice.athleteId(),
    rider: async (displayName) => {
      opened.clock.ms += 60_000;
      const signed = await opened.signIn(await testing.testDevice(), { displayName });
      if (signed.status !== 200) throw new Error(`sign-in: ${JSON.stringify(signed.body)}`);
      return {
        athleteId: signed.body.athleteId as string,
        token: signed.body.sessionToken as string,
        recoveryCodes: signed.body.recoveryCodes as string[],
      };
    },
  };
}

function asModerator(read: ModerationRead) {
  if (read.kind !== 'moderator') throw new Error(`not a moderator's read: ${read.kind}`);
  return read;
}

/**
 * A moderator's read's first page of the log, which must have been read —
 * turned oldest first, so the newest entry is `.at(-1)`. The instance pages
 * it newest first (#961).
 */
function logOf(read: ModerationRead) {
  const { log } = asModerator(read);
  if (log === undefined) throw new Error('the log was not read');
  return [...log.items].reverse();
}

/**
 * The moderator’s port over the real instance, except that a request for
 * `path` is answered `answer()` without reaching the route — a proxy's page,
 * or a log this client must not accept. A plaintext route is answered as it
 * stands; a SEALED one (#1192) is answered by the instance itself
 * (`answeringAs`), its 200 sealed back, because nobody on the way can write a
 * sealed answer any more.
 */
function answeredAt(
  { world, moderatorDependencies }: World,
  path: string,
  answer: () => Response,
): ModerationPort {
  const sealedAnswer = world.answeringAs(path, answer);
  const wrapped: InstanceSend = (url, init) =>
    new URL(url).pathname === path
      ? Promise.resolve(answer())
      : sealedAnswer(new Request(url, init));
  return createModerationPort({ ...moderatorDependencies, send: wrapped });
}

describe('who is a moderator — #955', () => {
  it('sends nothing, and says so, on a device connected to no instance', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const port = createModerationPort({
      storage: deviceStorage(),
      send,
      loadedFrom: LOADED_LOCALLY,
      signingKey: () => Promise.reject(new Error('no key is asked for')),
    });
    expect(await port.standing()).toBe('not-connected');
    expect(await port.read()).toEqual({ kind: 'not-connected' });
    expect(await port.decideRegistration('someone', 'approve', 'why')).toEqual({
      kind: 'refused',
      text: MODERATION_REFUSAL_TEXT['signed-out'],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('is the account the instance names — not one waiting for approval, nor an ordinary rider', async () => {
    const { moderator, ordinary, ordinaryId } = await moderatedWorld();
    expect(await moderator.standing()).toBe('moderator');
    // Waiting: refused about its own account before the route is reached.
    expect(await ordinary.standing()).toBe('not-moderator');
    await moderator.decideRegistration(ordinaryId, 'approve', 'ok');
    // Active: answered as a route that does not exist.
    expect(await ordinary.standing()).toBe('not-moderator');
    expect(await ordinary.read()).toEqual({ kind: 'not-moderator' });
  });

  // #957's review: the project's instance is behind a tunnel with an IP rule,
  // whose own 404 or 403 is a page of HTML and not the instance's answer.
  it.each([
    ['a bare HTML 404', 404, '<html><body>Not Found</body></html>', 'text/html'],
    ['a bare 403', 403, 'Forbidden', 'text/plain'],
    ['a 404 with another code', 404, '{"error":{"code":"no_route"}}', 'application/json'],
    ['a 403 with another code', 403, '{"error":{"code":"forbidden"}}', 'application/json'],
  ] as const)(
    'reads %s from a proxy as unreachable, never as "not a moderator"',
    async (_name, status, body, type) => {
      const world = await moderatedWorld();
      // Who moderates is read from `GET /v1/auth/account` (#1192), in plaintext:
      // a proxy can answer that, and it is where a proxy's page is met.
      const proxied = answeredAt(
        world,
        '/v1/auth/account',
        () => new Response(body, { status, headers: { 'content-type': type } }),
      );
      expect(await proxied.standing()).toBe('unreachable');
      expect(await proxied.read()).toEqual({ kind: 'unreachable' });
      // The control: the instance itself still says who moderates.
      expect(await world.moderator.standing()).toBe('moderator');
    },
  );

  it('tells a rider who is not a moderator nothing about whether an account exists', async () => {
    const { moderator, ordinary, ordinaryId, rider } = await moderatedWorld();
    const real = await rider('Real');
    for (const approved of [false, true]) {
      if (approved) await moderator.decideRegistration(ordinaryId, 'approve', 'ok');
      const somebody = await ordinary.actOnAccount(real.athleteId, 'suspend', 'testing');
      const nobody = await ordinary.actOnAccount('nobody-at-all', 'suspend', 'testing');
      expect(somebody).toEqual({ kind: 'refused', text: NOTHING_CHANGED_TEXT });
      expect(nobody).toEqual(somebody);
      expect(await ordinary.dismissReport(1, 'testing')).toEqual(somebody);
      expect(await ordinary.decideRegistration(real.athleteId, 'approve', 'testing')).toEqual(
        somebody,
      );
    }
    // And nothing it tried was done.
    expect(asModerator(await moderator.read()).registrations.map((each) => each.athleteId)).toEqual(
      [real.athleteId],
    );
  });
});

describe('the approval queue — #775, #955', () => {
  it('lists a waiting account, approves it with a reason, and reads the queue and the log back', async () => {
    const { moderator, ordinary, ordinaryId, me } = await moderatedWorld();
    const before = asModerator(await moderator.read());
    expect(before.me).toBe(me);
    expect(before.registrations).toEqual([
      expect.objectContaining({ athleteId: ordinaryId, displayName: 'Waiting' }),
    ]);

    expect(
      await moderator.decideRegistration(ordinaryId, 'approve', '  Known to the club.  '),
    ).toEqual({
      kind: 'done',
    });

    const after = asModerator(await moderator.read());
    expect(after.registrations).toEqual([]);
    expect(logOf(after).at(-1)).toMatchObject({
      action: 'approve_registration',
      actorAthleteId: me,
      targetAthleteId: ordinaryId,
      reason: 'Known to the club.',
    });
    // Approved is not a moderator.
    expect(await ordinary.standing()).toBe('not-moderator');
  });

  it('refuses an account, which then leaves the queue', async () => {
    const { moderator, ordinaryId } = await moderatedWorld();
    // An id as it might be pasted, with space round it (#957's review).
    expect(await moderator.decideRegistration(` ${ordinaryId} `, 'refuse', 'Not known.')).toEqual({
      kind: 'done',
    });
    const after = asModerator(await moderator.read());
    expect(after.registrations).toEqual([]);
    expect(logOf(after).at(-1)).toMatchObject({
      action: 'refuse_registration',
      targetAthleteId: ordinaryId,
    });
  });

  it('sends nothing for a blank reason or a malformed id', async () => {
    const { moderator, ordinaryId, send } = await moderatedWorld();
    const sent = send.mock.calls.length;
    expect(await moderator.decideRegistration(ordinaryId, 'approve', '   ')).toEqual({
      kind: 'refused',
      text: MODERATION_REFUSAL_TEXT.reason,
    });
    expect(await moderator.decideRegistration('../auth/session', 'approve', 'why')).toEqual({
      kind: 'refused',
      text: MODERATION_REFUSAL_TEXT['athlete-id'],
    });
    expect(send.mock.calls.length).toBe(sent);
    expect(asModerator(await moderator.read()).registrations).toHaveLength(1);
  });
});

describe('reports, suspending and hiding — #83, #905, #955', () => {
  it('decides a report by acting on its account, which closes it', async () => {
    const { world, moderator, rider } = await moderatedWorld();
    const carys = await rider('Carys');
    const dafydd = await rider('Dafydd');
    await moderator.decideRegistration(carys.athleteId, 'approve', 'ok');
    await moderator.decideRegistration(dafydd.athleteId, 'approve', 'ok');
    const reported = await world.call('POST', '/v1/reports', {
      token: carys.token,
      body: { athleteId: dafydd.athleteId, reason: 'A slur for a name.' },
    });
    expect(reported.status).toBe(204);

    const [report] = asModerator(await moderator.read()).reports;
    expect(report).toMatchObject({
      reporterAthleteId: carys.athleteId,
      targetAthleteId: dafydd.athleteId,
      reason: 'A slur for a name.',
    });
    expect(
      await moderator.actOnAccount(
        dafydd.athleteId,
        'suspend',
        'For the report.',
        report?.reportId,
      ),
    ).toEqual({ kind: 'done' });

    const after = asModerator(await moderator.read());
    expect(after.reports).toEqual([]);
    expect(logOf(after).at(-1)).toMatchObject({
      action: 'suspend',
      targetAthleteId: dafydd.athleteId,
      reportId: report?.reportId,
    });
    // Suspended is suspended: the instance ended Dafydd's session.
    expect((await world.call('GET', '/v1/auth/session', { token: dafydd.token })).status).toBe(401);

    // Lifted, and hidden, each logged.
    expect(await moderator.actOnAccount(dafydd.athleteId, 'unsuspend', 'Apologised.')).toEqual({
      kind: 'done',
    });
    expect(
      await moderator.actOnAccount(` ${carys.athleteId} `, 'hide_display_name', 'Rude name.'),
    ).toEqual({
      kind: 'done',
    });
    expect(logOf(await moderator.read()).slice(-2)).toEqual([
      expect.objectContaining({ action: 'unsuspend', targetAthleteId: dafydd.athleteId }),
      expect.objectContaining({ action: 'hide_display_name', targetAthleteId: carys.athleteId }),
    ]);
  });

  it('dismisses a report, which leaves the queue', async () => {
    const { world, moderator, rider } = await moderatedWorld();
    const carys = await rider('Carys');
    const dafydd = await rider('Dafydd');
    await moderator.decideRegistration(carys.athleteId, 'approve', 'ok');
    await world.call('POST', '/v1/reports', {
      token: carys.token,
      body: { athleteId: dafydd.athleteId, reason: 'Nothing much.' },
    });
    const [report] = asModerator(await moderator.read()).reports;
    expect(await moderator.dismissReport(report?.reportId ?? 0, 'Not a breach.')).toEqual({
      kind: 'done',
    });
    expect(asModerator(await moderator.read()).reports).toEqual([]);
  });

  it('declares a report about the moderator a conflict, which the instance will not let them close', async () => {
    const { world, moderator, rider, me } = await moderatedWorld();
    const carys = await rider('Carys');
    await moderator.decideRegistration(carys.athleteId, 'approve', 'ok');
    await world.call('POST', '/v1/reports', {
      token: carys.token,
      body: { athleteId: me, reason: 'The moderator is unfair.' },
    });
    const read = asModerator(await moderator.read());
    const [report] = read.reports;
    expect(report === undefined ? false : isConflict(report, read.me)).toBe(true);
    // Refused by the instance, and so still open: the one moderator cannot decide it.
    expect(await moderator.dismissReport(report?.reportId ?? 0, 'Unfounded.')).toEqual({
      kind: 'refused',
      text: NOTHING_CHANGED_TEXT,
    });
    expect(asModerator(await moderator.read()).reports).toEqual([report]);
  });

  it('says the same whether an account does not exist or cannot be acted on', async () => {
    const { moderator, rider, me } = await moderatedWorld();
    const carys = await rider('Carys');
    await moderator.decideRegistration(carys.athleteId, 'approve', 'ok');
    await moderator.actOnAccount(carys.athleteId, 'suspend', 'First time.');
    const nobody = await moderator.actOnAccount('nobody-at-all', 'suspend', 'why');
    const already = await moderator.actOnAccount(carys.athleteId, 'suspend', 'Again.');
    const themselves = await moderator.actOnAccount(me, 'suspend', 'Myself.');
    const noReport = await moderator.dismissReport(999, 'why');
    expect(nobody).toEqual({ kind: 'refused', text: NOTHING_CHANGED_TEXT });
    expect(already).toEqual(nobody);
    expect(themselves).toEqual(nobody);
    expect(noReport).toEqual(nobody);
  });
});

describe('the suspended accounts — #961', () => {
  it('lists each suspended account, most recently suspended first, and a lifted one leaves it', async () => {
    const { world, moderator, rider } = await moderatedWorld();
    const carys = await rider('Carys');
    const dafydd = await rider('Dafydd');
    expect(asModerator(await moderator.read()).suspended).toEqual({ items: [], next: null });
    await moderator.actOnAccount(carys.athleteId, 'suspend', 'First.');
    world.clock.ms += 1000;
    await moderator.actOnAccount(dafydd.athleteId, 'suspend', 'Second.');
    const read = asModerator(await moderator.read());
    expect(read.suspended?.items.map((each) => [each.athleteId, each.displayName])).toEqual([
      [dafydd.athleteId, 'Dafydd'],
      [carys.athleteId, 'Carys'],
    ]);
    expect(read.suspended?.next).toBeNull();
    // Lifted by the id the list gave, with no hunt through the log.
    const [first] = read.suspended?.items ?? [];
    expect(await moderator.actOnAccount(first?.athleteId ?? '', 'unsuspend', 'Lifted.')).toEqual({
      kind: 'done',
    });
    expect(
      asModerator(await moderator.read()).suspended?.items.map((each) => each.athleteId),
    ).toEqual([carys.athleteId]);
  });

  it(`pages past ${String(SUSPENDED_PAGE)}, and More gives the rest`, async () => {
    const { world, moderator, rider } = await moderatedWorld();
    const ids: string[] = [];
    for (let index = 0; index <= SUSPENDED_PAGE; index += 1) {
      const each = await rider(`Rider ${String(index)}`);
      await moderator.actOnAccount(each.athleteId, 'suspend', 'r');
      ids.push(each.athleteId);
    }
    expect(world.clock.ms).toBeGreaterThan(0);
    const first = asModerator(await moderator.read()).suspended;
    expect(first?.items).toHaveLength(SUSPENDED_PAGE);
    const second = await moderator.moreSuspended(first?.next ?? '');
    expect(second?.items).toHaveLength(1);
    expect(second?.next).toBeNull();
    // The first suspended is the last listed.
    expect(second?.items[0]?.athleteId).toBe(ids[0]);
    expect(
      [...(first?.items ?? []), ...(second?.items ?? [])].map((each) => each.athleteId).sort(),
    ).toEqual([...ids].sort());
  });

  it('still gives the queues when the suspended accounts cannot be read', async () => {
    const world = await moderatedWorld();
    const read = asModerator(
      await answeredAt(world, '/v1/moderation/suspended', () =>
        Response.json({
          items: [{ athleteId: '../x', displayName: 'x', suspendedAt: 1 }],
          next: null,
        }),
      ).read(),
    );
    expect(read.suspended).toBeUndefined();
    expect(read.registrations).toHaveLength(1);
    expect(read.log).toBeDefined();
  });
});

describe('the moderation log — #891, #899, #955', () => {
  // #957's review: the log is read on its own, so a log the client cannot
  // take does not take the two queues with it.
  it.each([
    [
      'one row it does not accept',
      () =>
        Response.json({
          entries: [{ logId: 1, action: 'suspend', actorAthleteId: '../x', reason: 'r', at: 1 }],
          next: null,
        }),
    ],
    ['a next cursor it does not accept', () => Response.json({ entries: [], next: 'not/ours' })],
    [
      // A page is read under the ordinary 256 KiB since #961, not a room route's 2 MiB.
      'an answer past its bound',
      () =>
        new Response(`{"entries":[],"next":null,"pad":"${'x'.repeat(256 * 1024 + 1)}"}`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    ['no answer it can read', () => new Response('<html>Bad gateway</html>', { status: 502 })],
  ] as const)('still gives the queues with %s in the log', async (_name, answer) => {
    const world = await moderatedWorld();
    const read = asModerator(await answeredAt(world, '/v1/moderation/log', answer).read());
    expect(read.log).toBeUndefined();
    expect(read.registrations).toEqual([
      expect.objectContaining({ athleteId: world.ordinaryId, displayName: 'Waiting' }),
    ]);
    expect(read.reports).toEqual([]);
    // The control: read straight, the same instance gives its log.
    expect(logOf(await world.moderator.read())).toEqual(expect.any(Array));
  });

  it(`is read newest first, ${String(MODERATION_LOG_PAGE)} at a time, and More reaches the rest exactly once — #961`, async () => {
    const { moderator, rider, ordinaryId } = await moderatedWorld();
    const carys = await rider('Carys');
    await moderator.decideRegistration(ordinaryId, 'approve', 'ok');
    // Enough actions for a second page: a suspension put on and lifted, over and over.
    for (let round = 0; round < MODERATION_LOG_PAGE; round += 1) {
      await moderator.actOnAccount(carys.athleteId, round % 2 === 0 ? 'suspend' : 'unsuspend', 'r');
    }
    const first = asModerator(await moderator.read()).log;
    expect(first?.items).toHaveLength(MODERATION_LOG_PAGE);
    expect(first?.items[0]).toMatchObject({ action: 'suspend', targetAthleteId: carys.athleteId });
    const ids = first?.items.map((entry) => entry.logId) ?? [];
    expect(ids).toEqual([...ids].sort((left, right) => right - left));
    expect(first?.next).toEqual(expect.any(String));

    const second = await moderator.moreLog(first?.next ?? '');
    expect(second).toEqual({
      items: [
        expect.objectContaining({ action: 'approve_registration', targetAthleteId: ordinaryId }),
      ],
      next: null,
    });
    expect(new Set([...ids, ...(second?.items ?? []).map((entry) => entry.logId)]).size).toBe(
      MODERATION_LOG_PAGE + 1,
    );
  });

  it('sends nothing for a cursor the instance could not have written, and reads none for a rider who is not a moderator', async () => {
    const { moderator, ordinary, send } = await moderatedWorld();
    const sent = send.mock.calls.length;
    expect(await moderator.moreLog('../auth/session')).toBeUndefined();
    expect(await moderator.moreSuspended('')).toBeUndefined();
    expect(send.mock.calls.length).toBe(sent);
    // The instance's own refusal of a cursor it did not write.
    expect(await moderator.moreLog('bm90LW91cnM')).toBeUndefined();
    // An ordinary rider is answered as though there were no such route.
    expect(await ordinary.moreLog('bm90LW91cnM')).toBeUndefined();
  });

  it('is read, newest last as the instance keeps it, and outlives an erased account', async () => {
    const { world, moderator, rider } = await moderatedWorld();
    const carys = await rider('Carys');
    await moderator.decideRegistration(carys.athleteId, 'approve', 'Known to the club.');
    await moderator.actOnAccount(carys.athleteId, 'hide_display_name', 'Rude name.');
    const before = logOf(await moderator.read());

    const erased = await world.call('DELETE', '/v1/account', {
      token: carys.token,
      body: { recoveryCode: carys.recoveryCodes[0] },
    });
    expect(erased.status).toBe(204);

    const after = logOf(await moderator.read());
    expect(after).toEqual(before);
    expect(after.filter((entry) => entry.targetAthleteId === carys.athleteId)).toHaveLength(2);
  });
});
