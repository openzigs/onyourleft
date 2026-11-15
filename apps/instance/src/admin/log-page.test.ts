// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin operator log page (#2645, ADR 0069 D-2), driven through the REAL
 * handler over a real SQLite file, its entries written the way a real writer
 * writes them (`SqlStore.recordOperatorAction`, on a second connection) and
 * every page held to what `GET /v1/operate/log` answers the owner's sealed
 * request.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { adminRequest, signInWith } from './admin-testing.ts';
import { LOG_ENTRY_NOT_SHOWN_TEXT } from './pages.ts';

let worlds: ModerationWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
});

async function world(routes?: readonly Route[]): Promise<ModerationWorld> {
  const made = await startModerationWorld({
    admin: {},
    ...(routes === undefined ? {} : { routes }),
  });
  worlds.push(made);
  return made;
}

async function signedIn(made: ModerationWorld): Promise<string> {
  const { code } = await adminCode(
    { database: made.path, blobs: `${made.path}.blobs` },
    () => new Date(made.clock.ms),
  );
  return signInWith(made.instance.handler, code);
}

/** `count` `migrate` entries, each with its own `applied=` count, from 1 up: the newest has the largest. */
async function seedMigrations(made: ModerationWorld, count: number): Promise<void> {
  await made.freshRead(async (store) => {
    for (let applied = 1; applied <= count; applied += 1) {
      await store.recordOperatorAction(
        { actor: { source: 'cli' }, action: 'migrate', at: Math.floor(made.clock.ms / 1000) },
        () => ({ outcome: 'done', detail: `applied=${String(applied)}`, value: undefined }),
      );
    }
  });
}

async function logPage(made: ModerationWorld, token: string, path: string): Promise<string> {
  const answer = await made.instance.handler(adminRequest('GET', path, { cookie: token }));
  expect(answer.status).toBe(200);
  return answer.text();
}

const itemsOf = (page: string): string[] =>
  [...page.matchAll(/<li>(.*?)<\/li>/g)]
    .map((match) => match[1] ?? '')
    .filter(
      // The shell's section links are list items too.
      (item) => !item.startsWith('<a href='),
    );

const olderOf = (page: string): string | undefined =>
  /<a href="(\/admin\/log\?cursor=[^"]+)">Older entries<\/a>/.exec(page)?.[1];

interface Entry {
  readonly id: number;
  readonly action: string;
  readonly detail: string | null;
}

describe('the operator log, a page at a time, newest first (#2645)', () => {
  it('shows 120 entries as pages of 50, 50 and 20 through “older”, each once, in the route’s order', async () => {
    const made = await world();
    const token = await signedIn(made);
    // The mint and the sign-in are two entries; 118 more make 120.
    await seedMigrations(made, 118);
    const everything = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
    const entries = (everything.body as { entries: Entry[] }).entries;
    expect(entries).toHaveLength(120);

    const pages: string[][] = [];
    let path: string | undefined = '/admin/log';
    while (path !== undefined) {
      const page = await logPage(made, token, path);
      pages.push(itemsOf(page));
      if (pages.length > 1) expect(page).toContain('<a href="/admin/log">Newest entries</a>');
      path = olderOf(page);
      expect(pages.length).toBeLessThanOrEqual(3);
    }
    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    const shown = pages.flat();
    // Newest first, each once: the route's own order, entry for entry.
    expect(shown.map((item) => /\(<code>(.*?)<\/code>\)/.exec(item)?.[1] ?? null)).toEqual(
      entries.map((entry) => entry.detail),
    );
    expect(shown[0]).toContain('<strong>Database migrated</strong>');
    expect(shown[0]).toContain('(<code>applied=118</code>)');
    expect(shown[1]).toContain('(<code>applied=117</code>)');
    expect(shown[0]).toContain('from the command line on the host: done');
    expect(shown.at(-2)).toContain('<strong>Signed in to the admin pages</strong>');
    expect(shown.at(-2)).toContain(
      'from the admin pages, through the tunnel: done (<code>code</code>)',
    );
    expect(shown.at(-1)).toContain('<strong>Admin sign-in code made</strong>');
    expect(new Set(shown).size).toBe(120);
  });

  it('says so when nothing older is there, and when the cursor is not one this instance wrote', async () => {
    const made = await world();
    const token = await signedIn(made);
    const first = await logPage(made, token, '/admin/log');
    expect(itemsOf(first)).toHaveLength(2);
    expect(olderOf(first)).toBeUndefined();
    expect(first).toContain('These are the oldest entries.');
    for (const cursor of ['AAAAAAAA', '%3Cscript%3E', 'x'.repeat(129)]) {
      const page = await logPage(made, token, `/admin/log?cursor=${cursor}`);
      expect(page, cursor).toContain('That page of the log could not be read');
      expect(page).not.toContain('<script');
      expect(itemsOf(page)).toEqual([]);
    }
  });
});

describe('an entry outside the log’s closed vocabulary is not shown (#2645, OPERATOR_DETAILS)', () => {
  /** The log route, with one entry's detail replaced by `detail`. */
  const withDetail = (detail: unknown, action = 'migrate'): readonly Route[] =>
    ROUTES.map((route) =>
      route.path === '/v1/operate/log' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context) => {
              const real = (await (await route.handle(context)).json()) as {
                entries: Entry[];
                cursor: string | null;
              };
              return json({
                ...real,
                entries: real.entries.map((entry, index) =>
                  index === 0 ? { ...entry, action, detail } : entry,
                ),
              });
            },
          }
        : route,
    );

  it.each([
    ['a coordinate', 'lat=51507400'],
    ['free text', 'password hunter2'],
    ['a word another action writes', 'voided_unused'],
    ['a count the action does not name', 'blobs=3'],
    ['not a string', 42],
  ] as const)(
    '%s: the row says it could not be shown, and shows nothing of it',
    async (_name, detail) => {
      const made = await world(withDetail(detail));
      const token = await signedIn(made);
      await seedMigrations(made, 1);
      const items = itemsOf(await logPage(made, token, '/admin/log'));
      expect(items).toHaveLength(3);
      expect(items[0]).toBe(LOG_ENTRY_NOT_SHOWN_TEXT);
      expect(items[0]).not.toContain(String(detail));
      // The rest of the page is drawn as ever.
      expect(items[1]).toContain('<strong>Signed in to the admin pages</strong>');
    },
  );

  it('the control: the same entry with a detail its action writes is shown', async () => {
    const made = await world(withDetail('applied=7'));
    const token = await signedIn(made);
    await seedMigrations(made, 1);
    const items = itemsOf(await logPage(made, token, '/admin/log'));
    expect(items[0]).toContain('<strong>Database migrated</strong>');
    expect(items[0]).toContain('(<code>applied=7</code>)');
  });

  it('an action this build does not know is not shown either', async () => {
    const made = await world(withDetail(null, 'drop_tables'));
    const token = await signedIn(made);
    await seedMigrations(made, 1);
    const items = itemsOf(await logPage(made, token, '/admin/log'));
    expect(items[0]).toBe(LOG_ENTRY_NOT_SHOWN_TEXT);
  });
});

describe('what the admin layer forwards, and what a failed read says (#2645, ADR 0069 D-2)', () => {
  /** The log route, wrapped: every query it is asked, a status to answer in place of its own after the first, an entry altered. */
  function spied(
    options: { readonly status?: number; readonly entry?: Record<string, unknown> } = {},
  ): { routes: readonly Route[]; queries: string[] } {
    const queries: string[] = [];
    const routes = ROUTES.map((route) =>
      route.path === '/v1/operate/log' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context: Parameters<Route['handle']>[0]) => {
              queries.push(new URL(context.request.url).search);
              const real = await route.handle(context);
              if (options.status !== undefined && queries.length > 1) {
                return new Response('{}', { status: options.status });
              }
              if (options.entry === undefined) return real;
              const body = (await real.json()) as { entries: Record<string, unknown>[] };
              return json({
                ...body,
                entries: body.entries.map((entry, index) =>
                  index === 0 ? { ...entry, ...options.entry } : entry,
                ),
              });
            },
          }
        : route,
    );
    return { routes, queries };
  }

  it('never lets a cursor of the wrong shape reach the route; a well-formed one goes through', async () => {
    const spy = spied();
    const made = await world(spy.routes);
    const token = await signedIn(made);
    const before = spy.queries.length;
    for (const cursor of ['a%20b', 'a.b', 'x'.repeat(129)]) {
      await logPage(made, token, `/admin/log?cursor=${cursor}`);
    }
    expect(spy.queries.length).toBe(before);
    await logPage(made, token, '/admin/log?cursor=AAAAAAAA');
    expect(spy.queries.slice(before)).toEqual(['?limit=50&cursor=AAAAAAAA']);
  });

  it('says the log could not be read, not that the cursor is wrong, when a valid older page fails', async () => {
    const spy = spied({ status: 503 });
    const made = await world(spy.routes);
    const token = await signedIn(made);
    await seedMigrations(made, 60);
    const first = await logPage(made, token, '/admin/log');
    const older = olderOf(first) as string;
    const page = await logPage(made, token, older);
    expect(page).toContain('could not be read from the instance');
    expect(page).not.toContain('does not name a page');
  });

  it.each([
    ['a source outside the vocabulary', { source: 'telepathy' }],
    ['an outcome outside the vocabulary', { outcome: 'maybe' }],
    ['a moment that is not an ISO 8601 UTC one', { at: '2026-01-01' }],
  ] as const)('%s: the row says it could not be shown', async (_name, entry) => {
    const made = await world(spied({ entry }).routes);
    const token = await signedIn(made);
    await seedMigrations(made, 1);
    const items = itemsOf(await logPage(made, token, '/admin/log'));
    expect(items[0]).toBe(LOG_ENTRY_NOT_SHOWN_TEXT);
  });
});
