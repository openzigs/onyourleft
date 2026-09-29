// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The parts of the Cloudflare Workers runtime the Durable Object adapter uses
 * (#781), written down as ports rather than installed as types.
 *
 * ## Why not `@cloudflare/workers-types`
 *
 * It would be one more dependency for about a dozen members, and its globals
 * (`Response`, `WebSocket`, `Request`) collide with the ones `@types/node`
 * gives the wide `tsconfig.json`. So the adapter names only what is here, and
 * `tsconfig.durable-object.json` compiles it with no `types` at all — a
 * `process` or a `node:` import in `src/room/durable-object/` is a compile
 * error, as it would be a load error under `workerd`.
 *
 * ⚠️ **These are shapes, not a promise about the platform.** What proves they
 * match `workerd` is `room-object.workerd.test.ts`, which runs the adapter
 * under the real runtime. A member added here and misspelt is caught there
 * and nowhere else.
 */

/**
 * A server-side WebSocket accepted through the Hibernation API
 * (`state.acceptWebSocket`). Its attachment survives eviction; nothing else
 * the object held in memory does.
 */
export interface HibernatableSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  /** At most 16 384 bytes once serialised (developers.cloudflare.com, read 2026-09-28). */
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** `state.storage`, the members this adapter calls. */
export interface DurableStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string[]): Promise<number>;
  /** Entries whose key starts with `prefix`, in key order. */
  list<T>(options: { readonly prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTimeMs: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** `DurableObjectState`, the members this adapter calls. */
export interface DurableObjectContext {
  readonly storage: DurableStorage;
  /** The Hibernation API: the runtime, not this object, holds the socket. */
  acceptWebSocket(socket: HibernatableSocket): void;
  getWebSockets(): HibernatableSocket[];
}

/** What the adapter reads of an incoming `Request`. */
export interface IncomingRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
}

/**
 * What the adapter builds that only the runtime can: a socket pair and a
 * `Response`. `Reply` is the runtime's own `Response`; the adapter never looks
 * inside one.
 */
export interface WorkersPlatform<Reply> {
  /** `new WebSocketPair()`: the client end goes back in the reply, the server end is accepted. */
  socketPair(): { readonly client: unknown; readonly server: HibernatableSocket };
  /** `new Response(null, { status: 101, webSocket: client })`. */
  upgraded(client: unknown): Reply;
  /** A reply with no socket, and a short text body for a person reading a log. */
  status(code: number, text: string): Reply;
}
