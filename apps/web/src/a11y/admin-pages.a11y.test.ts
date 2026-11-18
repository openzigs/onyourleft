// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The accessibility gate for the instance's own HTML** (#2645, ADR 0069
 * D-6): every admin page `apps/instance` serves, drawn by the instance's OWN
 * renderers (`apps/instance/src/admin/pages.ts`), parsed into jsdom and held
 * to {@link auditAccessibility}'s rules — the same rules every route of the
 * app is held to — and `/admin/admin.css`'s colour pairs held to
 * `design/contrast.ts`'s thresholds. It is a `.a11y.test.` file, so
 * `pnpm run test:a11y` runs it.
 *
 * ⚠️ **The list of pages is checked against the admin route table**
 * (`admin-routes.ts` §`ADMIN_ROUTES`), not trusted: a page route added there
 * and not here is red. Each later page sub-issue (#2646 onwards) adds its
 * page to {@link PAGES}.
 *
 * `apps/instance` is imported by a computed path, for
 * `testing/operate-instance-testing.ts`'s reason — it is written for Node's
 * type stripping, which `apps/web`'s typecheck does not follow — and a path,
 * not a URL, because under jsdom a URL resolved here is `http:`. The shapes
 * it is used through are written down here.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OperateStatusAnswer } from '@onyourleft/operate-text';
import { beforeAll, describe, expect, it } from 'vitest';

import { AA_LARGE_TEXT_OR_NON_TEXT, AA_TEXT, contrastRatio } from '../design/contrast';
import {
  COLOUR_TOKENS,
  DARK_COLOUR_TOKENS,
  FONT_FAMILY_TOKENS,
  FONT_SIZE_TOKENS,
  SPACE_TOKENS,
} from '../design/tokens';
import {
  SCRIPTED_ANALYSIS,
  SCRIPTED_BACKUPS,
  SCRIPTED_KEYS,
  SCRIPTED_PROBLEMS,
  SCRIPTED_ROOMS,
  SCRIPTED_JOBS,
  SCRIPTED_MODELS,
  SCRIPTED_STATUS,
} from '../instance/testing';
import { auditAccessibility, formatViolations, tabbableElements } from './audit';

interface ShellView {
  readonly name: string | null;
  readonly path: string;
  readonly strength: 'code' | 'passkey';
  readonly listener: 'tunnel' | 'loopback';
  readonly csrf: string;
}

interface LogEntryAnswer {
  readonly id: unknown;
  readonly at: unknown;
  readonly source: unknown;
  readonly action: unknown;
  readonly detail: unknown;
  readonly outcome: unknown;
}

type LogView =
  | {
      readonly kind: 'page';
      readonly entries: readonly LogEntryAnswer[];
      readonly older: string | null;
      readonly newest: boolean;
    }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'bad-cursor' };

interface PasskeyView {
  readonly id: string;
  readonly label: string;
  readonly enrolledAt: number;
  readonly lastUsedAt: number | null;
  readonly rpId: string;
  readonly standing: 'other-owner' | 'other-host' | 'unconfirmed' | 'confirmed';
}

interface PasskeysView {
  readonly passkeys: readonly PasskeyView[];
  readonly rpId: string;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly max: number;
  readonly labelLimit: number;
}

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  shellPage(view: ShellView, heading: string, body: string, script?: boolean): string;
  signInPage(
    name: string | null,
    notice: 'code-refused' | 'passkey-refused' | 'enrolled' | null,
  ): string;
  passkeysBody(view: PasskeysView): string;
  statusBody(status: OperateStatusAnswer | undefined, now: number): string;
  logBody(view: LogView): string;
  analysisBody(view: AnalysisView): string;
  accountsBody(view: AccountsView): string;
  backupsBody(view: BackupsView): string;
  roomsBody(view: RoomsView): string;
  keysBody(view: KeysView): string;
  problemsBody(view: {
    readonly problems:
      | { readonly since: string; readonly lines: readonly { at: string; line: string }[] }
      | undefined;
  }): string;
}

/** `apps/instance` §`admin/pages.ts` §`KeysView` (#2650). */
interface KeysView {
  readonly keys: unknown;
  readonly card: { readonly card: string; readonly fingerprint: string } | null;
  readonly onServer: boolean;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice:
    | { readonly kind: 'rotated'; readonly ok: boolean }
    | { readonly kind: 'busy' }
    | { readonly kind: 'not-rotated' }
    | null;
}

/** `apps/instance` §`admin/pages.ts` §`RoomsView` (#2649). */
interface RoomsView {
  readonly rooms: readonly unknown[] | undefined;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: { readonly ended: boolean } | null;
}

/** `apps/instance` §`admin/pages.ts` §`BackupsView` (#2647), its records as the route answers them. */
interface BackupsView {
  readonly backups:
    { readonly records: readonly unknown[]; readonly pendingSince: string | null } | undefined;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice:
    | { readonly kind: 'asked'; readonly ok: boolean }
    | { readonly kind: 'refused'; readonly sentence: string }
    | { readonly kind: 'not-asked' }
    | null;
  readonly all: boolean;
}

/** `apps/instance` §`admin/pages.ts` §`AccountsView` (#2646). */
interface AccountsView {
  readonly status: OperateStatusAnswer | undefined;
  readonly registrations:
    | readonly {
        readonly athleteId: string;
        readonly displayName: string;
        readonly createdAt: number;
        readonly adultConfirmed: boolean;
      }[]
    | undefined;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: {
    readonly decision: 'approve' | 'refuse';
    readonly ok: boolean;
    readonly problem: 'reason' | 'not-waiting' | null;
  } | null;
  readonly reasonLimit: number;
}

/** `apps/instance` §`admin/pages.ts` §`AnalysisView`, its reads as the routes answer them. */
interface AnalysisView {
  readonly analysis: unknown;
  readonly models: unknown;
  readonly jobs: unknown;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice:
    | { readonly about: 'offers' | 'model' | 'return'; readonly ok: boolean }
    | { readonly about: 'check'; readonly model: string; readonly outcome: string | null }
    | { readonly about: 'address'; readonly ok: boolean; readonly problem: string | null }
    | null;
}

/** `apps/instance` §`admin/admin-routes.ts`, as far as it is used here. */
interface AdminRoutes {
  readonly ADMIN_ROUTES: readonly {
    readonly path: string;
    readonly kind:
      'page' | 'sign-in' | 'sign-in-action' | 'redirect' | 'stylesheet' | 'script' | 'action';
  }[];
}

/** `apps/instance` §`admin/tokens.ts`, as far as it is used here. */
interface AdminTokens {
  readonly ADMIN_COLOURS: Readonly<Record<'light' | 'dark', Readonly<Record<string, string>>>>;
  readonly ADMIN_SPACE: Readonly<Record<string, string>>;
  readonly ADMIN_FONT_SIZE: Readonly<Record<string, string>>;
  readonly ADMIN_FONT_FAMILY: Readonly<Record<string, string>>;
}

/** `apps/instance` §`admin/style.ts`, as far as it is used here. */
interface AdminStyle {
  readonly ADMIN_STYLE: string;
  readonly ADMIN_CONTRAST_PAIRS: readonly {
    readonly where: string;
    readonly foreground: string;
    readonly background: string;
    readonly minimum: 4.5 | 3;
  }[];
}

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '../../../instance/src/admin');

let pages: AdminPages;
let routes: AdminRoutes;
let style: AdminStyle;
let tokens: AdminTokens;

beforeAll(async () => {
  [pages, routes, style, tokens] = (await Promise.all([
    import(/* @vite-ignore */ join(ADMIN, 'pages.ts')),
    import(/* @vite-ignore */ join(ADMIN, 'admin-routes.ts')),
    import(/* @vite-ignore */ join(ADMIN, 'style.ts')),
    import(/* @vite-ignore */ join(ADMIN, 'tokens.ts')),
  ])) as [AdminPages, AdminRoutes, AdminStyle, AdminTokens];
});

const NOW = Date.parse('2026-11-14T21:00:00.000Z');

/** A name that would break the markup if it were not escaped. */
const AWKWARD_NAME = 'Ride <Club> & "friends"';

const shell = (
  path: string,
  name: string | null = null,
  strength: ShellView['strength'] = 'code',
): ShellView => ({
  name,
  path,
  strength,
  listener: 'tunnel',
  csrf: 'a'.repeat(64),
});

const ENTRIES: readonly LogEntryAnswer[] = [
  {
    id: 3,
    at: '2026-11-14T09:30:00.000Z',
    source: 'admin_tunnel',
    action: 'admin_sign_in',
    detail: 'code',
    outcome: 'done',
  },
  // Outside the vocabulary: drawn as "could not be shown".
  {
    id: 2,
    at: '2026-11-14T09:20:00.000Z',
    source: 'cli',
    action: 'migrate',
    detail: 'lat=51507400',
    outcome: 'done',
  },
  {
    id: 1,
    at: '2026-11-14T09:00:00.000Z',
    source: 'cli',
    action: 'migrate',
    detail: 'applied=40',
    outcome: 'done',
  },
];

/** The owner's passkeys in every standing the Passkeys page draws, one with an awkward name. */
const PASSKEYS: readonly PasskeyView[] = [
  {
    id: '0123456789abcdef',
    label: 'Gate <laptop> & "phone"',
    enrolledAt: 1_763_100_000,
    lastUsedAt: 1_763_110_000,
    rpId: 'instance.example',
    standing: 'confirmed',
  },
  {
    id: '1123456789abcdef',
    label: 'Security key',
    enrolledAt: 1_763_100_000,
    lastUsedAt: null,
    rpId: 'instance.example',
    standing: 'unconfirmed',
  },
  {
    id: '2123456789abcdef',
    label: 'Old host',
    enrolledAt: 1_763_000_000,
    lastUsedAt: null,
    rpId: 'old.example',
    standing: 'other-host',
  },
  {
    id: '3123456789abcdef',
    label: 'Old owner',
    enrolledAt: 1_763_000_000,
    lastUsedAt: null,
    rpId: 'instance.example',
    standing: 'other-owner',
  },
];

const passkeysPage = (
  strength: ShellView['strength'],
  passkeys: readonly PasskeyView[],
  name: string | null = null,
): string =>
  pages.shellPage(
    shell('/admin/passkeys', name, strength),
    'Passkeys',
    pages.passkeysBody({
      passkeys,
      rpId: 'instance.example',
      strength,
      csrf: 'a'.repeat(64),
      max: 10,
      labelLimit: 60,
    }),
    true,
  );

/** The pages with a passkey ceremony, which link the one script (and only it). */
const SCRIPTED = new Set([
  '/admin/sign-in',
  '/admin/passkeys',
  '/admin/analysis',
  '/admin/accounts',
  '/admin/backups',
  '/admin/rooms',
  '/admin/keys',
]);

/** The keys' state the Keys page draws (#2650), and the card it draws on the server machine only. */
const KEY_STATE = {
  state: SCRIPTED_KEYS.state,
  current: SCRIPTED_KEYS.current,
  olderHeld: SCRIPTED_KEYS.olderHeld,
};
const CARD = { card: SCRIPTED_KEYS.card ?? '', fingerprint: SCRIPTED_KEYS.fingerprint ?? '' };

/** The Keys page (#2650), in a session of `strength`, through the tunnel unless `over` says otherwise. */
const keysPage = (
  strength: ShellView['strength'],
  over: Partial<KeysView> = {},
  name: string | null = null,
): string =>
  pages.shellPage(
    shell('/admin/keys', name, strength),
    'Keys',
    pages.keysBody({
      keys: KEY_STATE,
      card: null,
      onServer: false,
      strength,
      csrf: 'a'.repeat(64),
      notice: null,
      ...over,
    }),
    true,
  );

/** The Rooms page (#2649), in a session of `strength`, over the scripted rooms. */
const roomsPage = (
  strength: ShellView['strength'],
  over: Partial<RoomsView> = {},
  name: string | null = null,
): string =>
  pages.shellPage(
    shell('/admin/rooms', name, strength),
    'Rooms',
    pages.roomsBody({
      rooms: SCRIPTED_ROOMS,
      strength,
      csrf: 'a'.repeat(64),
      notice: null,
      ...over,
    }),
    true,
  );

/** The scripted records (#2647) with the route's further facts, one with a SHA-256. */
const RECORDS = SCRIPTED_BACKUPS.map((record, index) => ({
  ...record,
  databaseSha256: index === 0 ? 'ab'.repeat(32) : null,
  removed: index === 0 ? 1 : null,
  freeBytes: { backups: 80_000_000_000, offBox: index === 0 ? 900_000_000_000 : null },
}));

/** Thirty records (#2771): more than the page lists until asked for every one. */
const MANY_RECORDS = Array.from({ length: 30 }, (_, index) => ({
  ...RECORDS[index % RECORDS.length]!,
  id: 30 - index,
}));

/** The Backups page (#2647), in a session of `strength`, over the scripted records. */
const backupsPage = (
  strength: ShellView['strength'],
  over: Partial<BackupsView> = {},
  name: string | null = null,
): string =>
  pages.shellPage(
    shell('/admin/backups', name, strength),
    'Backups',
    pages.backupsBody({
      backups: { records: RECORDS, pendingSince: null },
      strength,
      csrf: 'a'.repeat(64),
      notice: null,
      all: false,
      ...over,
    }),
    true,
  );

/** Two riders waiting (#2646), one with a name that would break the markup if it were not escaped. */
const WAITING = [
  {
    athleteId: 'a1b2c3d4e5f6',
    displayName: AWKWARD_NAME,
    createdAt: 1_763_100_000,
    adultConfirmed: true,
  },
  {
    athleteId: 'f6e5d4c3b2a1',
    displayName: 'Sam',
    createdAt: 1_763_110_000,
    adultConfirmed: false,
  },
];

/** The Accounts page (#2646), in a session of `strength`, over the scripted status. */
const accountsPage = (
  strength: ShellView['strength'],
  over: Partial<AccountsView> = {},
  name: string | null = null,
): string =>
  pages.shellPage(
    shell('/admin/accounts', name, strength),
    'Accounts',
    pages.accountsBody({
      status: SCRIPTED_STATUS,
      registrations: WAITING,
      strength,
      csrf: 'a'.repeat(64),
      notice: null,
      reasonLimit: 1000,
      ...over,
    }),
    true,
  );

/** The AI backend page (#2648), in a session of `strength`, over the scripted reads. */
const analysisPage = (
  strength: ShellView['strength'],
  over: Partial<AnalysisView> = {},
  name: string | null = null,
): string =>
  pages.shellPage(
    shell('/admin/analysis', name, strength),
    'AI backend',
    pages.analysisBody({
      analysis: SCRIPTED_ANALYSIS,
      models: SCRIPTED_MODELS,
      jobs: SCRIPTED_JOBS,
      strength,
      csrf: 'a'.repeat(64),
      notice: null,
      ...over,
    }),
    true,
  );

/** A model whose name would break the markup if it were not escaped. */
const AWKWARD_MODELS = {
  ...SCRIPTED_MODELS,
  models: [{ ...SCRIPTED_MODELS.models[0]!, name: 'alpha:"14b" <x> & y' }],
};

/**
 * Every admin page, by its route, in every state it is drawn in. A page
 * sub-issue adds its route here; the derived test below fails until it does.
 */
const PAGES: Readonly<Record<string, readonly (readonly [string, () => string])[]>> = {
  '/admin/sign-in': [
    ['the form', () => pages.signInPage(null, null)],
    ['a code refused, an awkward name', () => pages.signInPage(AWKWARD_NAME, 'code-refused')],
    ['a passkey refused', () => pages.signInPage(null, 'passkey-refused')],
    ['a passkey just added', () => pages.signInPage(null, 'enrolled')],
  ],
  '/admin/passkeys': [
    ['a code session, none yet', () => passkeysPage('code', [])],
    ['a code session, every standing', () => passkeysPage('code', PASSKEYS, AWKWARD_NAME)],
    [
      'a code session, full',
      () =>
        passkeysPage(
          'code',
          Array.from({ length: 10 }, (_, index) => ({
            ...PASSKEYS[1]!,
            id: `${String(index)}`.padStart(16, '0'),
          })),
        ),
    ],
    ['a passkey session, every standing', () => passkeysPage('passkey', PASSKEYS)],
  ],
  '/admin/status': [
    [
      'the rows',
      () =>
        pages.shellPage(shell('/admin/status'), 'Status', pages.statusBody(SCRIPTED_STATUS, NOW)),
    ],
    [
      'not ready, an awkward name',
      () =>
        pages.shellPage(
          shell('/admin/status', AWKWARD_NAME),
          'Status',
          pages.statusBody({ ...SCRIPTED_STATUS, ready: false, commit: null }, NOW),
        ),
    ],
    [
      'unreadable',
      () => pages.shellPage(shell('/admin/status'), 'Status', pages.statusBody(undefined, NOW)),
    ],
  ],
  '/admin/accounts': [
    ['a code session: reads only', () => accountsPage('code')],
    [
      'a passkey session: a decision for each rider, an awkward name',
      () => accountsPage('passkey', {}, AWKWARD_NAME),
    ],
    [
      'approved, nobody left waiting',
      () =>
        accountsPage('passkey', {
          registrations: [],
          notice: { decision: 'approve', ok: true, problem: null },
        }),
    ],
    [
      'a refusal with no reason',
      () =>
        accountsPage('passkey', { notice: { decision: 'refuse', ok: false, problem: 'reason' } }),
    ],
    [
      'nothing readable',
      () => accountsPage('passkey', { status: undefined, registrations: undefined }),
    ],
    [
      'the invite mode, the queue unreadable',
      () =>
        accountsPage('code', {
          status: { ...SCRIPTED_STATUS, registration: 'invite' },
          registrations: undefined,
        }),
    ],
  ],
  '/admin/backups': [
    ['a code session: reads only', () => backupsPage('code')],
    [
      'a passkey session: back up now, an awkward name',
      () => backupsPage('passkey', {}, AWKWARD_NAME),
    ],
    [
      'a request waiting',
      () =>
        backupsPage('passkey', {
          backups: { records: RECORDS, pendingSince: '2026-11-14T21:00:00.000Z' },
          notice: { kind: 'asked', ok: true },
        }),
    ],
    [
      'a second press refused',
      () =>
        backupsPage('passkey', {
          notice: { kind: 'refused', sentence: 'A backup is already waiting.' },
        }),
    ],
    [
      'nothing recorded yet',
      () => backupsPage('passkey', { backups: { records: [], pendingSince: null } }),
    ],
    ['unreadable', () => backupsPage('passkey', { backups: undefined })],
    [
      'more than 20: the newest, and a link to the rest (#2771)',
      () => backupsPage('passkey', { backups: { records: MANY_RECORDS, pendingSince: null } }),
    ],
    [
      'more than 20: every one (#2771)',
      () =>
        backupsPage('code', { backups: { records: MANY_RECORDS, pendingSince: null }, all: true }),
    ],
  ],
  '/admin/rooms': [
    ['a code session: reads only', () => roomsPage('code')],
    [
      'a passkey session: End room for each, an awkward name',
      () =>
        roomsPage(
          'passkey',
          { rooms: [{ ...SCRIPTED_ROOMS[0]!, host: AWKWARD_NAME, riders: [AWKWARD_NAME] }] },
          AWKWARD_NAME,
        ),
    ],
    ['ended', () => roomsPage('passkey', { notice: { ended: true } })],
    ['not ended', () => roomsPage('passkey', { notice: { ended: false } })],
    ['no room open', () => roomsPage('passkey', { rooms: [] })],
    ['unreadable', () => roomsPage('passkey', { rooms: undefined })],
  ],
  '/admin/keys': [
    ['through the tunnel, a code session', () => keysPage('code')],
    [
      'through the tunnel, a passkey session, an awkward name',
      () => keysPage('passkey', {}, AWKWARD_NAME),
    ],
    ['on the server machine: the card', () => keysPage('passkey', { card: CARD, onServer: true })],
    ['rotated', () => keysPage('passkey', { notice: { kind: 'rotated', ok: true } })],
    ['busy', () => keysPage('passkey', { notice: { kind: 'busy' } })],
    [
      'no keys yet',
      () => keysPage('passkey', { keys: { state: 'no-keys', current: null, olderHeld: 0 } }),
    ],
    ['unreadable', () => keysPage('passkey', { keys: undefined })],
  ],
  '/admin/problems': [
    [
      'three lines, one holding markup',
      () =>
        pages.shellPage(
          shell('/admin/problems'),
          'Recent problems',
          pages.problemsBody({
            problems: {
              since: '2026-11-14T08:00:00.000Z',
              lines: [
                ...SCRIPTED_PROBLEMS.map(({ at, line }) => ({ at, line })),
                {
                  at: '2026-11-14T21:00:00.000Z',
                  line: '{"event":"request","route":"/v1/<script>x</script>","status":500}',
                },
              ],
            },
          }),
        ),
    ],
    [
      'none since the start, an awkward name',
      () =>
        pages.shellPage(
          shell('/admin/problems', AWKWARD_NAME),
          'Recent problems',
          pages.problemsBody({ problems: { since: '2026-11-14T08:00:00.000Z', lines: [] } }),
        ),
    ],
    [
      'unreadable',
      () =>
        pages.shellPage(
          shell('/admin/problems'),
          'Recent problems',
          pages.problemsBody({ problems: undefined }),
        ),
    ],
  ],
  '/admin/analysis': [
    ['a code session: reads only', () => analysisPage('code')],
    ['a passkey session: every form', () => analysisPage('passkey')],
    [
      'a model checked and calling tools, an awkward name',
      () =>
        analysisPage(
          'passkey',
          {
            models: AWKWARD_MODELS,
            notice: { about: 'check', model: 'alpha:"14b" <x> & y', outcome: 'tools-ok' },
          },
          AWKWARD_NAME,
        ),
    ],
    [
      'a check that failed',
      () =>
        analysisPage('passkey', {
          notice: { about: 'check', model: 'beta:32b', outcome: 'no-tool-call' },
        }),
    ],
    [
      'an address refused',
      () =>
        analysisPage('passkey', {
          notice: { about: 'address', ok: false, problem: 'not-local' },
        }),
    ],
    [
      'switches saved, the server unreachable, no jobs',
      () =>
        analysisPage('passkey', {
          notice: { about: 'offers', ok: true },
          models: { state: 'unreachable', version: null, models: [] },
          jobs: { ...SCRIPTED_JOBS, recent: [] },
        }),
    ],
    [
      'nothing readable',
      () => analysisPage('passkey', { analysis: undefined, models: undefined, jobs: undefined }),
    ],
    [
      'the models and jobs unreadable, returned to .env',
      () =>
        analysisPage('passkey', {
          models: undefined,
          jobs: undefined,
          notice: { about: 'return', ok: true },
        }),
    ],
  ],
  '/admin/log': [
    [
      'a page with older',
      () =>
        pages.shellPage(
          shell('/admin/log'),
          'Operator log',
          pages.logBody({ kind: 'page', entries: ENTRIES, older: 'AAAA', newest: true }),
        ),
    ],
    [
      'an older page, the oldest',
      () =>
        pages.shellPage(
          shell('/admin/log'),
          'Operator log',
          pages.logBody({ kind: 'page', entries: ENTRIES, older: null, newest: false }),
        ),
    ],
    [
      'empty',
      () =>
        pages.shellPage(
          shell('/admin/log'),
          'Operator log',
          pages.logBody({ kind: 'page', entries: [], older: null, newest: true }),
        ),
    ],
    [
      'unreadable',
      () =>
        pages.shellPage(shell('/admin/log'), 'Operator log', pages.logBody({ kind: 'unreadable' })),
    ],
    [
      'a cursor refused',
      () =>
        pages.shellPage(shell('/admin/log'), 'Operator log', pages.logBody({ kind: 'bad-cursor' })),
    ],
  ],
};

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('the list of admin pages is the admin route table’s (#2645)', () => {
  it('audits every page and sign-in route of ADMIN_ROUTES, and nothing that is not one', () => {
    const served = routes.ADMIN_ROUTES.filter(
      (route) => route.kind === 'page' || route.kind === 'sign-in',
    ).map((route) => route.path);
    expect(Object.keys(PAGES).sort()).toEqual([...served].sort());
  });
});

describe.each(Object.entries(PAGES))('the admin page %s (#2645)', (path, states) => {
  it.each(states)('%s: no accessibility violation', (_state, render) => {
    const violations = auditAccessibility(parse(render()));
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it.each(states)('%s: one h1, a main, no inline script or style', (_state, render) => {
    const html = render();
    const doc = parse(html);
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    expect(doc.documentElement.lang).toBe('en');
    expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=/i);
    // The one script, linked on a page with a passkey ceremony and empty; no other.
    const scripts = [...doc.querySelectorAll('script')].map((each) => [
      each.getAttribute('src'),
      each.textContent,
    ]);
    expect(scripts).toEqual(SCRIPTED.has(path) ? [['/admin/passkey.js', '']] : []);
    expect(doc.querySelector('link[rel=stylesheet]')?.getAttribute('href')).toBe(
      '/admin/admin.css',
    );
    expect(doc.body.textContent).not.toContain('<Club>&');
  });

  if (path !== '/admin/sign-in') {
    it.each(states)(
      '%s: by keyboard, the skip link first, then the section links and Sign out',
      (_state, render) => {
        const doc = parse(render());
        const tabbable = tabbableElements(doc);
        const [skip] = tabbable;
        expect(skip?.textContent).toBe('Skip to the page');
        expect(skip?.getAttribute('href')).toBe('#main');
        expect(doc.getElementById('main')?.tagName).toBe('MAIN');
        expect(doc.querySelector('header nav[aria-label]')).not.toBeNull();
        const current = doc.querySelector('nav a[aria-current="page"]');
        expect(current?.getAttribute('href')).toBe(path);
        expect(tabbable.map((each) => each.textContent)).toContain('Sign out');
        // Every link the shell draws is to a page the route table serves.
        for (const link of doc.querySelectorAll('nav a')) {
          expect(Object.keys(PAGES)).toContain(link.getAttribute('href'));
        }
      },
    );
  }
});

describe('the Backups page’s Details disclosures (#2771)', () => {
  it('each row’s summary is a tab stop named Details, its facts closed inside it', () => {
    const doc = parse(backupsPage('passkey'));
    const summaries = [...doc.querySelectorAll('tbody tr details > summary')];
    expect(summaries).toHaveLength(RECORDS.length);
    const tabbable = tabbableElements(doc);
    for (const summary of summaries) {
      expect(tabbable).toContain(summary);
      expect(summary.textContent).toBe('Details');
      expect(summary.parentElement?.hasAttribute('open')).toBe(false);
      expect(summary.parentElement?.querySelector('dl')).not.toBeNull();
    }
    // Nothing inside a closed disclosure is reachable before it is opened.
    for (const element of tabbable) {
      expect(element.closest('details') === null || element.tagName === 'SUMMARY').toBe(true);
    }
  });
});

describe('/admin/admin.css draws the app’s own tokens (#2771, ADR 0063)', () => {
  it('every colour it mirrors is the app’s, in both themes', () => {
    const app = { light: COLOUR_TOKENS, dark: DARK_COLOUR_TOKENS } as const;
    for (const theme of ['light', 'dark'] as const) {
      const mirrored = tokens.ADMIN_COLOURS[theme];
      expect(Object.keys(mirrored).length).toBeGreaterThan(20);
      for (const [name, value] of Object.entries(mirrored)) {
        expect(value, `${theme} ${name}`).toBe((app[theme] as Record<string, string>)[name]);
      }
    }
  });

  it('its spacing, type steps and faces are the app’s', () => {
    expect(tokens.ADMIN_SPACE).toEqual(SPACE_TOKENS);
    for (const [step, value] of Object.entries(tokens.ADMIN_FONT_SIZE)) {
      expect(value, step).toBe((FONT_SIZE_TOKENS as Record<string, string>)[step]);
    }
    expect(tokens.ADMIN_FONT_FAMILY).toEqual(FONT_FAMILY_TOKENS);
  });
});

describe('/admin/admin.css meets WCAG 2.2 AA in both schemes (#2645)', () => {
  it('every declared pair clears its threshold', () => {
    expect(style.ADMIN_CONTRAST_PAIRS.length).toBeGreaterThan(10);
    for (const pair of style.ADMIN_CONTRAST_PAIRS) {
      const minimum = pair.minimum === 4.5 ? AA_TEXT : AA_LARGE_TEXT_OR_NON_TEXT;
      const ratio = contrastRatio(pair.foreground, pair.background);
      expect(
        Number(ratio.toFixed(2)),
        `${pair.where}: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('names no colour the pairs do not hold', () => {
    const named = new Set(
      style.ADMIN_CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]),
    );
    const used = [...style.ADMIN_STYLE.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(([hex]) => {
      const lower = hex.toLowerCase();
      return lower.length === 4
        ? `#${[...lower.slice(1)].map((digit) => digit + digit).join('')}`
        : lower;
    });
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((colour) => !named.has(colour))).toEqual([]);
  });
});
