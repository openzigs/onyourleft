// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The riders this rider blocked, and undoing a block** (#1529): read back on
 * the Instance screen.
 *
 * A rider blocks another from a race's result, by the row it names them on
 * (#1516, `net/rooms-port.ts` §`blockRider`), because this device never holds
 * another rider's athlete id. For the same reason it cannot list or undo a
 * block by `GET /v1/blocks` and `DELETE /v1/blocks/{athleteId}`, which speak
 * in ids. So it asks for `GET /v1/blocks/handles`: each of the rider's own
 * blocks by an opaque handle the instance made for it, and the name the result
 * showed them when they blocked. {@link BlocksPort.unblock} sends the handle
 * back to `DELETE /v1/blocks/handles/{handle}`. **No athlete id is sent or
 * read here**: an answer that carries one is not read for it.
 *
 * Both routes are sealed-only on an instance holding keys (ADR 0047 D-7's
 * phase-2 row "`GET`, `POST` and `DELETE /v1/blocks…`"), so they go through
 * `heldAccountSession` (#1210), sealed from a device holding a pin, and in
 * plaintext only from one with none. Every request goes through
 * `instance-transport.ts`, the ONE module this client sends instance traffic
 * through (#777, ADR 0036 D-3 (a)), and only to the instance this device
 * connected to. A device connected to none sends nothing.
 *
 * A `*-port.ts`: `check:wiring` watches {@link BlocksPort} and
 * {@link createBlocksPort}, and `main.tsx` is the only production code that
 * builds one.
 */

import { MAXIMUM_DISPLAY_NAME_SCALARS } from '@onyourleft/domain';

import { heldAccountSession, type SealingDependencies } from './instance-port';

/** One block this rider made, as the instance lists it: never the blocked rider's id. */
export interface HeldBlock {
  /** Opaque: what {@link BlocksPort.unblock} sends back. */
  readonly handle: string;
  /**
   * The name the race's result showed this rider when they blocked, or
   * `null`: a block made before the instance kept names, by id, or of a
   * rider who has since deleted their account.
   */
  readonly name: string | null;
  /** Unix seconds. */
  readonly blockedAt: number;
}

export type BlocksRead =
  | { readonly kind: 'blocks'; readonly blocks: readonly HeldBlock[] }
  | { readonly kind: 'not-connected' }
  | { readonly kind: 'unreachable' };

export type UnblockAnswer = { readonly kind: 'unblocked' } | { readonly kind: 'unreachable' };

export interface BlocksPort {
  /** The blocks this rider made, newest first. */
  read(): Promise<BlocksRead>;
  /** Undo one of them, by its handle. */
  unblock(handle: string): Promise<UnblockAnswer>;
}

/** A handle as the instance makes one (`apps/instance` §migration 0035): 16 random bytes, in hex. */
const HANDLE = /^[0-9a-f]{32}$/;

function heldBlockFrom(value: unknown): HeldBlock | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const { handle, name, blockedAt } = row;
  if (
    typeof handle !== 'string' ||
    !HANDLE.test(handle) ||
    !(
      name === null ||
      (typeof name === 'string' && [...name].length <= MAXIMUM_DISPLAY_NAME_SCALARS)
    ) ||
    typeof blockedAt !== 'number' ||
    !Number.isSafeInteger(blockedAt) ||
    blockedAt < 0
  ) {
    return undefined;
  }
  // Only these three are read: nothing else in the answer is kept.
  return { handle, name, blockedAt };
}

/** The production {@link BlocksPort}: `main.tsx` builds it, and nothing else in the client. */
export function createBlocksPort(dependencies: SealingDependencies): BlocksPort {
  const accountSession = heldAccountSession(dependencies);
  return {
    read: async () => {
      try {
        const session = await accountSession();
        if (session.kind === 'closed') {
          return session.why === 'signed-out' ? { kind: 'not-connected' } : { kind: 'unreachable' };
        }
        const answer = await session.sealedOrKeyless.call('GET', '/v1/blocks/handles', {
          token: session.token,
        });
        const list = (answer.body as { blocks?: unknown } | null)?.blocks;
        if (answer.status !== 200 || !Array.isArray(list)) return { kind: 'unreachable' };
        const blocks = list.map(heldBlockFrom);
        return blocks.some((each) => each === undefined)
          ? { kind: 'unreachable' }
          : { kind: 'blocks', blocks: blocks as HeldBlock[] };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    unblock: async (handle) => {
      // Never a path segment the instance did not hand over (#1529).
      if (!HANDLE.test(handle)) return { kind: 'unreachable' };
      try {
        const session = await accountSession();
        if (session.kind === 'closed') return { kind: 'unreachable' };
        const answer = await session.sealedOrKeyless.call(
          'DELETE',
          `/v1/blocks/handles/${handle}`,
          { token: session.token },
        );
        return answer.status === 204 ? { kind: 'unblocked' } : { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },
  };
}
