// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3156: the script render's checks that need no browser. The render holds
 * each caption it draws to {@link drawnProblems} against the page's own boxes
 * and stops on a frame that breaks it; what a whole render wrote was read
 * back with `ffprobe` on the pull request.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';
import { MENU_MUSIC_FILE } from '../../src/shell/menu-music';
import type { Box } from './caption-layout';
import { SCRIPT_MUSIC } from './capture-args';
import {
  drawnProblems,
  finishVideo,
  hudProblems,
  LOGO_FILE,
  logoDataUrl,
  musicFile,
  partialName,
  scriptName,
} from './render-script';

const box = (x: number, y: number, width: number, height: number): Box => ({
  x,
  y,
  width,
  height,
});
const FRAME = { width: 1920, height: 1080 };

describe('a drawn caption, held to the rules — #3156', () => {
  const target = box(380, 17, 139, 101);
  const credit = box(8, 706, 194, 20);

  it('passes a caption clear of its panel and the credit, inside title-safe', () => {
    expect(drawnProblems(box(600, 220, 500, 80), { target, credit }, 'callout', FRAME)).toEqual([]);
  });

  it('refuses one over its panel, over the credit, or outside title-safe', () => {
    expect(drawnProblems(box(400, 30, 500, 80), { target, credit }, 'callout', FRAME)).toEqual([
      'covers the panel it explains',
      'is outside the title-safe area',
    ]);
    expect(
      drawnProblems(box(150, 680, 500, 80), { target: undefined, credit }, 'lower-third', FRAME),
    ).toEqual(['covers the map credit']);
  });

  it('lets a caption touch its panel’s edge, and a card fill the frame', () => {
    // Touching to the half pixel the browser rounds to is not covering.
    expect(
      drawnProblems(box(519.5, 117.5, 400, 80), { target, credit: undefined }, 'callout', FRAME),
    ).toEqual([]);
    expect(
      drawnProblems(box(0, 0, 1920, 1080), { target: undefined, credit: undefined }, 'card', FRAME),
    ).toEqual([]);
    expect(
      drawnProblems(box(0, 0, 1920, 1080), { target: undefined, credit }, 'card', FRAME),
    ).toEqual(['covers the map credit']);
  });

  it('names the video, its captions and chapters after the script and the frame', () => {
    const request = { script: 'youtube', fps: 60, width: 1920, height: 1080, out: undefined };
    expect(scriptName(request, '.mp4')).toBe('youtube-1920x1080-60fps.mp4');
    expect(scriptName(request, '.srt')).toBe('youtube-1920x1080-60fps.srt');
  });
});

describe('the script’s video, named only when whole — #3156', () => {
  it('encodes under a partial name, and renames it only with every frame written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oyl-render-script-'));
    try {
      const mp4 = join(dir, 'youtube-1920x1080-60fps.mp4');
      const partial = partialName(mp4);
      expect(partial).toBe(join(dir, 'youtube-1920x1080-60fps.partial.mp4'));
      writeFileSync(mp4, 'an earlier whole render');
      writeFileSync(partial, 'cut off');
      expect(() => {
        finishVideo(partial, mp4, 9, 10);
      }).toThrow('capture: wrote 9 frames, not the script’s 10');
      expect(readFileSync(mp4, 'utf8')).toBe('an earlier whole render');
      expect(existsSync(partial)).toBe(true);
      writeFileSync(partial, 'whole');
      finishVideo(partial, mp4, 10, 10);
      expect(readFileSync(mp4, 'utf8')).toBe('whole');
      expect(existsSync(partial)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the YouTube cut’s music bed — #3223', () => {
  it('mixes the music under the whole video, and names only the mixed video whole', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oyl-render-script-'));
    try {
      const mp4 = join(dir, 'youtube-1920x1080-60fps.mp4');
      const partial = partialName(mp4);
      writeFileSync(partial, 'silent');
      const mixed: string[] = [];
      finishVideo(partial, mp4, 10, 10, (video, out) => {
        mixed.push(video, out);
        writeFileSync(out, `${readFileSync(video, 'utf8')} with music`);
      });
      expect(mixed).toEqual([partial, join(dir, 'youtube-1920x1080-60fps.mixed.partial.mp4')]);
      expect(readFileSync(mp4, 'utf8')).toBe('silent with music');
      expect(existsSync(partial)).toBe(false);
      expect(existsSync(mixed[1] ?? '')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the silent partial and an earlier whole video as they were when the mix fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oyl-render-script-'));
    try {
      const mp4 = join(dir, 'youtube-1920x1080-60fps.mp4');
      const partial = partialName(mp4);
      writeFileSync(mp4, 'an earlier whole render');
      writeFileSync(partial, 'silent');
      expect(() => {
        finishVideo(partial, mp4, 10, 10, () => {
          throw new Error('capture: mixing the music failed');
        });
      }).toThrow('capture: mixing the music failed');
      expect(readFileSync(mp4, 'utf8')).toBe('an earlier whole render');
      expect(readFileSync(partial, 'utf8')).toBe('silent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('carries only the app’s own CC0 menu loop, credited as ASSETS.toml records it', () => {
    expect(Object.keys(SCRIPT_MUSIC)).toEqual(['aurora-ride']);
    const music = SCRIPT_MUSIC['aurora-ride'];
    if (music === undefined) throw new Error('no aurora-ride');
    // The file the menus play (#2057), from the app's own public/.
    expect(music.file).toBe(MENU_MUSIC_FILE);
    expect(musicFile(music).replaceAll('\\', '/')).toMatch(
      /\/apps\/web\/public\/audio\/upbeat-game-loop-aurora-ride\.ogg$/u,
    );
    expect(existsSync(musicFile(music))).toBe(true);
    const repository = join(LOGO_FILE, '..', '..', '..', '..', '..');
    const manifest = parseAssetManifest(readFileSync(join(repository, 'ASSETS.toml'), 'utf8'));
    const row = manifest.entries.find((entry) => entry.path === `apps/web/public/${music.file}`);
    expect(row).toMatchObject({ licence: 'CC0-1.0', creator: 'Venus17' });
    expect(music.credit).toContain('Upbeat Game Loop - Aurora Ride');
    expect(music.credit).toContain(`by ${String(row?.creator)}`);
    expect(music.credit).toContain('CC0 1.0');
    expect(music.credit).toContain(String(row?.url));
  });
});

describe('the whole HUD on every captioned frame — #3175', () => {
  it('refuses a frame missing or fading a panel its mode draws, and passes one with all of them', () => {
    expect(hudProblems([], 'callout')).toEqual([]);
    expect(hudProblems(['controls'], 'lower-third')).toEqual([
      'the HUD does not show controls, drawn and unfaded',
    ]);
    expect(hudProblems(['elevation', 'map'], 'title')).toEqual([
      'the HUD does not show elevation, map, drawn and unfaded',
    ]);
  });

  it('does not ask the closing card, which covers the whole frame', () => {
    expect(hudProblems(['controls'], 'card')).toEqual([]);
  });
});

describe('the logo in the intro — #3175', () => {
  it('draws the app’s own dark-palette logo, untouched, from its bytes', () => {
    expect(LOGO_FILE.replaceAll('\\', '/')).toMatch(/\/apps\/web\/src\/brand\/logo-dark\.webp$/u);
    const url = logoDataUrl();
    expect(url.startsWith('data:image/webp;base64,')).toBe(true);
    expect(Buffer.from(url.slice('data:image/webp;base64,'.length), 'base64')).toEqual(
      readFileSync(LOGO_FILE),
    );
  });
});
