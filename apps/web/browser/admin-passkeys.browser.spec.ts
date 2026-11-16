// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's admin passkeys, through a real browser and a real
 * authenticator protocol (#2642, ADR 0069 D-1, D-6).
 *
 * The instance runs in THIS process: the production `startInstance` behind
 * its Node listener, a SQLite file, the admin pages on, at
 * `http://localhost:<port>` — a secure context — from `apps/instance`'s own
 * test support (`src/admin/admin-browser-testing.ts`), imported by a computed
 * path as `identity.browser.spec.ts` imports its instance. The page is the
 * instance's own: its HTML, its one script (`/admin/passkey.js`) and
 * Chromium's **virtual authenticator** (CDP `WebAuthn.addVirtualAuthenticator`),
 * which speaks CTAP2 to the browser's real WebAuthn stack.
 *
 * A passkey is enrolled through the pages from a one-time code's session, the
 * instance is restarted over the same file, and the passkey signs in. Its two
 * controls: an assertion from a second virtual authenticator that never
 * enrolled — its own key, under the enrolled credential's id — and one whose
 * origin was changed on its way to the instance. Each must be refused.
 */

import { expect, test, type CDPSession, type Page } from '@playwright/test';

interface AdminBrowserInstance {
  readonly origin: string;
  mint(): Promise<string>;
  confirm(id: string): Promise<void>;
  passkeys(): Promise<readonly { readonly id: string; readonly algorithm: string }[]>;
  sessions(): Promise<number>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

interface AdminBrowserTesting {
  startAdminInstance(): Promise<AdminBrowserInstance>;
}

const ADMIN_TESTING = new URL('../../instance/src/admin/admin-browser-testing.ts', import.meta.url)
  .href;

let testing: AdminBrowserTesting;
let instance: AdminBrowserInstance;

test.beforeAll(async () => {
  testing = (await import(ADMIN_TESTING)) as AdminBrowserTesting;
});

test.beforeEach(async () => {
  instance = await testing.startAdminInstance();
});

test.afterEach(async () => {
  await instance.close();
});

/** A virtual CTAP2 platform authenticator that verifies the user and is always present. */
async function virtualAuthenticator(cdp: CDPSession): Promise<string> {
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

async function signInWithCode(page: Page): Promise<void> {
  await page.goto(`${instance.origin}/admin/sign-in`);
  await page.getByLabel('One-time code').fill(await instance.mint());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('with a one-time code', { exact: false })).toBeVisible();
}

/** Enrol the authenticator through the real pages; answers its credential's id, base64. */
async function enrol(page: Page, cdp: CDPSession, authenticatorId: string): Promise<string> {
  await signInWithCode(page);
  await page.getByRole('link', { name: 'Passkeys' }).click();
  await page.getByLabel('A name for this passkey').fill('Gate laptop');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Your passkey was added')).toBeVisible();
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  return (credentials[0] as { credentialId: string }).credentialId;
}

async function passkeySignIn(page: Page): Promise<void> {
  await page.goto(`${instance.origin}/admin/sign-in`);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
}

test.describe('the admin passkeys, through Chromium’s virtual authenticator (#2642)', () => {
  test('enrols through the pages, survives a restart over the same file, and signs in with the passkey', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const authenticatorId = await virtualAuthenticator(cdp);
    await enrol(page, cdp, authenticatorId);
    // Read back: the instance kept one passkey, of an algorithm ADR 0069 D-1 admits.
    const kept = await instance.passkeys();
    expect(kept).toHaveLength(1);
    expect(['es256', 'ed25519']).toContain(kept[0]?.algorithm);
    // The code session ended at its enrolment.
    expect(await instance.sessions()).toBe(0);

    await instance.restart();
    await passkeySignIn(page);
    // A sign-in lands on Status (#2645), in the shell, which says how the session was opened.
    await expect(page).toHaveURL(`${instance.origin}/admin/status`);
    await page.goto(`${instance.origin}/admin`);
    await expect(page).toHaveURL(`${instance.origin}/admin/status`);
    await expect(
      page.getByText('Signed in as the instance’s owner with a passkey, through the tunnel.'),
    ).toBeVisible();
    expect(await instance.sessions()).toBe(1);
  });

  test('the control: an assertion from a second authenticator that never enrolled is refused', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const first = await virtualAuthenticator(cdp);
    const credentialId = await enrol(page, cdp, first);
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: first });
    // A second authenticator, holding a key of its own — of the enrolled
    // passkey's algorithm, so its signature has the right shape — under the enrolled id.
    const second = await virtualAuthenticator(cdp);
    const algorithm = (await instance.passkeys())[0]?.algorithm;
    const stranger =
      algorithm === 'ed25519'
        ? await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
        : await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
            'sign',
            'verify',
          ]);
    if (!('privateKey' in stranger)) throw new Error('key generation made one key, not a pair');
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', stranger.privateKey));
    await cdp.send('WebAuthn.addCredential', {
      authenticatorId: second,
      credential: {
        credentialId,
        isResidentCredential: false,
        rpId: 'localhost',
        privateKey: Buffer.from(pkcs8).toString('base64'),
        // Ahead of the enrolled counter, so the signature, not the counter, is what refuses it.
        signCount: 100,
      },
    });
    await passkeySignIn(page);
    await expect(page.getByText('That passkey was not accepted')).toBeVisible();
    expect(await instance.sessions()).toBe(0);
    await page.goto(`${instance.origin}/admin`);
    await expect(page).toHaveURL(`${instance.origin}/admin/sign-in`);
  });

  test('the control: an assertion whose origin was changed on the way is refused', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const authenticatorId = await virtualAuthenticator(cdp);
    await enrol(page, cdp, authenticatorId);
    // The form the page's script submits, with its client data's origin rewritten.
    await page.route(`${instance.origin}/admin/sign-in/passkey`, async (route) => {
      const form = new URLSearchParams(route.request().postData() ?? '');
      const clientData = JSON.parse(
        Buffer.from(form.get('clientDataJSON') ?? '', 'base64url').toString('utf8'),
      ) as { origin: string };
      clientData.origin = 'http://localhost:1';
      form.set('clientDataJSON', Buffer.from(JSON.stringify(clientData)).toString('base64url'));
      await route.continue({ postData: form.toString() });
    });
    await passkeySignIn(page);
    await expect(page.getByText('That passkey was not accepted')).toBeVisible();
    expect(await instance.sessions()).toBe(0);
    // The control's control: unrewritten, the same passkey signs in.
    await page.unroute(`${instance.origin}/admin/sign-in/passkey`);
    await passkeySignIn(page);
    await expect(page).toHaveURL(`${instance.origin}/admin/status`);
  });
});
