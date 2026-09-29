// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The run-time screen on a model's write-up — #798. Every #564 case the source
 * scan holds is held here again at run time, each with a fixture that goes red
 * when its matcher is deleted from `angle-claims.ts`; and the three narrowings
 * that must NOT fire are held too, because a screen that withholds every
 * write-up passes every "withheld" test.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { UntrustedText } from './analysis-port';
import {
  MAXIMUM_WRITE_UP_CHARACTERS,
  passedScreen,
  type ScreenedWriteUp,
  type ScreenReason,
  screenWriteUp,
  type WithheldWriteUp,
} from './write-up-screen';

function untrusted(text: string): UntrustedText {
  return text as UntrustedText;
}

function shown(text: string): string {
  const outcome = screenWriteUp(untrusted(text));
  if (!passedScreen(outcome)) {
    throw new Error(`withheld: ${outcome.withheld.join(', ')}`);
  }
  return outcome;
}

function reasons(text: string): readonly ScreenReason[] {
  const outcome = screenWriteUp(untrusted(text));
  if (passedScreen(outcome)) {
    throw new Error('shown');
  }
  return outcome.withheld;
}

const CLEAN = 'A steady first half, then the power rose on the final climb.';

describe('screenWriteUp — the angle and frontal-plane rules, at run time', () => {
  it('shows a write-up that breaks no rule, as written', () => {
    expect(shown(CLEAN)).toBe(CLEAN);
  });

  it.each([
    ['U+00B0', '\u00b0'],
    ['U+00BA', '\u00ba'],
    ['U+02DA', '\u02da'],
    ['U+2070', '\u2070'],
    ['U+1D52', '\u1d52'],
    ['U+2218', '\u2218'],
  ])('withholds the degree sign spelled %s', (_name, sign) => {
    expect(reasons(`Your knee reached 142${sign} at the bottom.`)).toEqual(['angle-sign']);
  });

  it.each(['142deg', '142 deg', '142 DEG'])('withholds the abbreviation in %j', (text) => {
    expect(reasons(`The knee was ${text} there.`)).toEqual(['angle-sign']);
  });

  it('withholds the sign written as a character reference, although it is shown as text', () => {
    expect(reasons('The knee was 142&deg; there.')).toEqual(['angle-sign']);
    expect(reasons('The knee was 142&#176; there.')).toEqual(['angle-sign']);
    expect(reasons('The knee was 142&#xB0; there.')).toEqual(['angle-sign']);
  });

  it('withholds the word, singular or plural, in any case', () => {
    expect(reasons('about ten degrees more')).toEqual(['angle-word']);
    expect(reasons('One Degree less')).toEqual(['angle-word']);
  });

  it.each([
    'Some knee valgus appeared late.',
    'Your hips rocking on the climb.',
    'There was side-to-side movement.',
    'Possible hip drop in the last third.',
    'Your shoulders were less level.',
    'Lateral sway increased.',
    'Foot eversion was visible.',
    'The frontal view shows it.',
  ])('withholds the frontal plane in %j', (text) => {
    expect(reasons(text)).toEqual(['body-sideways']);
  });

  it.each([
    ['a soft hyphen', 'val\u00adgus'],
    ['a zero-width space', 'val\u200bgus'],
    ['a zero-width non-joiner', 'val\u200cgus'],
    ['a zero-width joiner', 'val\u200dgus'],
    ['a word joiner', 'val\u2060gus'],
    ['a byte-order mark', 'val\ufeffgus'],
    ['a right-to-left override', 'val\u202egus'],
    ['a directional isolate', 'val\u2066gus'],
  ])('reads through %s inside a word', (_name, word) => {
    expect(reasons(`Some knee ${word} appeared.`)).toEqual(['body-sideways']);
  });

  it('reads a word split across two lines as one sentence', () => {
    expect(reasons('Possible hip\ndrop late on.')).toEqual(['body-sideways']);
  });

  it('reads a full-width word as the word', () => {
    expect(reasons('ten ｄｅｇｒｅｅｓ')).toEqual(['angle-word']);
  });

  it.each([
    'The road shoulder is level with the verge.',
    'You rode on the hard shoulder, which was level.',
    'It was 30\u00b0C at the start and 86\u00b0F by the end.',
    'The display used a colour inversion at dusk.',
    'A temperature inversion kept the valley cold.',
    'A lateral shift of the camera moved the picture.',
    'Your cadence rocked steadily between 85 and 95.',
  ])('does not withhold %j, which is not about a body', (text) => {
    expect(shown(text)).toBe(text);
  });

  it('reports every kind, each once, and nothing else', () => {
    expect(reasons('142\u00b0, 150\u00b0, ten degrees, and valgus')).toEqual([
      'angle-sign',
      'angle-word',
      'body-sideways',
    ]);
  });
});

describe('screenWriteUp — withheld whole, and never with the model’s words', () => {
  const failing = `${CLEAN}\nYour knee reached 142\u00b0 at the bottom.\nThe finish was strong.`;

  it('returns no text at all when one sentence of many fails', () => {
    const outcome = screenWriteUp(untrusted(failing));
    expect(passedScreen(outcome)).toBe(false);
    expect(typeof outcome).toBe('object');
    expect(Object.keys(outcome)).toEqual(['withheld']);
  });

  it('carries only the kinds of finding, none of the words that failed or surround them', () => {
    const serialised = JSON.stringify(screenWriteUp(untrusted(failing)));
    for (const word of ['knee', '142', 'bottom', 'steady', 'finish', '\u00b0']) {
      expect(serialised).not.toContain(word);
    }
    expect(serialised).toBe('{"withheld":["angle-sign"]}');
  });
});

describe('screenWriteUp — plain text only', () => {
  it('leaves markdown, markup and URLs as the characters they are', () => {
    const text =
      '**Strong** finish. <b>bold</b> <a href="https://example.org">x</a> ' +
      '[link](javascript:alert(1)) javascript:alert(1) https://example.org &lt;i&gt;';
    expect(shown(text)).toBe(text);
  });

  it('is a string React renders as text: no element, no link, whatever it says', () => {
    const text = '<b>bold</b> <script>x()</script> [a](javascript:alert(1)) https://example.org';
    const markup = renderToStaticMarkup(createElement('p', null, shown(text)));
    expect(markup).toBe(
      '<p>&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;x()&lt;/script&gt; [a](javascript:alert(1)) https://example.org</p>',
    );
    expect(markup).not.toMatch(/<(?!\/?p>)/);
  });

  it('keeps a newline, writes a CRLF or a carriage return as one, and a tab as a space', () => {
    expect(shown('one\r\ntwo\rthree\nfour\tfive')).toBe('one\ntwo\nthree\nfour five');
  });

  it('takes out every character that renders as nothing or reorders the text', () => {
    const out = shown('a\u00adb\u200bc\u200ed\u202ae\u202cf\u2066g\u2069h\ufeffi\u061cj');
    expect(out).toBe('abcdefghij');
  });

  it('holds nothing but printable text and newlines, whatever it was handed', () => {
    for (const code of [0x00, 0x07, 0x0b, 0x0c, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f]) {
      const text = `before ${String.fromCharCode(code)} after`;
      expect(reasons(text), `U+${code.toString(16)}`).toEqual(['control-character']);
    }
  });

  it('reports a control character beside any angle finding', () => {
    expect(reasons('142\u00b0 \u0007')).toEqual(['control-character', 'angle-sign']);
  });

  it('withholds an empty write-up, and one of nothing but white space and invisibles', () => {
    expect(reasons('')).toEqual(['empty']);
    expect(reasons(' \n\t\u200b\ufeff ')).toEqual(['empty']);
  });

  it('shows a write-up of exactly the store’s bound, and withholds one character more', () => {
    expect(MAXIMUM_WRITE_UP_CHARACTERS).toBe(16_000);
    expect(shown('a'.repeat(MAXIMUM_WRITE_UP_CHARACTERS))).toHaveLength(
      MAXIMUM_WRITE_UP_CHARACTERS,
    );
    expect(reasons('a'.repeat(MAXIMUM_WRITE_UP_CHARACTERS + 1))).toEqual(['too-long']);
  });

  it('measures the length after trimming, as the store will', () => {
    expect(shown(`  ${'a'.repeat(MAXIMUM_WRITE_UP_CHARACTERS)}\n`)).toHaveLength(
      MAXIMUM_WRITE_UP_CHARACTERS,
    );
  });
});

describe('ScreenedWriteUp — made only by the screen', () => {
  it('cannot be an unscreened write-up or a plain string', () => {
    const needsScreened = (writeUp: ScreenedWriteUp): string => writeUp;
    const raw = untrusted(CLEAN);
    // @ts-expect-error — an UntrustedText has not been screened.
    expect(needsScreened(raw)).toBe(CLEAN);
    // @ts-expect-error — nor has a plain string.
    expect(needsScreened(CLEAN)).toBe(CLEAN);
    const outcome: ScreenedWriteUp | WithheldWriteUp = screenWriteUp(raw);
    if (passedScreen(outcome)) {
      expect(needsScreened(outcome)).toBe(CLEAN);
    } else {
      throw new Error('a clean write-up was withheld');
    }
  });

  it('is only ever made in write-up-screen.ts — no other shipped file casts to it', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const casts: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const count = (readFileSync(path, 'utf8').match(/as\s+ScreenedWriteUp\b/g) ?? []).length;
          for (let index = 0; index < count; index += 1) {
            casts.push(relative(root, path));
          }
        }
      }
    };
    walk(root);
    expect(casts).toEqual([join('camera', 'write-up-screen.ts')]);
  });
});
