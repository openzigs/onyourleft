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

type Step = 'claim' | 'passkey' | 'secrets' | 'backups' | 'registration' | 'invite' | 'finish';

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
  finishedPage(name: string | null): string;
  stepPage(frame: Frame, body: string, next: boolean): string;
  claimBody(view: unknown, csrf: string): string;
  passkeyBody(adminAddress: string): string;
  secretsBody(view: 'offer' | 'taken' | 'none', csrf: string): string;
  backupsBody(view: unknown, csrf: string): string;
  registrationBody(view: unknown, csrf: string): string;
  inviteBody(view: unknown, csrf: string): string;
  finishBody(changes: readonly string[], csrf: string): string;
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
    pages.stepPage(frame(step, reached, AWKWARD_NAME), body(), next);

const record = (offBox: string | null, outcome = 'done') => ({
  at: '2026-11-18T09:00:00.000Z',
  outcome,
  offBox,
});

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
        () => pages.claimBody({ kind: 'open', card: true, notConfirmed: false }, CSRF),
        false,
        'claim',
      ),
    ],
    [
      'not confirmed, no card',
      step(
        'claim',
        () => pages.claimBody({ kind: 'open', card: false, notConfirmed: true }, CSRF),
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
            { kind: 'code', card: CARD, code: CODE, expiresAt: '2026-11-18T09:10:00.000Z' },
            CSRF,
          ),
        false,
        'claim',
      ),
    ],
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
      'from .env',
      step('registration', () =>
        pages.registrationBody({ mode: 'approval', from: 'env', saved: false }, CSRF),
      ),
    ],
    [
      'chosen here, saved',
      step('registration', () =>
        pages.registrationBody({ mode: 'closed', from: 'setup', saved: true }, CSRF),
      ),
    ],
  ],
  '/setup/invite': [
    [
      'offered, invite mode',
      step('invite', () => pages.inviteBody({ kind: 'offer', inviteMode: true }, CSRF)),
    ],
    [
      'offered, another mode',
      step('invite', () => pages.inviteBody({ kind: 'offer', inviteMode: false }, CSRF)),
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
            inviteMode: false,
          },
          CSRF,
        ),
      ),
    ],
  ],
  '/setup/finish': [
    [
      'changes',
      step(
        'finish',
        () => pages.finishBody(['Owner claim confirmed', 'Registration mode set: closed'], CSRF),
        false,
      ),
    ],
    ['nothing changed', step('finish', () => pages.finishBody([], CSRF), false)],
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
    '%s: one h1, a main, no script, no inline style, the setup’s stylesheet',
    (_state, render) => {
      const html = render();
      const doc = parse(html);
      expect(doc.querySelectorAll('h1')).toHaveLength(1);
      expect(doc.querySelectorAll('main')).toHaveLength(1);
      expect(doc.documentElement.lang).toBe('en');
      expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=|<script/i);
      expect(doc.querySelector('link[rel=stylesheet]')?.getAttribute('href')).toBe(
        '/setup/setup.css',
      );
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
