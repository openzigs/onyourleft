// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: the capture's decisions that need no browser and no encoder. What a
 * capture actually writes was read back with `ffprobe` on the pull request.
 */

import { describe, expect, it } from 'vitest';

import { captureSceneFromHash } from '../../src/game/capture-scene';
import {
  CAPTURE_DATE_MS,
  CAPTURE_ROUTE_NAME,
  captureFrames,
  captureHash,
  captureMp4Args,
  captureName,
  captureRouteGpx,
  MAX_CAPTURE_FRAMES,
  parseCaptureArgs,
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

  it.each([
    [['--preset', 'climb'], /no option --preset/u],
    [['--scene'], /needs a value/u],
    [['--scene', 'x', '--scene', 'y'], /given twice/u],
    [['--scene', 'delivery'], /--scene is one of route-hud/u],
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
  it('opens the game at the scene the app reads', () => {
    expect(captureSceneFromHash(captureHash('route-hud'))?.id).toBe('route-hud');
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

  it('stands its clock on a midsummer morning', () => {
    expect(new Date(CAPTURE_DATE_MS).toISOString()).toBe('2026-06-20T10:30:00.000Z');
  });
});
