// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A browser's signature, verified by the Node instance — #772's
 * cross-platform criterion (ADR 0014 D-8). Read `identity-harness.ts` first.
 *
 * The instance runs in THIS process: the real handler behind the real Node
 * listener, the real identity routes and a real SQLite file, from
 * `apps/instance`'s own test support. It is imported by a computed path
 * because `apps/instance` is written for Node's type stripping (`.ts`
 * specifiers) and `apps/web`'s typecheck does not follow those; the shape it
 * is used through is written down here.
 */

import { expect, test, type Page } from '@playwright/test';

import type { IdentityHarness } from './identity-harness';

interface IdentityInstance {
  readonly url: string;
  call(
    method: string,
    path: string,
    options?: { body?: unknown },
  ): Promise<{ status: number; body: unknown }>;
  freshRead<T>(
    read: (store: {
      listDeviceKeys(athleteId: string): Promise<readonly { publicKey: string }[]>;
    }) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    originIsTheListener?: boolean;
    config?: { name?: string };
  }): Promise<IdentityInstance>;
}

const INSTANCE_TESTING = new URL('../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;

let testing: IdentityTesting;
let world: IdentityInstance;

test.beforeAll(async () => {
  testing = (await import(INSTANCE_TESTING)) as IdentityTesting;
});

test.beforeEach(async () => {
  world = await testing.startIdentityInstance();
});

test.afterEach(async () => {
  await world.close();
});

async function openHarness(
  page: Page,
  tamper: (body: Record<string, unknown>) => Record<string, unknown> = (body) => body,
): Promise<void> {
  await page.exposeFunction('oylInstancePost', (path: string, body: Record<string, unknown>) =>
    world.call('POST', path, { body: path === '/v1/auth/session' ? tamper(body) : body }),
  );
  const response = await page.goto('/identity.html');
  expect(
    response?.status(),
    'identity.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylIdentity !== undefined);
}

function signIn(page: Page, origin: string, database = 'identity-gate') {
  return page.evaluate(
    ([o, d]) => (window.__oylIdentity as IdentityHarness).signIn(o as string, d as string),
    [origin, database],
  );
}

test.describe('the device key, from the browser to the Node instance (#772)', () => {
  test('a statement the browser signed registers an athlete, and the same stored key signs in again', async ({
    page,
  }) => {
    await openHarness(page);
    const first = await signIn(page, testing.TEST_ORIGIN);
    expect(first.registered).toBe(true);
    expect(first.recoveryCodes).toHaveLength(10);

    const second = await signIn(page, testing.TEST_ORIGIN);
    expect(second.registered).toBe(false);
    expect(second.instanceAthleteId).toBe(first.instanceAthleteId);

    const keys = await world.freshRead((store) => store.listDeviceKeys(first.instanceAthleteId));
    expect(keys).toHaveLength(1);
    // The browser kept the instance's athlete id on the device.
    const kept = await page.evaluate(() => localStorage.getItem('oyl.instance.account.v1'));
    expect(kept).toContain(first.instanceAthleteId);
  });

  test('the control: one flipped signature byte in transit is refused by the instance', async ({
    page,
  }) => {
    await openHarness(page, (body) => {
      const signature = body.signature as string;
      const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
      return { ...body, signature: flipped };
    });
    await expect(signIn(page, testing.TEST_ORIGIN)).rejects.toThrow(/bad_signature/);
  });

  test('the control: a browser signing for another instance is refused', async ({ page }) => {
    await openHarness(page);
    await expect(signIn(page, 'https://other.example')).rejects.toThrow(/wrong_instance/);
  });
});

test.describe('the production transport, from the browser to the Node instance (#777)', () => {
  test('connects cross-origin with the real fetch, and a reload reads the names back from the instance', async ({
    page,
  }) => {
    // Its own instance, at the address the page really reaches — another
    // origin than the page's, so the instance's CORS answers are in the path.
    const own = await testing.startIdentityInstance({
      originIsTheListener: true,
      config: { name: 'Lanes of the Weald' },
    });
    try {
      await openHarness(page);
      const requests: string[] = [];
      page.on('request', (request) => {
        if (request.url().startsWith(own.url))
          requests.push(`${request.method()} ${request.url()}`);
      });
      const result = await page.evaluate(
        ([address]) =>
          (window.__oylIdentity as IdentityHarness).connect(address as string, 'instance-gate'),
        [own.url],
      );
      expect(result.connected).toMatchObject({ kind: 'connected' });
      expect(result.current).toMatchObject({
        kind: 'connected',
        origin: own.url,
        instanceName: 'Lanes of the Weald',
        displayName: 'Anna',
      });
      expect(result.devices).toMatchObject({ kind: 'listed' });
      // The requests went from the page to the instance, preflights included.
      expect(
        requests.some((line) => line.startsWith('POST') && line.endsWith('/v1/auth/session')),
      ).toBe(true);

      const reloaded = await page.evaluate(() =>
        (window.__oylIdentity as IdentityHarness).reload('instance-gate'),
      );
      expect(reloaded).toMatchObject({
        kind: 'connected',
        instanceName: 'Lanes of the Weald',
        displayName: 'Anna',
      });
    } finally {
      await own.close();
    }
  });
});
