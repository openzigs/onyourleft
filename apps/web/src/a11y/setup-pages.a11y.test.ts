// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The accessibility gate for the instance's first-run setup pages** (#2784,
 * ADR 0080 D-1, D-7): every page `apps/instance/src/setup/setup.ts` serves on
 * the loopback listener, drawn by the instance's OWN renderers
 * (`setup/pages.ts`) in each state it can be in, parsed into jsdom and held to
 * {@link auditAccessibility}'s rules — the rules every route of the app is
 * held to. It is a `.a11y.test.` file, so `pnpm run test:a11y` runs it.
 *
 * ⚠️ **The list of pages is checked against the setup route table**
 * (`setup-routes.ts` §`SETUP_ROUTES`), not trusted: a page added there and
 * not here is red. Every step is keyboard-operable — plain links, buttons
 * and a radio group, with no script at all — and every QR has its text
 * alternative beside it.
 *
 * `apps/instance` is imported by a computed path, for
 * `admin-pages.a11y.test.ts`'s reason; the shapes it is used through are
 * written down here.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { SCRIPTED_KEYS } from '../instance/testing';
import { codeWithCard, readCodeWithCard } from '../instance/instance-pin';
import { accessibleName, auditAccessibility, formatViolations, tabbableElements } from './audit';

type Step =
  | 'claim'
  | 'tailnet'
  | 'passkey'
  | 'secrets'
  | 'backups'
  | 'registration'
  | 'invite'
  | 'ai'
  | 'finish';

interface Frame {
  readonly name: string | null;
  readonly step: Step;
  readonly reached: Step;
  readonly csrf: string;
}

/** `apps/instance` §`setup/pages.ts`, as far as it is used here. */
interface SetupPages {
  lockedPage(name: string | null, notice: 'code-refused' | 'too-many' | null): string;
  wrongAddressPage(address: string): string;
  formRefusedPage(): string;
  messagePage(heading: string, text: string): string;
  exampleAddressPage(name: string | null): string;
  finishedPage(name: string | null): string;
  stepPage(frame: Frame, body: string, options: { readonly next: boolean }): string;
  claimBody(view: unknown, csrf: string): string;
  tailnetBody(view: unknown): string;
  passkeyBody(adminAddress: string): string;
  secretsBody(view: 'offer' | 'taken' | 'none', csrf: string): string;
  backupsBody(view: unknown, csrf: string): string;
  registrationBody(view: unknown, csrf: string): string;
  inviteBody(view: unknown, csrf: string): string;
  aiBody(view: unknown, csrf: string): string;
  finishBody(summary: unknown, csrf: string): string;
  readonly FINISHED_PAGE_STYLE: string;
}

/** `apps/instance` §`setup/setup-routes.ts`, as far as it is used here. */
interface SetupRoutes {
  readonly SETUP_ROUTES: readonly {
    readonly path: string;
    readonly kind: 'locked' | 'sign-in' | 'page' | 'action' | 'stylesheet';
    readonly step?: Step;
  }[];
}

/** `apps/instance` §`admin/pages.ts`'s QR words, as far as they are used here. */
interface AdminPages {
  readonly CARD_CODE_TEXT: Readonly<Record<'claim' | 'invite', { readonly label: string }>>;
}

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '../../../instance/src/setup');
const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '../../../instance/src/admin');

let pages: SetupPages;
let routes: SetupRoutes;
let admin: AdminPages;

beforeAll(async () => {
  [pages, routes, admin] = (await Promise.all([
    import(/* @vite-ignore */ join(SETUP, 'pages.ts')),
    import(/* @vite-ignore */ join(SETUP, 'setup-routes.ts')),
    import(/* @vite-ignore */ join(ADMIN, 'pages.ts')),
  ])) as [SetupPages, SetupRoutes, AdminPages];
});

/** A name that would break the markup if it were not escaped. */
const AWKWARD_NAME = 'Ride <Club> & "friends"';
const CSRF = 'a'.repeat(64);
const CARD = SCRIPTED_KEYS.card ?? '';
const CODE = 'k7mq-x3ra-p9tz-wc4e';

const frame = (step: Step, reached: Step = 'finish', name: string | null = null): Frame => ({
  name,
  step,
  reached,
  csrf: CSRF,
});

const step =
  (step: Step, body: () => string, next = true, reached: Step = 'finish') =>
  () =>
    pages.stepPage(frame(step, reached, AWKWARD_NAME), body(), { next });

/** Where the tablet reaches the server and what it needs first (#2855), on each path. */
const ORIGIN = 'https://onyourleft.tail1a2b.ts.net';
const reach = (
  path: 'tailnet' | 'internet' = 'tailnet',
  checked: 'connected' | 'not-connected' | null = null,
) => ({ origin: ORIGIN, path, checked });

const record = (offBox: string | null, outcome = 'done', beforeClaim = false) => ({
  at: '2026-11-18T09:00:00.000Z',
  secondsAgo: 14 * 60,
  outcome,
  offBox,
  beforeClaim,
});

/** A model as the AI step lists it (#2792): what Ollama reports, by `analysis/local-server.ts`. */
const model = (name: string, gpu: string, tools = 'listed', gpuPercent: number | null = null) => ({
  name,
  sizeBytes: 9_000_000_000,
  parameters: '14.8B',
  quantisation: 'Q4_K_M',
  tools,
  gpu,
  gpuPercent,
});

const LISTED = [
  model('alpha:14b', 'all'),
  model('beta:32b', 'part', 'listed', 62),
  model('gamma:26b', 'not-loaded', 'not-listed'),
  model('delta:8b', 'none', 'not-reported'),
  model('epsilon:4b', 'not-reported'),
];

/** The tailnet step's view (#2817): a Tailscale address on the tailnet path, unless a state says. */
const TAILNET_ORIGIN = 'https://onyourleft.tail1a2b.ts.net';
const tailnet = (view: Record<string, unknown>) => ({
  path: 'tailnet',
  origin: TAILNET_ORIGIN,
  tailscaleName: true,
  keys: 'ready',
  ...view,
});

const ai = (view: Record<string, unknown>) =>
  step('ai', () =>
    pages.aiBody(
      { model: null, server: null, pull: { kind: 'idle' }, notice: null, ...view },
      CSRF,
    ),
  );

/** Every setup page, by its route, in each state it can be drawn in. */
const PAGES: Readonly<Record<string, readonly (readonly [string, () => string])[]>> = {
  '/setup': [
    ['locked', () => pages.lockedPage(null, null)],
    ['a code refused', () => pages.lockedPage(AWKWARD_NAME, 'code-refused')],
    ['too many attempts', () => pages.lockedPage(null, 'too-many')],
    ['the wrong address', () => pages.wrongAddressPage('http://localhost:8788/setup')],
    ['a form refused', () => pages.formRefusedPage()],
    ['not found', () => pages.messagePage('Not found', 'There is no setup page at this address.')],
    ['finished', () => pages.finishedPage(AWKWARD_NAME)],
    ['the address is still the example', () => pages.exampleAddressPage(AWKWARD_NAME)],
  ],
  '/setup/claim': [
    ['claimed', step('claim', () => pages.claimBody({ kind: 'claimed' }, CSRF))],
    [
      'a claim to compare',
      step(
        'claim',
        () => pages.claimBody({ kind: 'pending', comparisonCode: '012345' }, CSRF),
        false,
        'claim',
      ),
    ],
    [
      'open',
      step(
        'claim',
        () =>
          pages.claimBody(
            { kind: 'open', card: true, notConfirmed: false, expired: false, reach: reach() },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
    [
      'open, the tunnel connected',
      step(
        'claim',
        () =>
          pages.claimBody(
            {
              kind: 'open',
              card: true,
              notConfirmed: false,
              expired: false,
              reach: reach('internet', 'connected'),
            },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
    [
      'open, the tunnel not connected',
      step(
        'claim',
        () =>
          pages.claimBody(
            {
              kind: 'open',
              card: true,
              notConfirmed: false,
              expired: false,
              reach: reach('internet', 'not-connected'),
            },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
    [
      'not confirmed, no card',
      step(
        'claim',
        () =>
          pages.claimBody(
            { kind: 'open', card: false, notConfirmed: true, expired: false, reach: reach() },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
    [
      'a restart voided the code (#2858)',
      step(
        'claim',
        () =>
          pages.claimBody(
            {
              kind: 'open',
              card: true,
              notConfirmed: false,
              expired: false,
              restarted: true,
              reach: reach(),
            },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
    [
      'the code ran out',
      step(
        'claim',
        () =>
          pages.claimBody(
            { kind: 'open', card: true, notConfirmed: false, expired: true, reach: reach() },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
    [
      'the claim QR',
      step(
        'claim',
        () =>
          pages.claimBody(
            {
              kind: 'code',
              card: CARD,
              code: CODE,
              expiresAt: '2026-11-18T09:10:00.000Z',
              secondsLeft: 600,
              reach: reach(),
            },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
  ],
  '/setup/tailnet': [
    ['a Tailscale address', step('tailnet', () => pages.tailnetBody(tailnet({})), true, 'tailnet')],
    [
      'Funnel on',
      step('tailnet', () => pages.tailnetBody(tailnet({ path: 'funnel' })), true, 'tailnet'),
    ],
    [
      'not a Tailscale address',
      step(
        'tailnet',
        () =>
          pages.tailnetBody(tailnet({ origin: 'https://rides.example.org', tailscaleName: false })),
        true,
        'tailnet',
      ),
    ],
    [
      'no card',
      step('tailnet', () => pages.tailnetBody(tailnet({ keys: 'none' })), true, 'tailnet'),
    ],
    [
      'keys that do not open at this address',
      step('tailnet', () => pages.tailnetBody(tailnet({ keys: 'unreadable' })), true, 'tailnet'),
    ],
    [
      'a Cloudflare tunnel',
      step('tailnet', () =>
        pages.tailnetBody(
          tailnet({
            path: 'cloudflare',
            origin: 'https://rides.example.org',
            tailscaleName: false,
          }),
        ),
      ),
    ],
    ['no path named', step('tailnet', () => pages.tailnetBody(tailnet({ path: null })))],
  ],
  '/setup/passkey': [
    ['explained', step('passkey', () => pages.passkeyBody('http://localhost:8788/admin'))],
  ],
  '/setup/secrets': [
    ['the kit offered', step('secrets', () => pages.secretsBody('offer', CSRF))],
    ['the kit taken', step('secrets', () => pages.secretsBody('taken', CSRF))],
    ['no kit', step('secrets', () => pages.secretsBody('none', CSRF))],
  ],
  '/setup/backups': [
    [
      'none yet',
      step('backups', () => pages.backupsBody({ last: null, waiting: false, notice: null }, CSRF)),
    ],
    [
      'copied',
      step('backups', () =>
        pages.backupsBody({ last: record('copied'), waiting: false, notice: null }, CSRF),
      ),
    ],
    [
      'copied before the claim (#2858)',
      step('backups', () =>
        pages.backupsBody(
          { last: record('copied', 'done', true), waiting: false, notice: null },
          CSRF,
        ),
      ),
    ],
    [
      'copy failed, too soon',
      step('backups', () =>
        pages.backupsBody({ last: record('failed'), waiting: false, notice: 'too-soon' }, CSRF),
      ),
    ],
    [
      'no off-box folder, waiting',
      step('backups', () =>
        pages.backupsBody({ last: record('not-configured'), waiting: true, notice: 'asked' }, CSRF),
      ),
    ],
    [
      'failed',
      step('backups', () =>
        pages.backupsBody({ last: record(null, 'failed'), waiting: false, notice: null }, CSRF),
      ),
    ],
  ],
  '/setup/registration': [
    [
      'approval checked',
      step('registration', () => pages.registrationBody({ mode: 'approval' }, CSRF), false),
    ],
    [
      'closed checked',
      step('registration', () => pages.registrationBody({ mode: 'closed' }, CSRF), false),
    ],
  ],
  '/setup/invite': [
    [
      'offered, invite mode',
      step('invite', () =>
        pages.inviteBody({ kind: 'offer', inviteMode: true, reach: 'tailnet' }, CSRF),
      ),
    ],
    [
      'offered, another mode',
      step('invite', () =>
        pages.inviteBody({ kind: 'offer', inviteMode: false, reach: 'internet' }, CSRF),
      ),
    ],
    ['taken', step('invite', () => pages.inviteBody({ kind: 'taken' }, CSRF))],
    ['no owner yet', step('invite', () => pages.inviteBody({ kind: 'no-owner' }, CSRF))],
    ['no card', step('invite', () => pages.inviteBody({ kind: 'no-card' }, CSRF))],
    [
      'the invite QR',
      step('invite', () =>
        pages.inviteBody(
          {
            kind: 'code',
            card: CARD,
            code: CODE,
            expiresAt: '2026-11-25T09:00:00.000Z',
            secondsLeft: 7 * 24 * 60 * 60,
            inviteMode: false,
            reach: 'tailnet',
          },
          CSRF,
        ),
      ),
    ],
  ],
  '/setup/ai': [
    ['no Ollama found', ai({})],
    ['no Ollama found, write-ups already on', ai({ model: 'served-model' })],
    ['Ollama with no models', ai({ server: { models: [] } })],
    ['models listed, one in use', ai({ model: 'alpha:14b', server: { models: LISTED } })],
    [
      'a download running',
      ai({
        server: { models: LISTED },
        pull: { kind: 'running', completedBytes: 1_000_000_000, totalBytes: 4_000_000_000 },
      }),
    ],
    [
      'a download failed, a name refused',
      ai({ server: { models: [] }, pull: { kind: 'failed' }, notice: 'bad-name' }),
    ],
    [
      'a download done, a model refused',
      ai({ server: { models: LISTED }, pull: { kind: 'done' }, notice: 'refused' }),
    ],
  ],
  '/setup/finish': [
    [
      'all done',
      step(
        'finish',
        () =>
          pages.finishBody(
            {
              ownerClaimed: true,
              kit: 'downloaded',
              backups: 'working',
              mode: 'invite',
              invites: 1,
              ai: 'on',
            },
            CSRF,
          ),
        false,
      ),
    ],
    [
      'little done',
      step(
        'finish',
        () =>
          pages.finishBody(
            {
              ownerClaimed: true,
              kit: 'not-downloaded',
              backups: 'none-yet',
              mode: 'approval',
              invites: 0,
              ai: 'off',
            },
            CSRF,
          ),
        false,
      ),
    ],
  ],
};

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('the list of setup pages is the setup route table’s (#2784)', () => {
  it('audits every page and the locked route of SETUP_ROUTES, and nothing that is not one', () => {
    const served = routes.SETUP_ROUTES.filter(
      (route) => route.kind === 'page' || route.kind === 'locked',
    ).map((route) => route.path);
    expect(Object.keys(PAGES).sort()).toEqual([...served].sort());
  });
});

describe.each(Object.entries(PAGES))('the setup page %s (#2784)', (path, states) => {
  it.each(states)('%s: no accessibility violation', (_state, render) => {
    const violations = auditAccessibility(parse(render()));
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it.each(states)(
    '%s: one h1, a main, no script, the setup’s stylesheet, and a title that says the setup once',
    (state, render) => {
      const html = render();
      const doc = parse(html);
      expect(doc.querySelectorAll('h1')).toHaveLength(1);
      expect(doc.querySelectorAll('main')).toHaveLength(1);
      expect(doc.documentElement.lang).toBe('en');
      expect(html).not.toMatch(/\sstyle=|\son[a-z]+=|<script/i);
      if (state === 'finished') {
        // Served after /setup/setup.css has gone: the same sheet, inline, and no link to fail.
        expect(doc.querySelector('link[rel=stylesheet]')).toBeNull();
        expect(doc.querySelectorAll('style')).toHaveLength(1);
        expect(doc.querySelector('style')?.textContent).toBe(pages.FINISHED_PAGE_STYLE);
      } else {
        expect(html).not.toMatch(/<style/i);
        expect(doc.querySelector('link[rel=stylesheet]')?.getAttribute('href')).toBe(
          '/setup/setup.css',
        );
      }
      expect(doc.title.split('Set up this instance')).toHaveLength(2);
      // No h2 that repeats the page's h1.
      const h1 = doc.querySelector('h1')?.textContent;
      for (const h2 of doc.querySelectorAll('h2')) expect(h2.textContent).not.toBe(h1);
      expect(doc.body.textContent).not.toContain('<Club>&');
    },
  );

  if (path !== '/setup') {
    it.each(states)(
      '%s: by keyboard, the skip link first, the steps reached as links, the current one marked',
      (_state, render) => {
        const doc = parse(render());
        const tabbable = tabbableElements(doc);
        expect(tabbable[0]?.textContent).toBe('Skip to the page');
        expect(tabbable[0]?.getAttribute('href')).toBe('#main');
        const nav = doc.querySelector('header nav[aria-label]');
        expect(nav).not.toBeNull();
        const current = nav?.querySelector('a[aria-current="step"]');
        expect(current?.getAttribute('href')).toBe(path);
        // Never colour alone: a done step says so in words beside its tick, and each step's box
        // is the same element class whether it is a link or not, so no row changes height.
        const items = [...(nav?.querySelectorAll('li') ?? [])];
        expect(items).toHaveLength(9);
        for (const item of items) expect(item.firstElementChild?.className).toBe('step');
        // Every form is reached by Tab, and each is operated by its button.
        for (const form of doc.querySelectorAll('main form')) {
          const button = form.querySelector('button[type=submit]');
          expect(button).not.toBeNull();
          expect(tabbable).toContain(button);
        }
        // A radio group is one tab stop with a legend; each choice is labelled.
        for (const radio of doc.querySelectorAll('input[type=radio]')) {
          expect(accessibleName(radio)).not.toBe('');
          expect(radio.closest('fieldset')?.querySelector('legend')).not.toBeNull();
        }
      },
    );
  }
});

describe.each([
  ['claim', '/setup/claim', 'the claim QR'],
  ['invite', '/setup/invite', 'the invite QR'],
] as const)('the %s QR on its setup step (#2784)', (purpose, path, state) => {
  const render = (): string => (PAGES[path]?.find(([name]) => name === state)?.[1] ?? (() => ''))();

  it('is an image with a name, described by the line beside it, which is the app’s own and selectable', () => {
    const doc = parse(render());
    const qr = doc.querySelectorAll('main svg[role="img"]');
    expect(qr).toHaveLength(1);
    const svg = qr[0] as Element;
    expect(accessibleName(svg)).toBe(admin.CARD_CODE_TEXT[purpose].label);
    const line = doc.getElementById(svg.getAttribute('aria-describedby') ?? '');
    expect(line?.tagName).toBe('CODE');
    expect(line?.textContent).toBe(codeWithCard(CARD, CODE));
    expect(readCodeWithCard(line?.textContent ?? '')).toEqual({ card: CARD, code: CODE });
    expect(tabbableElements(doc)).not.toContain(svg);
  });
});

describe('what a device needs before it can reach the server (#2855)', () => {
  const state = (path: string, name: string): Document =>
    parse((PAGES[path]?.find(([each]) => each === name)?.[1] ?? (() => ''))());

  /** Whether `first` comes before `second` in the page, as it is read and as Tab reaches it. */
  const precedes = (first: Element | null | undefined, second: Element | null | undefined) =>
    first != null &&
    second != null &&
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  const paragraph = (doc: Document, text: RegExp): Element | undefined =>
    [...doc.querySelectorAll('main p')].find((each) => text.test(each.textContent));

  it('names the address and what the tablet needs before the button that shows the claim code', () => {
    const doc = state('/setup/claim', 'open');
    const button = [...doc.querySelectorAll('main button')].find(
      (each) => each.textContent === 'Show the claim code',
    );
    const address = paragraph(doc, /Your tablet will reach this server at this address/);
    expect(address?.querySelector('code')?.textContent).toBe(ORIGIN);
    expect(precedes(address, button)).toBe(true);
    const needs = paragraph(doc, /same Tailscale network as this computer/);
    expect(needs?.className).toBe('warning');
    expect(precedes(needs, button)).toBe(true);
    const check = paragraph(doc, /open this address in the tablet’s web browser/);
    expect(check?.querySelector('code')?.textContent).toBe(`${ORIGIN}/health`);
    // The address is text to read and type on the tablet: this computer may not reach it.
    expect(doc.querySelector(`main a[href^="${ORIGIN}"]`)).toBeNull();
    // A tailnet cannot be checked from this computer, so the page claims no check.
    expect(doc.body.textContent).not.toContain('Checked from this computer');
  });

  it('keeps the same words beside the claim code, above the QR and the button, as before it', () => {
    const doc = state('/setup/claim', 'the claim QR');
    const needs = paragraph(doc, /same Tailscale network as this computer/);
    const scanned = [...doc.querySelectorAll('main button')].find(
      (each) => each.textContent === 'I’ve scanned it',
    );
    expect(precedes(needs, doc.querySelector('main svg[role="img"]'))).toBe(true);
    expect(precedes(needs, scanned)).toBe(true);
    expect(paragraph(doc, /Your tablet will reach this server/)?.textContent).toContain(ORIGIN);
  });

  it('says what this computer checked of a tunnel: connected as a status, not connected as a problem', () => {
    const connected = state('/setup/claim', 'open, the tunnel connected');
    const good = paragraph(connected, /Checked from this computer/);
    expect(good?.className).toBe('notice');
    expect(good?.getAttribute('role')).toBe('status');
    expect(good?.textContent).toContain('tunnel is connected');
    expect(connected.body.textContent).not.toContain('Tailscale');
    const dropped = state('/setup/claim', 'open, the tunnel not connected');
    const bad = paragraph(dropped, /Checked from this computer/);
    expect(bad?.className).toBe('problem');
    expect(bad?.textContent).toContain('not connected');
  });

  it('says what a rider’s device needs before the button that makes an invite, and beside the invite', () => {
    const offer = state('/setup/invite', 'offered, invite mode');
    const button = [...offer.querySelectorAll('main button')].find(
      (each) => each.textContent === 'Make an invite',
    );
    const needs = paragraph(offer, /must be on your Tailscale network too/);
    expect(needs?.className).toBe('warning');
    expect(precedes(needs, button)).toBe(true);
    expect(
      paragraph(state('/setup/invite', 'offered, another mode'), /must be online/)?.className,
    ).toBe('warning');
    const code = state('/setup/invite', 'the invite QR');
    expect(
      precedes(
        code.querySelector('main svg[role="img"]'),
        paragraph(code, /must be on your Tailscale network too/),
      ),
    ).toBe(true);
  });

  it('answers an address that is still the example with one sentence, the setting’s name collapsed, and no form', () => {
    const doc = state('/setup', 'the address is still the example');
    expect(doc.querySelector('h1')?.textContent).toBe('Set this server’s address first');
    expect(doc.querySelectorAll('form, input, button')).toHaveLength(0);
    const said = [...doc.querySelectorAll('main > p')];
    expect(said).toHaveLength(1);
    expect(said[0]?.className).toBe('problem');
    expect(said[0]?.textContent).toContain('still the example from the settings template');
    // The setting's name and the command are for whoever opens the block, never on the page's face.
    expect(said[0]?.textContent).not.toMatch(/OYL_|docker/);
    const expert = doc.querySelector('main details');
    expect(expert?.hasAttribute('open')).toBe(false);
    expect(expert?.textContent).toContain('OYL_INSTANCE_ORIGIN');
    // The example itself is never shown: the owner's own address goes there.
    expect(doc.body.textContent).not.toContain('your-tailnet');
  });
});

describe('the claim step’s one problem sentence (#2825)', () => {
  const alerts = (view: { notConfirmed: boolean; expired: boolean }): (string | null)[] =>
    [
      ...parse(
        pages.claimBody({ kind: 'open', card: true, reach: reach(), ...view }, CSRF),
      ).querySelectorAll('[role="alert"]'),
    ].map((alert) => alert.textContent);

  it('says a code ran out, as an alert, and nothing when none did', () => {
    expect(alerts({ notConfirmed: false, expired: true })).toEqual([
      'That code ran out. Show a new one.',
    ]);
    expect(alerts({ notConfirmed: false, expired: false })).toEqual([]);
  });

  it('says one sentence, the fuller one, when a claim could not be confirmed either', () => {
    const said = alerts({ notConfirmed: true, expired: true });
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^That claim could not be confirmed/);
  });
});

describe('the setup’s progress bar (#2784)', () => {
  it('ticks and names each done step, marks the current one, and draws later steps as plain items', () => {
    const doc = parse(
      pages.stepPage(
        frame('backups', 'registration'),
        pages.backupsBody({ last: null, waiting: false, notice: null }, CSRF),
        {
          next: true,
        },
      ),
    );
    const steps = [...doc.querySelectorAll('header nav li')].map((item) => ({
      link: item.querySelector('a') !== null,
      current: item.querySelector('[aria-current="step"]') !== null,
      mark: item.querySelector('.step-mark')?.textContent,
      said: item.querySelector('.step')?.textContent,
    }));
    expect(steps).toEqual([
      { link: true, current: false, mark: '✓', said: '✓Step 1, done: Claim' },
      { link: true, current: false, mark: '✓', said: '✓Step 2, done: Tailnet' },
      { link: true, current: false, mark: '✓', said: '✓Step 3, done: Passkey' },
      { link: true, current: false, mark: '✓', said: '✓Step 4, done: Emergency kit' },
      { link: true, current: true, mark: '✓', said: '✓Step 5, done: Backups' },
      { link: true, current: false, mark: '6', said: '6Step 6: Who may join' },
      { link: false, current: false, mark: '7', said: '7Step 7: Invite' },
      { link: false, current: false, mark: '8', said: '8Step 8: AI' },
      { link: false, current: false, mark: '9', said: '9Step 9: Finish' },
    ]);
    // The tick and the number are drawn, not read: the words are.
    for (const mark of doc.querySelectorAll('.step-mark')) {
      expect(mark.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('names each step by the number a narrow screen shows of it (WCAG 2.5.3, label in name)', () => {
    const doc = parse(
      pages.stepPage(
        frame('registration', 'registration'),
        pages.registrationBody({ mode: 'approval' }, CSRF),
        { next: false },
      ),
    );
    const names = [...doc.querySelectorAll('header nav .step')].map((item) => accessibleName(item));
    expect(names).toEqual([
      'Step 1, done: Claim',
      'Step 2, done: Tailnet',
      'Step 3, done: Passkey',
      'Step 4, done: Emergency kit',
      'Step 5, done: Backups',
      'Step 6: Who may join',
      'Step 7: Invite',
      'Step 8: AI',
      'Step 9: Finish',
    ]);
    // On a narrow screen the number is the visible label: the name holds it, and the name too.
    for (const item of doc.querySelectorAll('header nav .step')) {
      const mark = item.querySelector('.step-mark')?.textContent ?? '';
      const shortName = item.querySelector('.step-name')?.textContent ?? '';
      if (mark !== '✓') expect(accessibleName(item)).toContain(mark);
      expect(accessibleName(item)).toContain(shortName);
    }
  });

  it('never reloads a page by itself (WCAG 2.2.1, F41): a page that waits has a button that checks again', () => {
    for (const [path, states] of Object.entries(PAGES)) {
      for (const [state, render] of states) {
        const doc = parse(render());
        expect(doc.querySelector('meta[http-equiv="refresh" i]'), `${path} ${state}`).toBeNull();
      }
    }
    const again = (path: string, state: string): string | undefined => {
      const doc = parse((PAGES[path]?.find(([name]) => name === state)?.[1] ?? (() => ''))());
      const form = doc.querySelector(`main form[method="get"][action="${path}"]`);
      return form?.querySelector('button[type=submit]')?.textContent ?? undefined;
    };
    expect(again('/setup/claim', 'the claim QR')).toBe('I’ve scanned it');
    expect(again('/setup/backups', 'no off-box folder, waiting')).toBe('Check now');
    expect(again('/setup/claim', 'a claim to compare')).toBeUndefined();
    expect(again('/setup/backups', 'copied')).toBeUndefined();
    // #2792: a download that runs, and an Ollama not found yet.
    expect(again('/setup/ai', 'a download running')).toBe('Check now');
    expect(again('/setup/ai', 'no Ollama found')).toBe('Look again');
    expect(again('/setup/ai', 'models listed, one in use')).toBeUndefined();
  });
});

describe('the setup’s optional AI step (#2792)', () => {
  const draw = (view: Record<string, unknown>): Document => parse(ai(view)());
  const said = (doc: Document): string => doc.querySelector('main')?.textContent ?? '';

  it('says in one sentence that no Ollama was found, and is skipped with Next step', () => {
    const doc = draw({});
    const notices = [...doc.querySelectorAll('main p.notice')].map((each) => each.textContent);
    expect(notices).toEqual(['Ollama was not found on this computer, so AI write-ups stay off.']);
    expect(doc.querySelector('main form[action="/setup/next"] button')?.textContent).toBe(
      'Next step',
    );
    expect(doc.querySelector('main form[action="/setup/ai/pull"]')).toBeNull();
  });

  it('lists each model with how it fits, a button for each that can be used, and none for the one in use or one that cannot call tools', () => {
    const doc = draw({ model: 'alpha:14b', server: { models: LISTED } });
    const items = [...doc.querySelectorAll('main ul.models > li')].map((item) => ({
      name: item.querySelector('code')?.textContent,
      fit: item.querySelector('p')?.textContent,
      button: item.querySelector('form[action="/setup/ai/use"] button')?.textContent ?? null,
      sends: item.querySelector('form input[name="model"]')?.getAttribute('value') ?? null,
    }));
    expect(items).toEqual([
      {
        name: 'alpha:14b',
        fit: 'alpha:14b: 9.0 GB. It fits in the graphics card’s memory, so it runs at full speed.',
        button: null,
        sends: null,
      },
      {
        name: 'beta:32b',
        fit: 'beta:32b: 9.0 GB. Only 62 % of it fits in the graphics card’s memory, so it runs slowly. A smaller model would be faster.',
        button: 'Use beta:32b',
        sends: 'beta:32b',
      },
      {
        name: 'gamma:26b',
        fit: 'gamma:26b: 9.0 GB. How well it fits the graphics card is not known until it has been loaded.',
        button: null,
        sends: null,
      },
      {
        name: 'delta:8b',
        fit: 'delta:8b: 9.0 GB. None of it is in a graphics card’s memory, so it runs on the processor, slowly.',
        button: 'Use delta:8b',
        sends: 'delta:8b',
      },
      {
        name: 'epsilon:4b',
        fit: 'epsilon:4b: 9.0 GB. Ollama did not say how well it fits the graphics card.',
        button: 'Use epsilon:4b',
        sends: 'epsilon:4b',
      },
    ]);
    expect(said(doc)).toContain('AI write-ups are on. They run on this model: alpha:14b');
    // Each form on the page has a name of its own (`audit.ts` §`landmarks-are-distinguishable`).
    const names = [...doc.querySelectorAll('main form')].map((form) => accessibleName(form));
    expect(new Set(names).size).toBe(names.length);
  });

  it('names the field a model’s name is typed in, describes it, and names no model itself', () => {
    const doc = draw({ server: { models: [] } });
    const field = doc.querySelector('main form[action="/setup/ai/pull"] input[name="model"]');
    expect(field).not.toBeNull();
    expect(accessibleName(field as Element)).toBe('Model to download');
    expect(doc.getElementById(field?.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(
      /^Type a model’s name as Ollama’s library lists it/,
    );
    expect(field?.getAttribute('value')).toBeNull();
    expect(field?.getAttribute('placeholder')).toBeNull();
    // ADR 0046's amendment of 2026-11-14, point 8: the page names and recommends no model.
    expect(doc.querySelectorAll('main code')).toHaveLength(0);
  });

  it('draws a download as numbers and fixed words, with no form for a second while one runs', () => {
    const running = draw({
      server: { models: [] },
      pull: { kind: 'running', completedBytes: 1_000_000_000, totalBytes: 4_000_000_000 },
    });
    expect(said(running)).toContain('Downloading the model: 25 % so far, 1.0 GB of 4.0 GB.');
    expect(running.querySelector('main form[action="/setup/ai/pull"]')).toBeNull();
    const started = draw({
      server: { models: [] },
      pull: { kind: 'running', completedBytes: 0, totalBytes: 0 },
    });
    expect(said(started)).toContain('Downloading the model: it has just started.');
    const failed = draw({ server: { models: [] }, pull: { kind: 'failed' } });
    expect([...failed.querySelectorAll('[role="alert"]')].map((each) => each.textContent)).toEqual([
      'The download did not finish. Check that the name is spelled as Ollama lists it, that this computer is online and that its disk has room, then try again.',
    ]);
    expect(failed.querySelector('main form[action="/setup/ai/pull"]')).not.toBeNull();
    const done = draw({ server: { models: [] }, pull: { kind: 'done' } });
    expect(done.querySelector('main [role="status"]')?.textContent).toBe(
      'The download finished. The model is in the list on this page.',
    );
  });
});
