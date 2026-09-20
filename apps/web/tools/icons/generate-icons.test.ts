// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The committed icons are what the generator draws (#405).
 *
 * The same claim `packages/fit`'s corpus makes about its own generator, and for
 * the same reason: a committed artefact with a generator beside it is two
 * things that can disagree, and `ASSETS.toml`'s digest pins the bytes without
 * saying anything about whether they are still the drawing this file describes.
 *
 * ⚠️ **It compares decoded pixels, not bytes.** zlib's compressed form is not
 * guaranteed stable across versions of the library, so a byte comparison would
 * turn a different Node 24 patch release into a red build about an image that
 * is identical. Inflating the committed `IDAT` asks the question worth asking:
 * is this the same picture?
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COLOUR_TOKENS } from '../../src/design/tokens';

import {
  decodePng,
  drawIcon,
  encodePng,
  ICON_BACKGROUND,
  ICON_FOREGROUND,
  ICON_SPECS,
  PUBLIC_DIRECTORY,
} from './generate-icons';

function committed(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, PUBLIC_DIRECTORY))));
}

describe.each(ICON_SPECS)('$file', (spec) => {
  it('is the picture the generator draws', () => {
    const decoded = decodePng(committed(spec.file));
    expect(decoded.size).toBe(spec.size);
    expect([...decoded.pixels]).toEqual([...drawIcon(spec)]);
  });

  it('round-trips through this module’s own encoder and decoder', () => {
    // Without this the assertion above could be green because `decodePng` and
    // `drawIcon` share a bug — the committed file is the only independent
    // artefact in the comparison, and this is what says the pair is sound.
    const pixels = drawIcon(spec);
    expect([...decodePng(encodePng(spec.size, pixels)).pixels]).toEqual([...pixels]);
  });
});

describe('the icons and the design tokens', () => {
  it('paints the accent on the accent’s own ink, as tokens.ts spells them', () => {
    // `generate-icons.ts` writes the two colours out rather than importing
    // them, so that build-time code stays out of the client's module graph.
    // This is what stops that being a licence to drift.
    expect(ICON_BACKGROUND).toBe(COLOUR_TOKENS.accent);
    expect(ICON_FOREGROUND).toBe(COLOUR_TOKENS.accentInk);
  });

  it('keeps the maskable variant inside the safe zone a launcher crops to', () => {
    // Android masks an adaptive icon to a shape inscribed in the middle 80%.
    // A mark that reaches outside it loses its corners on some launchers and
    // not on others, which is the failure nobody sees on their own phone.
    const maskable = ICON_SPECS.find((spec) => spec.maskable);
    if (maskable === undefined) {
      throw new Error('there is no maskable icon to check');
    }
    const pixels = drawIcon(maskable);
    const margin = Math.floor(maskable.size * 0.1);
    const background = [11, 92, 85];
    for (let y = 0; y < maskable.size; y += 1) {
      for (let x = 0; x < maskable.size; x += 1) {
        const inside =
          x >= margin && x < maskable.size - margin && y >= margin && y < maskable.size - margin;
        if (inside) {
          continue;
        }
        const at = (y * maskable.size + x) * 3;
        expect([pixels[at], pixels[at + 1], pixels[at + 2]]).toEqual(background);
      }
    }
  });
});
