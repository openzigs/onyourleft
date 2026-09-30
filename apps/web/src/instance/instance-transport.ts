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
 *   origin: a caller cannot point a request at another host.
 * - `redirect: 'error'` — a redirect would carry a session token somewhere the
 *   rider did not type. `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
 *   `cache: 'no-store'`: nothing ambient rides along, and nothing is kept.
 * - **A time limit** ({@link INSTANCE_TIMEOUT_MILLISECONDS}), because an
 *   instance that never answers must not leave the screen waiting for ever.
 * - **A size limit on the answer** ({@link MAXIMUM_INSTANCE_ANSWER_BYTES}),
 *   read in chunks and abandoned past it, so an instance cannot make the app
 *   hold an unbounded body.
 */

import { instanceAddress } from './address';

/** How long one request may take before the app stops waiting. */
export const INSTANCE_TIMEOUT_MILLISECONDS = 15_000;

/** The largest answer the app reads from an instance. */
export const MAXIMUM_INSTANCE_ANSWER_BYTES = 256 * 1024;

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

async function boundedText(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > MAXIMUM_INSTANCE_ANSWER_BYTES) throw new InstanceUnreachableError('too-large');
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
      if (!path.startsWith('/') || path.startsWith('//')) {
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
      return { status: response.status, body: parsed(await boundedText(response)) };
    },
  };
}
