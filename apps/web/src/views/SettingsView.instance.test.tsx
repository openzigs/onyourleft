// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Settings' *Connect and keep* card says whether this device is connected —
 * #2756. The owner read a connected tablet as a disconnected one because the
 * card said *Connect to an instance* whatever the device held.
 *
 * The port is the REAL one, `createInstancePort`, over this device's storage
 * with and without a stored session, and an instance on the other end of the
 * wire that answers as a keyless instance does. So "connected" here is what
 * the Instance screen itself would say, read back through the path it reads,
 * and not a flag a test set. The text asserted is the card's visible text,
 * whole, which is also what holds it to the address and never a position.
 */

import { type JSX } from 'react';
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
import { hrefFor, routeById } from '../shell/routes';
import { mount, type Mounted } from '../testing/mount';
import { SettingsView } from './SettingsView';

const ORIGIN = 'https://instance.example.org';
const RIDER = 'Rider on the hill';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** This device's storage: signed in to {@link ORIGIN}, or holding nothing. */
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

/**
 * The real port, against a keyless instance: no keys served, so the session
 * is read in plaintext. `sessionStatus` is what `GET /v1/auth/session` answers.
 * Every read it starts is kept, so a test waits for the reads themselves.
 */
function realPort(
  signedIn: boolean,
  sessionStatus = 200,
  sessionBody: unknown = {},
): { port: InstancePort; reads: Promise<unknown>[]; sent: string[] } {
  const sent: string[] = [];
  const reads: Promise<unknown>[] = [];
  const port = createInstancePort({
    storage: deviceStorage(signedIn),
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () => Promise.resolve(),
    signingKey: () => Promise.reject(new Error('a keyless instance is sent nothing sealed')),
    now: () => 1_790_000_000_000,
    send: (url) => {
      const path = new URL(url).pathname;
      sent.push(path);
      if (path === '/v1/auth/session') {
        return Promise.resolve(
          sessionStatus === 200 ? json({ displayName: RIDER }) : json(sessionBody, sessionStatus),
        );
      }
      if (path === '/instance') return Promise.resolve(json({ name: 'Lanes' }));
      return Promise.resolve(json({}, 404));
    },
  });
  return {
    sent,
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

function Settings({ instance }: { readonly instance?: InstancePort }): JSX.Element {
  return (
    <SettingsView
      units="metric"
      onUnitsChange={() => undefined}
      onRiderMassChange={() => undefined}
      {...(instance === undefined ? {} : { instance })}
    />
  );
}

/** The Instance section's line, as a rider reads it. */
function line(): string {
  const heading = mounted?.container.querySelector('#oyl-instance-link-heading');
  const paragraph = heading?.parentElement?.querySelector('p');
  if (paragraph === null || paragraph === undefined) throw new Error('no Instance line');
  return (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function link(): HTMLAnchorElement {
  const heading = mounted?.container.querySelector('#oyl-instance-link-heading');
  const anchor = heading?.parentElement?.querySelector('a');
  if (anchor === null || anchor === undefined) throw new Error('no Instance link');
  return anchor;
}

async function readsDone(reads: Promise<unknown>[]): Promise<void> {
  await act(async () => {
    await Promise.allSettled(reads);
  });
}

describe('#2756 — the Connect and keep card says whether this device is connected', () => {
  it('with a stored session, names the instance address and the rider, and links to the connection', async () => {
    const { port, reads, sent } = realPort(true);
    mounted = await mount(<Settings instance={port} />);
    await readsDone(reads);

    expect(sent).toContain('/v1/auth/session');
    expect(line()).toBe(
      `Connected to your server at ${ORIGIN} as ${RIDER}. See this device’s connection and your devices there.`,
    );
    expect(line()).not.toContain('Connect to a server');
    expect(link().textContent).toBe('See this device’s connection');
    expect(link().getAttribute('href')).toBe(hrefFor(routeById('instance')));
  });

  it('with no stored session, offers to connect to a server and sends nothing', async () => {
    const { port, reads, sent } = realPort(false);
    mounted = await mount(<Settings instance={port} />);
    await readsDone(reads);

    expect(line()).toBe(
      'Connect to a server, to ride with other people, and see this device’s connection and your devices there.',
    );
    expect(link().textContent).toBe('Connect to a server');
    expect(link().getAttribute('href')).toBe(hrefFor(routeById('instance')));
    expect(sent).toEqual([]);
  });

  it('where this browser cannot connect at all, offers to connect to a server', async () => {
    mounted = await mount(<Settings />);

    expect(line()).toBe(
      'Connect to a server, to ride with other people, and see this device’s connection and your devices there.',
    );
  });

  it('with a stored session the instance no longer accepts, says so rather than "Connected"', async () => {
    const { port, reads } = realPort(true, 401);
    mounted = await mount(<Settings instance={port} />);
    await readsDone(reads);

    expect(line()).toBe(`Your server at ${ORIGIN} is not answering right now. See why.`);
    expect(link().textContent).toBe('See why');
    expect(link().getAttribute('href')).toBe(hrefFor(routeById('instance')));
  });

  it('before the read answers, claims neither connected nor not connected', async () => {
    const waiting: InstancePort = {
      ...realPort(true).port,
      current: () => new Promise(() => undefined),
    };
    mounted = await mount(<Settings instance={waiting} />);

    expect(line()).toBe(
      'See this device’s connection and your devices there, or connect to a server to ride with other people.',
    );
    expect(link().getAttribute('href')).toBe(hrefFor(routeById('instance')));
  });

  it('with an instance that cannot be reached, says so with the same sentence and links to the connection', async () => {
    const { port, reads } = realPort(true, 500);
    mounted = await mount(<Settings instance={port} />);
    await readsDone(reads);

    expect(line()).toBe(`Your server at ${ORIGIN} is not answering right now. See why.`);
    expect(link().getAttribute('href')).toBe(hrefFor(routeById('instance')));
  });

  it('with a sign-in this device cannot read, does not say "Connect to a server"', async () => {
    const { port, reads } = realPort(true, 403, { error: { code: 'sealed_required' } });
    mounted = await mount(<Settings instance={port} />);
    await readsDone(reads);

    expect(line()).toBe(`Your server at ${ORIGIN} is not answering right now. See why.`);
    expect(link().getAttribute('href')).toBe(hrefFor(routeById('instance')));
  });
});
