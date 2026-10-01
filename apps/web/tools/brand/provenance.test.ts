// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's brand art, as `ASSETS.toml` records it and as it is drawn — #965.
 *
 * `derive_brand.py` needs Python with Pillow, NumPy and SciPy at pinned
 * versions, which CI does not install, so CI does not re-run it — `--check` is
 * run by hand and quoted in the pull request that changes it,
 * the shape `tools/realistic/provenance.test.ts` has for Blender. What runs
 * here, on every pull request, is everything that does not need the pipeline:
 *
 * 1. **The manifest is the pipeline's own table.** Every source and every
 *    output in `brand.json` has an `ASSETS.toml` row carrying exactly the
 *    licence, creator, url, modified, input, input digest, script and tool the
 *    table gives it, and no row claims the script for a file the table does not
 *    make. `ASSET003` already pins each file's bytes; this pins what the row
 *    says about them.
 * 2. **The pictures are the shapes a launcher needs.** Read back from the
 *    committed PNGs: a square icon is opaque, a maskable one keeps the mark
 *    inside the middle 80 % a browser may crop to, an Android foreground keeps
 *    it inside the 66 dp circle of its 108 dp layer, a round icon is a disc, and
 *    a wordmark or a logo is cut out — its corners transparent, not the
 *    checkerboard Gemini painted into the sheet.
 * 3. **The Android background layer is the icons' own blue.**
 * 4. **The full logo is off its green screen, cleanly, and says no tagline.**
 *    No pixel of either logo that is more than a quarter covered is greener
 *    than the key's despill allows (a wrong key, or no despill, leaves a green
 *    fringe here); the light variant's white sticker has a visible edge on the
 *    white canvas; and no text the app ships carries the tagline the owner
 *    dropped on 2026-10-01.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';
import { DARK_COLOUR_TOKENS } from '../../src/design/tokens';

import { decodePng, type DecodedPng } from './png-testing';

interface BrandOutput {
  readonly path: string;
  readonly family: string;
  readonly kind: string;
  readonly size: number;
}

interface BrandTable {
  readonly creator: string;
  readonly url: string;
  readonly read: string;
  readonly tool: string;
  readonly sources: readonly { path: string; sha256: string; what: string }[];
  readonly families: Readonly<Record<string, { source: string; modified: string }>>;
  readonly outputs: readonly BrandOutput[];
}

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = 'apps/web/tools/brand/derive_brand.py';
const table = JSON.parse(
  readFileSync(fileURLToPath(new URL('./brand.json', import.meta.url)), 'utf8'),
) as BrandTable;
const manifest = parseAssetManifest(readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8'));

function bytesOf(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(REPOSITORY, path)));
}

function entryFor(path: string) {
  const entry = manifest.entries.find((candidate) => candidate.path === path);
  if (entry === undefined) {
    throw new Error(`${path} has no ASSETS.toml entry`);
  }
  return entry;
}

function picture(path: string): DecodedPng {
  return decodePng(bytesOf(path));
}

function pixel(image: DecodedPng, x: number, y: number): readonly number[] {
  const at = (y * image.width + x) * 4;
  return [...image.rgba.subarray(at, at + 4)];
}

/** The largest distance from the centre, as a share of the side, of any pixel the test picks. */
function reach(image: DecodedPng, picked: (rgba: readonly number[]) => boolean): number {
  const centre = (image.width - 1) / 2;
  let furthest = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (picked(pixel(image, x, y))) {
        furthest = Math.max(furthest, Math.hypot(x - centre, y - (image.height - 1) / 2));
      }
    }
  }
  return furthest / image.width;
}

function outputs(kind: string): readonly BrandOutput[] {
  const found = table.outputs.filter((output) => output.kind === kind);
  if (found.length === 0) {
    throw new Error(`brand.json makes no ${kind}`);
  }
  return found;
}

/** The Android background layer's colour, as `ic_launcher_background.xml` declares it. */
function launcherBlue(): readonly number[] {
  const xml = readFileSync(
    join(REPOSITORY, 'apps/mobile/android/app/src/main/res/values/ic_launcher_background.xml'),
    'utf8',
  );
  const colour = /<color name="ic_launcher_background">#([0-9A-Fa-f]{6})<\/color>/.exec(xml)?.[1];
  if (colour === undefined) {
    throw new Error('ic_launcher_background.xml declares no ic_launcher_background colour');
  }
  return [0, 2, 4].map((at) => Number.parseInt(colour.slice(at, at + 2), 16));
}

/** The flat blue every icon is drawn on, read from the largest square icon's corner. */
function panelBlue(): readonly number[] {
  return pixel(picture('apps/web/public/icon-512.png'), 0, 0).slice(0, 3);
}

describe('the brand art in ASSETS.toml — #965', () => {
  it.each(table.sources)('records the source $path as the owner supplied it', (source) => {
    expect(createHash('sha256').update(bytesOf(source.path)).digest('hex')).toBe(source.sha256);
    const entry = entryFor(source.path);
    expect(entry).toMatchObject({
      licence: 'CC-BY-4.0',
      sha256: source.sha256,
      creator: table.creator,
      url: table.url,
      read: table.read,
      modified: 'no',
    });
    expect(entry.source).toContain('generated with Google Gemini');
  });

  it.each(table.outputs)('records $path as derive_brand.py makes it', (output) => {
    const family = table.families[output.family];
    if (family === undefined) {
      throw new Error(`${output.path} names no family brand.json has`);
    }
    const source = table.sources.find((candidate) => candidate.path === family.source);
    expect(source, `${output.family}'s source is not a recorded source`).toBeDefined();
    const entry = entryFor(output.path);
    expect(entry).toMatchObject({
      licence: 'CC-BY-4.0',
      creator: table.creator,
      url: table.url,
      read: table.read,
      modified: family.modified,
      input: family.source,
      inputsha256: source?.sha256,
      script: SCRIPT,
      tool: table.tool,
    });
    expect(entry.source).toContain('generated with Google Gemini');
  });

  it('claims the script for nothing the table does not make', () => {
    const made = new Set(table.outputs.map((output) => output.path));
    const claimed = manifest.entries.filter((entry) => entry.script === SCRIPT);
    expect(claimed.map((entry) => entry.path).sort()).toEqual([...made].sort());
  });
});

describe('the brand pictures — #965', () => {
  it.each(table.outputs)('$path is the size brand.json asks for', (output) => {
    const image = picture(output.path);
    if (output.family === 'icon') {
      expect([image.width, image.height]).toEqual([output.size, output.size]);
    } else if (output.family === 'wordmark') {
      expect(image.height).toBe(output.size);
    } else {
      expect(image.width).toBe(output.size);
    }
  });

  it.each([...outputs('square'), ...outputs('maskable')])(
    '$path is opaque, and the flat blue all the way to its corners',
    (output) => {
      // The sheet's icon has rounded corners baked in on a light background;
      // a launcher's mask must be the only rounding, so every edge pixel is
      // the Android background layer's blue.
      const image = picture(output.path);
      expect(image.hasAlpha).toBe(false);
      const blue = launcherBlue();
      const last = image.width - 1;
      for (let at = 0; at <= last; at += 1) {
        for (const [x, y] of [
          [at, 0],
          [at, last],
          [0, at],
          [last, at],
        ] as const) {
          const edge = pixel(image, x, y);
          blue.forEach((channel, index) => {
            expect(Math.abs((edge[index] ?? 0) - channel)).toBeLessThanOrEqual(2);
          });
        }
      }
    },
  );

  it.each(outputs('maskable'))(
    '$path keeps the mark inside the middle 80 % a browser may crop to',
    (output) => {
      const image = picture(output.path);
      const blue = panelBlue();
      // Everything that is not the flat blue is the mark (or its edge).
      const markReach = reach(image, (rgba) =>
        rgba.slice(0, 3).some((channel, index) => Math.abs(channel - (blue[index] ?? 0)) > 6),
      );
      expect(markReach).toBeGreaterThan(0.3);
      expect(markReach).toBeLessThanOrEqual(0.4);
    },
  );

  it.each(outputs('foreground'))(
    '$path keeps the mark inside the 66 dp circle of its 108 dp layer',
    (output) => {
      const image = picture(output.path);
      const markReach = reach(image, (rgba) => (rgba[3] ?? 0) > 0);
      expect(markReach).toBeGreaterThan(0.2);
      expect(markReach).toBeLessThanOrEqual(33 / 108);
    },
  );

  it.each(outputs('round'))('$path is a disc', (output) => {
    const image = picture(output.path);
    const last = image.width - 1;
    for (const [x, y] of [
      [0, 0],
      [last, 0],
      [0, last],
      [last, last],
    ] as const) {
      expect(pixel(image, x, y)[3]).toBe(0);
    }
    expect(pixel(image, Math.floor(image.width / 2), 1)[3]).toBe(255);
  });

  it.each([
    ...outputs('wordmark-light'),
    ...outputs('wordmark-dark'),
    ...outputs('logo-light'),
    ...outputs('logo-dark'),
  ])('$path is cut out, not the sheet’s painted checkerboard', (output) => {
    const image = picture(output.path);
    const last = [image.width - 1, image.height - 1] as const;
    for (const [x, y] of [
      [0, 0],
      [last[0], 0],
      [0, last[1]],
      [last[0], last[1]],
    ] as const) {
      expect(pixel(image, x, y)[3]).toBe(0);
    }
    let opaque = 0;
    for (let index = 3; index < image.rgba.length; index += 4) {
      if (image.rgba[index] === 255) opaque += 1;
    }
    expect(opaque / (image.width * image.height)).toBeGreaterThan(0.2);
  });

  it('sets the dark wordmark’s letters in the dark palette’s ink, and the light one’s in navy', () => {
    // The commonest fully opaque colour is the letters' one flat colour: the
    // pipeline sets every letter pixel in it, and the arrow is far smaller.
    const lettersOf = (path: string): readonly number[] => {
      const image = picture(path);
      const counts = new Map<string, number>();
      for (let index = 0; index < image.rgba.length; index += 4) {
        if (image.rgba[index + 3] !== 255) continue;
        const key = [...image.rgba.subarray(index, index + 3)].join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      return (top?.[0] ?? '').split(',').map(Number);
    };
    expect(lettersOf('apps/web/src/brand/wordmark-light.png')).toEqual([17, 36, 64]);
    // `derive_brand.py` writes the dark ink out rather than importing it; this
    // is what holds the two together.
    const ink = DARK_COLOUR_TOKENS.ink;
    expect(lettersOf('apps/web/src/brand/wordmark-dark.png')).toEqual(
      [1, 3, 5].map((at) => Number.parseInt(ink.slice(at, at + 2), 16)),
    );
  });
});

describe('the Android launcher icon — #965', () => {
  it('draws its background layer in the icons’ own blue', () => {
    const declared = launcherBlue();
    panelBlue().forEach((channel, index) => {
      expect(Math.abs(channel - (declared[index] ?? 0))).toBeLessThanOrEqual(1);
    });
  });
});

describe('the full logo, off its green screen — #965', () => {
  const logos = [...outputs('logo-light'), ...outputs('logo-dark')];

  it.each(logos)('$path has no green fringe', (output) => {
    // `derive_brand.py` holds green to 10 above the larger of red and blue;
    // the resampler's rounding at a faint edge pixel may add a few more, so
    // the bound is on pixels at least a quarter covered, with room for that.
    const image = picture(output.path);
    let fringe = 0;
    for (let index = 0; index < image.rgba.length; index += 4) {
      if ((image.rgba[index + 3] ?? 0) < 64) continue;
      const [red = 0, green = 0, blue = 0] = image.rgba.subarray(index, index + 3);
      if (green - Math.max(red, blue) > 16) fringe += 1;
    }
    expect(fringe).toBe(0);
  });

  it('gives the light logo’s white sticker an edge the white canvas can see', () => {
    // Laid on the light palette's canvas (white), the pixel two to the left of
    // each row's first fully opaque one is the sticker's outside edge. Without
    // the shadow it is the canvas's own white.
    const image = picture(outputs('logo-light')[0]?.path ?? '');
    const edges: number[] = [];
    for (let y = 0; y < image.height; y += 1) {
      let first = -1;
      for (let x = 0; x < image.width; x += 1) {
        if (pixel(image, x, y)[3] === 255) {
          first = x;
          break;
        }
      }
      if (first < 3) continue;
      const [red = 0, green = 0, blue = 0, alpha = 0] = pixel(image, first - 2, y);
      const over = alpha / 255;
      edges.push(((red + green + blue) / 3) * over + 255 * (1 - over));
    }
    edges.sort((a, b) => a - b);
    expect(edges.length).toBeGreaterThan(100);
    expect(edges[Math.floor(edges.length / 2)]).toBeLessThan(235);
  });

  it('no shipped text carries the tagline', () => {
    // Assembled, so this file does not match itself.
    const tagline = ['agentic', 'cycling', 'trainer'].join(' ');
    const roots = ['apps/web/src', 'apps/web/public', 'apps/web/index.html', 'ASSETS.toml'];
    const texts: string[] = [];
    const walk = (path: string): void => {
      const full = join(REPOSITORY, path);
      if (statSync(full).isDirectory()) {
        for (const name of readdirSync(full)) walk(join(path, name));
      } else if (/\.(ts|tsx|css|html|json|toml|txt|webmanifest|md)$/.test(path)) {
        texts.push(path);
      }
    };
    roots.forEach(walk);
    expect(texts.length).toBeGreaterThan(100);
    const carrying = texts.filter((path) =>
      readFileSync(join(REPOSITORY, path), 'utf8').toLowerCase().includes(tagline),
    );
    expect(carrying).toEqual([]);
  });
});
