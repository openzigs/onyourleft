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
    options?: { body?: unknown; plain?: boolean },
  ): Promise<{ status: number; body: unknown }>;
  freshRead<T>(
    read: (store: {
      listDeviceKeys(athleteId: string): Promise<readonly { publicKey: string }[]>;
    }) => Promise<T>,
  ): Promise<T>;
  /** The instance's keys (#1189): its card. */
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    originIsTheListener?: boolean;
    config?: { name?: string };
    startsAt?: number;
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

async function openHarness(page: Page): Promise<void> {
  // Plaintext, as the page sent it: the challenge, and a known key's sign-in.
  await page.exposeFunction('oylInstancePost', (path: string, body: Record<string, unknown>) =>
    world.call('POST', path, { body, plain: true }),
  );
  // A raw request — the sealed one the page made (#1192) — to the same instance.
  await page.exposeFunction(
    'oylInstanceFetch',
    async (
      path: string,
      init: { method: string; headers: Record<string, string>; body: string | null },
    ) => {
      const response = await fetch(`${world.url}${path}`, {
        method: init.method,
        headers: init.headers,
        ...(init.body === null ? {} : { body: init.body }),
      });
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        text: await response.text(),
      };
    },
  );
  const response = await page.goto('/identity.html');
  expect(
    response?.status(),
    'identity.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylIdentity !== undefined);
}

function signIn(page: Page, origin: string, flipSignature = false, database = 'identity-gate') {
  return page.evaluate(
    ([o, d, i, f]) =>
      (window.__oylIdentity as IdentityHarness).signIn(o as string, d as string, {
        instanceOrigin: i as string,
        flipSignature: f === 'flip',
      }),
    [origin, database, testing.TEST_ORIGIN, flipSignature ? 'flip' : 'keep'],
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
    // Flipped in the page, before it is sealed: nothing on the way can read it (#1192).
    await openHarness(page);
    await expect(signIn(page, testing.TEST_ORIGIN, true)).rejects.toThrow(/bad_signature/);
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
      // The page judges the instance's key statements by its own clock (#1190, #1192).
      startsAt: Date.now(),
    });
    try {
      await openHarness(page);
      const requests: string[] = [];
      page.on('request', (request) => {
        if (request.url().startsWith(own.url))
          requests.push(`${request.method()} ${request.url()}`);
      });
      // The instance's card, as its operator hands it over (#1190, #1192).
      const card = (await own.instanceKeys.show()).card;
      const result = await page.evaluate(
        ([address, given]) =>
          (window.__oylIdentity as IdentityHarness).connect(
            address as string,
            'instance-gate',
            given as string,
          ),
        [own.url, card],
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
      // Registered SEALED (#1192): the session request went inside `/v1/sealed`.
      expect(requests.some((line) => line.startsWith('POST') && line.endsWith('/v1/sealed'))).toBe(
        true,
      );
      expect(
        requests.some((line) => line.startsWith('POST') && line.endsWith('/v1/auth/session')),
      ).toBe(false);

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
