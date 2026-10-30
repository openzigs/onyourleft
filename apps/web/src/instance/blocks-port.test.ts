// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `blocks-port.ts` against a scripted instance (#1529): what is read out of
 * an answer, and what is never sent. The sealed round trip through the real
 * instance is `net/rooms-sealed.test.ts` §"#1516".
 */

import { describe, expect, it } from 'vitest';

import { signedInStorage } from '../rooms/rooms-testing';
import { createBlocksPort } from './blocks-port';
import { NO_CARD_DEVICE } from './testing';

const HANDLE = '0123456789abcdef0123456789abcdef';

/** An instance that answers every request with `status` and `body`, and remembers each one. */
function scripted(status: number, body: unknown) {
  const seen: { method: string; path: string }[] = [];
  const send = (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ method: init.method ?? 'GET', path: new URL(url).pathname });
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    );
  };
  return { seen, send };
}

/** The requests that reached a block route: a device with no card reads the instance's keys first. */
const toBlocks = (seen: readonly { method: string; path: string }[]) =>
  seen.filter((each) => each.path.startsWith('/v1/blocks'));

const port = (send: ReturnType<typeof scripted>['send'], storage = signedInStorage()) =>
  createBlocksPort({ ...NO_CARD_DEVICE, storage, send });

describe('the blocks port — #1529', () => {
  it('reads each block’s handle, name and day, and nothing else the answer carries', async () => {
    const instance = scripted(200, {
      blocks: [
        { handle: HANDLE, name: 'Ann', blockedAt: 1_790_000_000, athleteId: 'should-not-be-read' },
        { handle: 'f'.repeat(32), name: null, blockedAt: 1_789_000_000 },
      ],
    });
    const read = await port(instance.send).read();
    expect(read).toEqual({
      kind: 'blocks',
      blocks: [
        { handle: HANDLE, name: 'Ann', blockedAt: 1_790_000_000 },
        { handle: 'f'.repeat(32), name: null, blockedAt: 1_789_000_000 },
      ],
    });
    expect(JSON.stringify(read)).not.toContain('should-not-be-read');
    expect(toBlocks(instance.seen)).toEqual([{ method: 'GET', path: '/v1/blocks/handles' }]);
  });

  for (const [why, row] of [
    ['a handle that is not one', { handle: '../../v1/account', name: 'Ann', blockedAt: 1 }],
    ['a name longer than any display name', { handle: HANDLE, name: 'x'.repeat(33), blockedAt: 1 }],
    ['no day', { handle: HANDLE, name: 'Ann' }],
    ['a day no calendar can draw', { handle: HANDLE, name: 'Ann', blockedAt: 8_640_000_000_001 }],
  ] as const) {
    it(`reads an answer holding ${why} as no answer`, async () => {
      const instance = scripted(200, { blocks: [row] });
      expect(await port(instance.send).read()).toEqual({ kind: 'unreachable' });
    });
  }

  it('undoes a block by its handle, in the path, and reads a 204 as done', async () => {
    const instance = scripted(204, null);
    expect(await port(instance.send).unblock(HANDLE)).toEqual({ kind: 'unblocked' });
    expect(toBlocks(instance.seen)).toEqual([
      { method: 'DELETE', path: `/v1/blocks/handles/${HANDLE}` },
    ]);
  });

  it('reads any other answer to an unblock as not done', async () => {
    const instance = scripted(503, { error: { code: 'unavailable' } });
    expect(await port(instance.send).unblock(HANDLE)).toEqual({ kind: 'unreachable' });
  });

  it('sends nothing for a handle the instance never made, nor from a device signed in nowhere', async () => {
    const instance = scripted(204, null);
    for (const handle of ['../account', 'not-a-handle', HANDLE.toUpperCase()]) {
      expect(await port(instance.send).unblock(handle)).toEqual({ kind: 'unreachable' });
    }
    // Not even the instance's keys were asked for.
    expect(instance.seen).toEqual([]);
    const nowhere = port(instance.send, { ...signedInStorage(), getItem: () => null });
    expect(await nowhere.read()).toEqual({ kind: 'not-connected' });
    expect(await nowhere.unblock(HANDLE)).toEqual({ kind: 'unreachable' });
    expect(toBlocks(instance.seen)).toEqual([]);
  });
});
