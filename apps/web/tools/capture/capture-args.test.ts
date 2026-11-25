// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: the capture's decisions that need no browser and no encoder. What a
 * capture actually writes was read back with `ffprobe` on the pull request.
 */

import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_MODE, CAPTURE_SCENES, captureSceneFromHash } from '../../src/game/capture-scene';
import { gameRouteFromHash } from '../../src/shell/routes';
import {
  CAPTURE_DATE_MS,
  CAPTURE_ROUTE_NAME,
  captureFrames,
  captureHash,
  captureRideName,
  captureMp4Args,
  captureName,
  captureRouteGpx,
  MAX_CAPTURE_FRAMES,
  parseCaptureArgs,
  parseScriptArgs,
} from './capture-args';

describe('capture’s arguments — #3152', () => {
  it('reads the issue’s own command, with 1920×1080 at 60 fps by default', () => {
    expect(parseCaptureArgs(['--', '--scene', 'route-hud', '--seconds', '20'])).toEqual({
      ok: true,
      request: {
        scene: 'route-hud',
        seconds: 20,
        fps: 60,
        width: 1920,
        height: 1080,
        out: undefined,
      },
    });
  });

  it('takes a size, a frame rate and a directory', () => {
    const parsed = parseCaptureArgs(['--fps', '30', '--size', '1280x720', '--out', '/tmp/x']);
    expect(parsed).toEqual({
      ok: true,
      request: {
        scene: 'route-hud',
        seconds: 20,
        fps: 30,
        width: 1280,
        height: 720,
        out: '/tmp/x',
      },
    });
  });

  it('takes a free ride’s start and archive (#3154)', () => {
    const parsed = parseCaptureArgs([
      '--scene',
      'free-ride',
      '--start',
      '40.1,-75.25',
      '--archive',
      '/maps/basemap.pmtiles',
    ]);
    expect(parsed.ok && parsed.request).toMatchObject({
      scene: 'free-ride',
      start: '40.1,-75.25',
      archive: '/maps/basemap.pmtiles',
    });
  });

  it('never repeats a refused start back: it is a place (ADR 0004 D)', () => {
    const parsed = parseCaptureArgs([
      '--scene',
      'free-ride',
      '--start',
      '95.123,-75.456',
      '--archive',
      'a',
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.message).not.toContain('95.123');
      expect(parsed.message).not.toContain('75.456');
    }
  });

  it.each([
    [['--preset', 'climb'], /no option --preset/u],
    [['--scene'], /needs a value/u],
    [['--scene', 'x', '--scene', 'y'], /given twice/u],
    [
      ['--scene', 'gravel'],
      /--scene is one of route-hud, delivery, lap-race, workout, pacer, free-ride, not gravel/u,
    ],
    // #3154: a free ride's start and archive, both, and only a free ride's.
    [['--scene', 'free-ride'], /rides the open world, so it needs --start and --archive/u],
    [['--scene', 'free-ride', '--start', '40.1,-75.2'], /needs --start and --archive/u],
    [['--start', '40.1,-75.2', '--archive', 'a.pmtiles'], /for a scene that rides the open world/u],
    [['--scene', 'free-ride', '--start', '91.0,-75.2', '--archive', 'a'], /latitude to 90/u],
    [['--scene', 'free-ride', '--start', '40.1;-75.2', '--archive', 'a'], /<lat>,<lon>/u],
    [['--seconds', '0'], /positive/u],
    [['--fps', '61'], /1 to 60/u],
    [['--fps', '2.5'], /1 to 60/u],
    [['--seconds', '0.01', '--fps', '30'], /not a whole number of frames/u],
    [['--seconds', String(MAX_CAPTURE_FRAMES)], /more than/u],
    [['--size', '1921x1080'], /each even/u],
    [['--size', 'big'], /WIDTHxHEIGHT/u],
  ])('refuses %j', (argv, message) => {
    const parsed = parseCaptureArgs(argv);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(message);
  });
});

describe('a capture’s frames and file — #3152', () => {
  it('is seconds × fps frames, exactly', () => {
    expect(captureFrames({ seconds: 20, fps: 60 })).toBe(1_200);
    expect(captureFrames({ seconds: 0.5, fps: 60 })).toBe(30);
  });

  it('names the scene, the size and the rate', () => {
    expect(
      captureName({
        scene: 'route-hud',
        seconds: 20,
        fps: 60,
        width: 1920,
        height: 1080,
        out: undefined,
      }),
    ).toBe('route-hud-1920x1080-60fps.mp4');
  });

  it('encodes H.264 High, 4:2:0, at CRF 16 and 60 fps, with the index first', () => {
    const args = captureMp4Args(60, 'out.mp4');
    const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(after('-c:v')).toBe('png');
    expect(args.lastIndexOf('-c:v')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.lastIndexOf('-c:v') + 1]).toBe('libx264');
    expect(after('-profile:v')).toBe('high');
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-crf')).toBe('16');
    expect(after('-framerate')).toBe('60');
    expect(after('-r')).toBe('60');
    expect(after('-movflags')).toBe('+faststart');
    expect(args.at(-1)).toBe('out.mp4');
  });
});

describe('what the capture rides — #3152', () => {
  it('opens the game at the scene the app reads, in the capture tool’s build', () => {
    vi.stubEnv('MODE', CAPTURE_MODE);
    try {
      for (const scene of Object.keys(CAPTURE_SCENES)) {
        expect(captureSceneFromHash(captureHash(scene))).toBe(CAPTURE_SCENES[scene]);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('opens a scene on its built-in route, and presses that route’s Ride (#3153)', () => {
    expect(captureHash('route-hud')).toBe('#/game?capture=route-hud');
    expect(captureRideName('route-hud')).toBe(CAPTURE_ROUTE_NAME);
    expect(captureHash('delivery')).toBe('#/game?route=level%3Amorning-round&capture=delivery');
    expect(gameRouteFromHash(captureHash('lap-race'))).toBe('circuit:bellwether');
    expect(captureRideName('lap-race')).toBe('Bellwether Loop');
    // #3154: the open world's card is chosen by the game, and its start is the command's.
    expect(captureHash('free-ride', '40.1,-75.25')).toBe(
      '#/game?capture=free-ride&start=40.1%2C-75.25',
    );
    expect(captureRideName('free-ride')).toBe('Open world');
  });

  it('rides an invented route under a placeholder name, from 0° 0°', () => {
    const gpx = captureRouteGpx();
    expect(gpx).toContain(`<name>${CAPTURE_ROUTE_NAME}</name>`);
    const points = [...gpx.matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"><ele>([-\d.]+)</gu)];
    expect(points).toHaveLength(801);
    expect(points[0]?.slice(1)).toEqual(['0.0000000', '0.0000000', '40.0']);
    const elevations = points.map((point) => Number(point[3]));
    expect(Math.max(...elevations) - Math.min(...elevations)).toBeGreaterThan(30);
  });

  it('gives the route a shape the HUD’s map can show, not a straight line (#3177)', () => {
    const points = [...captureRouteGpx().matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"/gu)];
    const north = points.map((point) => Number(point[1]));
    const east = points.map((point) => Number(point[2]));
    const span = (values: number[]): number => Math.max(...values) - Math.min(...values);
    // At 0° a degree is as long east as north, so the spans compare as drawn,
    // north-up and fitted whole (`hud/plan.ts`): a quarter as wide as it is long.
    expect(span(east) / span(north)).toBeGreaterThan(0.25);
    // And it bends both ways: east of its start, then west of it.
    expect(Math.max(...east)).toBeGreaterThan(0);
    expect(Math.min(...east)).toBeLessThan(0);
  });

  it('stands its clock on a midsummer morning', () => {
    expect(new Date(CAPTURE_DATE_MS).toISOString()).toBe('2026-06-20T10:30:00.000Z');
  });
});

describe('capture -- --script — #3156', () => {
  const where = ['--start', '40.1,-75.25', '--archive', '/tmp/basemap.pmtiles'];

  it('reads a whole script’s render, 1920×1080 at 60 fps by default', () => {
    expect(parseScriptArgs(['--', '--script', 'youtube', ...where])).toEqual({
      ok: true,
      request: {
        script: 'youtube',
        fps: 60,
        width: 1920,
        height: 1080,
        out: undefined,
        start: '40.1,-75.25',
        archive: '/tmp/basemap.pmtiles',
      },
    });
    expect(
      parseScriptArgs(['--script', 'youtube', '--size', '1280x720', '--fps', '30', ...where]),
    ).toMatchObject({ ok: true, request: { fps: 30, width: 1280, height: 720 } });
  });

  it('needs the free ride’s start and archive, since the script rides the open world', () => {
    expect(parseScriptArgs(['--script', 'youtube'])).toEqual({
      ok: false,
      message: 'capture: --script youtube rides the open world, so it needs --start and --archive',
    });
  });

  it('takes no scene and no length: the script says both', () => {
    expect(parseScriptArgs(['--script', 'youtube', '--seconds', '20', ...where])).toEqual({
      ok: false,
      message: 'capture: --seconds is the script’s to say, not --script’s',
    });
    expect(parseScriptArgs(['--script', 'youtube', '--scene', 'delivery', ...where])).toEqual({
      ok: false,
      message: 'capture: --scene is the script’s to say, not --script’s',
    });
    expect(parseScriptArgs(['--script', 'teaser'])).toEqual({
      ok: false,
      message: 'capture: --script is one of youtube, not teaser',
    });
    expect(parseScriptArgs(['--script', 'youtube', '--fps', '90', ...where])).toEqual({
      ok: false,
      message: 'capture: --fps is a whole number from 1 to 60, not 90',
    });
    expect(parseCaptureArgs(['--script', 'youtube'])).toEqual({
      ok: false,
      message: 'capture: --script is a whole video: parseScriptArgs reads it',
    });
  });
});
