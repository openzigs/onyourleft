// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Operate area's port (#2603) against the REAL instance
 * (`testing/operate-instance-testing.ts`): its own handler, identity, Operate route (#2602) and
 * a real SQLite file, with an owner, a deputy and a rider each a device here,
 * and the operator log written through the instance's own store on another
 * connection.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { INSTANCE_SESSION_STORAGE_KEY } from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createOperatePort, OPERATOR_LOG_PAGE, type OperatorLogRead } from './operate-port';
import {
  closeOperateWorlds,
  countingSealed,
  deviceStorage,
  keylessOwner,
  operatedWorld,
  writeOperatorEntries,
} from '../testing/operate-instance-testing';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

afterEach(async () => {
  await closeOperateWorlds();
  vi.restoreAllMocks();
});

function asPage(read: OperatorLogRead) {
  if (read.kind !== 'page') throw new Error(`not a page of the log: ${read.kind}`);
  return read;
}

describe('who owns the instance — #2603', () => {
  it('is the owner alone: the deputy and a rider, pending or approved, are not', async () => {
    const { owner, deputy, rider, approveRider } = await operatedWorld();
    expect(await createOperatePort(owner.dependencies).standing()).toBe('owner');
    // The deputy is a moderator and NOT the operator (ADR 0046 D-9 Q9).
    expect(await createOperatePort(deputy.dependencies).standing()).toBe('not-owner');
    // Pending: refused about its own account before any route.
    expect(await createOperatePort(rider.dependencies).standing()).toBe('not-owner');
    await approveRider();
    // Approved: `moderatorRole` is `null`.
    expect(await createOperatePort(rider.dependencies).standing()).toBe('not-owner');
  });

  it('sends nothing on a device connected to no instance', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const port = createOperatePort({
      storage: deviceStorage(),
      send,
      loadedFrom: LOADED_LOCALLY,
      signingKey: () => Promise.reject(new Error('no key is asked for')),
    });
    expect(await port.standing()).toBe('signed-out');
    expect(await port.log()).toEqual({ kind: 'signed-out' });
    expect(send).not.toHaveBeenCalled();
  });

  it('asks nothing of the instance from a copy of the app a website served (ADR 0047 D-11)', async () => {
    const { owner, world } = await operatedWorld();
    const counted = countingSealed(world, '/v1/operate/log');
    const port = createOperatePort({
      ...owner.dependencies,
      loadedFrom: LOADED_FROM_A_WEBSITE,
      send: counted.send,
    });
    expect(await port.standing()).toBe('no-keys');
    expect(await port.log()).toEqual({ kind: 'no-keys' });
    expect(counted.count()).toBe(0);
  });

  it('is no-keys on a device connected to an instance that holds no keys, which seals nothing', async () => {
    const device = await keylessOwner();
    const port = createOperatePort(device.dependencies);
    expect(await port.standing()).toBe('no-keys');
    expect(await port.log()).toEqual({ kind: 'no-keys' });
  });

  it('is signed-out when the instance no longer accepts this device’s session', async () => {
    const { owner } = await operatedWorld();
    const { storage } = owner.dependencies;
    const held = JSON.parse(storage.getItem(INSTANCE_SESSION_STORAGE_KEY) ?? 'null') as {
      token: string;
    };
    storage.setItem(
      INSTANCE_SESSION_STORAGE_KEY,
      JSON.stringify({ ...held, token: 'a-session-the-instance-never-issued' }),
    );
    const port = createOperatePort(owner.dependencies);
    expect(await port.standing()).toBe('signed-out');
    expect(await port.log()).toEqual({ kind: 'signed-out' });
  });

  // #957's review: a proxy's own 404 or 403 is a page of HTML, not the instance's answer.
  it.each([
    ['a bare HTML 404', 404, '<html><body>Not Found</body></html>', 'text/html'],
    ['a 404 with another code', 404, '{"error":{"code":"no_route"}}', 'application/json'],
    ['a 403 with another code', 403, '{"error":{"code":"forbidden"}}', 'application/json'],
  ] as const)(
    'reads %s as unreachable, never as "not the owner"',
    async (_name, status, body, type) => {
      const { owner, world } = await operatedWorld();
      const proxied = createOperatePort({
        ...owner.dependencies,
        // The keys are the instance's own, so the device seals; everything
        // else is answered by the proxy.
        send: (url, init) =>
          new URL(url).pathname === '/v1/instance/keys'
            ? world.instance.handler(new Request(url, init))
            : Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })),
      });
      expect(await proxied.standing()).toBe('unreachable');
      expect(await proxied.log()).toEqual({ kind: 'unreachable' });
      // The control: the instance itself still says who owns it.
      expect(await createOperatePort(owner.dependencies).standing()).toBe('owner');
    },
  );
});

describe('the operator log — #2602, #2603', () => {
  it(`is read newest first, ${String(OPERATOR_LOG_PAGE)} at a time, and the next page reaches the rest exactly once`, async () => {
    const { owner, world } = await operatedWorld();
    await writeOperatorEntries(world, OPERATOR_LOG_PAGE + 2);
    const port = createOperatePort(owner.dependencies);
    const first = asPage(await port.log());
    expect(first.entries).toHaveLength(OPERATOR_LOG_PAGE);
    expect(first.entries[0]).toEqual({
      id: OPERATOR_LOG_PAGE + 2,
      at: new Date((1_790_001_000 + (OPERATOR_LOG_PAGE + 1) * 60) * 1000).toISOString(),
      source: 'cli',
      action: 'backup',
      detail: `blobs=${String(OPERATOR_LOG_PAGE + 1)}`,
      outcome: 'done',
    });
    const ids = first.entries.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((left, right) => right - left));
    expect(first.next).not.toBeNull();
    const second = asPage(await port.log(first.next ?? ''));
    expect(second.entries.map((entry) => entry.id)).toEqual([2, 1]);
    expect(second.next).toBeNull();
  });

  it('shows an entry the app’s Operate area wrote, by source', async () => {
    const { owner, world } = await operatedWorld();
    await world.freshRead((store) =>
      store.recordOperatorAction(
        {
          actor: { source: 'app', athleteId: owner.athleteId() },
          action: 'room_open',
          at: 1_790_004_000,
        },
        () => ({ outcome: 'done', detail: 'ride', value: undefined }),
      ),
    );
    expect(asPage(await createOperatePort(owner.dependencies).log()).entries).toEqual([
      {
        id: 1,
        at: new Date(1_790_004_000 * 1000).toISOString(),
        source: 'app',
        action: 'room_open',
        detail: 'ride',
        outcome: 'done',
      },
    ]);
  });

  it('is never read for the deputy or a rider, whom the instance answers as no route', async () => {
    const { deputy, rider, world, approveRider } = await operatedWorld();
    await writeOperatorEntries(world, 2);
    expect(await createOperatePort(deputy.dependencies).log()).toEqual({ kind: 'not-owner' });
    expect(await createOperatePort(rider.dependencies).log()).toEqual({ kind: 'not-owner' });
    await approveRider();
    expect(await createOperatePort(rider.dependencies).log()).toEqual({ kind: 'not-owner' });
  });

  it('is no-keys on an instance handed no Operate area (#2602’s unavailable)', async () => {
    const { owner } = await operatedWorld({ withoutOperate: true });
    expect(await createOperatePort(owner.dependencies).log()).toEqual({ kind: 'no-keys' });
  });

  it('sends nothing for a cursor the instance could not have written', async () => {
    const { owner, sent } = await operatedWorld();
    const port = createOperatePort(owner.dependencies);
    sent.length = 0;
    expect(await port.log('not a cursor!')).toEqual({ kind: 'unreachable' });
    expect(sent).toEqual([]);
  });

  it.each([
    ['a detail that is free text', { detail: 'sk-ant secret here' }],
    ['a detail that is a decimal', { detail: 'lat=51.5' }],
    ['a detail that is signed', { detail: 'lon=-0' }],
    ['an unknown outcome', { outcome: 'maybe' }],
    ['an unknown source', { source: 'web' }],
    ['a time that is not ISO 8601', { at: 'yesterday' }],
    ['a time that is not the instance’s own form of it', { at: '2026-11-14 09:00' }],
    ['an id that is not a count', { id: 0 }],
    ['an action that is not a name', { action: 'Back Up' }],
  ] as const)('shows no page that holds %s', async (_name, change) => {
    const { owner, world } = await operatedWorld();
    const good = {
      id: 1,
      at: '2026-11-14T09:00:00.000Z',
      source: 'cli',
      action: 'backup',
      detail: 'blobs=1',
      outcome: 'done',
    };
    const answered = (entries: readonly unknown[]) =>
      createOperatePort({
        ...owner.dependencies,
        send: (url, init) =>
          world.answeringAs('/v1/operate/log', () => Response.json({ entries, cursor: null }))(
            new Request(url, init),
          ),
      });
    // The control: the same answer with the good row is a page.
    expect(asPage(await answered([good]).log()).entries).toHaveLength(1);
    expect(await answered([good, { ...good, id: 2, ...change }]).log()).toEqual({
      kind: 'unreachable',
    });
  });
});
