// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one module in this client permitted to talk to an instance**
 * ([#777](https://github.com/openzigs/onyourleft/issues/777),
 * [ADR 0036](../../../../docs/adr/0036-a-self-hostable-instance-server-now.md)
 * D-3 (a)). `privacy/no-network.test.ts` pins exactly one `fetch` here, and a
 * `fetch` — or a socket — anywhere else in the client is a red build. A room's
 * socket (#782) is opened through this module rather than beside it, and that
 * is a change to this file and to that list, never a second module.
 *
 * ## What leaves, exactly
 *
 * Only what `sign-in.ts` and `instance-port.ts` hand {@link InstanceHttp.call}:
 * today, a device's public key, a signed statement, the display name a rider
 * typed when registering, and the session token in `Authorization`. The bodies
 * are built in those two modules and nowhere else, and
 * `privacy/boundaries.test.ts` walks each for a coordinate — this module is a
 * `departing` boundary (ADR 0036 D-3 (d)). No module here can name a camera
 * type (`instance-transport.test.ts` reads the imports), so a picture cannot
 * reach this path.
 *
 * ## The request, and what it refuses
 *
 * - **The origin is checked again here** with `address.ts`'s rule, and a
 *   refused origin throws before `fetch` is reached — so a caller that skipped
 *   the check still sends nothing over `http:` to another machine.
 * - **Only a path**, starting with `/` and not `//`, is appended to that
 *   origin: a caller cannot point a request at another host. ⚠️ **And only a
 *   plain one, since #782's review**: a path holding a `.` or `..` segment, a
 *   `?`, a `#`, a `%` or a `\` is refused before anything is sent. `fetch`
 *   normalises dot segments (and a `\` is a `/` to the URL parser), so
 *   `/v1/rooms/x/../../auth/devices/K/revoke?/ticket` used to leave as a
 *   bearer-authenticated `POST /v1/auth/devices/K/revoke` — the caller that
 *   built it from a room id had checked nothing. No caller here sends a query;
 *   one that needs to is given a structured parameter, never a string.
 * - `redirect: 'error'` — a redirect would carry a session token somewhere the
 *   rider did not type. `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
 *   `cache: 'no-store'`: nothing ambient rides along, and nothing is kept.
 * - **A time limit** ({@link INSTANCE_TIMEOUT_MILLISECONDS}), because an
 *   instance that never answers must not leave the screen waiting for ever.
 * - **A size limit on the answer** ({@link MAXIMUM_INSTANCE_ANSWER_BYTES}),
 *   read in chunks and abandoned past it, so an instance cannot make the app
 *   hold an unbounded body.
 *
 * ## A room's socket — #782
 *
 * {@link instanceRoomSocket} is the ONE place the client opens a WebSocket,
 * and it is here rather than in a module of its own because ADR 0036 D-3 (a)
 * admits exactly one module for instance traffic: `no-network.test.ts`
 * §`PERMITTED_NETWORK_CALLS` pins one `fetch` AND one `WebSocket` to this
 * file, and either primitive anywhere else in the client is a red build.
 *
 * - **Only a room's socket path** is opened — `/v1/rooms/{roomId}/socket` on
 *   the address's own `socketOrigin` (`wss:` for `https:`, `ws:` for a
 *   loopback `http:`, `address.ts`), with a room id the instance's own router
 *   would accept. ⚠️ Both of a room's paths — the ticket's and the socket's —
 *   come from ONE builder, {@link roomPath}, which refuses any other id; until
 *   #782's review only the socket's was checked, and the ticket's POST
 *   carried the rider's session token wherever a hostile id steered it.
 * - **Text only.** A binary message is not the wire format
 *   (`@onyourleft/protocol`), and the socket is closed on one.
 * - **No credential rides on the socket**: the hello carries a single-use,
 *   30-second ticket minted over {@link InstanceHttp.call} (#772), never the
 *   session token, and a browser WebSocket sends no `Authorization` header.
 * - **What leaves** is `net/room-session.ts`'s hello and reports — a ticket, a
 *   power in watts, a cadence and the client's own clock; never a position
 *   (`@onyourleft/protocol` has no field for one, and
 *   `net/room-session.test.ts` walks every sent message for a coordinate).
 *
 * ## A sealed call — #1191
 *
 * {@link sealedInstance} seals a request to the instance's encryption key
 * (ADR 0047 D-8, D-9) and sends it as `POST /v1/sealed` through the SAME
 * `fetch` as every other call here — `no-network.test.ts` is unchanged, and
 * the bytes leave through this module and nowhere else. What it holds:
 *
 * - **The ephemeral key and the HPKE context live in memory for one request or
 *   one stream** (D-2), inside `@onyourleft/domain`'s `sealRequest`, and are
 *   dropped with the call. Nothing here writes to IndexedDB or `localStorage`,
 *   logs, or calls `exportKey` on a private key.
 * - **The clock offset**, per instance ({@link InstanceClock}). On a sealed
 *   `stale_request` the call re-signs ONCE with the instance's time, keeps the
 *   offset for the next request, and says so above five minutes; a second
 *   `stale_request` says the instance's clock looks wrong. The offset is taken
 *   ONLY from a sealed answer — a plaintext one, which the edge could write, is
 *   never read for it.
 * - **A stream ends `finished` only on its sealed `end` event.** One that
 *   stops without it, or whose next event does not open in order, is `cut`;
 *   resuming is a NEW sealed request naming the last event id opened.
 *
 * The instance key is the caller's: from a statement verified under the
 * identity key the device pinned (#1190). Which routes are called sealed is
 * #1192's.
 */

import {
  PASTED_KEY_PAD_BYTES,
  SEALED_CLOCK_NOTICE_SECONDS,
  SEALED_END_KIND,
  SEALED_PATH,
  sealedEnvelopeLimit,
  sealRequest,
  utf8Decode,
  utf8Encode,
  type HpkePrimitives,
  type SealedEvent,
  type SealedInstanceKey,
  type SealedRequest,
  type Sha256,
  type SigningKey,
} from '@onyourleft/domain';

import { instanceAddress } from './address';

/** How long one request may take before the app stops waiting. */
export const INSTANCE_TIMEOUT_MILLISECONDS = 15_000;

/** The largest answer the app reads from an instance. */
export const MAXIMUM_INSTANCE_ANSWER_BYTES = 256 * 1024;

/**
 * The largest answer ONE call may ask to read instead — a room's route (#784),
 * which is up to the instance's 900 KiB of GPX in a JSON string. Asked for by
 * {@link InstanceCallOptions.maximumAnswerBytes}, and never more than this.
 */
export const MAXIMUM_ROOM_ROUTE_ANSWER_BYTES = 2 * 1024 * 1024;

/** How a request is sent. The platform's own `fetch` in production. */
export type InstanceSend = (url: string, init: RequestInit) => Promise<Response>;

/** The status and the parsed JSON body — `null` for an empty or unreadable one. */
export interface InstanceAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface InstanceCallOptions {
  readonly body?: Readonly<Record<string, unknown>>;
  readonly token?: string;
  /**
   * A larger answer than {@link MAXIMUM_INSTANCE_ANSWER_BYTES}, for the one
   * call that needs it (a room's route, #784) — clamped to
   * {@link MAXIMUM_ROOM_ROUTE_ANSWER_BYTES}.
   */
  readonly maximumAnswerBytes?: number;
  /**
   * A query string, as names and values (#961: a moderators' list's `limit`
   * and `cursor`). Encoded here with `URLSearchParams` and appended AFTER the
   * path has passed {@link isPlainPath}, so no value — a cursor the instance
   * wrote, say — can reach the path: `?`, `#`, `/` and `%` in it are encoded.
   * A path that carries a `?` of its own is still refused.
   */
  readonly query?: Readonly<Record<string, string>>;
}

/** One instance, reached over HTTP. */
export interface InstanceHttp {
  readonly origin: string;
  call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options?: InstanceCallOptions,
  ): Promise<InstanceAnswer>;
}

/** Why a request was never made, or never answered. */
export class InstanceUnreachableError extends Error {
  override readonly name = 'InstanceUnreachableError';
  constructor(readonly why: 'refused-address' | 'refused-path' | 'no-answer' | 'too-large') {
    super(`The instance could not be reached: ${why}.`);
  }
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > limit) throw new InstanceUnreachableError('too-large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(read);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

async function boundedText(response: Response, limit: number): Promise<string> {
  return new TextDecoder().decode(await boundedBytes(response, limit));
}

function parsed(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Whether `path` is one this module appends to an origin: absolute, not
 * protocol-relative, and PLAIN — no `.` or `..` segment for `fetch` to
 * normalise away, no `?` or `#` to push the rest into a query or a fragment,
 * no `%` to smuggle either past this check, and no `\`, which the URL parser
 * reads as `/`. See the module header, and #782's review (B1).
 *
 * ⚠️ **And no C0 control character** (#922): the URL parser strips a tab, a
 * line feed and a carriage return from anywhere in a URL, so
 * `/v1/rooms/.\t./auth/x` passed the segment check here and was sent as
 * `/v1/auth/x`. The rest of C0 is refused with them: none has any business
 * in a path this module is handed.
 */
function isPlainPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (/[?#%\\]/.test(path)) return false;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f]/u.test(path)) return false;
  return path
    .slice(1)
    .split('/')
    .every((segment) => segment !== '.' && segment !== '..');
}

/** The platform's own `fetch`: the ONE this client calls an instance with. */
const platformSend: InstanceSend = async (url, init) => fetch(url, init);

/**
 * The transport to one instance. Throws {@link InstanceUnreachableError} at
 * once, having sent nothing, for an origin `address.ts` refuses.
 */
export function instanceHttp(origin: string, send?: InstanceSend): InstanceHttp {
  const decision = instanceAddress(origin);
  if (decision.kind !== 'accepted' || decision.origin !== origin) {
    throw new InstanceUnreachableError('refused-address');
  }
  const sender: InstanceSend = send ?? platformSend;
  return {
    origin,
    call: async (method, path, options = {}) => {
      if (!isPlainPath(path)) {
        throw new InstanceUnreachableError('refused-path');
      }
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const query =
        options.query === undefined ? '' : new URLSearchParams(options.query).toString();
      let response: Response;
      try {
        response = await sender(`${origin}${path}${query === '' ? '' : `?${query}`}`, {
          method,
          headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          // ⚠️ `redirect: 'error'` holds in the Android shell only while
          // `capacitor.config.ts` leaves `CapacitorHttp` off: enabled, it
          // patches `fetch` onto the native stack, which ignores this option
          // (#892's review). Keep it off, or route this module around it.
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MILLISECONDS),
        });
      } catch {
        throw new InstanceUnreachableError('no-answer');
      }
      const limit = Math.min(
        options.maximumAnswerBytes ?? MAXIMUM_INSTANCE_ANSWER_BYTES,
        MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
      );
      return { status: response.status, body: parsed(await boundedText(response, limit)) };
    },
  };
}

/**
 * What a room's socket is to the rest of the client — deliberately not the
 * platform's own type, so no other module can name it (#782).
 */
export interface InstanceSocket {
  /** Send one text message. Dropped when the socket is not open. */
  send(text: string): void;
  /** Close it. Idempotent. */
  close(code?: number, reason?: string): void;
}

/** What a room's socket tells its owner. */
export interface InstanceSocketEvents {
  onOpen(): void;
  onText(text: string): void;
  /** Always called once, whether the socket closed cleanly, failed to open or errored. */
  onClose(code: number, reason: string): void;
}

/** How a socket is opened. The platform's own in production. */
export type OpenInstanceSocket = (url: string, events: InstanceSocketEvents) => InstanceSocket;

/** A room id the instance's router accepts (`room/node/router.ts` §`ROOM_SOCKET_PATH`). */
const ROOM_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether the instance's router could route `roomId` — and so whether a room path may be built from it. */
export function isRoomId(roomId: string): boolean {
  return ROOM_ID.test(roomId);
}

/**
 * The ONE builder of a room's paths on an instance — the ticket's
 * (`POST /v1/rooms/{roomId}/ticket`), the socket's, and since #784 and #785 the
 * route's, the result's and the start's — so that every one applies
 * {@link isRoomId}. Throws {@link InstanceUnreachableError} `refused-path`,
 * having built nothing, for any other id (#782's review, B1).
 */
export function roomPath(
  roomId: string,
  kind: 'ticket' | 'socket' | 'route' | 'results' | 'start',
): string {
  if (!isRoomId(roomId)) throw new InstanceUnreachableError('refused-path');
  return `/v1/rooms/${roomId}/${kind}`;
}

/** RFC 6455 §7.4.1: the endpoint received a type of data it cannot accept. */
const UNSUPPORTED_DATA = 1003;

/** `readyState` of an open socket (WHATWG WebSockets §"The WebSocket interface"). */
const OPEN = 1;

const platformSocket: OpenInstanceSocket = (url, events) => {
  const socket = new WebSocket(url);
  let closed = false;
  socket.addEventListener('open', () => {
    events.onOpen();
  });
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string') {
      events.onText(event.data);
    } else {
      socket.close(UNSUPPORTED_DATA, 'text-only');
    }
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    if (closed) return;
    closed = true;
    events.onClose(event.code, event.reason);
  });
  return {
    send: (text) => {
      if (socket.readyState === OPEN) socket.send(text);
    },
    close: (code, reason) => {
      try {
        socket.close(code ?? 1000, reason);
      } catch {
        // An invalid code or an already-closing socket: nothing else to do.
      }
    },
  };
};

/**
 * Open one room's socket on the instance at `origin`. Throws
 * {@link InstanceUnreachableError} at once, having opened nothing, for an
 * origin `address.ts` refuses or a room id the instance could not route.
 */
export function instanceRoomSocket(
  origin: string,
  roomId: string,
  events: InstanceSocketEvents,
  open?: OpenInstanceSocket,
): InstanceSocket {
  const decision = instanceAddress(origin);
  if (decision.kind !== 'accepted' || decision.origin !== origin) {
    throw new InstanceUnreachableError('refused-address');
  }
  return (open ?? platformSocket)(`${decision.socketOrigin}${roomPath(roomId, 'socket')}`, events);
}

// --- Sealed calls — #1191, ADR 0047 D-8, D-9 --------------------------------

/** How long a sealed stream may run before the app stops reading it. */
export const SEALED_STREAM_TIMEOUT_MILLISECONDS = 10 * 60_000;

/**
 * The offset between this device's clock and each instance's, in seconds,
 * kept in memory and replaced only by a later SEALED `stale_request` (D-9).
 */
export interface InstanceClock {
  offsetSeconds(origin: string): number;
  setOffset(origin: string, seconds: number): void;
}

export function createInstanceClock(): InstanceClock {
  const offsets = new Map<string, number>();
  return {
    offsetSeconds: (origin) => offsets.get(origin) ?? 0,
    setOffset: (origin, seconds) => {
      offsets.set(origin, seconds);
    },
  };
}

/**
 * The two things a rider is told about clocks (D-9). ⚠️ **Draft wording**,
 * for the owner's approval in #1191's pull request (D-14 Q6).
 */
export function clockOffsetNotice(minutes: number): string {
  return `This phone’s clock is off by about ${String(minutes)} minutes from your instance’s. Sealed requests may fail until the date and time are set automatically.`;
}

/** Said on a second `stale_request`: the box's clock is the one moving. Draft, as above. */
export const INSTANCE_CLOCK_WRONG_NOTICE =
  'Your instance’s clock looks wrong; ask its operator to check it.';

export type SealedNotice =
  | { readonly kind: 'clock-offset'; readonly minutes: number; readonly text: string }
  | { readonly kind: 'instance-clock-wrong'; readonly text: string };

/** What a sealed call needs beyond the address. */
export interface SealedCallDependencies {
  /** The instance's encryption key, from its statement verified under the pinned identity key. */
  readonly instanceKey: SealedInstanceKey;
  /**
   * The key that signs: the session's device key, or for a sessionless call
   * the key its inner statement adds. `null` only for `recover/email` (D-8).
   */
  readonly signingKey: SigningKey | null;
  /** HPKE's six primitives — `@onyourleft/store`'s `webCryptoHpkePrimitives`. */
  readonly primitives: HpkePrimitives<unknown>;
  readonly sha256: Sha256;
  readonly clock: InstanceClock;
  /** Unix milliseconds. */
  readonly now?: () => number;
}

export interface SealedCallOptions {
  readonly body?: Readonly<Record<string, unknown>>;
  readonly token?: string;
  /** A pasted key travels in this request: pad it to at least 1 KiB (D-9). */
  readonly pastedKey?: boolean;
  readonly maximumAnswerBytes?: number;
}

/** A sealed call's answer: the INNER status and body, and anything the rider must be told. */
export interface SealedInstanceAnswer extends InstanceAnswer {
  readonly notice?: SealedNotice;
}

export interface SealedStreamOptions {
  readonly token?: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: Readonly<Record<string, unknown>>;
  /** Resume after this event id: a NEW sealed request (D-9). */
  readonly lastEventId?: string;
  /** Each event as it opens, in order. Never the `end` event. */
  onEvent(event: { readonly id: string; readonly kind: string; readonly data: string }): void;
}

/** How a stream ended. */
export interface SealedStreamResult {
  /** `finished` only on the sealed `end` event; anything else is `cut`. */
  readonly outcome: 'finished' | 'cut';
  /** The last event id opened — what a resume names. */
  readonly lastEventId?: string;
  /** When the instance refused instead of streaming: its status and body. */
  readonly refused?: InstanceAnswer;
  readonly notice?: SealedNotice;
}

export interface SealedInstance {
  call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options?: SealedCallOptions,
  ): Promise<SealedInstanceAnswer>;
  stream(path: string, options: SealedStreamOptions): Promise<SealedStreamResult>;
}

function isSealedReply(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'nonce' in body && 'ct' in body;
}

function staleTime(body: unknown): number | undefined {
  const record = body as { error?: { code?: unknown }; instanceTime?: unknown } | null;
  return record?.error?.code === 'stale_request' && typeof record.instanceTime === 'number'
    ? record.instanceTime
    : undefined;
}

/**
 * Sealed calls to the instance at `origin` (#1191). Throws
 * {@link InstanceUnreachableError} at once, having sent nothing, for an
 * origin `address.ts` refuses or a path {@link isPlainPath} refuses.
 */
export function sealedInstance(
  origin: string,
  sealing: SealedCallDependencies,
  send?: InstanceSend,
): SealedInstance {
  const decision = instanceAddress(origin);
  if (decision.kind !== 'accepted' || decision.origin !== origin) {
    throw new InstanceUnreachableError('refused-address');
  }
  const sender: InstanceSend = send ?? platformSend;
  const now = sealing.now ?? (() => Date.now());

  async function seal(
    method: string,
    path: string,
    body: Readonly<Record<string, unknown>> | undefined,
    token: string | undefined,
    extra: { pastedKey?: boolean; lastEventId?: string },
  ): Promise<SealedRequest> {
    return sealRequest({
      primitives: sealing.primitives,
      sha256: sealing.sha256,
      instanceOrigin: origin,
      instanceKey: sealing.instanceKey,
      sessionToken: token ?? null,
      method,
      path,
      body: body === undefined ? null : utf8Encode(JSON.stringify(body)),
      issuedAt: Math.floor(now() / 1000) + sealing.clock.offsetSeconds(origin),
      ...(sealing.signingKey === null ? {} : { signer: sealing.signingKey }),
      ...(extra.lastEventId === undefined ? {} : { lastEventId: extra.lastEventId }),
      ...(extra.pastedKey === true ? { minimumPadding: PASTED_KEY_PAD_BYTES } : {}),
    });
  }

  async function post(sealed: SealedRequest, token: string | undefined, timeout: number) {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    try {
      return await sender(`${origin}${SEALED_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(sealed.envelope),
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new InstanceUnreachableError('no-answer');
    }
  }

  /** A whole answer: a plaintext refusal as it is, or the sealed reply opened. */
  async function whole(sealed: SealedRequest, response: Response, limit: number) {
    const body = parsed(new TextDecoder().decode(await boundedBytes(response, limit)));
    if (response.status !== 200 || !isSealedReply(body)) {
      return { status: response.status, body, sealed: false };
    }
    const reply = await sealed.openReply(body);
    return { status: reply.status, body: parsed(utf8Decode(reply.body) ?? ''), sealed: true };
  }

  /**
   * The offset from a SEALED `stale_request`, kept; and whether to tell the
   * rider. Never from a plaintext answer, which the edge could write.
   */
  function learnOffset(instanceTime: number): SealedNotice | undefined {
    const offset = instanceTime - Math.floor(now() / 1000);
    sealing.clock.setOffset(origin, offset);
    if (Math.abs(offset) <= SEALED_CLOCK_NOTICE_SECONDS) return undefined;
    const minutes = Math.round(Math.abs(offset) / 60);
    return { kind: 'clock-offset', minutes, text: clockOffsetNotice(minutes) };
  }

  const WRONG: SealedNotice = { kind: 'instance-clock-wrong', text: INSTANCE_CLOCK_WRONG_NOTICE };

  return {
    async call(method, path, options = {}) {
      if (!isPlainPath(path)) throw new InstanceUnreachableError('refused-path');
      const limit = sealedEnvelopeLimit(
        Math.min(
          options.maximumAnswerBytes ?? MAXIMUM_INSTANCE_ANSWER_BYTES,
          MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
        ),
      );
      const attempt = async () => {
        const sealed = await seal(method, path, options.body, options.token, options);
        return whole(
          sealed,
          await post(sealed, options.token, INSTANCE_TIMEOUT_MILLISECONDS),
          limit,
        );
      };
      const first = await attempt();
      const instanceTime = first.sealed ? staleTime(first.body) : undefined;
      if (instanceTime === undefined) return { status: first.status, body: first.body };
      const notice = learnOffset(instanceTime);
      const second = await attempt();
      if (second.sealed && staleTime(second.body) !== undefined) {
        return { status: second.status, body: second.body, notice: WRONG };
      }
      return {
        status: second.status,
        body: second.body,
        ...(notice === undefined ? {} : { notice }),
      };
    },

    async stream(path, options) {
      if (!isPlainPath(path)) throw new InstanceUnreachableError('refused-path');
      let notice: SealedNotice | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const sealed = await seal(options.method ?? 'GET', path, options.body, options.token, {
          ...(options.lastEventId === undefined ? {} : { lastEventId: options.lastEventId }),
        });
        const response = await post(sealed, options.token, SEALED_STREAM_TIMEOUT_MILLISECONDS);
        if (!(response.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
          const answer = await whole(
            sealed,
            response,
            sealedEnvelopeLimit(MAXIMUM_INSTANCE_ANSWER_BYTES),
          );
          const instanceTime = answer.sealed ? staleTime(answer.body) : undefined;
          if (instanceTime !== undefined && attempt === 0) {
            notice = learnOffset(instanceTime);
            continue;
          }
          if (instanceTime !== undefined) notice = WRONG;
          return {
            outcome: 'cut',
            refused: { status: answer.status, body: answer.body },
            ...(options.lastEventId === undefined ? {} : { lastEventId: options.lastEventId }),
            ...(notice === undefined ? {} : { notice }),
          };
        }
        const read = await readStream(sealed, response, options);
        return { ...read, ...(notice === undefined ? {} : { notice }) };
      }
      throw new InstanceUnreachableError('no-answer');
    },
  };
}

/** A stream's frames, each opened in order; `finished` only on its sealed `end`. */
async function readStream(
  sealed: SealedRequest,
  response: Response,
  options: SealedStreamOptions,
): Promise<Pick<SealedStreamResult, 'outcome' | 'lastEventId'>> {
  const opener = sealed.streamOpener();
  let lastEventId = options.lastEventId;
  const result = (outcome: 'finished' | 'cut') => ({
    outcome,
    ...(lastEventId === undefined ? {} : { lastEventId }),
  });
  if (response.body === null) return result('cut');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return result('cut');
      }
      buffered += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (buffered.length > sealedEnvelopeLimit(MAXIMUM_INSTANCE_ANSWER_BYTES)) {
        return result('cut');
      }
      const blocks = buffered.split('\n\n');
      buffered = chunk.done ? '' : (blocks.pop() ?? '');
      for (const block of blocks) {
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length));
        if (data.length !== 1) continue;
        let event: SealedEvent;
        try {
          event = await opener.open(data[0] as string);
        } catch {
          return result('cut');
        }
        if (event.kind === SEALED_END_KIND) return result('finished');
        lastEventId = event.id;
        options.onEvent({ id: event.id, kind: event.kind, data: utf8Decode(event.data) ?? '' });
      }
      if (chunk.done) return result('cut');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
