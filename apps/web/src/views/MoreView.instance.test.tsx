// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The More menu's Instance line says whether this device is connected —
 * #2859. The trial of 2026-11-18 found it saying "Sign in to an instance with
 * this device" on a connected tablet, as Settings' card did before #2756.
 *
 * The port is the REAL one, `createInstancePort`, over this device's storage
 * with and without a stored session, and an instance on the other end of the
 * wire that answers as a keyless instance does — so "connected" is what the
 * Instance screen itself would say, read back through the path it reads.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePort,
  type InstanceStorage,
} from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import { LOADED_LOCALLY } from '../instance/testing';
import { routeById } from '../shell/routes';
import { mount, type Mounted } from '../testing/mount';
import { MoreView } from './MoreView';

const ORIGIN = 'https://instance.example.org';
const RIDER = 'Rider on the hill';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function deviceStorage(signedIn: boolean): InstanceStorage {
  const map = new Map<string, string>(
    signedIn
      ? [
          [
            INSTANCE_ACCOUNT_STORAGE_KEY,
            JSON.stringify({ origin: ORIGIN, instanceAthleteId: 'a' }),
          ],
          [INSTANCE_SESSION_STORAGE_KEY, JSON.stringify({ origin: ORIGIN, token: 't' })],
        ]
      : [],
  );
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The real port against a keyless instance; every read it starts is kept, to be waited for. */
function realPort(
  signedIn: boolean,
  sessionStatus = 200,
): {
  port: InstancePort;
  reads: Promise<unknown>[];
} {
  const reads: Promise<unknown>[] = [];
  const port = createInstancePort({
    storage: deviceStorage(signedIn),
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () => Promise.resolve(),
    signingKey: () => Promise.reject(new Error('a keyless instance is sent nothing sealed')),
    now: () => 1_790_000_000_000,
    send: (url) => {
      const path = new URL(url).pathname;
      if (path === '/v1/auth/session') {
        return Promise.resolve(
          sessionStatus === 200 ? json({ displayName: RIDER }) : json({}, sessionStatus),
        );
      }
      if (path === '/instance') return Promise.resolve(json({ name: 'Lanes' }));
      return Promise.resolve(json({}, 404));
    },
  });
  return {
    reads,
    port: {
      ...port,
      current: () => {
        const read = port.current();
        reads.push(read);
        return read;
      },
    },
  };
}

/** The Instance entry's line, as a rider reads it. */
function instanceLine(): string {
  const paragraph = mounted?.container.querySelector('#oyl-more-instance');
  if (paragraph === null || paragraph === undefined) throw new Error('no Instance line');
  return (paragraph.textContent ?? '').trim();
}

async function readsDone(reads: Promise<unknown>[]): Promise<void> {
  await act(async () => {
    await Promise.allSettled(reads);
  });
}

describe('#2859 — the More menu’s Instance line says whether this device is connected', () => {
  it('with a stored session, names the server’s address and the rider, as Settings does', async () => {
    const { port, reads } = realPort(true);
    mounted = await mount(<MoreView instance={port} />);
    await readsDone(reads);
    expect(instanceLine()).toBe(`Connected to your server at ${ORIGIN} as ${RIDER}.`);
    expect(instanceLine()).not.toContain('Sign in to an instance');
  });

  it('with a stored session the instance no longer accepts, says it is not answering', async () => {
    const { port, reads } = realPort(true, 401);
    mounted = await mount(<MoreView instance={port} />);
    await readsDone(reads);
    expect(instanceLine()).toBe(`Your server at ${ORIGIN} is not answering right now.`);
  });

  it('with nothing connected, or no port, keeps the route’s own line', async () => {
    const { port, reads } = realPort(false);
    mounted = await mount(<MoreView instance={port} />);
    await readsDone(reads);
    expect(instanceLine()).toBe(routeById('instance').summary);
    mounted.unmount();
    mounted = await mount(<MoreView />);
    expect(instanceLine()).toBe(routeById('instance').summary);
  });
});
