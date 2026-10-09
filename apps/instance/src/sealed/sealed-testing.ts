// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the sealed-request tests share (#1191): the instance's current
 * encryption key read from its own served statement, a device's sealed call
 * through the real listener, and two routes that exist only for the tests — a
 * counter, so "the inner route ran once" is a number, and a stream.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import {
  fromHex,
  PAD_MINIMUM_BYTES,
  SEALED_PATH,
  sealRequest,
  utf8Decode,
  utf8Encode,
  type OpenedSealedReply,
  type SealedEnvelope,
  type SealedEvent,
  type SealedInstanceKey,
  type SealedRequest,
  type SigningKey,
} from '@onyourleft/domain';

import { instanceHpkePrimitives } from '../auth/crypto.ts';
import type { IdentityInstance } from '../auth/identity-testing.ts';
import { errorResponse } from '../errors.ts';
import { json, noContent, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { sha256 } from './sealed.ts';

/** The instance's newest encryption key, from `GET /v1/instance/keys`'s statement. */
export async function currentKey(world: IdentityInstance): Promise<SealedInstanceKey> {
  const served = await world.instanceKeys.served();
  const newest = served.statements.at(-1);
  if (newest === undefined) throw new Error('the instance serves no encryption key');
  return {
    keyId: newest.statement.keyId,
    publicKey: fromHex(newest.statement.encryptionKey, 'the encryption key', 32),
  };
}

export interface SealedCallOptions {
  readonly method?: string;
  readonly path: string;
  /** A JSON body, or bytes as they are. */
  readonly body?: unknown;
  /** The session token sent in `Authorization` AND bound into the AAD. */
  readonly token?: string;
  /** The token bound into the AAD, when a test sends another in `Authorization`. */
  readonly sealedForToken?: string | null;
  /** `null`: unsigned (`recover/email`). */
  readonly signer?: SigningKey | null;
  /** Unix seconds; the world's clock by default. */
  readonly issuedAt?: number;
  readonly lastEventId?: string;
  readonly minimumPadding?: number;
  readonly instanceKey?: SealedInstanceKey;
}

/** A sealed request, made but not sent: the envelope and its opener. */
export async function sealFor(
  world: IdentityInstance,
  options: SealedCallOptions,
): Promise<SealedRequest> {
  const body =
    options.body === undefined
      ? null
      : options.body instanceof Uint8Array
        ? options.body
        : utf8Encode(JSON.stringify(options.body));
  const sealedFor = options.sealedForToken === undefined ? options.token : options.sealedForToken;
  return sealRequest({
    primitives: instanceHpkePrimitives,
    sha256,
    instanceOrigin: world.identity.origin,
    instanceKey: options.instanceKey ?? (await currentKey(world)),
    sessionToken: sealedFor ?? null,
    method: options.method ?? 'GET',
    path: options.path,
    body,
    issuedAt: options.issuedAt ?? Math.floor(world.clock.ms / 1000),
    ...(options.signer === null || options.signer === undefined ? {} : { signer: options.signer }),
    ...(options.lastEventId === undefined ? {} : { lastEventId: options.lastEventId }),
    minimumPadding: options.minimumPadding ?? PAD_MINIMUM_BYTES,
  });
}

/** `POST /v1/sealed` with `envelope`, raw. */
export async function sendEnvelope(
  url: string,
  envelope: SealedEnvelope | string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return fetch(`${url}${SEALED_PATH}`, {
    method: 'POST',
    headers,
    body: typeof envelope === 'string' ? envelope : JSON.stringify(envelope),
  });
}

export interface SealedAnswer {
  /** The outer status and body exactly as on the wire. */
  readonly status: number;
  readonly raw: string;
  /** The opened reply, when the answer was sealed. */
  readonly reply?: OpenedSealedReply;
  /** The opened reply's body as JSON, or the plaintext refusal's. */
  readonly body: unknown;
}

/** Read an answer to `sealed`: opened when it is sealed, as it is when not. */
export async function answerTo(sealed: SealedRequest, response: Response): Promise<SealedAnswer> {
  const raw = await response.text();
  const parsed: unknown = raw === '' ? null : JSON.parse(raw);
  if (
    response.status === 200 &&
    typeof parsed === 'object' &&
    parsed !== null &&
    'nonce' in parsed
  ) {
    const reply = await sealed.openReply(parsed);
    const text = utf8Decode(reply.body) ?? '';
    return { status: 200, raw, reply, body: text === '' ? null : (JSON.parse(text) as unknown) };
  }
  return { status: response.status, raw, body: parsed };
}

/** Seal, send and open: one sealed call through the real listener. */
export async function sealedCall(
  world: IdentityInstance,
  options: SealedCallOptions,
): Promise<SealedAnswer> {
  const sealed = await sealFor(world, options);
  return answerTo(sealed, await sendEnvelope(world.url, sealed.envelope, options.token));
}

/** The opened reply's error code, or the plaintext one; `undefined` for a success. */
export function codeOf(answer: SealedAnswer): string | undefined {
  const code = (answer.body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Every `data:` line of a stream's raw text, in order. */
export function frames(raw: string): string[] {
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length));
}

/** Open a stream's frames in order; stops at the first that does not open. */
export async function openFrames(
  sealed: SealedRequest,
  data: readonly string[],
): Promise<{ events: SealedEvent[]; failed: boolean }> {
  const opener = sealed.streamOpener();
  const events: SealedEvent[] = [];
  for (const each of data) {
    try {
      events.push(await opener.open(each));
    } catch {
      return { events, failed: true };
    }
  }
  return { events, failed: false };
}

/** How many times the counting route ran. */
export interface Counter {
  runs: number;
}

/** The production table, plus a sealed-only counter and two sealed-only streams. */
export function testRoutes(counter: Counter): readonly Route[] {
  const encoder = new TextEncoder();
  const stream = (cut: boolean, endAt?: number): Route['handle'] => {
    return ({ request }) => {
      let id = Number(request.headers.get('last-event-id') ?? '0');
      // One event per pull, so an event sent before the cut has been read
      // before it: `error` discards whatever is still queued.
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          id += 1;
          if (cut && id === 3) {
            controller.error(new Error('the stream was cut'));
          } else if (id > 5) {
            controller.close();
          } else {
            controller.enqueue(
              encoder.encode(
                `event: ${id === endAt ? 'end' : 'section'}\nid: ${String(id)}\ndata: part ${String(id)}\n\n`,
              ),
            );
          }
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    };
  };
  const extra: Route[] = [
    {
      method: 'POST',
      path: '/v1/test/count',
      operationId: 'testCount',
      reaches: 'own',
      summary: 'Counts its runs. Test-only.',
      identity: true,
      auth: 'session',
      sealed: 'only',
      response: { contentType: 'none' },
      handle: () => {
        counter.runs += 1;
        return noContent();
      },
    },
    {
      method: 'GET',
      path: '/v1/test/stream',
      operationId: 'testStream',
      reaches: 'own',
      summary: 'Five events. Test-only.',
      identity: true,
      auth: 'session',
      sealed: 'only',
      response: { contentType: 'text/plain' },
      handle: stream(false),
    },
    {
      method: 'GET',
      path: '/v1/test/stream-cut',
      operationId: 'testStreamCut',
      reaches: 'own',
      summary: 'Two events, then an error. Test-only.',
      identity: true,
      auth: 'session',
      sealed: 'only',
      response: { contentType: 'text/plain' },
      handle: stream(true),
    },
    {
      method: 'GET',
      path: '/v1/test/stream-end-then-cut',
      operationId: 'testStreamEndThenCut',
      reaches: 'own',
      summary: 'An inner event named end, then an error. Test-only.',
      identity: true,
      auth: 'session',
      sealed: 'only',
      response: { contentType: 'text/plain' },
      handle: stream(true, 2),
    },
    {
      method: 'POST',
      path: '/v1/test/echo',
      operationId: 'testEcho',
      reaches: 'own',
      summary: 'Its body’s length. Test-only.',
      identity: true,
      auth: 'session',
      response: {
        contentType: 'application/json',
        schema: { type: 'object', description: 'length' },
      },
      handle: ({ body }) =>
        body === null ? errorResponse('validation_failed') : json({ length: body.length }),
    },
  ];
  return [...ROUTES, ...extra];
}
