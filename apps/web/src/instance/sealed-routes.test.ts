// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The client's half of phase 1 (#1192, ADR 0047 D-7, D-11):
 *
 * - **No plaintext call to a sealed-only route** in the four modules that
 *   reach an instance's accounts, moderators and history. The list scanned
 *   for is the instance's OWN committed list (`apps/instance/src/sealed/
 *   phase-one.ts`, read by a computed `import()` — test code only, as
 *   `sync.test.ts` reads the instance's test support), so a route marked
 *   there is scanned for here with no edit.
 * - **The web-build gate**: a copy of the app a website served offers no
 *   sealed feature and sends nothing for one; one opened from loopback or a
 *   file, or the Android shell, does.
 * - **No card, no sealed request**: a device with no pin sends nothing for a
 *   phase-1 feature, and a new key with no card is told it needs one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import {
  INSTANCE_KEY_TEXT,
  sealedBuildOffered,
  sealedRouteGate,
  WEB_BUILD_TEXT,
  type LoadedFrom,
} from './instance-pin';
import {
  CONNECT_REFUSAL_TEXT,
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createModerationPort } from './moderation-port';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

interface PhaseOneRoute {
  readonly method: string;
  readonly path: string;
  readonly mark: 'only' | 'new-key';
}

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    moderators?: { readonly owner: string };
  }): Promise<IdentityInstance>;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const NOW = unixSeconds(1_790_000_000);

let phaseOne: readonly PhaseOneRoute[];
/** "The synced history": every route `sync/routes.ts` declares, by the instance's own rule. */
let syncFamily: readonly PhaseOneRoute[];
let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  const committed = (await import(/* @vite-ignore */ INSTANCE('sealed/phase-one.ts'))) as {
    PHASE_ONE_SEALED_ROUTES: readonly PhaseOneRoute[];
    SEALED_FAMILIES: readonly {
      readonly row: string;
      covers(route: { method: string; path: string; reaches: unknown }): boolean;
    }[];
  };
  phaseOne = committed.PHASE_ONE_SEALED_ROUTES;
  const family = committed.SEALED_FAMILIES.find((each) => each.row === 'The synced history');
  syncFamily = phaseOne.filter((route) => family?.covers({ ...route, reaches: 'own' }) === true);
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

/**
 * Every call to an instance in `source` that is NOT on a sealed receiver,
 * with a path written into it that could be a sealed-only route: a string or
 * template literal starting `/v1/`, a `${…}` in it matching any one segment,
 * compared segment by segment with each route (whose `{name}` matches any one
 * segment, and a query is ignored). A receiver is sealed when its name says so
 * (`sealed`, `session.sealed`, …) — the convention these four modules keep.
 */
function plaintextCallsToSealedRoutes(source: string, routes: readonly PhaseOneRoute[]): string[] {
  const only = routes.filter((route) => route.mark === 'only');
  const found: string[] = [];
  const call = /([A-Za-z_$][\w$.?]*)\.(call|post|json|bytes)\(([^;]{0,240})/g;
  for (const match of source.matchAll(call)) {
    const receiver = match[1] ?? '';
    if (/sealed/i.test(receiver)) continue;
    const literal = /[`'](\/v1\/[^`']*)[`']/.exec(match[3] ?? '')?.[1];
    if (literal === undefined) continue;
    const segments = (literal.split('?')[0] ?? '').split('/');
    for (const route of only) {
      const want = route.path.split('/');
      if (want.length !== segments.length) continue;
      const same = want.every((segment, index) => {
        const have = segments[index] ?? '';
        return segment.startsWith('{') || have.includes('${') || segment === have;
      });
      if (same) found.push(`${receiver}.${match[2] ?? ''} → ${route.method} ${route.path}`);
    }
  }
  return found;
}

const CLIENT_MODULES = [
  'instance-port.ts',
  'sign-in.ts',
  'sync.ts',
  'sync-port.ts',
  'moderation-port.ts',
];

/** Every non-test source file under `apps/web/src`. */
function clientSources(): string[] {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$|-testing\.tsx?$|\/testing\//.test(path)
      ) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.map((path) => relative(root, path));
}

describe('every caller of a sealed-only route seals it (#1192, ADR 0047 D-7)', () => {
  it('reads the instance’s own committed list, and it is not empty', () => {
    expect(phaseOne.filter((route) => route.mark === 'only').length).toBeGreaterThan(20);
    expect(phaseOne.map((route) => route.path)).toContain('/v1/moderation/log');
  });

  it('no module in the client calls a sync route in plaintext (#1195)', () => {
    // Derived from the instance's committed list: a sync route added there is
    // scanned for here with no edit.
    expect(syncFamily.map((route) => route.path)).toContain('/v1/sync/manifest');
    expect(syncFamily.length).toBeGreaterThanOrEqual(13);
    const root = fileURLToPath(new URL('../', import.meta.url));
    const sources = clientSources();
    expect(sources).toContain(join('instance', 'sync-port.ts'));
    const found = sources.flatMap((path) =>
      plaintextCallsToSealedRoutes(readFileSync(join(root, path), 'utf8'), syncFamily).map(
        (call) => `${path}: ${call}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it.each(CLIENT_MODULES)('%s makes no plaintext call to one', (module) => {
    const source = readFileSync(fileURLToPath(new URL(`./${module}`, import.meta.url)), 'utf8');
    expect(plaintextCallsToSealedRoutes(source, phaseOne)).toEqual([]);
  });

  it('finds one where there is one — the control', () => {
    const found = plaintextCallsToSealedRoutes(
      [
        "await connection.http.call('GET', '/v1/auth/devices', { token });",
        'await transport.json(`GET`, `/v1/sync/items/${kind}/${key}`);',
        "await dependencies.transport.post('/v1/auth/link', body);",
        "await http.call('GET', '/v1/moderation/log', { query });",
        "await session.sealed.call('GET', '/v1/moderation/log', { query });",
        "await http.call('GET', '/v1/auth/session', { token });",
      ].join('\n'),
      phaseOne,
    );
    expect(found).toEqual([
      'connection.http.call → GET /v1/auth/devices',
      'transport.json → GET /v1/sync/items/{kind}/{key}',
      'transport.json → POST /v1/sync/items/{kind}/{key}',
      'transport.json → DELETE /v1/sync/items/{kind}/{key}',
      'dependencies.transport.post → POST /v1/auth/link',
      'http.call → GET /v1/moderation/log',
    ]);
  });
});

describe('the web-build gate (#1192, ADR 0047 D-11)', () => {
  it.each([
    ['the Android shell', { native: true, href: 'https://localhost/' }, true],
    [
      'a copy opened from a file',
      { native: false, href: 'file:///Users/rider/app/index.html' },
      true,
    ],
    ['localhost', { native: false, href: 'http://localhost:5173/' }, true],
    ['localhost over https', { native: false, href: 'https://localhost/' }, true],
    ['127.0.0.1', { native: false, href: 'http://127.0.0.1:4319/identity.html' }, true],
    ['::1', { native: false, href: 'http://[::1]:8080/' }, true],
    ['a website', { native: false, href: 'https://app.example/' }, false],
    ['the instance’s own origin', { native: false, href: 'https://ride.example/app/' }, false],
    ['a host named like loopback', { native: false, href: 'https://localhost.example/' }, false],
    ['an address on the LAN', { native: false, href: 'http://192.168.1.20:5173/' }, false],
    ['another scheme', { native: false, href: 'capacitor://localhost/' }, false],
    ['nothing readable', { native: false, href: 'not a url' }, false],
  ] as const)('%s: offered %s', (_name, from, offered) => {
    expect(sealedBuildOffered(from as LoadedFrom)).toBe(offered);
  });

  it('says the web-build sentence ahead of anything about a card', () => {
    expect(sealedRouteGate(undefined, LOADED_FROM_A_WEBSITE)).toEqual({
      kind: 'web-build',
      text: WEB_BUILD_TEXT,
    });
    expect(sealedRouteGate(undefined, LOADED_LOCALLY).kind).toBe('needs-card');
  });
});

/** Every request, handed to the instance's own handler — and counted. */
function wire(world: IdentityInstance): InstanceSend & ReturnType<typeof vi.fn> {
  return vi.fn((url: string, init: RequestInit) => world.instance.handler(new Request(url, init)));
}

const paths = (send: ReturnType<typeof wire>): string[] =>
  (send.mock.calls as [string, RequestInit][]).map(
    ([url, init]) => `${init.method ?? 'GET'} ${new URL(url).pathname}`,
  );

function deviceStorage(): InstanceStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function device(send: InstanceSend, loadedFrom: LoadedFrom, storage = deviceStorage()) {
  const store = createStoreHarness();
  harnesses.push(store);
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom,
    ensureLocalAthlete: () => store.write(async (open) => ensureLocalAthlete(open, NOW)),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: () => NOW * 1000,
  };
  return { storage, dependencies, port: createInstancePort(dependencies) };
}

async function world(options?: Parameters<IdentityTesting['startIdentityInstance']>[0]) {
  const started = await testing.startIdentityInstance(options);
  worlds.push(started);
  return started;
}

describe('a copy of the app a website served seals nothing (#1192, ADR 0047 D-11)', () => {
  it('lists no devices, mints no link code and reads no moderators’ page — and sends nothing for them', async () => {
    const w = await world();
    const send = wire(w);
    const card = (await w.instanceKeys.show()).card;
    // Registered from a copy that may seal; then the same sign-in, opened from a website.
    const local = device(send, LOADED_LOCALLY);
    expect(await local.port.connect(testing.TEST_ORIGIN, 'Anna', card)).toMatchObject({
      kind: 'connected',
    });
    const website = device(send, LOADED_FROM_A_WEBSITE, local.storage);
    send.mockClear();
    expect(await website.port.devices()).toEqual({ kind: 'unavailable', text: WEB_BUILD_TEXT });
    expect(await website.port.linkCode()).toEqual({ kind: 'unavailable', text: WEB_BUILD_TEXT });
    expect(await createModerationPort(website.dependencies).mintInvite('A friend')).toEqual({
      kind: 'refused',
      text: WEB_BUILD_TEXT,
    });
    expect(paths(send).filter((path) => /sealed|instance\/keys/.test(path))).toEqual([]);
    // The control: the same sign-in, opened locally, lists them.
    expect((await local.port.devices()).kind).toBe('listed');
  });

  it('links no device, and registers no new key, saying why', async () => {
    const w = await world();
    const send = wire(w);
    const card = (await w.instanceKeys.show()).card;
    const website = device(send, LOADED_FROM_A_WEBSITE);
    expect(await website.port.link(`${card} abcd-efgh-jkmn-pqrs`)).toEqual({
      kind: 'refused',
      text: WEB_BUILD_TEXT,
    });
    expect(send).not.toHaveBeenCalled();
    // With the card, from a website: the key is new, so it is refused, and the sentence says why.
    expect(await website.port.connect(testing.TEST_ORIGIN, 'Anna', card)).toEqual({
      kind: 'refused',
      text: WEB_BUILD_TEXT,
    });
    expect(paths(send)).not.toContain('POST /v1/sealed');
    expect(website.storage.map.has(INSTANCE_SESSION_STORAGE_KEY)).toBe(false);
  });
});

describe('no card, no sealed request (#1192, ADR 0047 D-14 Q1)', () => {
  it('tells a new rider with no card that the instance registers only with one, and keeps nothing', async () => {
    const w = await world();
    const send = wire(w);
    const { port, storage } = device(send, LOADED_LOCALLY);
    expect(await port.connect(testing.TEST_ORIGIN, 'Anna')).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT.sealed_required,
    });
    expect(storage.map.has(INSTANCE_SESSION_STORAGE_KEY)).toBe(false);
    expect(paths(send)).not.toContain('POST /v1/sealed');
  });

  it('attempts no sealed request for a device that signed in without a card', async () => {
    const w = await world();
    const send = wire(w);
    const card = (await w.instanceKeys.show()).card;
    const first = device(send, LOADED_LOCALLY);
    await first.port.connect(testing.TEST_ORIGIN, 'Anna', card);
    await first.port.disconnect();
    // Signed in again with only the address: a key the instance holds, no pin kept.
    expect(await first.port.connect(testing.TEST_ORIGIN, 'Anna')).toMatchObject({
      kind: 'connected',
    });
    send.mockClear();
    expect(await first.port.devices()).toEqual({
      kind: 'unavailable',
      text: INSTANCE_KEY_TEXT['needs-card'],
    });
    expect(paths(send)).toEqual([]);
  });
});
