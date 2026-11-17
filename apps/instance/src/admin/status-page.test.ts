// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin Status page (#2645, ADR 0069 D-2, D-7), driven through the REAL
 * handler over a real SQLite file. What the page shows is held to what
 * `GET /v1/operate/status` answers the owner's SEALED request in the same
 * test, and a route whose answer is changed is followed by the page while
 * the store says otherwise — so a page that read the store, or a stale copy,
 * is red here.
 */

import { statusRows, type OperateStatusAnswer } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { errorResponse } from '../errors.ts';
import { adminCode } from '../operator/commands.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { adminRequest, signInWith } from './admin-testing.ts';

let worlds: ModerationWorld[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
});

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** One disk, fixed, so the route and the page read the same figure. */
const DISK = [
  {
    holds: 'database_and_blobs',
    freeBytes: 20_000_000_000,
    totalBytes: 500_000_000_000,
    low: true,
  },
] as const;

type Options = NonNullable<Parameters<typeof startModerationWorld>[0]>;

async function world(options: Options = {}): Promise<ModerationWorld> {
  const made = await startModerationWorld({
    admin: {},
    registration: 'approval',
    operateStatus: {
      disk: () => Promise.resolve(DISK),
      tunnel: () => Promise.resolve({ state: 'ready', connections: 4 }),
    },
    ...options,
    config: { commit: COMMIT, ...options.config },
  });
  worlds.push(made);
  return made;
}

/** A session, through `operator admin-code` and the real sign-in. */
async function signedIn(made: ModerationWorld): Promise<string> {
  const { code } = await adminCode(
    { database: made.path, blobs: `${made.path}.blobs` },
    () => new Date(made.clock.ms),
  );
  return signInWith(made.instance.handler, code);
}

async function statusPage(made: ModerationWorld, token: string): Promise<string> {
  const answer = await made.instance.handler(
    adminRequest('GET', '/admin/status', { cookie: token }),
  );
  expect(answer.status).toBe(200);
  return answer.text();
}

/** The status route's answer to the owner's sealed request. */
async function routeAnswer(made: ModerationWorld): Promise<OperateStatusAnswer> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/status');
  expect(read.status).toBe(200);
  return read.body as OperateStatusAnswer;
}

const unescape = (html: string): string =>
  html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

/** Every fact the page draws, read back out of its markup. */
function factsOf(page: string) {
  return [...page.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((match) => {
    const dd = match[2] ?? '';
    const warning = /<p class="warning"><strong>(.*?):<\/strong> (.*?)<\/p>$/.exec(dd);
    const value = warning === null ? dd : dd.slice(0, warning.index);
    const code = /^<code>(.*)<\/code>$/.exec(value);
    return {
      label: unescape(match[1] ?? ''),
      value: unescape(code === null ? value : (code[1] ?? '')),
      code: code !== null,
      warning:
        warning === null
          ? null
          : { label: unescape(warning[1] ?? ''), text: unescape(warning[2] ?? '') },
    };
  });
}

async function seed(made: ModerationWorld): Promise<void> {
  // Two riders awaiting approval: the instance requires it.
  await made.rider('Pending one');
  await made.rider('Pending two');
  await made.freshRead((store) =>
    store.recordBackup({
      outcome: 'done',
      at: Math.floor(made.clock.ms / 1000) - 3600,
      snapshot: 'snapshot-2026-09-21T00-00-00-000Z',
      rows: 12,
      blobs: 2,
      databaseSha256: 'e'.repeat(64),
      sizeBytes: 4096,
      offBox: 'copied',
      removed: 0,
      backupsFreeBytes: 1_000_000,
      offBoxFreeBytes: null,
      intervalSeconds: 21_600,
    }),
  );
}

describe('the Status page is the status route’s answer, read through the seam (#2645)', () => {
  it('shows exactly the rows of what GET /v1/operate/status answers the owner, seeded values included', async () => {
    const made = await world();
    await seed(made);
    const token = await signedIn(made);
    const page = await statusPage(made, token);
    const answer = await routeAnswer(made);

    // The seeds are in the route's answer, so the comparison below means something.
    expect(answer.counts.athletes.pending).toBe(2);
    expect(answer.commit).toBe(COMMIT);
    expect(answer.lastBackup).not.toBeNull();

    const facts = factsOf(page);
    expect(facts).toEqual(statusRows(answer, made.clock.ms));
    expect(facts.length).toBeGreaterThan(10);
    expect(facts).toContainEqual({
      label: 'Accounts',
      value: '2 active, 2 awaiting approval, 0 suspended',
      code: false,
      warning: null,
    });
    expect(facts).toContainEqual({
      label: 'Deployed commit',
      value: COMMIT,
      code: true,
      warning: null,
    });
    expect(facts.find((fact) => fact.label === 'Last backup')?.value).toMatch(
      /^2026-09-2\d \d\d:\d\d UTC, 1 hour ago; its off-box copy succeeded\.$/,
    );
    expect(facts.find((fact) => fact.label.startsWith('Disk'))?.warning?.label).toBe('Low');
    // No probes in this world: the route says not ready, and so does the page.
    expect(answer.ready).toBe(false);
    expect(page).toContain('<strong>Not ready:</strong> The instance is up but not ready');
  });

  it('follows the route when the route and the store disagree — the control that the page never reads the store', async () => {
    const wrapped: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/status' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context) => {
              const real = (await (await route.handle(context)).json()) as OperateStatusAnswer;
              return json({
                ...real,
                counts: { ...real.counts, athletes: { ...real.counts.athletes, pending: 41 } },
              });
            },
          }
        : route,
    );
    const made = await world({ routes: wrapped });
    await seed(made);
    const token = await signedIn(made);
    const page = await statusPage(made, token);
    const answer = await routeAnswer(made);
    expect(answer.counts.athletes.pending).toBe(41);
    // The store holds two; the page says what the route said.
    const pending = await made.freshRead(
      async (store) => (await store.operateCounts()).athletes.pending,
    );
    expect(pending).toBe(2);
    expect(factsOf(page)).toEqual(statusRows(answer, made.clock.ms));
    expect(page).toContain('41 awaiting approval');
  });

  it('says the status could not be read when the route answers no status, and draws no row', async () => {
    const failing: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/status' && route.method === 'GET'
        ? { ...route, handle: () => errorResponse('unavailable') }
        : route,
    );
    const made = await world({ routes: failing });
    const token = await signedIn(made);
    const page = await statusPage(made, token);
    expect(page).toContain('The instance’s status could not be read, so it is not shown here.');
    expect(factsOf(page)).toEqual([]);
  });
});

describe('the compare link, and no request out (#2645, #2601’s decision 3)', () => {
  const LINK = `https://github.com/openzigs/onyourleft/compare/${COMMIT}...main`;

  it('draws the link for a 40-hex commit of this repository’s source, with fetch stubbed to fail and never called', async () => {
    const made = await world();
    const token = await signedIn(made);
    const fetch = vi.fn(() => Promise.reject(new Error('the instance reached for the network')));
    vi.stubGlobal('fetch', fetch);
    const page = await statusPage(made, token);
    vi.unstubAllGlobals();
    expect(page).toContain(`<a href="${LINK}" rel="noreferrer">Compare with main</a>`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a fork’s source', { sourceUrl: 'https://example.org/someone/fork' }],
    ['a commit that is not 40 hex', { commit: '0123456' }],
    ['no commit', { commit: null }],
  ] as const)('draws no link for %s', async (_name, config) => {
    const made = await world({ config });
    const token = await signedIn(made);
    const page = await statusPage(made, token);
    expect(page).not.toContain('/compare/');
    expect(page).not.toContain('Compare with main');
  });
});
