// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/operate/keys` and `POST /v1/operate/keys/rotate` (#2613), called
 * sealed through the real listener, as every caller who might try them.
 * What a rotation changed is read back where a device reads it — the
 * statements `GET /v1/instance/keys` serves, and a sealed request sealed to
 * the new key and to the old — and through a second connection to the
 * database file, never off the route's own answer.
 */

import { fromHex, toHex, type SealedInstanceKey } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { ENCRYPTION_KEY_LIFE_SECONDS } from '../keys/instance-keys.ts';
import { privateSpellings, secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { currentKey, sealedCall } from '../sealed/sealed-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import type { OperatorLogEntry } from '../store/sql-store.ts';

const KEYS = '/v1/operate/keys';
const ROTATE = '/v1/operate/keys/rotate';

interface KeysBody {
  readonly state: string;
  readonly fingerprint: string | null;
  readonly card: string | null;
  readonly current: { serial: number; createdAt: string; rotatesAt: string } | null;
  readonly olderHeld: number;
}

let opened: ModerationWorld | undefined;
afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

async function world(): Promise<ModerationWorld> {
  opened = await startModerationWorld();
  return opened;
}

const keysOf = async (w: ModerationWorld): Promise<KeysBody> => {
  const answer = await w.as(w.owner, 'GET', KEYS);
  expect(answer.status).toBe(200);
  return answer.body as KeysBody;
};

const wholeLog = (w: ModerationWorld): Promise<readonly OperatorLogEntry[]> =>
  w.freshRead((store) => store.listOperatorLogPage(undefined, 200));

/** The encryption keys' serials, read from the database file. */
const serials = (w: ModerationWorld): Promise<number[]> =>
  w.freshRead(async (store) =>
    (await store.listInstanceKeys())
      .filter((row) => row.role === 'encryption')
      .map((row) => row.serial ?? 0)
      .sort((a, b) => a - b),
  );

/** What a device reads: `GET /v1/instance/keys`, plaintext. */
async function served(w: ModerationWorld) {
  const answer = await fetch(`${w.url}/v1/instance/keys`);
  expect(answer.status).toBe(200);
  return (await answer.json()) as {
    identityKey: string;
    statements: { statement: { serial: number; keyId: string; encryptionKey: string } }[];
  };
}

describe('GET /v1/operate/keys — the card and the fingerprint, whole (#2613)', () => {
  it('shows what instance-key show prints: the fingerprint, the card, and the current key and its rotation', async () => {
    const w = await world();
    const shown = await w.instanceKeys.show();
    const body = await keysOf(w);
    expect(body.state).toBe('ready');
    // The form a rider's device shows and the card ends in: 52 base32 characters.
    expect(body.fingerprint).toBe(shown.fingerprintBase32);
    expect(body.fingerprint).toMatch(/^[A-Z2-7]{52}$/);
    // Never truncated: the card as the operator's CLI prints it, 52 characters after the #.
    expect(body.card).toBe(shown.card);
    expect(body.card).toMatch(new RegExp(`^oyl-instance:${TEST_ORIGIN}#[A-Z2-7]{52}$`));
    const current = shown.encryptionKeys.find((key) => key.supersededAt === null);
    expect(body.current).toEqual({
      serial: current?.serial,
      createdAt: new Date((current?.createdAt ?? 0) * 1000).toISOString(),
      rotatesAt: new Date(
        ((current?.createdAt ?? 0) + ENCRYPTION_KEY_LIFE_SECONDS) * 1000,
      ).toISOString(),
    });
    expect(body.olderHeld).toBe(0);
    // A read logs nothing.
    expect(await wholeLog(w)).toEqual([]);
  });
});

describe('POST /v1/operate/keys/rotate — the routine rotation (#2613)', () => {
  it('reaches what devices read: a new statement served, the pin unchanged, and both keys open a sealed request', async () => {
    const w = await world();
    const before = await served(w);
    const oldKey = await currentKey(w);
    const [oldSerial] = await serials(w);

    const rotated = await w.as(w.owner, 'POST', ROTATE, { confirm: 'rotate' });
    expect(rotated.status).toBe(200);
    const { outcome, serial } = rotated.body as { outcome: string; serial: number };
    expect(outcome).toBe('rotated');
    expect(serial).toBeGreaterThan(oldSerial ?? 0);

    // The statement a device reads names the new key, under the SAME identity key: nobody pins again.
    const after = await served(w);
    expect(after.identityKey).toBe(before.identityKey);
    expect(after.statements[0]?.statement.serial).toBe(serial);
    expect(await serials(w)).toEqual([oldSerial, serial]);

    // A new sealed request from the same device's session, sealed to the new key, is answered.
    const newest = after.statements[0]?.statement;
    if (newest === undefined) throw new Error('no statement served');
    const newKey: SealedInstanceKey = {
      keyId: newest.keyId,
      publicKey: fromHex(newest.encryptionKey, 'the encryption key', 32),
    };
    expect(newKey.keyId).not.toBe(oldKey.keyId);
    for (const instanceKey of [newKey, oldKey]) {
      const answer = await sealedCall(w, {
        path: KEYS,
        token: w.owner.token,
        signer: w.owner.device.signingKey,
        instanceKey,
      });
      expect(answer.status).toBe(200);
      expect((answer.body as KeysBody).current?.serial).toBe(serial);
    }
    expect((await keysOf(w)).olderHeld).toBe(1);
    const log = (await w.as(w.owner, 'GET', '/v1/operate/log')).body as {
      entries: { action: string; outcome: string; source: string; detail: string | null }[];
    };
    expect(log.entries).toEqual([
      expect.objectContaining({
        action: 'instance_key_rotate',
        outcome: 'done',
        source: 'app',
        detail: null,
      }),
    ]);
  });

  it.each([
    ['no confirm', {}],
    ['another word', { confirm: 'yes' }],
    ['the word in capitals', { confirm: 'ROTATE' }],
    ['a field it does not take', { confirm: 'rotate', dropOld: true }],
  ])('rotates nothing and logs nothing for %s', async (_case, body) => {
    const w = await world();
    const before = await serials(w);
    const answer = await w.as(w.owner, 'POST', ROTATE, body);
    expect(answer.status).toBe(400);
    expect(codeOf(answer.body)).toBe('validation_failed');
    expect(await serials(w)).toEqual(before);
    expect(await wholeLog(w)).toEqual([]);
  });

  it('answers busy while another holds the key lease, writes no key, and logs the refusal', async () => {
    const w = await world();
    const before = await serials(w);
    const now = Math.floor(w.clock.ms / 1000);
    // The instance's own maintenance pass, on its own connection.
    expect(
      await w.freshRead((store) => store.takeInstanceKeyLease('maintenance-pass', now, now + 60)),
    ).toBe(true);
    const answer = await w.as(w.owner, 'POST', ROTATE, { confirm: 'rotate' });
    expect(answer).toEqual({ status: 200, body: { outcome: 'busy', serial: null } });
    expect(await serials(w)).toEqual(before);
    expect(await wholeLog(w)).toEqual([
      expect.objectContaining({
        action: 'instance_key_rotate',
        outcome: 'refused',
        detail: 'busy',
        source: 'app',
      }),
    ]);
  });

  it('rotates nothing when its log entry cannot be written: rotated and logged, or neither', async () => {
    const w = await world();
    const before = await serials(w);
    const servedBefore = await served(w);
    const database = openDatabase(w.path);
    try {
      database.exec(`create trigger operator_log_refuses_test before insert on operator_log
        begin select raise(abort, 'the log refused this entry'); end`);
    } finally {
      database.close();
    }
    const answer = await w.as(w.owner, 'POST', ROTATE, { confirm: 'rotate' });
    expect(answer.status).toBe(500);
    expect(await serials(w)).toEqual(before);
    expect((await served(w)).statements).toEqual(servedBefore.statements);
  });

  it('returns no secret: neither private half, in hex or base64, nor OYL_INSTANCE_SECRET_KEY', async () => {
    const w = await world();
    const rotated = await w.as(w.owner, 'POST', ROTATE, { confirm: 'rotate' });
    const read = await w.as(w.owner, 'GET', KEYS);
    expect([rotated.status, read.status]).toEqual([200, 200]);
    const markers: string[] = [
      toHex(secretBytes(7)),
      toHex(secretBytes(7)).toUpperCase(),
      btoa(String.fromCharCode(...secretBytes(7))),
      w.owner.token,
      w.deputy.token,
    ];
    const rows = await w.freshRead((store) => store.listInstanceKeys());
    // The identity key and both encryption keys: every private half held.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      markers.push(...(await privateSpellings(row, secretBytes(7), TEST_ORIGIN)));
      markers.push(toHex(row.wrapped), btoa(String.fromCharCode(...row.wrapped)));
    }
    const bodies = JSON.stringify([rotated.body, read.body]);
    for (const marker of markers) expect(bodies).not.toContain(marker);
  });
});

describe('/v1/operate/keys — the owner’s, and nobody else’s (#2613)', () => {
  it('answers the deputy and a rider as no route, for both, and rotates nothing', async () => {
    const w = await world();
    const rider = await w.rider('Rider');
    const before = await serials(w);
    for (const caller of [w.deputy, rider]) {
      for (const [method, path, body] of [
        ['GET', KEYS, undefined],
        ['POST', ROTATE, { confirm: 'rotate' }],
      ] as const) {
        const nowhere = await w.as(caller, method, '/v1/no-such-route');
        const answer = await w.as(caller, method, path, body);
        expect(answer.status).toBe(404);
        expect(codeOf(answer.body)).toBe('not_found');
        expect(answer).toEqual(nowhere);
      }
    }
    expect(await serials(w)).toEqual(before);
    expect(await wholeLog(w)).toEqual([]);
  });
});
