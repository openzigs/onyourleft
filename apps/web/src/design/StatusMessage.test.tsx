// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #48's sixth acceptance criterion, the half a contrast check cannot see:
 * *"colour is never the sole carrier of meaning in any design-system
 * primitive."*
 *
 * The test that would not catch a regression is "each tone gets its own class".
 * A class name is a colour by another name. What is asserted instead is that
 * the **text** differs between tones — because text is what survives greyscale,
 * a colour-vision deficiency, and a screen reader, and it is the thing a later
 * "let's simplify the labels" change would remove.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { mount, type Mounted } from '../testing/mount';

import { StatusMessage, type StatusTone } from './StatusMessage';

const TONES: StatusTone[] = ['info', 'success', 'warning', 'danger'];

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function render(tone: StatusTone, label?: string): Promise<HTMLElement> {
  mounted = await mount(
    <StatusMessage tone={tone} label={label}>
      Something happened.
    </StatusMessage>,
  );
  return mounted.container;
}

describe('colour is never the only signal', () => {
  it('gives every tone a distinct word, with the colour stripped out', async () => {
    const words: string[] = [];
    for (const tone of TONES) {
      const container = await render(tone);
      // Read only the label span. Reading the whole message would pass on the
      // shared body text and prove nothing about the tone.
      words.push(container.querySelector('.oyl-status__label')?.textContent ?? '');
      mounted?.unmount();
      mounted = undefined;
    }
    expect(new Set(words).size).toBe(TONES.length);
    expect(words.every((word) => word.trim().length > 2)).toBe(true);
  });

  it('gives every tone a distinct glyph as a second redundant signal', async () => {
    const glyphs: string[] = [];
    for (const tone of TONES) {
      const container = await render(tone);
      glyphs.push(container.querySelector('.oyl-status__glyph')?.textContent ?? '');
      mounted?.unmount();
      mounted = undefined;
    }
    expect(new Set(glyphs).size).toBe(TONES.length);
  });

  it('hides the glyph from a screen reader, because the word already says it', async () => {
    const container = await render('warning');
    expect(container.querySelector('.oyl-status__glyph')?.getAttribute('aria-hidden')).toBe('true');
    // …and the word is NOT hidden, which is the half that matters.
    expect(container.querySelector('.oyl-status__label')?.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('the label', () => {
  it('can be overridden where the default word is too blunt', async () => {
    const container = await render('danger', 'This browser has no Bluetooth support');
    expect(container.querySelector('.oyl-status__label')?.textContent).toBe(
      'This browser has no Bluetooth support: ',
    );
  });
});

describe('the live region', () => {
  it('is off by default, so a message present at load is not announced twice', async () => {
    const container = await render('info');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('is on when asked for', async () => {
    mounted = await mount(
      <StatusMessage tone="info" live>
        Checking.
      </StatusMessage>,
    );
    expect(mounted.container.querySelector('[role="status"]')).not.toBeNull();
  });
});
