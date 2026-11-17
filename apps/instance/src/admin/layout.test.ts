// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin pages' look (#2771): the header's mark and tab bar, the button
 * kinds a change is drawn with — a change that is hard to undo as `danger`
 * and set apart — the readable moments of the tables, and what the
 * stylesheet must keep true: no request it makes of its own, a 48 px target
 * on every control, the passkey script's `hidden` honoured, and dark unless
 * the browser prefers light.
 *
 * The renderers are pure, so each is called here as `admin.ts` calls it. The
 * accessibility of every page and state, the contrast of every pair and the
 * tokens' match with the app's are `apps/web/src/a11y/admin-pages.a11y.test.ts`'s.
 */

import type { OperateAnalysisAnswer } from '@onyourleft/operate-text';
import { describe, expect, it } from 'vitest';

import {
  accountsBody,
  analysisBody,
  backupsBody,
  keysBody,
  passkeysBody,
  readableMoment,
  roomsBody,
  shellPage,
  type RoomAnswer,
  type ShellView,
} from './pages.ts';
import { ADMIN_STYLE } from './style.ts';
import { ADMIN_COLOURS, colourProperty } from './tokens.ts';

const ROOMS: readonly RoomAnswer[] = [
  {
    roomId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    shortCode: 'a1b2c3',
    kind: 'race',
    visibility: 'private',
    phase: 'riding',
    openedAt: '2026-11-14T19:30:00.000Z',
    host: 'Ann',
    riders: ['Ann', 'Bea', null],
  },
  {
    roomId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    shortCode: '0f1e2d',
    kind: 'group',
    visibility: 'public',
    phase: 'lobby',
    openedAt: '2026-11-14T18:00:00.000Z',
    host: 'Cal',
    riders: [],
  },
];

const ANALYSIS: OperateAnalysisAnswer = {
  local: {
    url: null,
    model: null,
    reasoningTokens: null,
    offered: true,
    othersMayUse: false,
    setIn: 'none',
    state: 'not-set',
  },
  hosted: { offered: false, operatorKey: 'none', operatorKeyOrigin: null },
};

const shell = (name: string | null = null): ShellView => ({
  name,
  path: '/admin/keys',
  strength: 'passkey',
  listener: 'tunnel',
  csrf: 'a'.repeat(64),
});

/** Each form's button, as `[its classes, its words]`. */
const buttons = (html: string): (readonly [string, string])[] =>
  [...html.matchAll(/<button type="submit"(?: class="([^"]*)")?>([^<]*)<\/button>/g)].map(
    ([, kind, words]) => [kind ?? '', words ?? ''] as const,
  );

/** The danger cards' markup. */
const dangerCards = (html: string): string[] =>
  [...html.matchAll(/<div class="panel danger">\n([\s\S]*?)\n<\/div>\n/g)].map(
    ([, inside]) => inside ?? '',
  );

describe('the header: the mark, the instance’s name and the section links as tabs (#2771)', () => {
  it('draws the mark with its arrow hidden from assistive technology, the name escaped, and the current tab marked', () => {
    const html = shellPage(shell('Ride <Club> & "friends"'), 'Keys', '<p>Body.</p>');
    expect(html).toMatch(
      /<p class="brand"><span class="wordmark"><svg class="mark" viewBox="[^"]+" aria-hidden="true" focusable="false"><path d="[^"]+"\/><\/svg>On Your Left<\/span> <span class="name">Ride &lt;Club&gt; &amp; &quot;friends&quot;<\/span><\/p>/,
    );
    expect(html).toContain('<li><a href="/admin/keys" aria-current="page">Keys</a></li>');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(buttons(html)).toContainEqual(['secondary', 'Sign out']);
  });
});

describe('a change is drawn with the app’s button kinds; one hard to undo is danger, apart (#2771)', () => {
  const csrf = 'b'.repeat(64);

  it('Keys: rotating the encryption key is a danger card with a danger button; a code session has neither', () => {
    const view = {
      keys: {
        state: 'ready' as const,
        current: {
          serial: 1_790_000_000,
          createdAt: '2026-10-22T08:00:00.000Z',
          rotatesAt: '2026-11-21T08:00:00.000Z',
        },
        olderHeld: 0,
      },
      card: null,
      onServer: false,
      csrf,
      notice: null,
    };
    const passkey = keysBody({ ...view, strength: 'passkey' });
    const [rotate] = dangerCards(passkey);
    expect(dangerCards(passkey)).toHaveLength(1);
    expect(rotate).toContain('<h2>Rotate the encryption key</h2>');
    expect(buttons(rotate ?? '')).toEqual([['danger', 'Rotate the encryption key']]);
    const code = keysBody({ ...view, strength: 'code' });
    expect(dangerCards(code)).toEqual([]);
    expect(buttons(code)).toEqual([]);
  });

  it('Rooms: the table is for reading, and each End room is in a danger card below it', () => {
    const html = roomsBody({ rooms: ROOMS, strength: 'passkey', csrf, notice: null });
    const table = html.indexOf('<table>');
    const [ending] = dangerCards(html);
    expect(table).toBeGreaterThan(-1);
    expect(html.indexOf('<div class="panel danger">')).toBeGreaterThan(table);
    expect(html.slice(table, html.indexOf('</table>'))).not.toContain('<form');
    expect(buttons(ending ?? '')).toEqual(ROOMS.map(() => ['danger', 'End room']));
    for (const room of ROOMS) {
      expect(ending).toContain(`<code>${room.shortCode}</code></h3>`);
    }
  });

  it('Accounts: Approve is the primary; Refuse is danger, in a form set apart', () => {
    const html = accountsBody({
      status: undefined,
      registrations: [
        { athleteId: 'a1', displayName: 'Sam', createdAt: 1_763_100_000, adultConfirmed: true },
      ],
      strength: 'passkey',
      csrf,
      notice: null,
      reasonLimit: 1000,
    });
    expect(buttons(html)).toEqual([
      ['', 'Approve'],
      ['danger', 'Refuse'],
    ]);
    expect(html).toMatch(/<form class="apart" method="post" action="\/admin\/accounts\/refuse"/);
    expect(html).not.toMatch(
      /<form class="apart" method="post" action="\/admin\/accounts\/approve"/,
    );
  });

  it('Passkeys: Revoke is danger, in a form set apart', () => {
    const html = passkeysBody({
      passkeys: [
        {
          id: '0123456789abcdef',
          label: 'Laptop',
          enrolledAt: 1_763_100_000,
          lastUsedAt: null,
          rpId: 'instance.example',
          standing: 'confirmed',
        },
      ],
      rpId: 'instance.example',
      strength: 'passkey',
      csrf,
      max: 10,
      labelLimit: 60,
    });
    expect(buttons(html)).toEqual([['danger', 'Revoke Laptop']]);
    expect(html).toContain('<form class="apart" method="post" action="/admin/passkeys/');
  });

  it('Backups: Back up now is the primary, under a heading of its own', () => {
    const html = backupsBody({
      backups: { records: [], pendingSince: null },
      strength: 'passkey',
      csrf,
      notice: null,
      all: false,
    });
    expect(html).toContain('<h2>Back up now</h2>');
    expect(buttons(html)).toEqual([['', 'Back up now']]);
    expect(dangerCards(html)).toEqual([]);
  });

  it('AI backend: the switches are secondary, and returning to .env is a danger card', () => {
    const html = analysisBody({
      analysis: ANALYSIS,
      models: undefined,
      jobs: undefined,
      strength: 'passkey',
      csrf,
      notice: null,
    });
    const drawn = buttons(html);
    expect(drawn.filter(([, words]) => words.startsWith('Turn '))).toEqual([
      ['secondary', 'Turn off'],
      ['secondary', 'Turn on'],
      ['secondary', 'Turn on'],
    ]);
    const [back] = dangerCards(html);
    expect(dangerCards(html)).toHaveLength(1);
    expect(buttons(back ?? '')).toHaveLength(1);
    expect(buttons(back ?? '')[0]?.[0]).toBe('danger');
  });
});

describe('a table’s When column is a moment in operate-text’s words (#2771)', () => {
  it('draws the minute in UTC as the app’s panels do, inside a <time> carrying the moment', () => {
    expect(readableMoment('2026-11-04T09:05:00.000Z')).toBe(
      '<time datetime="2026-11-04T09:05:00.000Z">2026-11-04 09:05 UTC</time>',
    );
  });

  it('draws a value that is not a moment as words alone, escaped, and no <time>', () => {
    expect(readableMoment('<b>soon</b>')).toBe('&lt;b&gt;soon&lt;/b&gt; UTC');
  });
});

/** The declarations of the rule whose selector is exactly `selector`. */
const declarations = (selector: string): string => {
  const start = ADMIN_STYLE.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return ADMIN_STYLE.slice(start, ADMIN_STYLE.indexOf('}', start));
};

describe('/admin/admin.css (#2771)', () => {
  it('asks for nothing of its own: no font file, no import, no other origin', () => {
    expect(ADMIN_STYLE).not.toMatch(/url\(|@import|@font-face|https?:|\/\//);
  });

  it('honours the passkey script’s hidden attribute over any display a rule gives', () => {
    expect(declarations('[hidden]')).toContain('display: none !important');
  });

  it('gives every control a target of at least 48 px', () => {
    expect(ADMIN_STYLE).toContain('--admin-target: 3rem;');
    for (const selector of [
      'button',
      '.sections a',
      '.pager a',
      'summary',
      'input[type=text], input[type=url], select',
    ]) {
      expect(declarations(selector), selector).toContain('min-height: var(--admin-target)');
    }
  });

  it('is dark unless the browser prefers light, in the app’s tokens', () => {
    const light = ADMIN_STYLE.indexOf('@media (prefers-color-scheme: light)');
    expect(light).toBeGreaterThan(-1);
    const dark = ADMIN_STYLE.slice(0, light);
    const lightBlock = ADMIN_STYLE.slice(light, ADMIN_STYLE.indexOf('\n}\n', light));
    expect(dark).toContain('color-scheme: dark;');
    expect(lightBlock).toContain('color-scheme: light;');
    for (const [name, value] of Object.entries(ADMIN_COLOURS.dark)) {
      expect(dark).toContain(
        `${colourProperty(name as keyof typeof ADMIN_COLOURS.dark)}: ${value};`,
      );
    }
    for (const [name, value] of Object.entries(ADMIN_COLOURS.light)) {
      expect(lightBlock).toContain(
        `${colourProperty(name as keyof typeof ADMIN_COLOURS.light)}: ${value};`,
      );
    }
  });

  it('names its colours as theme.css does', () => {
    expect(colourProperty('inkMuted')).toBe('--oyl-color-ink-muted');
    expect(colourProperty('dangerActionInk')).toBe('--oyl-color-danger-action-ink');
  });
});
