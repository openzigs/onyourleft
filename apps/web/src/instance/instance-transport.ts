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
 */

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

async function boundedText(response: Response, limit: number): Promise<string> {
  if (response.body === null) return '';
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
  return new TextDecoder().decode(bytes);
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
 */
function isPlainPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (/[?#%\\]/.test(path)) return false;
  return path
    .slice(1)
    .split('/')
    .every((segment) => segment !== '.' && segment !== '..');
}

/**
 * The transport to one instance. Throws {@link InstanceUnreachableError} at
 * once, having sent nothing, for an origin `address.ts` refuses.
 */
export function instanceHttp(origin: string, send?: InstanceSend): InstanceHttp {
  const decision = instanceAddress(origin);
  if (decision.kind !== 'accepted' || decision.origin !== origin) {
    throw new InstanceUnreachableError('refused-address');
  }
  const sender: InstanceSend = send ?? (async (url, init) => fetch(url, init));
  return {
    origin,
    call: async (method, path, options = {}) => {
      if (!isPlainPath(path)) {
        throw new InstanceUnreachableError('refused-path');
      }
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      let response: Response;
      try {
        response = await sender(`${origin}${path}`, {
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
