// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `POST /v1/sealed` (#1191, ADR 0047 D-8, D-9): a request sealed to the
 * instance's encryption key, opened, checked and dispatched through the same
 * route table, and its answer sealed back.
 *
 * ## The order, and why each step is where it is
 *
 * 0. **The envelope's size and shape** — the handler has read at most
 *    {@link sealedEnvelopeLimit} bytes, and the envelope must be exactly
 *    `{ v, keyId, enc, ct }` — before any cryptography.
 * 1. **The session, or the address.** With `Authorization`, the session is a
 *    hash and a lookup, as for every route, and its sealed-request limit is
 *    counted on the token hash. Without one, a per-client-address limit
 *    (`client-address.ts` resolves the address). Both come BEFORE any X25519,
 *    so an unauthenticated or rate-limited flood costs no Diffie–Hellman.
 * 2. **`keyId`**: a key this instance does not hold, or one past its overlap,
 *    is plaintext `instance_key_unknown`.
 * 3. **`Open`**, under the AAD binding the instance's origin, the key and the
 *    session's token hash. A ciphertext sealed for another session does not
 *    open: plaintext `sealed_unopened`. **Everything after this is sealed.**
 * 4. **The signature** (D-8) over `oyl-sealed-request-v1`: under the key the
 *    SESSION ROW names — never the key the request claims (`signer`) — or, for
 *    a request with no session, the key its inner statement adds, which must
 *    be the signer. `recover/email` alone carries none.
 * 5. **Freshness**: `issuedAt` within 120 s, or `stale_request` carrying
 *    `instanceTime` and nothing runs.
 * 6. **Replay**: SHA-256 of `enc` recorded in SQLite, check and insert one
 *    statement, BEFORE the inner route runs: `replayed` otherwise.
 * 7. **The inner route**, through the handler's own dispatch.
 *
 * A request with no session is dispatched only to {@link SESSIONLESS_PATHS};
 * any other inner path is `unauthenticated`, sealed.
 */

import {
  decodeFrame,
  isLowerHex32,
  openSealedRequest,
  parseSealedEnvelope,
  SEALED_END_KIND,
  SEALED_FRESHNESS_SECONDS,
  SEALED_PATH,
  sealedBodySha256,
  sealedEnvelopeLimit,
  sealedReplyWriter,
  sealedRequestStatementBytes,
  toHex,
  unpad,
  utf8Decode,
  utf8Encode,
  type SealedBinding,
  type SealedReplyWriter,
} from '@onyourleft/domain';

import { isSignature, verifyEd25519 } from '../auth/crypto.ts';
import type { Caller } from '../auth/identity.ts';
import { errorBody, errorResponse, JSON_TYPE, type ErrorCode } from '../errors.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';

/** The inner paths a request with no session may reach (D-9, phase 1). */
export const SESSIONLESS_PATHS: ReadonlySet<string> = new Set([
  '/v1/auth/session',
  '/v1/auth/link',
  '/v1/auth/recover',
  '/v1/auth/recover/email',
]);

/** The one sessionless path that carries no sealed-request statement (D-8). */
export const UNSIGNED_PATH = '/v1/auth/recover/email';

const METHODS = new Set(['GET', 'POST', 'DELETE']);
const MAXIMUM_PATH_LENGTH = 2048;
const MAXIMUM_EVENT_ID_LENGTH = 128;

/** What a sealed request's frame header must hold. */
interface InnerHeader {
  readonly method: string;
  readonly path: string;
  readonly issuedAt: number;
  readonly signer?: string;
  readonly signature?: string;
  readonly lastEventId?: string;
}

function innerHeader(
  header: Readonly<Record<string, unknown>>,
  origin: string,
): InnerHeader | undefined {
  const { method, path, issuedAt, signer, signature, lastEventId } = header;
  if (typeof method !== 'string' || !METHODS.has(method)) return undefined;
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAXIMUM_PATH_LENGTH) {
    return undefined;
  }
  // The path is appended to this instance's own origin and must come back as
  // itself: no `..`, no `//host`, no fragment, nothing the URL parser rewrites.
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(origin).origin || `${url.pathname}${url.search}` !== path) {
    return undefined;
  }
  if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt)) return undefined;
  if (signer !== undefined && !isLowerHex32(signer)) return undefined;
  if (signature !== undefined && !isSignature(signature)) return undefined;
  if (
    lastEventId !== undefined &&
    (typeof lastEventId !== 'string' || lastEventId.length > MAXIMUM_EVENT_ID_LENGTH)
  ) {
    return undefined;
  }
  return {
    method,
    path,
    issuedAt,
    ...(signer === undefined ? {} : { signer }),
    ...(signature === undefined ? {} : { signature }),
    ...(lastEventId === undefined ? {} : { lastEventId }),
  };
}

/** The public key a sessionless request's inner statement adds or signs in with. */
function statementKey(body: Uint8Array): string | undefined {
  const text = utf8Decode(body);
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as { publicKey?: unknown } | null;
    return isLowerHex32(parsed?.publicKey) ? parsed.publicKey : undefined;
  } catch {
    return undefined;
  }
}

/** A sealed JSON answer: `{ v, nonce, ct }`, always 200 on the wire. */
async function sealedAnswer(
  writer: SealedReplyWriter,
  status: number,
  contentType: string,
  body: Uint8Array,
): Promise<Response> {
  return json(await writer.reply(status, contentType, body));
}

/** An error in the one shape, sealed. */
async function sealedError(
  writer: SealedReplyWriter,
  code: ErrorCode,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<Response> {
  const response = errorResponse(code);
  const body = { ...errorBody(code), ...extra };
  return sealedAnswer(writer, response.status, JSON_TYPE, utf8Encode(JSON.stringify(body)));
}

/** One event of the inner route's own `text/event-stream`. */
interface InnerEvent {
  readonly id: string | undefined;
  readonly kind: string;
  readonly data: string;
}

/** The inner stream's events, parsed as the SSE specification reads them. */
async function* innerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<InnerEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffered = '';
  let id: string | undefined;
  let kind = 'message';
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r\n|\r|\n/);
      buffered = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (line === '') {
          if (data.length > 0) yield { id, kind, data: data.join('\n') };
          kind = 'message';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') data.push(value);
        else if (field === 'event') kind = value;
        else if (field === 'id') id = value;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The inner route's stream, re-sealed (D-9): every event under the one reply
 * key at consecutive sequence numbers, each frame a `data:` line and nothing
 * else, and a sealed `end` event once the inner stream has finished. A stream
 * that fails part-way stops WITHOUT `end`, which is how the device tells it
 * was cut.
 */
function sealedStream(
  writer: SealedReplyWriter,
  inner: Response,
  resumedAfter: string | undefined,
): Response {
  const encoder = new TextEncoder();
  // An inner event with no id takes one from this count (#1207). A resumed
  // stream counts on from the id it resumed after when that is a count, so a
  // resumed stream's ids never repeat ones the device already holds; after an
  // id that is not a count, an id-less event keeps that id, as SSE's own last
  // event id does, which repeats nothing new.
  const resumedCount =
    resumedAfter !== undefined && /^(?:0|[1-9]\d{0,14})$/.test(resumedAfter)
      ? Number(resumedAfter)
      : undefined;
  let sequence = resumedCount ?? 0;
  const fallbackId = (): string => {
    sequence += 1;
    return resumedAfter === undefined || resumedCount !== undefined
      ? String(sequence)
      : resumedAfter;
  };
  // The `end` event names the last id the stream carried, so a device that
  // resumes after it asks for nothing more.
  let lastId = resumedAfter ?? '0';
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const frame = (line: string): void => {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      };
      try {
        if (inner.body !== null) {
          for await (const event of innerEvents(inner.body as ReadableStream<Uint8Array>)) {
            // `end` is the sealed stream's own; an inner event may not borrow it.
            if (event.kind === SEALED_END_KIND) throw new Error('reserved event kind');
            lastId = event.id ?? fallbackId();
            frame(await writer.event(lastId, event.kind, utf8Encode(event.data)));
          }
        }
        frame(await writer.event(lastId, SEALED_END_KIND, new Uint8Array(0)));
        controller.close();
      } catch {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
  });
}

/** The inner response, sealed: a whole one, or its stream event by event. */
async function sealInner(
  writer: SealedReplyWriter,
  inner: Response,
  resumedAfter: string | undefined,
): Promise<Response> {
  const contentType = inner.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/event-stream') && inner.status === 200) {
    return sealedStream(writer, inner, resumedAfter);
  }
  const body = new Uint8Array(await inner.arrayBuffer());
  return sealedAnswer(writer, inner.status, contentType, body);
}

async function handleSealed(context: RouteContext): Promise<Response> {
  const { identity, instanceKeys, sealed, request, client } = context;
  if (identity === undefined || instanceKeys === undefined || sealed === undefined) {
    return errorResponse('unavailable');
  }
  // 0. The envelope's shape: no cryptography yet.
  const envelope = parseSealedEnvelope(context.json);
  if (envelope === undefined) {
    return errorResponse('validation_failed', {
      fields: [{ field: 'body', problem: 'must be a sealed envelope: v, keyId, enc and ct' }],
    });
  }
  // 1. The session and its limit, or the address's — before any X25519.
  const authorization = request.headers.get('authorization');
  let caller: Caller | undefined;
  if (authorization !== null) {
    caller = await identity.authenticate(authorization);
    if (caller === undefined) {
      return errorResponse('unauthenticated', { headers: { 'www-authenticate': 'Bearer' } });
    }
    if (!identity.allowSealedRequest(caller)) return errorResponse('rate_limited');
  } else if (!identity.allowSessionlessSealedRequest(client.address)) {
    return errorResponse('rate_limited');
  }
  // 2. The key.
  const recipient = await instanceKeys.encryptionKey(envelope.keyId);
  if (recipient === undefined) return errorResponse('instance_key_unknown');
  // 3. Open. A refusal before this point is plaintext; after it, sealed.
  const binding: SealedBinding = {
    instanceOrigin: identity.origin,
    keyId: envelope.keyId,
    tokenSha256: caller?.tokenSha256 ?? null,
  };
  let opened;
  try {
    opened = await openSealedRequest(sealed.primitives, recipient, envelope, binding);
  } catch {
    return errorResponse('sealed_unopened');
  }
  const writer = await sealedReplyWriter(sealed.primitives, opened.context, binding);
  let header: InnerHeader | undefined;
  let body: Uint8Array;
  try {
    const frame = decodeFrame(unpad(opened.padded));
    header = innerHeader(frame.header, identity.origin);
    body = frame.body;
  } catch {
    return sealedError(writer, 'validation_failed');
  }
  if (header === undefined) return sealedError(writer, 'validation_failed');
  const pathname = header.path.split('?')[0] ?? header.path;
  // A request with no session reaches the named sessionless routes and nothing else.
  if (caller === undefined && (header.method !== 'POST' || !SESSIONLESS_PATHS.has(pathname))) {
    return sealedError(writer, 'unauthenticated');
  }
  // 4. The signature, under the SESSION's key, or the inner statement's.
  const unsigned = caller === undefined && pathname === UNSIGNED_PATH;
  if (!unsigned) {
    const key = caller !== undefined ? caller.deviceKey : statementKey(body);
    if (
      key === undefined ||
      header.signature === undefined ||
      (caller === undefined && header.signer !== key)
    ) {
      return sealedError(writer, 'bad_signature');
    }
    const statement = sealedRequestStatementBytes({
      instanceOrigin: identity.origin,
      keyId: envelope.keyId,
      enc: toHex(envelope.enc),
      method: header.method,
      path: header.path,
      issuedAt: header.issuedAt,
      bodySha256: await sealedBodySha256(sealed.sha256, body),
    });
    if (!(await verifyEd25519(key, statement, header.signature))) {
      return sealedError(writer, 'bad_signature');
    }
  }
  // 5. Freshness, before the replay record: a stale request leaves no record.
  const now = sealed.nowSeconds();
  if (Math.abs(now - header.issuedAt) > SEALED_FRESHNESS_SECONDS) {
    return sealedError(writer, 'stale_request', { instanceTime: now });
  }
  // 6. Replay: one statement, before anything runs.
  if ((await sealed.record(envelope.enc)) === 'replayed') {
    return sealedError(writer, 'replayed');
  }
  if (caller !== undefined) await sealed.touch(caller);
  // 7. The inner route, through the same table.
  const headers = new Headers();
  if (authorization !== null) headers.set('authorization', authorization);
  if (body.length > 0) headers.set('content-type', 'application/json');
  if (header.lastEventId !== undefined) headers.set('last-event-id', header.lastEventId);
  const inner = new Request(new URL(header.path, identity.origin), {
    method: header.method,
    headers,
    ...(body.length > 0 && header.method !== 'GET' ? { body } : {}),
  });
  const answered = await context.dispatch(inner, body.length > 0 ? body : null, client);
  return sealInner(writer, answered, header.lastEventId);
}

const base64url: Schema = { type: 'string' };

export const SEALED_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: SEALED_PATH,
    operationId: 'sealedRequest',
    reaches: 'own',
    summary:
      'A request sealed to the instance’s encryption key (ADR 0047 D-9): the inner method, path, body and the device’s signature are inside `ct`, the inner route is dispatched through this same table, and the answer is sealed back. A refusal before the request opens is plaintext — `unauthenticated`, `rate_limited`, `instance_key_unknown`, `sealed_unopened` — and every answer after it, refusals included (`bad_signature`, `stale_request`, `replayed`), is sealed and sent with 200. An inner body over the instance’s body limit is refused only after Open, as a sealed `payload_too_large`: the envelope’s own limit allows for the padding (D-9), so the size of what was sealed is not known before.',
    identity: true,
    errors: [
      'validation_failed',
      'unauthenticated',
      'instance_key_unknown',
      'sealed_unopened',
      'unavailable',
    ],
    bodyLimit: (config) => sealedEnvelopeLimit(config.bodyLimitBytes),
    request: {
      type: 'object',
      properties: {
        v: { type: 'integer' },
        keyId: { type: 'string' },
        enc: base64url,
        ct: base64url,
      },
      required: ['v', 'keyId', 'enc', 'ct'],
      additionalProperties: false,
    },
    response: {
      contentType: 'sealed',
      schema: {
        type: 'object',
        properties: { v: { type: 'integer' }, nonce: base64url, ct: base64url },
        required: ['v', 'nonce', 'ct'],
        additionalProperties: false,
      },
    },
    handle: handleSealed,
  },
];
