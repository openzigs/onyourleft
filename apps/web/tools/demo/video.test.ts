// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The video export's decisions that need no browser and no encoder — #1655.
 * What a render actually writes is `demo-video.video.spec.ts`'s, which reads
 * the files back with `ffprobe` and `ffmpeg`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ROUTE_ID } from './route-bundle';
import {
  cardFrames,
  CLOSING_CARD_SECONDS,
  hasEncoder,
  mp4Args,
  parseCssRgb,
  parseFrameMd5,
  parseVideoArgs,
  renderUrl,
  rideFrames,
  sampledFrames,
  shareOfColour,
  VIDEO_ROUTE_ID,
  videoName,
  webmArgs,
} from './video';

describe('demo:video’s arguments — #1655', () => {
  it('reads the issue’s own command', () => {
    expect(
      parseVideoArgs([
        '--',
        '--preset',
        'climb',
        '--seconds',
        '30',
        '--size',
        '1920x1080',
        '--fps',
        '30',
      ]),
    ).toEqual({
      ok: true,
      request: {
        preset: 'climb',
        route: undefined,
        seconds: 30,
        fps: 30,
        width: 1920,
        height: 1080,
        out: undefined,
        mp4: 'auto',
        realistic: true,
      },
    });
  });

  it('defaults to the climb, 30 seconds at 30 a second, 1920 × 1080', () => {
    const parsed = parseVideoArgs([]);
    expect(parsed.ok && parsed.request).toMatchObject({
      preset: 'climb',
      seconds: 30,
      fps: 30,
      width: 1920,
      height: 1080,
    });
  });

  it('takes a route, an output directory, the MP4 switch and --no-realistic', () => {
    const parsed = parseVideoArgs([
      '--route',
      'upstate-climb',
      '--out',
      '/tmp/v',
      '--mp4',
      'off',
      '--no-realistic',
      '--preset',
      'group',
    ]);
    expect(parsed.ok && parsed.request).toMatchObject({
      preset: 'group',
      route: 'upstate-climb',
      out: '/tmp/v',
      mp4: 'off',
      realistic: false,
    });
  });

  it.each([
    [['--preset', 'descent'], 'demo:video: --preset is one of climb, sprint, group, not descent'],
    [['--speed', '2'], 'demo:video has no option --speed'],
    [['--fps'], 'demo:video: --fps needs a value'],
    [['--fps', '--seconds'], 'demo:video: --fps needs a value'],
    [['--fps', '30', '--fps', '25'], 'demo:video: --fps is given twice'],
    [['--fps', '29.97'], 'demo:video: --fps is a whole number from 1 to 60, not 29.97'],
    [['--fps', '0'], 'demo:video: --fps is a whole number from 1 to 60, not 0'],
    [['--fps', '61'], 'demo:video: --fps is a whole number from 1 to 60, not 61'],
    [['--seconds', '0'], 'demo:video: --seconds is a positive number'],
    [['--seconds', 'ten'], 'demo:video: --seconds is a positive number'],
    [
      ['--seconds', '0.05', '--fps', '30'],
      'demo:video: 0.05 seconds at 30 frames a second is not a whole number of frames',
    ],
    [['--seconds', '3601', '--fps', '60'], 'demo:video: 216060 frames is more than 216000'],
    [
      ['--size', '1920'],
      'demo:video: --size is WIDTHxHEIGHT, each even and from 64 to 9998, e.g. 1920x1080',
    ],
    [
      ['--size', '1921x1080'],
      'demo:video: --size is WIDTHxHEIGHT, each even and from 64 to 9998, e.g. 1920x1080',
    ],
    [
      ['--size', '32x32'],
      'demo:video: --size is WIDTHxHEIGHT, each even and from 64 to 9998, e.g. 1920x1080',
    ],
    [['--route', '../secret'], 'demo:video: no route can be called ../secret'],
    [['--mp4', 'yes'], 'demo:video: --mp4 is auto, on or off, not yes'],
  ])('refuses %j: %s', (argv, message) => {
    expect(parseVideoArgs(argv)).toEqual({ ok: false, message });
  });

  it('holds its route id to the bake’s', () => {
    expect(VIDEO_ROUTE_ID.source).toBe(ROUTE_ID.source);
    expect(VIDEO_ROUTE_ID.flags).toBe(ROUTE_ID.flags);
  });
});

describe('what a render writes — #1655', () => {
  it('is seconds × fps frames of ride, and a closing card on a baked route alone', () => {
    expect(rideFrames({ seconds: 30, fps: 30 })).toBe(900);
    expect(rideFrames({ seconds: 2.5, fps: 24 })).toBe(60);
    expect(cardFrames({ route: undefined, fps: 30 })).toBe(0);
    expect(cardFrames({ route: 'upstate-climb', fps: 30 })).toBe(CLOSING_CARD_SECONDS * 30);
  });

  it('names its files as the issue does, with the route when there is one', () => {
    const climb = { preset: 'climb', route: undefined, width: 1920, height: 1080 } as const;
    expect(videoName(climb, 'webm')).toBe('climb-1920x1080.webm');
    expect(videoName(climb, 'mp4')).toBe('climb-1920x1080.mp4');
    expect(videoName({ ...climb, route: 'upstate-climb' }, 'webm')).toBe(
      'climb-upstate-climb-1920x1080.webm',
    );
  });

  it('asks the page for its render clock', () => {
    expect(renderUrl('http://demo.localhost', { preset: 'sprint', route: undefined })).toBe(
      'http://demo.localhost/?preset=sprint&render',
    );
    expect(renderUrl('http://demo.localhost', { preset: 'climb', route: 'fixture' })).toBe(
      'http://demo.localhost/?preset=climb&route=fixture&render',
    );
  });

  it.each([
    ['webm', webmArgs(30, 'out.webm'), 'libvpx-vp9'],
    ['mp4', mp4Args(30, 'out.mp4'), 'libx264'],
  ])(
    'encodes %s from PNG frames at the asked rate, on one thread, with no metadata',
    (_name, args, codec) => {
      expect(args.slice(args.indexOf('-f'), args.indexOf('-i') + 2)).toEqual([
        '-f',
        'image2pipe',
        '-framerate',
        '30',
        '-c:v',
        'png',
        '-i',
        '-',
      ]);
      expect(args[args.indexOf('-c:v', args.indexOf('-i')) + 1]).toBe(codec);
      expect(args[args.indexOf('-threads') + 1]).toBe('1');
      expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
      expect(args).toEqual(expect.arrayContaining(['-an', '-map_metadata', '-1', '+bitexact']));
      expect(args.at(-1)).toMatch(/^out\./);
    },
  );

  it('finds an encoder by its name in ffmpeg’s list, not by a substring', () => {
    const listed = [
      'Encoders:',
      ' V....D libx264              libx264 H.264 / AVC',
      ' V....D libx264rgb           libx264 H.264 RGB',
      ' V....D libvpx-vp9           libvpx VP9',
    ].join('\n');
    expect(hasEncoder(listed, 'libx264')).toBe(true);
    expect(hasEncoder(listed, 'libvpx-vp9')).toBe(true);
    expect(
      hasEncoder(
        listed.replace(' V....D libx264              libx264 H.264 / AVC\n', ''),
        'libx264',
      ),
    ).toBe(false);
  });
});

describe('reading a video back — #1655', () => {
  it('takes each frame’s MD5 from ffmpeg’s framemd5, in order', () => {
    const text = [
      '#format: frame checksums',
      '#version: 2',
      '#tb 0: 1/30',
      '0,          0,          0,        1,   172800, 0123456789abcdef0123456789abcdef',
      '0,          1,          1,        1,   172800, fedcba9876543210fedcba9876543210',
      '',
    ].join('\n');
    expect(parseFrameMd5(text)).toEqual([
      '0123456789abcdef0123456789abcdef',
      'fedcba9876543210fedcba9876543210',
    ]);
    expect(() => parseFrameMd5('0, 0, 0, 1, 10, not-a-hash')).toThrow(/not a frame line/);
  });

  it('samples the first, the middle and the last frame', () => {
    expect(sampledFrames(900)).toEqual([0, 449, 899]);
    expect(sampledFrames(20)).toEqual([0, 9, 19]);
    expect(sampledFrames(2)).toEqual([0, 1]);
    expect(sampledFrames(1)).toEqual([0]);
    expect(() => sampledFrames(0)).toThrow(RangeError);
  });

  it('measures how much of a box is one colour, within a tolerance', () => {
    // A 4 × 2 frame: the left half dark, the right half light.
    const dark = [20, 24, 32];
    const light = [230, 230, 230];
    const rgb = new Uint8Array([
      ...dark,
      ...dark,
      ...light,
      ...light,
      ...dark,
      ...dark,
      ...light,
      ...light,
    ]);
    const whole = { x: 0, y: 0, width: 4, height: 2 };
    expect(shareOfColour(rgb, 4, whole, [20, 24, 32], 0)).toBe(0.5);
    expect(shareOfColour(rgb, 4, { x: 0, y: 0, width: 2, height: 2 }, [30, 30, 30], 10)).toBe(1);
    expect(shareOfColour(rgb, 4, { x: 0, y: 0, width: 2, height: 2 }, [30, 30, 30], 5)).toBe(0);
    // A box past the frame's edge is cut to it; an empty one is none.
    expect(shareOfColour(rgb, 4, { x: 2, y: 1, width: 10, height: 10 }, [230, 230, 230], 0)).toBe(
      1,
    );
    expect(shareOfColour(rgb, 4, { x: 0, y: 0, width: 0, height: 0 }, [20, 24, 32], 0)).toBe(0);
  });

  it('reads a computed colour', () => {
    expect(parseCssRgb('rgb(17, 24, 39)')).toEqual([17, 24, 39]);
    expect(parseCssRgb('rgba(17, 24, 39, 0.9)')).toEqual([17, 24, 39]);
    expect(() => parseCssRgb('oklch(0.2 0 0)')).toThrow(/not an rgb/);
  });
});

describe('demo:video under node — #1655', () => {
  const WEB = fileURLToPath(new URL('../../', import.meta.url));

  it('loads its whole import graph with types stripped, as package.json runs it', () => {
    // #1931's shape: `demo:bake`'s graph reaches a parameter property, which
    // node will not strip, so its script does not start. `demo-video.ts`
    // renders as soon as it is imported, so its graph is loaded through
    // `render-video.ts`, which does nothing until called.
    const manifest = JSON.parse(readFileSync(`${WEB}package.json`, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['demo:video']).toBe(
      'node --import ./tools/ts-extensionless-resolve.mjs tools/demo/demo-video.ts',
    );
    const loaded = spawnSync(
      process.execPath,
      [
        '--import',
        './tools/ts-extensionless-resolve.mjs',
        '--input-type=module',
        '-e',
        "const m = await import('./tools/demo/render-video.ts'); console.log(typeof m.renderDemoVideo);",
      ],
      { cwd: WEB, encoding: 'utf8', timeout: 30_000 },
    );
    expect(loaded.stderr).toBe('');
    expect(loaded.stdout.trim()).toBe('function');
  });
});
