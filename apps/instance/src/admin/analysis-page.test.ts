// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin AI backend page (#2648, ADR 0069 D-2, D-4, D-8), driven through
 * the REAL handler over a real SQLite file. What the page shows is held to
 * what the analysis routes answer the owner's SEALED request in the same
 * test, and every change is read back through `GET /v1/operate/analysis` —
 * the read the app's panel and a rider's next job's settings come from —
 * and through the operator log, never through the page's own answer alone.
 * That a saved model reaches a rider's job is `analysis-page-instance.test.ts`'s,
 * on the running instance.
 */

import {
  aiNowLines,
  CHECK_TEXT,
  MODEL_SAVE_FAILED_TEXT,
  MODEL_SAVED_TEXT,
  OFFER_FAILED_TEXT,
  OFFER_SAVED_TEXT,
  ownKeyText,
  RETURN_FAILED_TEXT,
  RETURNED_TEXT,
  type OperateAnalysisAnswer,
} from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startFakeModelServer,
  type FakeModelServer,
} from '../analysis/fake-model-server-testing.ts';
import { sha256Hex } from '../auth/crypto.ts';
import { escapeHtml } from '../html.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { runCommand } from '../operator/run.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import {
  adminBrowser,
  changeOn,
  handlerOver,
  passkeySessionOn,
  signInWith,
  steppedUpForm,
  type AdminBrowser,
  type HandlerOver,
  type PasskeySession,
} from './admin-testing.ts';
import {
  ANALYSIS_ADDRESS_REFUSED_TEXT,
  ANALYSIS_ADDRESS_SAVED_TEXT,
  ANALYSIS_KEY_ELSEWHERE_TEXT,
  ANALYSIS_READS_ONLY_TEXT,
} from './pages.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
const servers: FakeModelServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  for (const server of servers.splice(0)) await server.close();
  worlds = [];
  restarted = [];
});

const PORT = 8788;

/** A name the instance resolves to a public address, and every other name to a local one. */
const PUBLIC_NAME = 'models.public.example';

async function world(admin: { readonly loopbackPort?: number } = {}): Promise<ModerationWorld> {
  const made = await startModerationWorld({
    admin,
    resolve: (name) => Promise.resolve(name === PUBLIC_NAME ? ['8.8.8.8'] : ['127.0.0.1']),
  });
  worlds.push(made);
  return made;
}

const paths = (made: ModerationWorld) => ({ database: made.path, blobs: `${made.path}.blobs` });
const clockOf = (made: ModerationWorld) => () => new Date(made.clock.ms);

const tunnel = (made: ModerationWorld): AdminBrowser => adminBrowser(made.instance.handler);

const passkeySession = (made: ModerationWorld, browser = tunnel(made)): Promise<PasskeySession> =>
  passkeySessionOn(browser, paths(made), clockOf(made));

/** The settings as the owner reads them: sealed, through the real route. */
async function settings(made: ModerationWorld): Promise<OperateAnalysisAnswer> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/analysis');
  expect(read.status).toBe(200);
  return read.body as OperateAnalysisAnswer;
}

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

/** The operator log's analysis entries, oldest first, as the owner reads them. */
async function analysisLog(made: ModerationWorld): Promise<LogEntry[]> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries
    .filter((entry) => entry.action.startsWith('analysis_'))
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }))
    .reverse();
}

/** The settings row, read back through the store on a connection of its own. */
const settingRow = (made: ModerationWorld) => made.freshRead((store) => store.getAnalysisSetting());

async function page(browser: AdminBrowser, token: string): Promise<string> {
  const answer = await browser.send('GET', '/admin/analysis', { cookie: token });
  expect(answer.status).toBe(200);
  return answer.text();
}

async function codeSession(made: ModerationWorld): Promise<string> {
  const { code } = await adminCode(paths(made), clockOf(made));
  return signInWith(made.instance.handler, code);
}

/** Each line, as the page draws it: text escaped, a machine name as code. */
const lineHtml = (line: readonly (string | { readonly code: string })[]): string =>
  line
    .map((part) =>
      typeof part === 'string' ? escapeHtml(part) : `<code>${escapeHtml(part.code)}</code>`,
    )
    .join('');

describe('the AI backend page is the analysis routes’ answers, read through the seam (#2648)', () => {
  it('draws the Now lines and the owner’s key exactly as GET /v1/operate/analysis answers them, and no form in a code session', async () => {
    const made = await world();
    const saved = await made.as(made.owner, 'POST', '/v1/operate/analysis', {
      localUrl: 'http://127.0.0.1:11434/v1',
      localModel: 'alpha:14b',
    });
    expect(saved.status).toBe(200);
    const token = await codeSession(made);
    const html = await page(tunnel(made), token);
    const answer = await settings(made);
    expect(answer.local).toMatchObject({ model: 'alpha:14b', setIn: 'app', state: 'on' });
    for (const line of aiNowLines(answer, null))
      expect(html).toContain(`<li>${lineHtml(line)}</li>`);
    expect(html).toContain('<code>alpha:14b</code>');
    expect(html).toContain(escapeHtml(ownKeyText(answer)));
    expect(html).toContain(escapeHtml(ANALYSIS_KEY_ELSEWHERE_TEXT));
    // A code session reads, and is drawn no change.
    expect(html).toContain(escapeHtml(ANALYSIS_READS_ONLY_TEXT));
    expect(html).not.toContain('data-step-up');
  });

  it('follows the route when the route and the store disagree — the control that the page never reads the store', async () => {
    const wrapped: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/analysis' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context) => {
              const real = (await (await route.handle(context)).json()) as OperateAnalysisAnswer;
              return json({ ...real, local: { ...real.local, model: 'route-only:1b' } });
            },
          }
        : route,
    );
    const made = await startModerationWorld({ admin: {}, routes: wrapped });
    worlds.push(made);
    const html = await page(tunnel(made), await codeSession(made));
    expect(await settingRow(made)).toBeUndefined();
    expect(html).toContain('Model: <code>route-only:1b</code>');
  });
});

describe('an address with a user:password is never drawn by the page (#2648, #2611)', () => {
  it('strips it from the Now line in a code session and from the address input in a passkey session', async () => {
    const secret = 'http://MARKER-user:MARKER-pass@ollama:11434/v1';
    const wrapped: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/analysis' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context) => {
              const real = (await (await route.handle(context)).json()) as OperateAnalysisAnswer;
              return json({ ...real, local: { ...real.local, url: secret } });
            },
          }
        : route,
    );
    const made = await startModerationWorld({ admin: {}, routes: wrapped });
    worlds.push(made);
    const code = await page(tunnel(made), await codeSession(made));
    expect(code).toContain('<code>http://ollama:11434/v1</code>');
    expect(code).not.toContain('MARKER');
    const passkey = await page(tunnel(made), (await passkeySession(made)).token);
    expect(passkey).toContain('value="http://ollama:11434/v1"');
    expect(passkey).not.toContain('MARKER');
  });
});

describe('each change through the page, with a fresh passkey, is the route’s own (#2648, ADR 0069 D-2, D-8)', () => {
  it('turns each switch, read back through GET /v1/operate/analysis, each logged under admin_tunnel', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const before = await settings(made);
    expect(before.local.othersMayUse).toBe(false);
    expect(before.local.offered).toBe(true);
    expect(before.hosted.offered).toBe(true);

    for (const [offer, on] of [
      ['others', 'on'],
      ['local', 'off'],
      ['hosted', 'off'],
    ] as const) {
      const answer = await changeOn(browser, session, '/admin/analysis/offer', 'analysis_offer', {
        offer,
        on,
      });
      expect(answer.status, offer).toBe(200);
      expect(await answer.text(), offer).toContain(OFFER_SAVED_TEXT);
    }
    const after = await settings(made);
    expect(after.local.othersMayUse).toBe(true);
    expect(after.local.offered).toBe(false);
    expect(after.hosted.offered).toBe(false);
    // The page shows the state read back, and offers the switch the other way.
    const html = await page(browser, session.token);
    expect(html).toContain('<strong>A model on this instance</strong>: off.');
    expect(html).toMatch(/name="offer" value="local">\n<input type="hidden" name="on" value="on">/);
    expect(await analysisLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'analysis_settings_set',
        detail: 'others_local',
        outcome: 'done',
      },
      {
        source: 'admin_tunnel',
        action: 'analysis_settings_set',
        detail: 'offer_local',
        outcome: 'done',
      },
      {
        source: 'admin_tunnel',
        action: 'analysis_settings_set',
        detail: 'offer_hosted',
        outcome: 'done',
      },
    ]);
  });

  it('saves an address, checks a model on that server, offers Save only once it called tools, and saves it, read back', async () => {
    const made = await world();
    const browser = tunnel(made);
    const model = await startFakeModelServer([
      { kind: 'tool-calls', calls: [{ name: 'fixed_number', arguments: '{}' }] },
      { kind: 'text', text: 'It is 42.' },
    ]);
    servers.push(model);
    const session = await passkeySession(made);
    const address = `http://127.0.0.1:${model.baseUrl.port}/v1`;

    const pointed = await changeOn(
      browser,
      session,
      '/admin/analysis/address',
      'analysis_address',
      {
        localUrl: address,
      },
    );
    expect(pointed.status).toBe(200);
    expect(await pointed.text()).toContain(escapeHtml(ANALYSIS_ADDRESS_SAVED_TEXT));
    expect((await settings(made)).local.url).toBe(address);

    const checked = await changeOn(browser, session, '/admin/analysis/check', 'analysis_check', {
      model: 'alpha:14b',
    });
    expect(checked.status).toBe(200);
    const said = await checked.text();
    expect(said).toContain(escapeHtml(CHECK_TEXT['tools-ok']));
    // Save is offered for the model that was checked, and for no other.
    expect(said).toContain(
      '<form method="post" action="/admin/analysis/model" data-step-up="analysis_model" aria-label="Save this model">',
    );
    expect(said).toContain('<input type="hidden" name="localModel" value="alpha:14b">');
    // The check's two turns, both to the model it named: the page's list reads ask no model anything.
    const chats = model.requests.filter((_, index) =>
      model.paths[index]?.endsWith('/chat/completions'),
    );
    expect(chats.map((request) => request.model)).toEqual(['alpha:14b', 'alpha:14b']);
    // A check changes no setting.
    expect((await settings(made)).local.model).toBeNull();

    const saved = await changeOn(browser, session, '/admin/analysis/model', 'analysis_model', {
      localModel: 'alpha:14b',
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).toContain(escapeHtml(MODEL_SAVED_TEXT));
    expect((await settings(made)).local).toMatchObject({
      url: address,
      model: 'alpha:14b',
      setIn: 'app',
      state: 'on',
    });

    // A check that does not come back tools-ok: no Save form (the server's script has run out).
    const failed = await changeOn(browser, session, '/admin/analysis/check', 'analysis_check', {
      model: 'beta:32b',
    });
    const failedPage = await failed.text();
    expect(failedPage).toContain(escapeHtml(CHECK_TEXT['server-error']));
    expect(failedPage).not.toContain('action="/admin/analysis/model"');

    expect(await analysisLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'analysis_settings_set',
        detail: 'local_url',
        outcome: 'done',
      },
      {
        source: 'admin_tunnel',
        action: 'analysis_model_checked',
        detail: 'tools_ok',
        outcome: 'done',
      },
      {
        source: 'admin_tunnel',
        action: 'analysis_settings_set',
        detail: 'local_model',
        outcome: 'done',
      },
      {
        source: 'admin_tunnel',
        action: 'analysis_model_checked',
        detail: 'server_error',
        outcome: 'done',
      },
    ]);
  });

  it.each([
    ['a public IP', 'http://203.0.113.9:11434/v1'],
    ['a name that resolves to one', `http://${PUBLIC_NAME}:11434/v1`],
  ])(
    'refuses %s with the route’s code, and stores nothing, read back through GET /v1/operate/analysis',
    async (_name, localUrl) => {
      const made = await world();
      const session = await passkeySession(made);
      const before = await settings(made);
      const refused = await changeOn(
        tunnel(made),
        session,
        '/admin/analysis/address',
        'analysis_address',
        { localUrl },
      );
      expect(refused.status).toBe(400);
      const html = await refused.text();
      expect(html).toContain(escapeHtml(ANALYSIS_ADDRESS_REFUSED_TEXT));
      expect(html).toContain('The instance’s reason: <code>not-local</code>.');
      expect(await settings(made)).toEqual(before);
      expect(await settingRow(made)).toBeUndefined();
      expect(await analysisLog(made)).toEqual([
        {
          source: 'admin_tunnel',
          action: 'analysis_settings_set',
          detail: 'local_url',
          outcome: 'refused',
        },
      ]);
    },
  );

  it('returns to .env, read back, logged analysis_settings_cleared under admin_tunnel', async () => {
    const made = await world();
    expect(
      (
        await made.as(made.owner, 'POST', '/v1/operate/analysis', {
          localModel: 'alpha:14b',
          othersLocal: true,
        })
      ).status,
    ).toBe(200);
    const session = await passkeySession(made);
    const answer = await changeOn(
      tunnel(made),
      session,
      '/admin/analysis/clear',
      'analysis_clear',
      {},
    );
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain(escapeHtml(RETURNED_TEXT));
    expect((await settings(made)).local).toMatchObject({ model: null, othersMayUse: false });
    expect(await settingRow(made)).toBeUndefined();
    expect((await analysisLog(made)).at(-1)).toEqual({
      source: 'admin_tunnel',
      action: 'analysis_settings_cleared',
      detail: 'cleared',
      outcome: 'done',
    });
  });

  it('logs a change made on the server machine under admin_loopback', async () => {
    const made = await world({ loopbackPort: PORT });
    const browser = adminBrowser(made.instance.handler, { loopback: PORT });
    const session = await passkeySession(made, browser);
    const answer = await changeOn(browser, session, '/admin/analysis/offer', 'analysis_offer', {
      offer: 'others',
      on: 'on',
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect((await settings(made)).local.othersMayUse).toBe(true);
    expect(await analysisLog(made)).toEqual([
      {
        source: 'admin_loopback',
        action: 'analysis_settings_set',
        detail: 'others_local',
        outcome: 'done',
      },
    ]);
  });
});

/** Every change the page makes, with fields it would be made with. */
const CHANGES = [
  ['/admin/analysis/offer', 'analysis_offer', { offer: 'others', on: 'on' }],
  ['/admin/analysis/check', 'analysis_check', { model: 'alpha:14b' }],
  ['/admin/analysis/model', 'analysis_model', { localModel: 'alpha:14b' }],
  ['/admin/analysis/address', 'analysis_address', { localUrl: 'http://127.0.0.1:11434/v1' }],
  ['/admin/analysis/clear', 'analysis_clear', {}],
] as const;

describe('a change the route answered and the read-back does not hold is said to have failed (#2648)', () => {
  it('says the switch and the model were not taken when the settings read back after them do not show them', async () => {
    // A route that answers 200 and keeps nothing: the write that reports success while the read cannot see it.
    const forgetful: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/analysis' && route.method === 'POST'
        ? {
            ...route,
            handle: async (context) => {
              const read = ROUTES.find(
                (each) => each.path === '/v1/operate/analysis' && each.method === 'GET',
              );
              return (read as Route).handle(context);
            },
          }
        : route,
    );
    const made = await startModerationWorld({ admin: {}, routes: forgetful });
    worlds.push(made);
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const offer = await changeOn(browser, session, '/admin/analysis/offer', 'analysis_offer', {
      offer: 'others',
      on: 'on',
    });
    expect(offer.status).toBe(200);
    const offerPage = await offer.text();
    expect(offerPage).toContain(escapeHtml(OFFER_FAILED_TEXT));
    expect(offerPage).not.toContain(escapeHtml(OFFER_SAVED_TEXT));
    const model = await changeOn(browser, session, '/admin/analysis/model', 'analysis_model', {
      localModel: 'alpha:14b',
    });
    const modelPage = await model.text();
    expect(modelPage).toContain(escapeHtml(MODEL_SAVE_FAILED_TEXT));
    expect(modelPage).not.toContain(escapeHtml(MODEL_SAVED_TEXT));
    expect((await settings(made)).local).toMatchObject({ othersMayUse: false, model: null });
  });
});

describe('the address and the return to .env are said to have failed when the read-back does not show them (#2648)', () => {
  /** The routes with `method` answering as the settings read does and keeping nothing. */
  const forgetting = (method: 'POST' | 'DELETE'): readonly Route[] =>
    ROUTES.map((route) =>
      route.path === '/v1/operate/analysis' && route.method === method
        ? {
            ...route,
            handle: async (context) => {
              const read = ROUTES.find(
                (each) => each.path === '/v1/operate/analysis' && each.method === 'GET',
              );
              return (read as Route).handle(context);
            },
          }
        : route,
    );

  it('does not say the address was saved when the route kept nothing', async () => {
    const made = await startModerationWorld({ admin: {}, routes: forgetting('POST') });
    worlds.push(made);
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const answer = await changeOn(browser, session, '/admin/analysis/address', 'analysis_address', {
      localUrl: 'http://127.0.0.1:11434/v1',
    });
    const html = await answer.text();
    expect(html).not.toContain(escapeHtml(ANALYSIS_ADDRESS_SAVED_TEXT));
    expect(html).toContain(escapeHtml(ANALYSIS_ADDRESS_REFUSED_TEXT));
  });

  it('does not say it returned to .env when the settings are still the app’s', async () => {
    const made = await startModerationWorld({ admin: {}, routes: forgetting('DELETE') });
    worlds.push(made);
    const seeded = await made.as(made.owner, 'POST', '/v1/operate/analysis', {
      localModel: 'alpha:14b',
    });
    expect(seeded.status).toBe(200);
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const answer = await changeOn(browser, session, '/admin/analysis/clear', 'analysis_clear', {});
    const html = await answer.text();
    expect(html).not.toContain(escapeHtml(RETURNED_TEXT));
    expect(html).toContain(escapeHtml(RETURN_FAILED_TEXT));
    expect((await settings(made)).local.setIn).toBe('app');
  });
});

describe('no change without a fresh passkey check made for it (#2648, ADR 0069 D-4)', () => {
  it('through the tunnel: no assertion, a code session, a step-up for another value, and a step-up used twice change nothing, read back', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const csrfOf = async (token: string) => {
      const html = await page(browser, token);
      return /name="csrf" value="([0-9a-f]{64})"/.exec(html)?.[1] as string;
    };
    const before = await settings(made);

    // No assertion at all: the form as a browser with the script blocked posts it.
    const bare = await browser.send('POST', '/admin/analysis/model', {
      cookie: session.token,
      form: { csrf: await csrfOf(session.token), localModel: 'alpha:14b' },
    });
    expect(bare.status).toBe(403);

    // A code session: refused before any step-up is looked at.
    const code = await codeSession(made);
    const fromCode = await browser.send('POST', '/admin/analysis/model', {
      cookie: code,
      form: { csrf: await csrfOf(code), localModel: 'alpha:14b' },
    });
    expect(fromCode.status).toBe(403);
    expect(await fromCode.text()).toContain('A change needs a passkey sign-in');

    // A step-up for one model, posted with another.
    const other = await steppedUpForm(browser, session, 'analysis_model', {
      localModel: 'alpha:14b',
    });
    const swapped = await browser.send('POST', '/admin/analysis/model', {
      cookie: session.token,
      form: { ...other, localModel: 'evil:1b' },
    });
    expect(swapped.status).toBe(403);

    // A step-up for a switch, posted to another change.
    const offer = await steppedUpForm(browser, session, 'analysis_offer', {
      offer: 'others',
      on: 'on',
    });
    const elsewhere = await browser.send('POST', '/admin/analysis/clear', {
      cookie: session.token,
      form: {
        csrf: offer.csrf as string,
        credential: offer.credential as string,
        clientDataJSON: offer.clientDataJSON as string,
        authenticatorData: offer.authenticatorData as string,
        signature: offer.signature as string,
      },
    });
    expect(elsewhere.status).toBe(403);

    // One that went through, posted again.
    const once = await steppedUpForm(browser, session, 'analysis_offer', {
      offer: 'local',
      on: 'off',
    });
    expect(
      (await browser.send('POST', '/admin/analysis/offer', { cookie: session.token, form: once }))
        .status,
    ).toBe(200);
    const after = await settings(made);
    expect(after.local.offered).toBe(false);
    expect(
      (await browser.send('POST', '/admin/analysis/offer', { cookie: session.token, form: once }))
        .status,
    ).toBe(403);

    // Only the one change that had its own step-up happened.
    expect(after).toEqual({ ...before, local: { ...before.local, offered: false } });
    expect(await analysisLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'analysis_settings_set',
        detail: 'offer_local',
        outcome: 'done',
      },
    ]);
  });

  it('refuses an assertion whose counter has not moved past the last change’s', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const first = await changeOn(browser, session, '/admin/analysis/offer', 'analysis_offer', {
      offer: 'others',
      on: 'on',
    });
    expect(first.status).toBe(200);
    // The counter the change before reported, reported again: a cloned passkey.
    const replayed = await steppedUpForm(
      browser,
      session,
      'analysis_offer',
      { offer: 'others', on: 'off' },
      { bend: { signCount: session.authenticator.signCount - 1 } },
    );
    const refused = await browser.send('POST', '/admin/analysis/offer', {
      cookie: session.token,
      form: replayed,
    });
    expect(refused.status).toBe(403);
    expect((await settings(made)).local.othersMayUse).toBe(true);
  });
});

describe('owner-only, checked on the instance (#2648, the epic’s constraint)', () => {
  it.each(CHANGES)(
    '%s: with no session, sent to sign in; once the owner key names another athlete, refused and the session ended — nothing changed, read back through the store',
    async (path, action, fields) => {
      const made = await world();
      const browser = tunnel(made);
      const session = await passkeySession(made);
      const log = await analysisLog(made);
      const form = await steppedUpForm(browser, session, action, fields);

      const none = await browser.send('POST', path, { form });
      expect(none.status).toBe(303);
      expect(none.headers.get('location')).toBe('/admin/sign-in');

      const moved = await handlerOver(made.path, made.clock, {
        owner: made.deputy.device.publicKey,
      });
      restarted.push(moved);
      const refused = await adminBrowser(moved.handler).send('POST', path, {
        cookie: session.token,
        form,
      });
      expect(refused.status).toBe(303);
      expect(refused.headers.get('location')).toBe('/admin/sign-in');
      // Read back through the store: no setting written, the session gone, the log unchanged.
      expect(await settingRow(made)).toBeUndefined();
      expect(
        await made.freshRead(async (store) =>
          store.findAdminSession(await sha256Hex(session.token)),
        ),
      ).toBeUndefined();
      expect(await analysisLog(made)).toEqual(log);
    },
  );
});

describe('the operator log entry is the change’s: a log that cannot be written leaves nothing changed (#2648)', () => {
  it('answers that something went wrong, and the switch is as it was, read back', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const form = await steppedUpForm(browser, session, 'analysis_offer', {
      offer: 'others',
      on: 'on',
    });
    const database = openDatabase(made.path);
    try {
      database.exec(
        "create trigger refuse_admin_log before insert on operator_log when new.source = 'admin_tunnel' and new.action = 'analysis_settings_set' and new.outcome = 'done' begin select raise(abort, 'the log is down'); end",
      );
    } finally {
      database.close();
    }
    const answer = await browser.send('POST', '/admin/analysis/offer', {
      cookie: session.token,
      form,
    });
    expect(answer.status).toBe(500);
    expect(await answer.text()).toContain('Nothing was changed.');
    expect((await settings(made)).local.othersMayUse).toBe(false);
    expect(await settingRow(made)).toBeUndefined();
    // The attempt is kept, as failed.
    expect(await analysisLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'analysis_settings_set', detail: null, outcome: 'failed' },
    ]);
  });
});

describe('no hosted key, no field for one, and no secret on any AI backend answer (#2648, ADR 0047 D-13, CLAUDE.md §6)', () => {
  it('never says the operator’s held key, or any secret the instance holds, and draws no field a key could be typed in', async () => {
    const made = await world();
    const browser = tunnel(made);
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const hostedKey = 'sk-MARKER-hosted-key-2648';
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2648-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2648');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(
        await runCommand(
          ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
          {
            ...paths(made),
            secret,
            ownerKey: made.owner.device.publicKey,
            readStandardInput: () => Promise.resolve(hostedKey),
          },
        ),
      ).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    const { code } = await adminCode(paths(made), clockOf(made));
    const codeToken = await signInWith(made.instance.handler, code);
    const session = await passkeySession(made);
    const said: string[] = [];
    const keep = async (answer: Response): Promise<string> => {
      for (const [name, value] of answer.headers.entries()) {
        if (name !== 'set-cookie') said.push(`${name}: ${value}`);
      }
      const text = await answer.text();
      said.push(text);
      return text;
    };
    const readOnly = await keep(
      await browser.send('GET', '/admin/analysis', { cookie: codeToken }),
    );
    const full = await keep(
      await browser.send('GET', '/admin/analysis', { cookie: session.token }),
    );
    for (const [path, action, fields] of CHANGES) {
      await keep(await changeOn(browser, session, path, action, fields));
    }
    // Refusals too: no assertion, and a code session.
    await keep(
      await browser.send('POST', '/admin/analysis/clear', { cookie: codeToken, form: {} }),
    );
    await keep(
      await browser.send('POST', '/admin/analysis/clear', { cookie: session.token, form: {} }),
    );

    // The page says the key is held, and for which origin: never the key.
    expect(full).toContain('Your key is held for https://models.example');
    for (const html of [readOnly, full]) {
      const inputs = [...html.matchAll(/<input([^>]*)>/g)].map(
        ([, attributes]) => attributes ?? '',
      );
      const names = inputs.map((attributes) => /name="([^"]*)"/.exec(attributes)?.[1]);
      expect(
        names.every(
          (name) =>
            name !== undefined &&
            ['csrf', 'offer', 'on', 'model', 'localModel', 'localUrl'].includes(name),
        ),
        names.join(),
      ).toBe(true);
      expect(inputs.filter((attributes) => /type="password"|key/i.test(attributes))).toEqual([]);
      expect(html).not.toMatch(/<label[^>]*>[^<]*key/i);
      expect(html).not.toMatch(/<textarea/i);
    }
    said.push(...made.instance.lines, JSON.stringify(await analysisLog(made)));
    const everything = said.join('\n');
    for (const marker of [
      secret,
      hostedKey,
      'MARKER-metrics-token-2648',
      'MARKER-tunnel-token-2648',
      made.owner.token,
      session.token,
      codeToken,
      code,
      code.replaceAll('-', ''),
      made.owner.device.publicKey,
    ]) {
      expect(everything, marker).not.toContain(marker);
    }
  });
});
