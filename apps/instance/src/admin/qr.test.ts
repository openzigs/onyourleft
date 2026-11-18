// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The card and a single-use code as one server-drawn QR (#2783, ADR 0080 D-3,
 * D-7, ADR 0047 D-6). Every QR here is READ BACK the way a camera reads one:
 * the served SVG is painted into pixels and handed to `jsqr`, the decoder the
 * app's scanner uses (`apps/web/src/camera/side-link-qr.ts`) — test-only here
 * — and what it reads must be the app's `<card> <code>` line, whole.
 */

import { base32Unpadded } from '@onyourleft/domain';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../html.ts';
import {
  CARD_CODE_LINE_TEXT,
  CARD_CODE_TEXT,
  CARD_CODE_UNTIL_TEXT,
  cardCodePart,
  type CardCodePurpose,
} from './pages.ts';
import { cardWithCode, QR_INK, QR_PAPER, QR_QUIET_ZONE, qrModules, qrSvg } from './qr.ts';

/** A whole card: a real 32-byte fingerprint, 52 base32 characters. */
const FINGERPRINT = base32Unpadded(
  Uint8Array.from({ length: 32 }, (_, at) => (at * 37 + 11) % 256),
);
const CARD = `oyl-instance:https://ride.example#${FINGERPRINT}`;
/** A code as `readableCode` mints one. */
const CODE = 'k7mq-x3ra-p9tz-wc4e';

/** How many pixels a module is painted as. */
const SCALE = 4;

/**
 * The SVG's picture as RGBA pixels: its viewBox, its paper `rect` and its ink
 * `path` read from the markup the page serves — the colours too, so a drawing
 * that lost its contrast would not read.
 */
function paint(svg: string): { rgba: Uint8ClampedArray; width: number; height: number } {
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const paper = /<rect width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"\/>/.exec(svg);
  const ink = /<path d="([^"]*)" fill="(#[0-9a-f]{6})"\/>/.exec(svg);
  if (box === null || paper === null || ink === null) throw new Error('not a QR drawing');
  const side = Number(box[1]);
  const width = side * SCALE;
  const rgba = new Uint8ClampedArray(width * width * 4);
  const fill = (x: number, y: number, hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
    for (let dy = 0; dy < SCALE; dy += 1) {
      for (let dx = 0; dx < SCALE; dx += 1) {
        const at = ((y * SCALE + dy) * width + x * SCALE + dx) * 4;
        rgba.set([r, g, b, 255], at);
      }
    }
  };
  for (let y = 0; y < Number(paper[2]); y += 1) {
    for (let x = 0; x < Number(paper[1]); x += 1) fill(x, y, paper[3] as string);
  }
  const d = ink[1] as string;
  const unit = /M(\d+) (\d+)h1v1h-1z/gy;
  let read = 0;
  for (const match of d.matchAll(unit)) {
    fill(Number(match[1]), Number(match[2]), ink[2] as string);
    read += match[0].length;
  }
  if (read !== d.length) throw new Error('the path holds something that is not a module');
  return { rgba, width, height: width };
}

/** What a camera reads off `svg`, or `undefined`. */
function decode(svg: string): string | undefined {
  const { rgba, width, height } = paint(svg);
  return jsQR(rgba, width, height)?.data;
}

const svgOf = (html: string): string => {
  const found = /<svg class="qr"[\s\S]*?<\/svg>/.exec(html);
  if (found === null) throw new Error('no QR drawing in the markup');
  return found[0];
};

describe('the card and a code as one line (#2783, the app’s codeWithCard)', () => {
  it('is the card, one space and the code: the full 52-character fingerprint, starting oyl-instance:', () => {
    const line = cardWithCode(CARD, CODE);
    expect(line).toBe(`${CARD} ${CODE}`);
    expect(line.startsWith('oyl-instance:')).toBe(true);
    expect(FINGERPRINT).toMatch(/^[A-Z2-7]{52}$/);
    expect(line.split(' ')[0]?.split('#')[1]).toBe(FINGERPRINT);
  });

  it('refuses a card that is not whole, or not a card, and a code that is not one the instance mints', () => {
    for (const card of [
      `oyl-instance:https://ride.example#${FINGERPRINT.slice(0, 51)}`,
      `oyl-instance:https://ride.example#${FINGERPRINT.slice(0, 8)}`,
      `https://ride.example#${FINGERPRINT}`,
      `oyl-instance:https://ride.example/path#${FINGERPRINT}`,
      ` ${CARD}`,
      `${CARD} `,
      '',
    ]) {
      expect(() => cardWithCode(card, CODE), card).toThrow(/whole instance card/);
    }
    for (const code of [
      'K7MQ-X3RA-P9TZ-WC4E',
      'k7mqx3rap9tzwc4e',
      'k7mq-x3ra-p9tz',
      'k7mq-x3ra-p9tz-wc4e ',
      'k7mq x3ra p9tz wc4e',
      'https://evil.example/',
      '',
    ]) {
      expect(() => cardWithCode(CARD, code), code).toThrow(/code that is not one/);
    }
  });
});

describe('the QR drawn on the server (#2783)', () => {
  it('reads back, through the app’s decoder, as exactly the line it was drawn from', () => {
    const line = cardWithCode(CARD, CODE);
    const svg = qrSvg(line, 'A label', 'the-line');
    expect(decode(svg)).toBe(line);
    expect(decode(svg)?.startsWith('oyl-instance:')).toBe(true);
  });

  it('is the encoder’s own grid, inside a four-module quiet zone, black on white', () => {
    const line = cardWithCode(CARD, CODE);
    const svg = qrSvg(line, 'A label', 'the-line');
    const modules = qrModules(line);
    const side = modules.length + QR_QUIET_ZONE * 2;
    expect(svg).toContain(`viewBox="0 0 ${String(side)} ${String(side)}"`);
    expect(QR_INK).toBe('#000000');
    expect(QR_PAPER).toBe('#ffffff');
    const dark = new Set(
      [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((match) => `${match[1]},${match[2]}`),
    );
    const expected = new Set(
      modules.flatMap((cells, row) =>
        cells.flatMap((on, column) =>
          on ? [`${String(column + QR_QUIET_ZONE)},${String(row + QR_QUIET_ZONE)}`] : [],
        ),
      ),
    );
    expect(dark).toEqual(expected);
  });

  it('is an image named for what it is for, described by the line beside it, with no script or style', () => {
    const svg = qrSvg('oyl-instance:x', 'Ride <Club> & "friends"', 'claim-code-line');
    expect(svg).toMatch(/^<svg class="qr" role="img" /);
    expect(svg).toContain('aria-label="Ride &lt;Club&gt; &amp; &quot;friends&quot;"');
    expect(svg).toContain('aria-describedby="claim-code-line"');
    expect(svg).not.toMatch(/<script|style=|on[a-z]+=|href/i);
  });
});

describe.each(['claim', 'invite'] as const)('the %s code’s part of a page (#2783)', (purpose) => {
  const view = (over: Partial<{ card: string; code: string }> = {}) => ({
    purpose: purpose satisfies CardCodePurpose,
    card: CARD,
    code: CODE,
    expiresAt: '2026-11-18T14:05:00.000Z',
    ...over,
  });

  it('draws the QR, which reads back as the line, and the same line beside it as text', () => {
    const html = cardCodePart(view());
    const line = `${CARD} ${CODE}`;
    expect(decode(svgOf(html))).toBe(line);
    const id = `${purpose}-code-line`;
    expect(html).toContain(`aria-describedby="${id}"`);
    expect(html).toContain(`<code class="card" id="${id}">${escapeHtml(line)}</code>`);
    expect(html).toContain(`aria-label="${escapeHtml(CARD_CODE_TEXT[purpose].label)}"`);
    expect(html).toContain(`<h2>${escapeHtml(CARD_CODE_TEXT[purpose].heading)}</h2>`);
    expect(html).toContain(escapeHtml(CARD_CODE_LINE_TEXT));
    expect(html).toContain(
      `${escapeHtml(CARD_CODE_UNTIL_TEXT)} <time datetime="2026-11-18T14:05:00.000Z">`,
    );
  });

  it('escapes the card it is handed, in the text and in nothing the QR loses', () => {
    const awkward = `oyl-instance:https://a&b.example#${FINGERPRINT}`;
    const html = cardCodePart(view({ card: awkward }));
    expect(html).toContain(`>oyl-instance:https://a&amp;b.example#${FINGERPRINT} ${CODE}</code>`);
    expect(html).not.toContain('a&b.example');
    expect(decode(svgOf(html))).toBe(`${awkward} ${CODE}`);
  });

  it('draws nothing for a truncated card or a code the instance does not mint', () => {
    expect(() => cardCodePart(view({ card: CARD.slice(0, -1) }))).toThrow();
    expect(() => cardCodePart(view({ code: 'not-a-code' }))).toThrow();
  });
});
