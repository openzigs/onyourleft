// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/operate/log` (#2602), called through the real listener, sealed, as
 * every caller who might try it — and the entries it shows written the way a
 * real writer writes them: through `SqlStore.recordOperatorAction` on another
 * connection that is then closed, and by the operator's CLI.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { runCommand } from '../operator/run.ts';
import type { OperatorLogEntry } from '../store/sql-store.ts';

const LOG = '/v1/operate/log';

interface LogBody {
  readonly entries: readonly {
    readonly id: number;
    readonly at: string;
    readonly source: string;
    readonly action: string;
    readonly detail: string | null;
    readonly outcome: string;
  }[];
  readonly cursor: string | null;
}

/** The operator's CLI, in this process, against the world's own database file. */
async function cli(
  world: ModerationWorld,
  argv: readonly string[],
  extra: { secret?: string; ownerKey?: string; input?: string } = {},
): Promise<number> {
  const report = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const refusal = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    return await runCommand(argv, {
      database: world.path,
      blobs: `${world.path}.blobs`,
      secret: extra.secret,
      ownerKey: extra.ownerKey,
      readStandardInput: () => Promise.resolve(extra.input ?? ''),
    });
  } finally {
    report.mockRestore();
    refusal.mockRestore();
  }
}

const wholeLog = (world: ModerationWorld): Promise<readonly OperatorLogEntry[]> =>
  world.freshRead((store) => store.listOperatorLogPage(undefined, 200));

describe('GET /v1/operate/log — the owner’s, and nobody else’s (#2602)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld({ registration: 'approval' });
  });
  afterAll(() => world.close());

  it('answers the owner 200; the deputy, an approved rider and a pending one exactly as no route; and no session unauthenticated — changing nothing', async () => {
    const approved = await world.rider('Approved');
    expect(
      (
        await world.as(
          world.owner,
          'POST',
          `/v1/moderation/registrations/${approved.athleteId}/approve`,
          {
            reason: 'Known',
          },
        )
      ).status,
    ).toBe(200);
    const pending = await world.rider('Pending');
    expect((await world.as(pending, 'GET', '/v1/auth/account')).status).toBe(200);
    // An approved rider is a rider: they reach a rider's route.
    expect((await world.as(approved, 'GET', '/v1/blocks')).status).toBe(200);
    const before = await wholeLog(world);

    const owner = await world.as(world.owner, 'GET', LOG);
    expect(owner.status).toBe(200);
    expect(Array.isArray((owner.body as LogBody).entries)).toBe(true);
    expect((owner.body as LogBody).cursor).toBeNull();

    const nowhere = await world.as(approved, 'GET', '/v1/no-such-route');
    expect(nowhere.status).toBe(404);
    for (const caller of [world.deputy, approved, pending]) {
      const answer = await world.as(caller, 'GET', LOG);
      expect(answer).toEqual(nowhere);
      expect(codeOf(answer.body)).toBe('not_found');
    }

    const anonymous = await world.call('GET', LOG, { signer: null });
    expect(anonymous.status).toBe(401);
    expect(codeOf(anonymous.body)).toBe('unauthenticated');

    // Read back through the store, not the answers: nothing changed.
    expect(await wholeLog(world)).toEqual(before);
  });

  it('refuses it in plaintext on an instance that seals: the owner’s area is never served unsealed', async () => {
    const plain = await world.call('GET', LOG, { token: world.owner.token, plain: true });
    expect(plain.status).toBe(403);
    expect(codeOf(plain.body)).toBe('sealed_required');
  });
});

describe('what GET /v1/operate/log shows is what was written (#2602)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld();
  });
  afterAll(() => world.close());

  it('shows an entry written through the store function on another connection, closed before the read', async () => {
    // `freshRead` opens its own store on the file and closes it after.
    const written = await world.freshRead((store) =>
      store.recordOperatorAction(
        {
          actor: { source: 'app', athleteId: world.owner.athleteId },
          action: 'room_open',
          at: 1_790_004_000,
        },
        () => ({ outcome: 'done', detail: 'ride', value: undefined }),
      ),
    );
    const read = await world.as(world.owner, 'GET', LOG);
    expect(read.status).toBe(200);
    expect((read.body as LogBody).entries[0]).toEqual({
      id: written.logId,
      at: new Date(1_790_004_000 * 1000).toISOString(),
      source: 'app',
      action: 'room_open',
      detail: 'ride',
      outcome: 'done',
    });
  });

  it('shows what the operator’s CLI did, from the CLI, and pages it newest first', async () => {
    expect(await cli(world, ['model-key', 'clear'])).toBe(0);
    expect(await cli(world, ['model-key', 'clear'])).toBe(0);
    const first = await world.as(world.owner, 'GET', `${LOG}?limit=2`);
    expect(first.status).toBe(200);
    const page = first.body as LogBody;
    expect(page.entries.map((entry) => [entry.source, entry.action, entry.detail])).toEqual([
      ['cli', 'model_key_clear', 'none_held'],
      ['cli', 'model_key_clear', 'none_held'],
    ]);
    expect(page.cursor).not.toBeNull();
    const second = await world.as(
      world.owner,
      'GET',
      `${LOG}?limit=2&cursor=${encodeURIComponent(page.cursor ?? '')}`,
    );
    const rest = second.body as LogBody;
    expect(rest.entries.map((entry) => entry.action)).toEqual(['room_open']);
    expect(rest.cursor).toBeNull();
  });

  it('refuses a limit out of range and a cursor it did not write, by the field’s name', async () => {
    for (const query of ['?limit=0', '?limit=201', '?cursor=not-ours']) {
      const answer = await world.as(world.owner, 'GET', `${LOG}${query}`);
      expect(answer.status, query).toBe(400);
      expect(codeOf(answer.body), query).toBe('validation_failed');
    }
    // A well-formed cursor that is another list's.
    const otherList = btoa(JSON.stringify(['log', '1'])).replace(/=+$/, '');
    const answer = await world.as(world.owner, 'GET', `${LOG}?cursor=${otherList}`);
    expect(codeOf(answer.body)).toBe('validation_failed');
  });

  it('carries no secret the instance holds: not the secret key, a hosted key, a session token', async () => {
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const hostedKey = 'sk-MARKER-hosted-key-2602';
    expect(
      await cli(world, ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'], {
        secret,
        ownerKey: world.owner.device.publicKey,
        input: hostedKey,
      }),
    ).toBe(0);
    const read = await world.as(world.owner, 'GET', `${LOG}?limit=200`);
    expect(read.status).toBe(200);
    const body = JSON.stringify(read.body);
    expect((read.body as LogBody).entries[0]).toMatchObject({
      source: 'cli',
      action: 'model_key_set',
      detail: null,
      outcome: 'done',
    });
    for (const marker of [
      secret,
      hostedKey,
      world.owner.token,
      world.deputy.token,
      world.owner.device.publicKey,
    ]) {
      expect(body).not.toContain(marker);
    }
  });
});

describe('an instance handed no Operate area (#2602)', () => {
  it('answers the owner `unavailable` rather than calling the route', async () => {
    const world = await startModerationWorld({ withoutOperate: true });
    try {
      const answer = await world.as(world.owner, 'GET', LOG);
      expect(answer.status).toBe(503);
      expect(codeOf(answer.body)).toBe('unavailable');
    } finally {
      await world.close();
    }
  });
});
