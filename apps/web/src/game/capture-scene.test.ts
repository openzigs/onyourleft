// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: capture mode's switch, script and sensors, read without a screen.
 * The screen is `capture-wiring.test.tsx`'s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_MODE,
  CAPTURE_SCENES,
  captureReadingAt,
  captureRider,
  captureSceneFromHash,
  CaptureSensors,
  publishCaptureFrame,
  type CaptureScene,
  type CaptureTarget,
} from './capture-scene';
import { simulatedRiderKey } from './simulated-rider';

const SCENE: CaptureScene = {
  id: 'test',
  keys: [
    { second: 0, watts: 100, cadence: 80, heartRate: 100 },
    { second: 10, watts: 200, cadence: 90, heartRate: 150 },
    { second: 20, watts: 150, cadence: 85, heartRate: 140 },
  ],
};

describe('the capture switch — #3152', () => {
  // The capture tool's build: `vite build --mode capture`.
  beforeEach(() => {
    vi.stubEnv('MODE', CAPTURE_MODE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the scene the fragment names', () => {
    expect(captureSceneFromHash('#/game?capture=route-hud')).toBe(CAPTURE_SCENES['route-hud']);
    expect(captureSceneFromHash('#/game?simulate=200&capture=route-hud')?.id).toBe('route-hud');
  });

  it('is off with no scene, an unknown one, or a name off the object’s prototype', () => {
    expect(captureSceneFromHash('#/game')).toBeUndefined();
    expect(captureSceneFromHash('#/game?capture=')).toBeUndefined();
    expect(captureSceneFromHash('#/game?capture=delivery')).toBeUndefined();
    expect(captureSceneFromHash('#/game?capture=toString')).toBeUndefined();
    expect(captureSceneFromHash('#/game?capture=__proto__')).toBeUndefined();
  });

  it('is off in every other build, a release among them: the fragment is never read (PR #3160)', () => {
    for (const mode of ['production', 'development', 'test', 'Capture', '']) {
      vi.stubEnv('MODE', mode);
      expect(captureSceneFromHash('#/game?capture=route-hud')).toBeUndefined();
    }
  });

  it('rides as a simulated rider from the start line in real time, keyed apart from ?simulate=', () => {
    const rider = captureRider(SCENE);
    expect(rider).toEqual({ watts: 100, speedup: 1, startMetres: undefined, capture: SCENE });
    expect(simulatedRiderKey(rider)).not.toBe(
      simulatedRiderKey({ watts: 100, speedup: 1, startMetres: undefined }),
    );
  });
});

describe('a scene’s script — #3152', () => {
  it('moves each reading in a straight line between keys, in whole numbers', () => {
    expect(captureReadingAt(SCENE, 0)).toEqual({ watts: 100, cadence: 80, heartRate: 100 });
    expect(captureReadingAt(SCENE, 2.5)).toEqual({ watts: 125, cadence: 83, heartRate: 113 });
    expect(captureReadingAt(SCENE, 10)).toEqual({ watts: 200, cadence: 90, heartRate: 150 });
    expect(captureReadingAt(SCENE, 15)).toEqual({ watts: 175, cadence: 88, heartRate: 145 });
  });

  it('holds the last key after it, and the first before nought', () => {
    expect(captureReadingAt(SCENE, 99)).toEqual({ watts: 150, cadence: 85, heartRate: 140 });
    expect(captureReadingAt(SCENE, -3)).toEqual({ watts: 100, cadence: 80, heartRate: 100 });
  });

  it('gives every shipped scene keys that rise from nought', () => {
    for (const scene of Object.values(CAPTURE_SCENES)) {
      expect(scene.keys[0]?.second).toBe(0);
      const seconds = scene.keys.map((key) => key.second);
      expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
    }
  });
});

describe('the capture rider’s sensors — #3152', () => {
  it('read the script from the instant the ride started, paired and live', () => {
    const sensors = new CaptureSensors(SCENE);
    expect(sensors.read(5_000).rider.power).toBe(100);
    sensors.start(5_000);
    const read = sensors.read(10_000);
    expect(read).toEqual({
      rider: { power: 150, live: true, paired: true },
      cadence: { value: 85, live: true, paired: true },
      heartRate: { value: 125, live: true, paired: true },
    });
  });
});

describe('what a capture publishes — #3152', () => {
  it('writes the frame to the target it is given', () => {
    const target: CaptureTarget = {};
    publishCaptureFrame({ drawn: 3, distance: 12.5, elapsed: 1.05 }, target);
    expect(target.__oylCapture).toEqual({ drawn: 3, distance: 12.5, elapsed: 1.05 });
  });
});
