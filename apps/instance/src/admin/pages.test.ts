// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every `/admin` route, from the admin route table** (#2645, ADR 0069 D-4):
 * the header set on every answer, the CSRF refusals on every `POST`, the
 * sign-in redirect on every signed-in page without a session, and the owner
 * asked again on every page. The routes are READ from `admin-routes.ts`
 * §`ADMIN_ROUTES`, not listed here, so a page a later sub-issue adds is held
 * to all of it by being added — it cannot opt out by forgetting.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { ADMIN_ROUTES } from './admin-routes.ts';
import {
  adminRequest,
  csrfFrom,
  handlerOver,
  signInWith,
  type AdminRequestOptions,
  type HandlerOver,
} from './admin-testing.ts';
import { ADMIN_HEADERS } from './headers.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
});

async function world(): Promise<ModerationWorld> {
  const made = await startModerationWorld({ admin: {} });
  worlds.push(made);
  return made;
}

async function signedIn(made: ModerationWorld, address = '203.0.113.7'): Promise<string> {
  const { code } = await adminCode(
    { database: made.path, blobs: `${made.path}.blobs` },
    () => new Date(made.clock.ms),
  );
  return signInWith(made.instance.handler, code, { address });
}

/** The operator log as the owner reads it: sealed, through the real route. */
async function ownersLog(made: ModerationWorld): Promise<unknown> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return read.body;
}

const sessionRow = async (made: ModerationWorld, token: string) => {
  const sha = await sha256Hex(token);
  return made.freshRead((store) => store.findAdminSession(sha));
};

/** A route's path as a browser sends it: a passkey's `{id}` filled in with one of the right shape. */
const sent = (path: string): string => path.replace('{id}', '0123456789abcdef');

const GETS = ADMIN_ROUTES.filter((route) => route.methods.includes('GET'));
const POSTS = ADMIN_ROUTES.filter((route) => route.methods.includes('POST'));
/** Every GET that shows the instance's state: everything but the sign-in page and the stylesheet. */
const SIGNED_IN = GETS.filter((route) => route.kind === 'page' || route.kind === 'redirect');

/** The headers an answer may carry besides the admin set. */
const OWN = ['content-type', 'location', 'set-cookie', 'allow', 'retry-after'];

function heldToAdminHeaders(answer: Response, what: string): void {
  for (const [name, value] of Object.entries(ADMIN_HEADERS)) {
    expect(answer.headers.get(name), `${name} on ${what}`).toBe(value);
  }
  const names = [...answer.headers.keys()];
  expect(
    names.filter((name) => name.startsWith('access-control-')),
    what,
  ).toEqual([]);
  expect(
    names.filter((name) => !(name in ADMIN_HEADERS) && !OWN.includes(name)),
    what,
  ).toEqual([]);
  const policy = answer.headers.get('content-security-policy') ?? '';
  expect(policy, what).not.toContain('unsafe-inline');
  expect(policy, what).toContain("frame-ancestors 'none'");
  expect(answer.headers.get('cache-control'), what).toBe('no-store');
}

describe('the admin route table (#2645)', () => {
  it('holds the shell’s pages, the sign-in, the stylesheet and the sign-out — and nothing a test here would miss', () => {
    expect(SIGNED_IN.map((route) => route.path)).toEqual([
      '/admin',
      '/admin/status',
      '/admin/accounts',
      '/admin/backups',
      '/admin/analysis',
      '/admin/rooms',
      '/admin/keys',
      '/admin/log',
      '/admin/problems',
      '/admin/passkeys',
    ]);
    expect(POSTS.map((route) => route.path)).toEqual([
      '/admin/sign-in',
      '/admin/sign-in/passkey-options',
      '/admin/sign-in/passkey',
      '/admin/sign-out',
      '/admin/accounts/approve',
      '/admin/accounts/refuse',
      '/admin/backups',
      '/admin/rooms/end',
      '/admin/keys/rotate',
      '/admin/analysis/offer',
      '/admin/analysis/check',
      '/admin/analysis/model',
      '/admin/analysis/address',
      '/admin/analysis/clear',
      '/admin/passkeys/options',
      '/admin/passkeys/add',
      '/admin/passkeys/{id}/revoke',
      '/admin/step-up',
    ]);
    for (const route of ADMIN_ROUTES)
      expect(route.path === '/admin' || route.path.startsWith('/admin/')).toBe(true);
  });
});

describe('every /admin route carries the admin headers, signed in or not (#2645, ADR 0069 D-4)', () => {
  it('on every GET and every POST of the table, with and without a session', async () => {
    const made = await world();
    const handler = made.instance.handler;
    const token = await signedIn(made);
    const csrf = await csrfFrom(handler, token);
    const answers: (readonly [string, Response])[] = [];
    for (const route of GETS) {
      for (const options of [{}, { cookie: token }] as AdminRequestOptions[]) {
        const what = `GET ${route.path}${options.cookie === undefined ? '' : ' (session)'}`;
        answers.push([what, await handler(adminRequest('GET', route.path, options))]);
      }
    }
    for (const route of POSTS) {
      // Refusals only, so the session lives through the loop: a foreign Origin, and no token.
      answers.push([
        `POST ${route.path} (foreign Origin)`,
        await handler(
          adminRequest('POST', sent(route.path), {
            cookie: token,
            form: { csrf, code: 'x' },
            origin: 'https://evil.example',
          }),
          { address: '198.51.100.1' },
        ),
      ]);
    }
    expect(answers.length).toBe(GETS.length * 2 + POSTS.length);
    for (const [what, answer] of answers) heldToAdminHeaders(answer, what);
    // Each signed-in page was served, as a page, to the session.
    for (const route of SIGNED_IN.filter((each) => each.kind === 'page')) {
      const answer = answers.find(([what]) => what === `GET ${route.path} (session)`)?.[1];
      expect(answer?.status, route.path).toBe(200);
      expect(answer?.headers.get('content-type'), route.path).toBe('text/html; charset=utf-8');
    }
  });
});

describe('with no session, every signed-in page goes to sign-in and draws nothing (#2645)', () => {
  it.each(SIGNED_IN.map((route) => route.path))(
    '%s: 303 to /admin/sign-in with no body, for no cookie and for one nobody issued',
    async (path) => {
      const made = await world();
      const before = await ownersLog(made);
      for (const cookie of [undefined, 'A'.repeat(43), 'not a token']) {
        const answer = await made.instance.handler(
          adminRequest('GET', path, cookie === undefined ? {} : { cookie }),
        );
        expect(answer.status).toBe(303);
        expect(answer.headers.get('location')).toBe('/admin/sign-in');
        expect(await answer.text()).toBe('');
      }
      expect(await ownersLog(made)).toEqual(before);
    },
  );
});

describe('every POST is refused without the session’s token or from a foreign Origin (#2645, ADR 0069 D-4)', () => {
  /** The refusals every `POST` but a sign-in's gets: a sign-in has no session to hold a token. */
  const REFUSALS: readonly (readonly [string, (csrf: string) => AdminRequestOptions])[] = [
    ['no token', () => ({ form: {} })],
    ['a wrong token', () => ({ form: { csrf: '0'.repeat(64) } })],
    ['a foreign Origin', (csrf) => ({ form: { csrf }, origin: 'https://evil.example' })],
    ['no Origin', (csrf) => ({ form: { csrf }, origin: null })],
    ['Sec-Fetch-Site: same-site', (csrf) => ({ form: { csrf }, site: 'same-site' })],
  ];
  const CASES = POSTS.flatMap((route) =>
    REFUSALS.filter(
      ([name]) =>
        (route.kind !== 'sign-in' && route.kind !== 'sign-in-action') ||
        name.includes('Origin') ||
        name.includes('Sec-Fetch'),
    ).map(([name, shape]) => [route.path, name, shape] as const),
  );

  it.each(CASES)('%s with %s: 403, nothing changed, read back', async (path, _name, shape) => {
    const made = await world();
    const handler = made.instance.handler;
    const token = await signedIn(made);
    const csrf = await csrfFrom(handler, token);
    const before = await ownersLog(made);
    const refused = await handler(
      adminRequest('POST', sent(path), {
        cookie: token,
        ...shape(csrf),
        form: { code: 'x', ...shape(csrf).form },
      }),
      { address: '198.51.100.2' },
    );
    expect(refused.status).toBe(403);
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect(await sessionRow(made, token)).toBeDefined();
    // A refusal is counted in memory and only flushed later: the log itself is unchanged.
    expect(await ownersLog(made)).toEqual(before);
  });
});

describe('the owner is asked again on every page (#2645, ADR 0069 D-1)', () => {
  it.each(SIGNED_IN.map((route) => route.path))(
    '%s: once OYL_INSTANCE_OWNER_KEY names another athlete, refused, the session ended, and nothing else changed',
    async (path) => {
      const made = await world();
      const token = await signedIn(made);
      const moved = await handlerOver(made.path, made.clock, {
        owner: made.deputy.device.publicKey,
      });
      restarted.push(moved);
      const before = await ownersLog(made);
      const answer = await moved.handler(adminRequest('GET', path, { cookie: token }));
      expect(answer.status).toBe(303);
      expect(answer.headers.get('location')).toBe('/admin/sign-in');
      expect(await answer.text()).toBe('');
      // Read back through the store, not the answer: the session is gone, the log unchanged.
      expect(await sessionRow(made, token)).toBeUndefined();
      expect(await ownersLog(made)).toEqual(before);
    },
  );
});

describe('the one script is linked only on the pages with a passkey ceremony, and never inline (#2642, #2645, #2646, #2647, #2648, #2649, #2650)', () => {
  it('the sign-in page, Passkeys, Accounts, Backups, the AI backend, Rooms and Keys link /admin/passkey.js; Status, the log and Recent problems link nothing', async () => {
    const made = await world();
    const handler = made.instance.handler;
    const token = await signedIn(made);
    const scripts = async (path: string, cookie?: string): Promise<string[]> => {
      const answer = await handler(
        adminRequest('GET', path, cookie === undefined ? {} : { cookie }),
      );
      expect(answer.status, path).toBe(200);
      const html = await answer.text();
      // No script element with a body, and no handler attribute.
      expect(html, path).not.toMatch(/<script[^>]*>[^<]|\son[a-z]+=/i);
      return [...html.matchAll(/<script([^>]*)>/gi)].map(([, attributes]) => attributes ?? '');
    };
    expect(await scripts('/admin/sign-in')).toEqual([' src="/admin/passkey.js" defer']);
    expect(await scripts('/admin/passkeys', token)).toEqual([' src="/admin/passkey.js" defer']);
    // #2648: its changes each ask for a step-up, which the script asks the passkey for.
    expect(await scripts('/admin/analysis', token)).toEqual([' src="/admin/passkey.js" defer']);
    // #2646: each approval and refusal asks for a step-up.
    expect(await scripts('/admin/accounts', token)).toEqual([' src="/admin/passkey.js" defer']);
    // #2647: "back up now" asks for a step-up.
    expect(await scripts('/admin/backups', token)).toEqual([' src="/admin/passkey.js" defer']);
    // #2649: End room asks for a step-up.
    expect(await scripts('/admin/rooms', token)).toEqual([' src="/admin/passkey.js" defer']);
    // #2650: rotating the encryption key asks for a step-up.
    expect(await scripts('/admin/keys', token)).toEqual([' src="/admin/passkey.js" defer']);
    expect(await scripts('/admin/status', token)).toEqual([]);
    expect(await scripts('/admin/log', token)).toEqual([]);
    // #2651: read-only, so no script.
    expect(await scripts('/admin/problems', token)).toEqual([]);
    const script = await handler(adminRequest('GET', '/admin/passkey.js'));
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('content-security-policy')).toContain("script-src 'self'");
  });
});

describe('a session lands on Status (#2645)', () => {
  it('/admin and /admin/sign-in, with a session, send the browser to /admin/status', async () => {
    const made = await world();
    const token = await signedIn(made);
    for (const path of ['/admin', '/admin/sign-in']) {
      const answer = await made.instance.handler(adminRequest('GET', path, { cookie: token }));
      expect(answer.status, path).toBe(303);
      expect(answer.headers.get('location'), path).toBe('/admin/status');
    }
  });
});
