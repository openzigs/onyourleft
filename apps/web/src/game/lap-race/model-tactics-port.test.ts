// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2710: the device's tactics port, **read back through the real instance**
 * (#2709's routes, sealed, as `apps/instance`'s own test world serves them,
 * read by a computed `import()` — test code only, as
 * `instance/sealed-routes.test.ts` reads it). A race state the race built is
 * sent, the model's answer comes back, and the race logs it as a decision; a
 * withdrawn consent, a busy instance and a model with no answer each come back
 * as a refusal the race logs and rides past.
 *
 * And the port's own edges: no session sends nothing, and an answer it
 * cannot read is never an offer.
 */

import { kilograms } from '@onyourleft/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import {
  modelTacticsInputOf,
  startLapRaceModel,
  answerLapRaceModel,
  askLapRaceModel,
} from './model-race';
import {
  createModelTacticsPort,
  readTacticsStatus,
  type TacticsChannel,
  type TacticsSession,
} from './model-tactics-port';
import { lapRaceBotConditions, startLapRaceRide, stepLapRaceRide } from './ride-race';

interface World {
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string },
  ): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

interface SyncTesting {
  syncWorld(
    count: number,
    options?: { tactics?: Readonly<Record<string, unknown>> },
  ): Promise<{ world: World; riders: { token: string }[] }>;
}

interface TacticsTesting {
  readonly OFFERED: unknown;
  readonly TEST_TACTICS_MODEL: { readonly baseUrl: URL };
  chatServer(answer: (body: Readonly<Record<string, unknown>>) => string | undefined): {
    readonly fetch: typeof globalThis.fetch;
    readonly requests: { url: string; body: Readonly<Record<string, unknown>> }[];
  };
}

const INSTANCE = (path: string): string =>
  new URL(`../../../../instance/src/${path}`, import.meta.url).href;

let sync: SyncTesting;
let tactics: TacticsTesting;
const worlds: World[] = [];

beforeAll(async () => {
  sync = (await import(/* @vite-ignore */ INSTANCE('sync/sync-testing.ts'))) as SyncTesting;
  tactics = (await import(
    /* @vite-ignore */ INSTANCE('analysis/tactics-testing.ts')
  )) as TacticsTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  vi.restoreAllMocks();
});

/** The instance's own test world, `riders` signed in, its local model answering `answer`. */
async function instanceWith(
  riders: number,
  answer: (body: Readonly<Record<string, unknown>>) => string | undefined,
) {
  const server = tactics.chatServer(answer);
  const { world, riders: signedIn } = await sync.syncWorld(riders, {
    tactics: { local: tactics.OFFERED, fetch: server.fetch },
  });
  worlds.push(world);
  const portFor = (token: string) =>
    createModelTacticsPort({
      session: () =>
        Promise.resolve({
          kind: 'open',
          token,
          channel: { call: (method, path, options) => world.call(method, path, options) },
        }),
    });
  return { world, server, ports: signedIn.map((rider) => portFor(rider.token)) };
}

/** A race of seven bots a few seconds in, as the device holds one. */
function raceSoFar() {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 5;
      return array;
    },
  );
  const profile = circuitRoute(100, () => 0);
  const started = startLapRaceRide({
    choice: { laps: 3, bots: 7, tier: 'brisk', itemsOn: false },
    profile,
    conditions: lapRaceBotConditions(
      profile,
      rideConditionsFor(kilograms(75), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
    draft: true,
    riderMassKilograms: 75,
    model: true,
  });
  vi.restoreAllMocks();
  if (started === undefined) throw new Error('a circuit starts a race');
  return stepLapRaceRide(
    { ...started, countdownLeftMs: 0 },
    { ticks: 100, along: 40, riderWatts: 220 },
  );
}

const ATTACK = JSON.stringify({
  bots: [
    { bot: 0, move: 'attack' },
    { bot: 4, move: 'follow' },
  ],
});

describe('the tactics port, through the real instance (#2709’s routes)', () => {
  it('offers, records a consent, warms the model, and brings back a decision the race logs', async () => {
    const { server, ports } = await instanceWith(1, () => ATTACK);
    const port = ports[0]!;
    const before = await port.tacticsStatus();
    expect(before).toEqual({
      kind: 'offered',
      instance: 'https://ride.example',
      modelAddress: tactics.TEST_TACTICS_MODEL.baseUrl.href,
      consented: false,
    });
    if (before.kind !== 'offered') return;
    const after = await port.recordTacticsConsent(before);
    expect(after).toMatchObject({ kind: 'offered', consented: true });
    expect(await port.tacticsStatus()).toMatchObject({ consented: true });

    expect(await port.startTacticsRace()).toEqual({ kind: 'answer', body: { warming: true } });

    const ride = raceSoFar();
    const model = ride.model ?? startLapRaceModel();
    const asking = askLapRaceModel(
      model,
      ride.race,
      ride.bots,
      ride.conditions,
      ride.seed,
      true,
      220 / 75,
    );
    expect(asking.send).toBeDefined();
    const send = asking.send!;
    const reply = await port.decideTactics(send.input);
    expect(reply).toEqual({
      kind: 'answer',
      body: {
        bots: [
          { bot: 0, move: 'attack' },
          { bot: 4, move: 'follow' },
        ],
      },
    });
    const logged = answerLapRaceModel(asking.model, ride.race, send.ask, reply);
    expect(logged.log.at(-1)).toMatchObject({
      outcome: 'decision',
      moves: [
        { bot: 0, move: 'attack' },
        { bot: 4, move: 'follow' },
      ],
    });
    // The model was asked about the very race state the device sent.
    const asked = server.requests.at(-1)?.body.messages as { content: string }[];
    expect(JSON.parse(asked.at(-1)?.content ?? '')).toEqual(send.input);
    await port.endTacticsRace();
  });

  it('comes back refused after a withdrawal, and for a second rider while one races (D-5.4, D-6.3)', async () => {
    const { ports } = await instanceWith(2, () => ATTACK);
    const [one, two] = ports as [(typeof ports)[0], (typeof ports)[0]];
    for (const port of [one, two]) {
      const status = await port.tacticsStatus();
      if (status.kind === 'offered') await port.recordTacticsConsent(status);
    }
    const ride = raceSoFar();
    const input = modelTacticsInputOf(
      ride.race,
      ride.bots,
      ride.conditions,
      ride.seed,
      true,
      3,
      0,
    )!;
    expect((await one.startTacticsRace()).kind).toBe('answer');
    expect(await two.startTacticsRace()).toEqual({ kind: 'refused', code: 'tactics_busy' });
    expect(await two.decideTactics(input)).toEqual({ kind: 'refused', code: 'tactics_busy' });
    await one.endTacticsRace();

    expect(await one.withdrawTacticsConsent()).toMatchObject({ kind: 'offered', consented: false });
    expect(await one.decideTactics(input)).toEqual({
      kind: 'refused',
      code: 'tactics_consent_required',
    });
  });

  it('comes back refused when the model gave no decision', async () => {
    const { ports } = await instanceWith(1, () => undefined);
    const port = ports[0]!;
    const status = await port.tacticsStatus();
    if (status.kind === 'offered') await port.recordTacticsConsent(status);
    const ride = raceSoFar();
    const input = modelTacticsInputOf(
      ride.race,
      ride.bots,
      ride.conditions,
      ride.seed,
      true,
      3,
      0,
    )!;
    expect(await port.decideTactics(input)).toEqual({ kind: 'refused', code: 'tactics_failed' });
  });
});

describe('the tactics port’s own edges', () => {
  it('sends nothing with no session, and says so as unreachable', async () => {
    const calls: string[] = [];
    const channel: TacticsChannel = {
      call: (method, path) => {
        calls.push(`${method} ${path}`);
        return Promise.resolve({ status: 200, body: {} });
      },
    };
    let session: TacticsSession = { kind: 'closed' };
    const port = createModelTacticsPort({ session: () => Promise.resolve(session) });
    expect(await port.tacticsStatus()).toEqual({ kind: 'unreachable' });
    expect(await port.startTacticsRace()).toEqual({ kind: 'unreachable' });
    expect(calls).toEqual([]);
    session = { kind: 'open', token: 't', channel };
    await port.endTacticsRace();
    expect(calls).toEqual(['POST /v1/analysis/tactics/end']);
  });

  it('is unreachable when a call throws, or the session cannot be had', async () => {
    const throwing = createModelTacticsPort({
      session: () =>
        Promise.resolve({
          kind: 'open',
          token: 't',
          channel: { call: () => Promise.reject(new Error('offline')) },
        }),
    });
    expect(await throwing.decideTactics({} as never)).toEqual({ kind: 'unreachable' });
    const noSession = createModelTacticsPort({
      session: () => Promise.reject(new Error('no keys')),
    });
    expect(await noSession.withdrawTacticsConsent()).toEqual({ kind: 'unreachable' });
  });

  it('reads a status field by field, and never offers on one it cannot read', () => {
    const offered = {
      offered: true,
      instance: 'https://i',
      modelAddress: 'http://127.0.0.1/v1',
      consent: null,
      consented: false,
    };
    expect(readTacticsStatus({ status: 200, body: offered })).toMatchObject({ kind: 'offered' });
    expect(
      readTacticsStatus({ status: 200, body: { ...offered, offered: false, modelAddress: null } }),
    ).toEqual({
      kind: 'not-offered',
    });
    for (const body of [
      null,
      [],
      'yes',
      { ...offered, offered: 'true' },
      { ...offered, consented: 1 },
      { ...offered, modelAddress: null },
      { ...offered, instance: '' },
      { ...offered, instance: 'x'.repeat(2_049) },
    ]) {
      expect(readTacticsStatus({ status: 200, body })).toEqual({ kind: 'unreachable' });
    }
    expect(readTacticsStatus({ status: 503, body: offered })).toEqual({ kind: 'unreachable' });
  });

  it('keeps a refusal’s code only when it is a code', async () => {
    const answering = (body: unknown) =>
      createModelTacticsPort({
        session: () =>
          Promise.resolve({
            kind: 'open',
            token: 't',
            channel: { call: () => Promise.resolve({ status: 429, body }) },
          }),
      });
    expect(await answering({ error: { code: 'rate_limited' } }).startTacticsRace()).toEqual({
      kind: 'refused',
      code: 'rate_limited',
    });
    expect(await answering({ error: { code: 'Not A Code!' } }).startTacticsRace()).toEqual({
      kind: 'refused',
    });
    expect(await answering(null).startTacticsRace()).toEqual({ kind: 'refused' });
  });
});
