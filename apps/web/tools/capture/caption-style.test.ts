// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3175's review: how a caption of the demo video looks, held to what a
 * viewer needs. The page is handed these declarations as data
 * (`render-script.ts`), so what is pinned here is what is drawn.
 */

import { describe, expect, it } from 'vitest';

import {
  CREDIT_MIN_VH,
  lineRole,
  lineVh,
  LOGO_VH,
  overlayStyle,
  READING_MIN_VH,
  type CaptionKind,
} from './caption-style';
import { YOUTUBE_SCRIPT } from './scripts/youtube';
import { CALLOUT_PANELS, shownLines, type VideoCaption } from './video-script';

const KINDS: readonly CaptionKind[] = ['title', 'lower-third', 'callout', 'card'];
const vhOf = (css: Readonly<Record<string, string>>): number =>
  Number((css['fontSize'] ?? '').replace(/vh$/u, ''));
const kindOf = (caption: VideoCaption): CaptionKind =>
  caption.callout !== undefined && Object.hasOwn(CALLOUT_PANELS, caption.callout)
    ? 'callout'
    : (caption.placement ?? 'lower-third');

describe('how a caption looks — #3175', () => {
  it('reads the card’s last line as the project’s address, and those between as credit', () => {
    // heading, two statements, four credit lines, the address.
    const roles = Array.from({ length: 8 }, (_, index) => lineRole('card', index, 8, 2));
    expect(roles).toEqual([
      'heading',
      'statement',
      'statement',
      'credit',
      'credit',
      'credit',
      'credit',
      'address',
    ]);
    // A title's lines under its heading are all the script's statements.
    expect(lineRole('title', 1, 2, 1)).toBe('statement');
    expect(lineRole('callout', 0, 1, 0)).toBe('heading');
  });

  it('draws no line of the shipped script too small to read on a phone', () => {
    for (const scene of YOUTUBE_SCRIPT.scenes) {
      for (const caption of scene.captions) {
        const kind = kindOf(caption);
        const count = shownLines(caption).length;
        const statements = caption.lines?.length ?? 0;
        const style = overlayStyle(kind, count, statements);
        expect(style.lines).toHaveLength(count);
        style.lines.forEach((line, index) => {
          const credit = lineRole(kind, index, count, statements) === 'credit';
          expect(
            vhOf(line),
            `${scene.id} “${caption.text}” line ${String(index)}`,
          ).toBeGreaterThanOrEqual(credit ? CREDIT_MIN_VH : READING_MIN_VH);
        });
      }
    }
  });

  it('keeps one hierarchy: the heading largest, statements under it, credit smallest', () => {
    for (const kind of KINDS) {
      expect(lineVh(kind, 'heading')).toBeGreaterThan(lineVh(kind, 'statement'));
    }
    expect(lineVh('card', 'address')).toBeGreaterThan(lineVh('card', 'statement'));
    expect(lineVh('card', 'heading')).toBeGreaterThan(lineVh('card', 'address'));
    expect(lineVh('card', 'statement')).toBeGreaterThan(lineVh('card', 'credit'));
    // A callout is beside the panel it explains, so it is the smaller caption.
    expect(lineVh('lower-third', 'heading')).toBeGreaterThan(lineVh('callout', 'heading'));
  });

  it('draws the card’s address above its credit lines, boxed, though the script lists it last', () => {
    const { lines } = overlayStyle('card', 8, 2);
    const order = lines.map((line) => Number(line['order']));
    expect(order).toEqual([0, 1, 1, 3, 3, 3, 3, 2]);
    expect(lines[7]?.['border']).toContain('var(--oyl-color-hud-ink)');
    // The credit is set back, in the HUD's muted ink, and spaced off the address.
    expect(lines[3]?.['color']).toBe('var(--oyl-color-hud-ink-muted)');
    expect(lines[3]?.['marginTop']).toBeDefined();
    expect(lines[4]?.['marginTop']).toBeUndefined();
  });

  it('balances every line and hyphenates none', () => {
    for (const kind of KINDS) {
      for (const line of overlayStyle(kind, 8, 2).lines) {
        expect(line['textWrap']).toBe('balance');
        expect(line['hyphens']).toBe('none');
      }
    }
  });

  it('lifts a caption off the sky with a shadow, and its leader and ring with a dark edge', () => {
    for (const kind of ['title', 'lower-third', 'callout'] as const) {
      const style = overlayStyle(kind, 2, 1);
      expect(style.card['boxShadow']).toMatch(/rgb\(0 0 0 \/ 0\.\d+\)/u);
      expect(style.card['background']).toBe('var(--oyl-color-hud-surface)');
      expect(style.marks['filter']).toMatch(/^drop-shadow\(/u);
    }
    // The card is the whole frame: nothing to lift it from.
    expect(overlayStyle('card', 8, 2).card['boxShadow']).toBeUndefined();
    expect(overlayStyle('card', 8, 2).card['width']).toBe('100vw');
  });

  it('sets a callout left and the rest centred, each no wider than leaves the ride in view', () => {
    expect(overlayStyle('callout', 1, 0).card['textAlign']).toBe('left');
    expect(overlayStyle('lower-third', 1, 0).card['textAlign']).toBe('center');
    expect(overlayStyle('callout', 1, 0).card['maxWidth']).toBe('36vw');
    expect(overlayStyle('lower-third', 1, 0).card['maxWidth']).toBe('64vw');
    expect(overlayStyle('title', 2, 1).card['maxWidth']).toBe('84vw');
  });

  it('draws the logo smaller than the gap between the HUD’s top panels and the rider', () => {
    expect(overlayStyle('title', 2, 1).logoVh).toBe(LOGO_VH.title);
    expect(overlayStyle('card', 8, 2).logoVh).toBe(LOGO_VH.card);
    // 512 × 408 pixels drawn at 1080p: never scaled up.
    expect((LOGO_VH.title / 100) * 1080).toBeLessThanOrEqual(408);
    expect(LOGO_VH.title).toBeLessThanOrEqual(20);
  });
});
