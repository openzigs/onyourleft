// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `POST /v1/sealed`, end to end through the real listener (#1191, ADR 0047
 * D-8, D-9): replay (across a restart, and two at once), freshness, the
 * session binding with three athletes, the edge holding a token, purpose
 * separation, the refusals that cost no X25519, the sessionless routes, the
 * body limit, streams, padding on the wire, sealed errors, and
 * `last_used_at`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  AUTH_PURPOSE,
  decodeFrame,
  deviceStatementBytes,
  fromBase64url,
  openReply,
  sealedResponseAad,
  unpad,
  ERASE_ACCOUNT_PURPOSE,
  encodeFrame,
  LINK_PURPOSE,
  PAD_MINIMUM_BYTES,
  PASTED_KEY_PAD_BYTES,
  RECOVER_PURPOSE,
  SEALED_INFO,
  sealedEnvelopeLimit,
  sealedRequestAad,
  sealedRequestStatementBytes,
  setupBaseSender,
  toBase64url,
  toHex,
  utf8Decode,
  utf8Encode,
  type DevicePurpose,
} from '@onyourleft/domain';

import { instanceHpkePrimitives, sha256Hex, verifyEd25519 } from '../auth/crypto.ts';
import { createIdentity, DEFAULT_LIMITS } from '../auth/identity.ts';
import {
  startIdentityInstance,
  TEST_ORIGIN,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from '../auth/identity-testing.ts';
import { startTestInstance, type TestInstance } from '../instance-testing.ts';
import { createInstanceKeys } from '../keys/instance-keys.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { createSealed } from './sealed.ts';
import {
  answerTo,
  codeOf,
  currentKey,
  frames,
  openFrames,
  sealedCall,
  sealFor,
  sendEnvelope,
  testRoutes,
  type Counter,
} from './sealed-testing.ts';

let world: IdentityInstance | undefined;
let restarted: { instance: TestInstance; store: SqlStore } | undefined;
afterEach(async () => {
  if (restarted !== undefined) {
    await restarted.instance.listening.close();
    await restarted.store.close();
    restarted = undefined;
  }
  await world?.close();
  world = undefined;
});

/** Calls to X25519 on the instance's HPKE port: the cost a refusal must not pay. */
function countingPrimitives(): {
  primitives: typeof instanceHpkePrimitives;
  calls: { x25519: number };
} {
  const calls = { x25519: 0 };
  const primitives: typeof instanceHpkePrimitives = {
    ...instanceHpkePrimitives,
    x25519: (privateKey, publicKey) => {
      calls.x25519 += 1;
      return instanceHpkePrimitives.x25519(privateKey, publicKey);
    },
  };
  return { primitives, calls };
}

async function start(
  options: Parameters<typeof startIdentityInstance>[0] = {},
): Promise<{ world: IdentityInstance; counter: Counter }> {
  const counter: Counter = { runs: 0 };
  world = await startIdentityInstance({ routes: testRoutes(counter), ...options });
  return { world, counter };
}

interface Rider {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
}

async function rider(w: IdentityInstance): Promise<Rider> {
  const device = await testDevice();
  const signed = await w.signIn(device);
  return {
    device,
    token: signed.body.sessionToken as string,
    athleteId: signed.body.athleteId as string,
  };
}

const COUNT = { method: 'POST', path: '/v1/test/count' } as const;

describe('the round trip', () => {
  it('opens, dispatches through the route table, and seals the answer back', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const answer = await sealedCall(w, {
      path: '/v1/auth/session',
      token: a.token,
      signer: a.device.signingKey,
    });
    expect(answer.status).toBe(200);
    expect(answer.reply?.status).toBe(200);
    expect((answer.body as { athleteId: string }).athleteId).toBe(a.athleteId);
    // The edge sees ciphertext: no member of the inner answer is on the wire.
    expect(answer.raw).not.toContain(a.athleteId);
    expect(Object.keys(JSON.parse(answer.raw) as object).sort()).toEqual(['ct', 'nonce', 'v']);
  });

  it('keeps a sealed-only route out of reach of a plaintext request', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    expect((await w.call('POST', '/v1/test/count', { token: a.token })).status).toBe(404);
    expect(counter.runs).toBe(0);
    const sealed = await sealedCall(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    expect(sealed.reply?.status).toBe(204);
    expect(counter.runs).toBe(1);
  });

  it('answers a key it does not hold in plaintext, `instance_key_unknown`', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const key = await currentKey(w);
    const answer = await sealedCall(w, {
      ...COUNT,
      token: a.token,
      signer: a.device.signingKey,
      instanceKey: { ...key, keyId: '0000000000000000' },
    });
    expect(answer.status).toBe(400);
    expect(codeOf(answer)).toBe('instance_key_unknown');
  });
});

describe('replay (D-9)', () => {
  it('runs the inner route once for the same envelope sent twice; the second is `replayed`', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    const first = await answerTo(sealed, await sendEnvelope(w.url, sealed.envelope, a.token));
    const second = await answerTo(sealed, await sendEnvelope(w.url, sealed.envelope, a.token));
    expect(first.reply?.status).toBe(204);
    expect(codeOf(second)).toBe('replayed');
    expect(counter.runs).toBe(1);
  });

  it('survives a restart inside the ten-minute window: the record is in SQLite', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    await sendEnvelope(w.url, sealed.envelope, a.token);
    expect(counter.runs).toBe(1);
    // A second instance over the same file: a new store, a new identity, new
    // keys and a new sealed record — everything a restart makes again. Only
    // the database is shared, so a record kept in memory is not.
    const store = await openSqlStore(w.path);
    const now = (): number => w.clock.ms + 60_000;
    const identity = createIdentity({ store, origin: TEST_ORIGIN, now, registration: 'open' });
    const instanceKeys = createInstanceKeys({
      store,
      secret: secretBytes(7),
      origin: TEST_ORIGIN,
      now: () => Math.floor(now() / 1000),
    });
    const instance = await startTestInstance({
      routes: testRoutes(counter),
      identity,
      instanceKeys,
      sealed: createSealed({ store, now }),
      config: { bodyLimitBytes: 16_384 },
    });
    restarted = { instance, store };
    const again = await answerTo(
      sealed,
      await sendEnvelope(instance.url, sealed.envelope, a.token),
    );
    expect(codeOf(again)).toBe('replayed');
    expect(counter.runs).toBe(1);
  });

  it('runs the route once for two identical envelopes sent at once', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    const answers = await Promise.all(
      [0, 1, 2].map(async () =>
        answerTo(sealed, await sendEnvelope(w.url, sealed.envelope, a.token)),
      ),
    );
    expect(counter.runs).toBe(1);
    expect(answers.map(codeOf).filter((code) => code === 'replayed')).toHaveLength(2);
  });

  it('forgets an `enc` ten minutes on', async () => {
    const { world: w } = await start();
    const enc = new Uint8Array(32).fill(5);
    expect(await w.sealed.record(enc)).toBe('recorded');
    expect(await w.sealed.record(enc)).toBe('replayed');
    w.clock.ms += 601_000;
    expect(await w.sealed.record(enc)).toBe('recorded');
  });
});

describe('freshness (D-9)', () => {
  it('refuses ±121 s as `stale_request` carrying the instance’s time, and runs nothing', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const now = Math.floor(w.clock.ms / 1000);
    for (const issuedAt of [now - 121, now + 121]) {
      const answer = await sealedCall(w, {
        ...COUNT,
        token: a.token,
        signer: a.device.signingKey,
        issuedAt,
      });
      expect(answer.status).toBe(200);
      expect(codeOf(answer)).toBe('stale_request');
      expect((answer.body as { instanceTime: number }).instanceTime).toBe(now);
    }
    expect(counter.runs).toBe(0);
    for (const issuedAt of [now - 120, now + 120]) {
      const answer = await sealedCall(w, {
        ...COUNT,
        token: a.token,
        signer: a.device.signingKey,
        issuedAt,
      });
      expect(answer.reply?.status).toBe(204);
    }
    expect(counter.runs).toBe(2);
  });

  it('leaves no replay record for a stale request: freshness comes before the record', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, {
      ...COUNT,
      token: a.token,
      signer: a.device.signingKey,
      issuedAt: Math.floor(w.clock.ms / 1000) - 500,
    });
    expect(
      codeOf(await answerTo(sealed, await sendEnvelope(w.url, sealed.envelope, a.token))),
    ).toBe('stale_request');
    const enc = fromBase64url(sealed.envelope.enc)!;
    expect(await w.sealed.record(enc)).toBe('recorded');
  });
});

describe('the session binding (D-8, D-9), three athletes', () => {
  it('does not open an envelope sealed for session A and sent with session B’s token', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const b = await rider(w);
    await rider(w);
    const answer = await sealedCall(w, {
      ...COUNT,
      token: b.token,
      sealedForToken: a.token,
      signer: a.device.signingKey,
    });
    expect(answer.status).toBe(400);
    expect(codeOf(answer)).toBe('sealed_unopened');
    expect(counter.runs).toBe(0);
  });

  it('refuses a signature by another live key of the SAME athlete as `bad_signature`', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    await rider(w);
    await rider(w);
    // A second device of A's, linked with a code A's first device minted.
    const code = await w.call('POST', '/v1/auth/link-codes', { token: a.token });
    const second = await testDevice();
    const nonce = await w.nonceFor(second);
    const linked = await w.call('POST', '/v1/auth/link', {
      body: {
        ...(await second.statement(nonce, { purpose: LINK_PURPOSE })),
        linkCode: (code.body as { linkCode: string }).linkCode,
      },
    });
    expect(linked.status).toBe(200);
    const answer = await sealedCall(w, { ...COUNT, token: a.token, signer: second.signingKey });
    expect(answer.status).toBe(200);
    expect(codeOf(answer)).toBe('bad_signature');
    expect(counter.runs).toBe(0);
  });
});

describe('the edge cannot reuse a token (D-8)', () => {
  it('refuses a request it sealed with a fresh key of its own, and nothing runs', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const edge = await testDevice();
    const answer = await sealedCall(w, { ...COUNT, token: a.token, signer: edge.signingKey });
    expect(codeOf(answer)).toBe('bad_signature');
    expect(counter.runs).toBe(0);
  });
});

describe('purpose separation (D-8)', () => {
  it('verifies no device statement as a sealed request, nor the reverse', async () => {
    const device = await testDevice();
    const sealedStatement = {
      instanceOrigin: TEST_ORIGIN,
      keyId: '0123456789abcdef',
      enc: 'e'.repeat(64),
      method: 'POST',
      path: '/v1/test/count',
      issuedAt: 1_790_000_000,
      bodySha256: 'f'.repeat(64),
    };
    const sealedBytes = sealedRequestStatementBytes(sealedStatement);
    const sealedSignature = await device.sign(sealedBytes);
    const purposes: readonly DevicePurpose[] = [
      AUTH_PURPOSE,
      LINK_PURPOSE,
      RECOVER_PURPOSE,
      ERASE_ACCOUNT_PURPOSE,
    ];
    for (const purpose of purposes) {
      const statementBytes = deviceStatementBytes({
        purpose,
        instanceOrigin: TEST_ORIGIN,
        nonce: 'e'.repeat(64),
        publicKey: device.publicKey,
        issuedAt: 1_790_000_000,
      });
      const signature = await device.sign(statementBytes);
      expect(await verifyEd25519(device.publicKey, statementBytes, signature)).toBe(true);
      expect(await verifyEd25519(device.publicKey, sealedBytes, signature)).toBe(false);
      expect(await verifyEd25519(device.publicKey, statementBytes, sealedSignature)).toBe(false);
    }
    expect(await verifyEd25519(device.publicKey, sealedBytes, sealedSignature)).toBe(true);
  });
});

describe('a refusal before `Open` costs no X25519', () => {
  it('refuses an unknown token, a rate-limited session and a rate-limited address before any', async () => {
    const counting = countingPrimitives();
    const { world: w } = await start({
      sealedPrimitives: counting.primitives,
      limits: {
        ...DEFAULT_LIMITS,
        registrationPerAddress: { limit: 10_000, windowMs: 60_000 },
        sealedPerSession: { limit: 1, windowMs: 60_000 },
        sessionlessSealedPerAddress: { limit: 1, windowMs: 60_000 },
      },
    });
    const a = await rider(w);
    const ok = await sealedCall(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    expect(ok.reply?.status).toBe(204);
    expect(counting.calls.x25519).toBe(1);

    const unknown = await sealedCall(w, {
      ...COUNT,
      token: 'not-a-session',
      signer: a.device.signingKey,
    });
    expect(unknown.status).toBe(401);
    expect(codeOf(unknown)).toBe('unauthenticated');
    const limited = await sealedCall(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    expect(codeOf(limited)).toBe('rate_limited');
    const firstSessionless = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/recover/email',
      body: { address: 'a@example.org' },
      signer: null,
    });
    expect(firstSessionless.status).toBe(200);
    expect(counting.calls.x25519).toBe(2);
    const limitedSessionless = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/recover/email',
      body: { address: 'a@example.org' },
      signer: null,
    });
    expect(codeOf(limitedSessionless)).toBe('rate_limited');
    expect(counting.calls.x25519).toBe(2);
  });
});

describe('sessionless requests (D-8, D-9)', () => {
  it('seals `unauthenticated` for an inner path that is not a named sessionless route', async () => {
    const counting = countingPrimitives();
    const { world: w, counter } = await start({ sealedPrimitives: counting.primitives });
    const device = await testDevice();
    const answer = await sealedCall(w, { ...COUNT, signer: device.signingKey });
    expect(answer.status).toBe(200);
    expect(codeOf(answer)).toBe('unauthenticated');
    expect(counting.calls.x25519).toBe(1);
    expect(counter.runs).toBe(0);
  });

  it('registers through a sealed sign-in signed by the key its statement adds, and no other', async () => {
    const { world: w } = await start();
    const device = await testDevice();
    const statement = await device.statement(await w.nonceFor(device), {
      issuedAt: Math.floor(w.clock.ms / 1000),
    });
    const other = await testDevice();
    const refused = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/session',
      body: statement,
      signer: other.signingKey,
    });
    expect(codeOf(refused)).toBe('bad_signature');
    const signedIn = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/session',
      body: statement,
      signer: device.signingKey,
    });
    expect(signedIn.reply?.status).toBe(200);
    expect(typeof (signedIn.body as { sessionToken: unknown }).sessionToken).toBe('string');
  });

  it('refuses `recover/email` whose unsigned `issuedAt` is stale', async () => {
    const { world: w } = await start({ emailRecovery: true });
    const answer = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/recover/email',
      body: { address: 'a@example.org' },
      signer: null,
      issuedAt: Math.floor(w.clock.ms / 1000) - 300,
    });
    expect(codeOf(answer)).toBe('stale_request');
  });

  it('counts the per-address limit on the address `client-address.ts` resolves', async () => {
    const { world: w } = await start({
      limits: {
        ...DEFAULT_LIMITS,
        registrationPerAddress: { limit: 10_000, windowMs: 60_000 },
        sessionlessSealedPerAddress: { limit: 1, windowMs: 60_000 },
      },
    });
    const ask = async (): Promise<string | undefined> =>
      codeOf(
        await sealedCall(w, {
          method: 'POST',
          path: '/v1/auth/recover/email',
          body: { address: 'a@example.org' },
          signer: null,
        }),
      );
    expect(await ask()).not.toBe('rate_limited');
    expect(await ask()).toBe('rate_limited');
    // The limit belongs to the address: another one has its own allowance.
    expect(w.identity.allowSessionlessSealedRequest('198.51.100.7')).toBe(true);
  });
});

describe('the body limit (D-9)', () => {
  it('accepts sealed the largest body `POST /v1/sync/records` reads in plaintext, and no byte more', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const limit = 16_384;
    const largest = utf8Encode(JSON.stringify({ pad: 'x'.repeat(limit - 10) }));
    expect(largest.length).toBe(limit);
    const plain = await fetch(`${w.url}/v1/sync/records`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body: largest,
    });
    expect(plain.status).not.toBe(413);
    const sealed = await sealedCall(w, {
      method: 'POST',
      path: '/v1/sync/records',
      body: largest,
      token: a.token,
      signer: a.device.signingKey,
    });
    expect(sealed.reply?.status).toBe(plain.status);
    const oneMore = await sealedCall(w, {
      method: 'POST',
      path: '/v1/sync/records',
      body: utf8Encode(JSON.stringify({ pad: 'x'.repeat(limit - 9) })),
      token: a.token,
      signer: a.device.signingKey,
    });
    expect(codeOf(oneMore)).toBe('payload_too_large');
  });

  it('refuses an envelope one byte over its limit before any cryptography', async () => {
    const counting = countingPrimitives();
    const { world: w } = await start({ sealedPrimitives: counting.primitives });
    const a = await rider(w);
    const sealed = await sealFor(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    const text = JSON.stringify(sealed.envelope);
    const over = `${text}${' '.repeat(sealedEnvelopeLimit(16_384) + 1 - text.length)}`;
    const response = await sendEnvelope(w.url, over, a.token);
    expect(response.status).toBe(413);
    expect(counting.calls.x25519).toBe(0);
    const exact = `${text}${' '.repeat(sealedEnvelopeLimit(16_384) - text.length)}`;
    expect((await sendEnvelope(w.url, exact, a.token)).status).toBe(200);
  });
});

describe('streams (D-9)', () => {
  it('carries a `data:` line and nothing else, every event in order, and ends with `end`', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, {
      path: '/v1/test/stream',
      token: a.token,
      signer: a.device.signingKey,
    });
    const response = await sendEnvelope(w.url, sealed.envelope, a.token);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const raw = await response.text();
    for (const line of raw.split('\n')) expect(line === '' || line.startsWith('data: ')).toBe(true);
    expect(raw).not.toMatch(/^(event|id):/m);
    expect(raw).not.toContain('section');
    const opened = await openFrames(sealed, frames(raw));
    expect(opened.failed).toBe(false);
    expect(opened.events.map((event) => `${event.id}:${event.kind}`)).toEqual([
      '1:section',
      '2:section',
      '3:section',
      '4:section',
      '5:section',
      '5:end',
    ]);
    expect(utf8Decode(opened.events[0]!.data)).toBe('part 1');
  });

  it('fails to open a dropped, a duplicated or a reordered event', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, {
      path: '/v1/test/stream',
      token: a.token,
      signer: a.device.signingKey,
    });
    const data = frames(await (await sendEnvelope(w.url, sealed.envelope, a.token)).text());
    const [one, two, three, ...rest] = data as [string, string, string, ...string[]];
    for (const tampered of [
      [one, three, ...rest],
      [one, two, two, three, ...rest],
      [one, three, two, ...rest],
    ]) {
      const opened = await openFrames(sealed, tampered);
      expect(opened.failed).toBe(true);
      expect(opened.events.at(-1)?.kind).not.toBe('end');
    }
  });

  it('ends a stream cut short with no `end`, so it reads as cut and not finished', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, {
      path: '/v1/test/stream-cut',
      token: a.token,
      signer: a.device.signingKey,
    });
    const raw = await (await sendEnvelope(w.url, sealed.envelope, a.token)).text();
    const opened = await openFrames(sealed, frames(raw));
    expect(opened.failed).toBe(false);
    expect(opened.events.map((event) => event.kind)).toEqual(['section', 'section']);
  });

  it('never lets an inner event named `end` stand for the stream finishing', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, {
      path: '/v1/test/stream-end-then-cut',
      token: a.token,
      signer: a.device.signingKey,
    });
    const raw = await (await sendEnvelope(w.url, sealed.envelope, a.token)).text();
    const opened = await openFrames(sealed, frames(raw));
    expect(opened.events.map((event) => event.kind)).not.toContain('end');
  });

  it('resumes with a NEW sealed request naming the last event id opened', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const sealed = await sealFor(w, {
      path: '/v1/test/stream',
      token: a.token,
      signer: a.device.signingKey,
      lastEventId: '3',
    });
    const raw = await (await sendEnvelope(w.url, sealed.envelope, a.token)).text();
    const opened = await openFrames(sealed, frames(raw));
    expect(opened.events.map((event) => event.id)).toEqual(['4', '5', '5']);
    expect(opened.events.at(-1)?.kind).toBe('end');
  });
});

describe('padding on the wire (D-9)', () => {
  it('gives 10-byte and 200-byte requests one `ct` length, and a pasted key at least 1 KiB', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const ctLength = async (body: Uint8Array, minimumPadding?: number): Promise<number> =>
      (
        await sealFor(w, {
          method: 'POST',
          path: '/v1/test/echo',
          body,
          token: a.token,
          signer: a.device.signingKey,
          ...(minimumPadding === undefined ? {} : { minimumPadding }),
        })
      ).envelope.ct.length;
    const ten = await ctLength(new Uint8Array(10).fill(0x61));
    expect(await ctLength(new Uint8Array(200).fill(0x61))).toBe(ten);
    const pasted = await ctLength(new Uint8Array(10).fill(0x61), PASTED_KEY_PAD_BYTES);
    expect(pasted).toBe(Math.ceil(((PASTED_KEY_PAD_BYTES + 16) * 4) / 3));
    expect(ten).toBe(Math.ceil(((PAD_MINIMUM_BYTES * 2 + 16) * 4) / 3));
  });

  it('refuses a plaintext whose padding is not its bucket, inside a valid AEAD', async () => {
    const { world: w, counter } = await start();
    const a = await rider(w);
    const key = await currentKey(w);
    const context = await setupBaseSender(
      instanceHpkePrimitives,
      key.publicKey,
      utf8Encode(SEALED_INFO),
    );
    const body = new Uint8Array(0);
    const issuedAt = Math.floor(w.clock.ms / 1000);
    const statement = sealedRequestStatementBytes({
      instanceOrigin: TEST_ORIGIN,
      keyId: key.keyId,
      enc: toHex(context.enc),
      method: 'POST',
      path: '/v1/test/count',
      issuedAt,
      bodySha256: await sha256Hex(''),
    });
    const frame = encodeFrame(
      {
        method: 'POST',
        path: '/v1/test/count',
        issuedAt,
        signer: a.device.publicKey,
        signature: await a.device.sign(statement),
      },
      body,
    );
    // A length prefix, the frame, and zeros — to 4096 bytes, where it belongs in 512.
    const padded = new Uint8Array(4096);
    padded.set([0, 0, (frame.length >> 8) & 0xff, frame.length & 0xff]);
    padded.set(frame, 4);
    const ct = await context.seal(
      sealedRequestAad({
        instanceOrigin: TEST_ORIGIN,
        keyId: key.keyId,
        tokenSha256: await sha256Hex(a.token),
      }),
      padded,
    );
    const response = await sendEnvelope(
      w.url,
      { v: 1, keyId: key.keyId, enc: toBase64url(context.enc), ct: toBase64url(ct) },
      a.token,
    );
    expect(response.status).toBe(200);
    const reply = JSON.parse(await response.text()) as { nonce: string; ct: string };
    const nonce = fromBase64url(reply.nonce)!;
    const opener = await openReply(instanceHpkePrimitives, context, nonce);
    const opened = decodeFrame(
      unpad(
        await opener.open(
          sealedResponseAad(
            {
              instanceOrigin: TEST_ORIGIN,
              keyId: key.keyId,
              tokenSha256: await sha256Hex(a.token),
            },
            context.enc,
            nonce,
          ),
          fromBase64url(reply.ct)!,
        ),
      ),
    );
    expect(opened.header.status).toBe(400);
    expect(utf8Decode(opened.body)).toContain('validation_failed');
    expect(counter.runs).toBe(0);
  });
});

describe('errors after `Open` are sealed (D-9)', () => {
  it('puts no plaintext `code` on the wire for `bad_signature`', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const edge = await testDevice();
    const answer = await sealedCall(w, { ...COUNT, token: a.token, signer: edge.signingKey });
    expect(codeOf(answer)).toBe('bad_signature');
    expect(answer.status).toBe(200);
    expect(answer.raw).not.toContain('bad_signature');
    expect(answer.raw).not.toContain('"code"');
    expect(answer.raw).not.toContain('"error"');
  });
});

describe('`last_used_at` (D-8)', () => {
  it('moves for the key that signed a sealed request, and not for another', async () => {
    const { world: w } = await start();
    const a = await rider(w);
    const b = await rider(w);
    const before = await w.freshRead(async (store) => ({
      a: (await store.listDeviceKeys(a.athleteId))[0]!.lastUsedAt,
      b: (await store.listDeviceKeys(b.athleteId))[0]!.lastUsedAt,
    }));
    w.clock.ms += 3_600_000;
    const answer = await sealedCall(w, { ...COUNT, token: a.token, signer: a.device.signingKey });
    expect(answer.reply?.status).toBe(204);
    const after = await w.freshRead(async (store) => ({
      a: (await store.listDeviceKeys(a.athleteId))[0]!.lastUsedAt,
      b: (await store.listDeviceKeys(b.athleteId))[0]!.lastUsedAt,
    }));
    expect(after.a).toBe(Math.floor(w.clock.ms / 1000));
    expect(after.a).not.toBe(before.a);
    expect(after.b).toBe(before.b);
  });
});

describe('what the AAD binds', () => {
  it('names the session by the hash the instance stores', async () => {
    expect(await sha256Hex('token')).toBe(
      toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Encode('token')))),
    );
    expect(PAD_MINIMUM_BYTES).toBe(256);
  });
});
