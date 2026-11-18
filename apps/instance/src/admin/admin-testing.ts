// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the admin pages' tests share (#2641): a request as a browser on the
 * tunnel's hostname sends one, a sign-in through the real handler, and a
 * handler built afresh over a database file another world wrote — the
 * "discard the handler, build a new one" of the round trip.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import { request as httpRequest } from 'node:http';

import { expect } from 'vitest';

import { createIdentity } from '../auth/identity.ts';
import { TEST_ORIGIN, type TestClock } from '../auth/identity-testing.ts';
import type { Moderators } from '../moderation/moderation.ts';
import { createHandler, type Handler } from '../handler.ts';
import { adminCode, adminPasskeysConfirm, type DataPaths } from '../operator/commands.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { testConfig } from '../instance-testing.ts';
import { createInstanceKeys } from '../keys/instance-keys.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { createOperate } from '../operate/operate.ts';
import { keysState } from '../operate/status.ts';
import type { ClientInfo } from '../route-kit.ts';
import { createSealed } from '../sealed/sealed.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { ADMIN_COOKIE, createAdmin, LOOPBACK_COOKIE, type Admin } from './admin.ts';
import {
  softwareAuthenticator,
  type Bend,
  type SoftwareAuthenticator,
} from './webauthn-testing.ts';

/** The tunnel's hostname, as a browser names it in `Host`. */
export const TEST_HOST = new URL(TEST_ORIGIN).host;

export interface AdminRequestOptions {
  /** The session cookie's token, sent as `__Host-oyl-admin`. */
  readonly cookie?: string;
  /** A form, sent `application/x-www-form-urlencoded`. */
  readonly form?: Readonly<Record<string, string>>;
  /** `Origin`: the instance's own unless a test says otherwise; `null` sends none. */
  readonly origin?: string | null;
  /** `Sec-Fetch-Site`: `same-origin` unless a test says otherwise; `null` sends none. */
  readonly site?: string | null;
  /** `Host`: the tunnel's hostname unless a test says otherwise. */
  readonly host?: string;
  /** Any other header. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The loopback listener's port (#2643): the request is a browser's on
   * `http://localhost:<port>` — its `Host`, its `Origin` and its cookie's name.
   */
  readonly loopback?: number;
}

/** A request for `path` on the instance, as a browser on its admin page sends it. */
export function adminRequest(
  method: string,
  path: string,
  options: AdminRequestOptions = {},
): Request {
  const headers = new Headers(options.headers);
  const local =
    options.loopback === undefined ? undefined : `localhost:${String(options.loopback)}`;
  headers.set('host', options.host ?? local ?? TEST_HOST);
  if (options.cookie !== undefined) {
    const name = local === undefined ? ADMIN_COOKIE : LOOPBACK_COOKIE;
    headers.set('cookie', `${name}=${options.cookie}`);
  }
  const ours = local === undefined ? TEST_ORIGIN : `http://${local}`;
  const origin = options.origin === undefined ? ours : options.origin;
  const site = options.site === undefined ? 'same-origin' : options.site;
  if (method === 'POST') {
    if (origin !== null) headers.set('origin', origin);
    if (site !== null) headers.set('sec-fetch-site', site);
  }
  if (options.form !== undefined) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  return new Request(`http://instance.invalid${path}`, {
    method,
    headers,
    ...(options.form === undefined ? {} : { body: new URLSearchParams(options.form).toString() }),
  });
}

/** The session token a sign-in's `Set-Cookie` carries, or `undefined`. */
export function cookieOf(response: Response, name: string = ADMIN_COOKIE): string | undefined {
  const set = response.headers.get('set-cookie');
  const value = set === null ? undefined : new RegExp(`^${name}=([^;]*)`).exec(set)?.[1];
  return value === undefined || value === '' ? undefined : value;
}

/** Redeem `code` through `handler`'s `POST /admin/sign-in`; answers the cookie's token. */
export async function signInWith(
  handler: Handler,
  code: string,
  client: ClientInfo = { address: '203.0.113.7' },
): Promise<string> {
  const answer = await handler(adminRequest('POST', '/admin/sign-in', { form: { code } }), client);
  expect(answer.status, await answer.clone().text()).toBe(303);
  const token = cookieOf(answer);
  if (token === undefined) throw new Error('the sign-in set no cookie');
  return token;
}

/** The synchronizer token the signed-in Status page's sign-out form carries. */
export async function csrfFrom(handler: Handler, token: string): Promise<string> {
  const page = await (
    await handler(adminRequest('GET', '/admin/status', { cookie: token }))
  ).text();
  const value = /name="csrf" value="([0-9a-f]{64})"/.exec(page)?.[1];
  if (value === undefined) throw new Error('the Status page carried no CSRF token');
  return value;
}

/** The synchronizer token a signed-in page carries: the passkeys page's, by default. */
export async function csrfOn(
  handler: Handler,
  token: string,
  path = '/admin/passkeys',
): Promise<string> {
  const page = await (await handler(adminRequest('GET', path, { cookie: token }))).text();
  const value = /name="csrf" value="([0-9a-f]{64})"/.exec(page)?.[1];
  if (value === undefined) throw new Error(`${path} carried no CSRF token`);
  return value;
}

/** A ceremony's options, as the page's script reads them. */
export interface CeremonyOptions {
  readonly challenge: string;
  readonly rpId: string;
  readonly allowCredentials?: readonly string[];
  readonly excludeCredentials?: readonly string[];
  readonly userHandle?: string;
}

/** A JSON answer from the admin layer: its status and body. */
async function json(answer: Response): Promise<{ status: number; body: CeremonyOptions }> {
  return { status: answer.status, body: (await answer.json()) as CeremonyOptions };
}

/**
 * Enrol `authenticator` from the code session `token` through the real pages,
 * as the page's script does: the options, the authenticator's response, the
 * form. Answers the form's answer; `bend` changes the response.
 */
export async function enrolWith(
  handler: Handler,
  token: string,
  authenticator: SoftwareAuthenticator,
  options: { readonly label?: string; readonly bend?: Bend; readonly origin?: string } = {},
): Promise<Response> {
  const csrf = await csrfOn(handler, token);
  const asked = await json(
    await handler(
      adminRequest('POST', '/admin/passkeys/options', { cookie: token, form: { csrf } }),
    ),
  );
  expect(asked.status, JSON.stringify(asked.body)).toBe(200);
  const made = await authenticator.register(
    {
      rpId: asked.body.rpId,
      origin: options.origin ?? TEST_ORIGIN,
      challenge: asked.body.challenge,
    },
    options.bend,
  );
  return handler(
    adminRequest('POST', '/admin/passkeys/add', {
      cookie: token,
      form: {
        csrf,
        label: options.label ?? `Passkey ${authenticator.algorithm}`,
        clientDataJSON: made.clientDataJSON,
        attestationObject: made.attestationObject,
      },
    }),
  );
}

/** The form fields a passkey sign-in posts, for a fresh challenge the instance issued. */
export async function passkeySignInForm(
  handler: Handler,
  authenticator: SoftwareAuthenticator,
  options: { readonly bend?: Bend; readonly origin?: string; readonly client?: ClientInfo } = {},
): Promise<Record<string, string>> {
  const asked = await json(
    await handler(
      adminRequest('POST', '/admin/sign-in/passkey-options', { form: {} }),
      options.client,
    ),
  );
  expect(asked.status, JSON.stringify(asked.body)).toBe(200);
  const made = await authenticator.assert(
    {
      rpId: asked.body.rpId,
      origin: options.origin ?? TEST_ORIGIN,
      challenge: asked.body.challenge,
    },
    options.bend,
  );
  return {
    credential: made.credentialId,
    clientDataJSON: made.clientDataJSON,
    authenticatorData: made.authenticatorData,
    signature: made.signature,
  };
}

/** Sign in with `authenticator` through the real pages; answers the cookie's token. */
export async function passkeySignIn(
  handler: Handler,
  authenticator: SoftwareAuthenticator,
  client: ClientInfo = { address: '203.0.113.7' },
): Promise<string> {
  const form = await passkeySignInForm(handler, authenticator, { client });
  const answer = await handler(adminRequest('POST', '/admin/sign-in/passkey', { form }), client);
  expect(answer.status, await answer.clone().text()).toBe(303);
  const token = cookieOf(answer);
  if (token === undefined) throw new Error('the passkey sign-in set no cookie');
  return token;
}

/**
 * A step-up for `action` over `fields` from the session `token`, as the
 * page's script asks for one: the challenge, then `authenticator`'s
 * assertion over it. Answers the form fields to post with the change.
 */
export async function stepUpWith(
  handler: Handler,
  token: string,
  authenticator: SoftwareAuthenticator,
  action: string,
  fields: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const csrf = await csrfOn(handler, token);
  const asked = await json(
    await handler(
      adminRequest('POST', '/admin/step-up', { cookie: token, form: { csrf, action, ...fields } }),
    ),
  );
  expect(asked.status, JSON.stringify(asked.body)).toBe(200);
  const made = await authenticator.assert({
    rpId: asked.body.rpId,
    origin: TEST_ORIGIN,
    challenge: asked.body.challenge,
  });
  return {
    csrf,
    ...fields,
    credential: made.credentialId,
    clientDataJSON: made.clientDataJSON,
    authenticatorData: made.authenticatorData,
    signature: made.signature,
  };
}

export interface HandlerOver {
  readonly handler: Handler;
  readonly store: SqlStore;
  readonly admin: Admin;
  close(): Promise<void>;
}

/**
 * A NEW handler over the database at `path` — its own store connection, its
 * own accounts, keys, Operate area and admin pages — as an instance restarted
 * on the same file is. `moderators` is the restarted instance's configuration.
 */
export async function handlerOver(
  path: string,
  clock: TestClock,
  moderators: Moderators,
): Promise<HandlerOver> {
  const store = await openSqlStore(path);
  const now = (): number => clock.ms;
  const identity = createIdentity({
    store,
    origin: TEST_ORIGIN,
    registration: 'open',
    moderators,
    now,
  });
  const instanceKeys = createInstanceKeys({
    store,
    secret: secretBytes(7),
    origin: TEST_ORIGIN,
    now: () => Math.floor(clock.ms / 1000),
  });
  await instanceKeys.maintain();
  const reject = (): Promise<never> => Promise.reject(new Error('a test reached for the network'));
  const admin = createAdmin({
    store,
    origin: TEST_ORIGIN,
    ownerKey: moderators.owner,
    secretKeySet: true,
    roleOf: (athleteId) => identity.moderation.roleOf(athleteId),
    now,
    name: null,
    instanceKeys,
  });
  const config = testConfig({ moderators });
  const handler = createHandler({
    config,
    version: '9.8.7',
    notices: 'notices',
    log: () => undefined,
    identity,
    instanceKeys,
    sealed: createSealed({ store, now }),
    operate: createOperate({
      store,
      status: {
        now,
        startedAt: clock.ms,
        disk: () => Promise.resolve([]),
        tunnel: () => Promise.resolve({ state: 'unknown' }),
        keys: keysState(instanceKeys),
      },
      analysis: {
        environment: config,
        resolve: reject,
        now,
        hostedKey: () => Promise.resolve({ kind: 'none' }),
        localModel: () => {
          throw new Error('a test reached for a model');
        },
      },
    }),
    admin,
  });
  return { handler, store, admin, close: () => store.close() };
}

/**
 * A browser on one listener's admin pages (#2648): the tunnel's hostname, or
 * `http://localhost:<port>` — its `Host`, `Origin`, cookie name and RP ID —
 * with the `ClientInfo` that listener's adapter writes.
 */
export interface AdminBrowser {
  readonly origin: string;
  readonly cookieName: string;
  send(method: string, path: string, options?: AdminRequestOptions): Promise<Response>;
}

export function adminBrowser(
  handler: Handler,
  on: { readonly loopback?: number; readonly client?: ClientInfo } = {},
): AdminBrowser {
  const loopback = on.loopback;
  const client =
    on.client ??
    (loopback === undefined
      ? { address: '203.0.113.7' }
      : { address: '172.30.87.1', listener: 'loopback' });
  return {
    origin: loopback === undefined ? TEST_ORIGIN : `http://localhost:${String(loopback)}`,
    cookieName: loopback === undefined ? ADMIN_COOKIE : LOOPBACK_COOKIE,
    send: (method, path, options = {}) =>
      handler(
        adminRequest(method, path, {
          ...options,
          ...(loopback === undefined ? {} : { loopback }),
        }),
        client,
      ),
  };
}

/** A confirmed passkey's session on `browser`'s listener, and the authenticator it was opened with. */
export interface PasskeySession {
  readonly token: string;
  readonly authenticator: SoftwareAuthenticator;
}

/**
 * Through the real pages on `browser`'s listener: a one-time code from
 * `operator admin-code`, a passkey enrolled from its session, confirmed by
 * `operator admin-passkeys confirm` on the host, and a sign-in with it.
 */
export async function passkeySessionOn(
  browser: AdminBrowser,
  paths: DataPaths,
  now: () => Date,
): Promise<PasskeySession> {
  const cookieFrom = (answer: Response): string => {
    const token = cookieOf(answer, browser.cookieName);
    if (token === undefined) throw new Error('no session cookie was set');
    return token;
  };
  const { code } = await adminCode(paths, now);
  const signedIn = await browser.send('POST', '/admin/sign-in', { form: { code } });
  expect(signedIn.status, await signedIn.clone().text()).toBe(303);
  const codeToken = cookieFrom(signedIn);
  const page = await (await browser.send('GET', '/admin/passkeys', { cookie: codeToken })).text();
  const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(page)?.[1];
  if (csrf === undefined) throw new Error('the passkeys page carried no CSRF token');
  const asked = (await (
    await browser.send('POST', '/admin/passkeys/options', { cookie: codeToken, form: { csrf } })
  ).json()) as CeremonyOptions;
  const authenticator = await softwareAuthenticator('es256');
  const made = await authenticator.register({
    rpId: asked.rpId,
    origin: browser.origin,
    challenge: asked.challenge,
  });
  const added = await browser.send('POST', '/admin/passkeys/add', {
    cookie: codeToken,
    form: { csrf, label: 'Test passkey', ...made },
  });
  expect(added.status, await added.clone().text()).toBe(303);
  const database = openDatabase(paths.database);
  let id: string | undefined;
  try {
    id = (
      database
        .prepare('select id from admin_passkey where credential_id = ?')
        .get(authenticator.credentialId) as { id: string } | undefined
    )?.id;
  } finally {
    database.close();
  }
  if (id === undefined) throw new Error('the passkey was not kept');
  await adminPasskeysConfirm(paths, id, now);
  const options = (await (
    await browser.send('POST', '/admin/sign-in/passkey-options', { form: {} })
  ).json()) as CeremonyOptions;
  const assertion = await authenticator.assert({
    rpId: options.rpId,
    origin: browser.origin,
    challenge: options.challenge,
  });
  const opened = await browser.send('POST', '/admin/sign-in/passkey', {
    form: { credential: assertion.credentialId, ...assertion },
  });
  expect(opened.status, await opened.clone().text()).toBe(303);
  return { token: cookieFrom(opened), authenticator };
}

/** The synchronizer token the page at `path` carries for `token`'s session on `browser`. */
export async function csrfOnPage(
  browser: AdminBrowser,
  token: string,
  path: string,
): Promise<string> {
  const page = await (await browser.send('GET', path, { cookie: token })).text();
  const value = /name="csrf" value="([0-9a-f]{64})"/.exec(page)?.[1];
  if (value === undefined) throw new Error(`${path} carried no CSRF token`);
  return value;
}

/**
 * The form a change posts as the page's script makes it (#2648): the
 * step-up for `action` over `fields`, and the passkey's assertion over it;
 * `bend` changes the assertion.
 */
export async function steppedUpForm(
  browser: AdminBrowser,
  session: PasskeySession,
  action: string,
  fields: Readonly<Record<string, string>>,
  options: { readonly page?: string; readonly bend?: Bend } = {},
): Promise<Record<string, string>> {
  const csrf = await csrfOnPage(browser, session.token, options.page ?? '/admin/analysis');
  const asked = await browser.send('POST', '/admin/step-up', {
    cookie: session.token,
    form: { csrf, action, ...fields },
  });
  expect(asked.status, await asked.clone().text()).toBe(200);
  const challenge = (await asked.json()) as CeremonyOptions;
  const made = await session.authenticator.assert(
    { rpId: challenge.rpId, origin: browser.origin, challenge: challenge.challenge },
    options.bend,
  );
  return {
    csrf,
    ...fields,
    credential: made.credentialId,
    clientDataJSON: made.clientDataJSON,
    authenticatorData: made.authenticatorData,
    signature: made.signature,
  };
}

/** A change made as the page's script makes it: {@link steppedUpForm}, posted to `path`. */
export async function changeOn(
  browser: AdminBrowser,
  session: PasskeySession,
  path: string,
  action: string,
  fields: Readonly<Record<string, string>>,
): Promise<Response> {
  const form = await steppedUpForm(browser, session, action, fields);
  return browser.send('POST', path, { cookie: session.token, form });
}

/**
 * The running instance as a browser on the tunnel's hostname reaches it:
 * every request sent over HTTP to its listener, `Host` and all, and the
 * answer read back with its `Set-Cookie`.
 */
export function overHttp(url: string): Handler {
  return async (request) => {
    const target = new URL(request.url);
    const body = request.method === 'GET' ? undefined : await request.text();
    const headers = Object.fromEntries(request.headers.entries());
    return new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest(
        `${url}${target.pathname}${target.search}`,
        { method: request.method, headers },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            const answer = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (value !== undefined)
                answer.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            resolve(
              new Response(incoming.statusCode === 303 ? null : Buffer.concat(chunks), {
                status: incoming.statusCode ?? 0,
                headers: answer,
              }),
            );
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  };
}
