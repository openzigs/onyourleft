// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: capture mode's switch, script and sensors, read without a screen.
 * The screen is `capture-wiring.test.tsx`'s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_MODE,
  CAPTURE_SCENE_MARK,
  CAPTURE_SCENES,
  CaptureCues,
  CaptureLog,
  captureGhostTrack,
  captureReadingAt,
  captureRider,
  captureSceneFromHash,
  CaptureSensors,
  captureStorage,
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
    expect(captureSceneFromHash('#/game?simulate=200&capture=route-hud')?.id).toBe(
      'oyl-capture-scene:route-hud',
    );
    expect(captureSceneFromHash('#/game?route=level%3Amorning-round&capture=delivery')).toBe(
      CAPTURE_SCENES['delivery'],
    );
  });

  it('is off with no scene, an unknown one, or a name off the object’s prototype', () => {
    expect(captureSceneFromHash('#/game')).toBeUndefined();
    expect(captureSceneFromHash('#/game?capture=')).toBeUndefined();
    expect(captureSceneFromHash('#/game?capture=no-such-scene')).toBeUndefined();
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

  it('gives every shipped scene keys that rise from nought, an id of the mark and its name, and cues in order', () => {
    for (const [name, scene] of Object.entries(CAPTURE_SCENES)) {
      expect(scene.keys[0]?.second).toBe(0);
      const seconds = scene.keys.map((key) => key.second);
      expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
      expect(scene.id).toBe(`${CAPTURE_SCENE_MARK}${name}`);
      const cues = (scene.cues ?? []).map((cue) => cue.second);
      expect(cues).toEqual([...cues].sort((a, b) => a - b));
    }
  });

  it('has a scene for each of Delivery, the lap race, a workout and the pacer (#3153)', () => {
    expect(CAPTURE_SCENES['delivery']?.route?.id).toMatch(/^level:/u);
    expect(CAPTURE_SCENES['delivery']?.seed).toBeTypeOf('number');
    expect(CAPTURE_SCENES['lap-race']?.route?.id).toMatch(/^circuit:/u);
    expect(CAPTURE_SCENES['lap-race']?.lapRace?.aiBots).toBeUndefined();
    expect(CAPTURE_SCENES['workout']?.workout?.query).toMatch(/^workout=built-in:/u);
    expect(CAPTURE_SCENES['pacer']?.pacer).toBeDefined();
    expect(CAPTURE_SCENES['pacer']?.ghost).toBe(true);
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

describe('a capture’s workout trainer — #3153', () => {
  it('reads the power its trainer holds in place of the script’s, and the script’s where it holds none', () => {
    const sensors = new CaptureSensors(SCENE, (second) => (second < 5 ? 231.6 : undefined));
    sensors.start(0);
    expect(sensors.read(1_000).rider.power).toBe(232);
    expect(sensors.read(10_000).rider.power).toBe(200);
    expect(sensors.read(10_000).cadence.value).toBe(90);
  });
});

describe('a capture’s scripted presses — #3153', () => {
  const scene: CaptureScene = {
    ...SCENE,
    cues: [
      { kind: 'throw', second: 2 },
      { kind: 'item', second: 2 },
      { kind: 'throw', second: 5 },
    ],
  };

  it('hands back each press once the ride is at its second, in order, a second apart, and the next only once it is taken', () => {
    const cues = new CaptureCues(scene);
    expect(cues.due(1.99)).toBeUndefined();
    expect(cues.due(2)).toEqual({ kind: 'throw', second: 2 });
    // Not taken: asked again.
    expect(cues.due(2.5)).toEqual({ kind: 'throw', second: 2 });
    cues.taken(2.5);
    // Due at 2 s, but never within a second of the last press.
    expect(cues.due(3.49)).toBeUndefined();
    expect(cues.due(3.5)).toEqual({ kind: 'item', second: 2 });
    cues.taken(3.5);
    expect(cues.due(4.9)).toBeUndefined();
    expect(cues.due(5)).toEqual({ kind: 'throw', second: 5 });
    cues.taken(5);
    expect(cues.due(99)).toBeUndefined();
  });

  it('makes none on a scene with none', () => {
    expect(new CaptureCues(SCENE).due(99)).toBeUndefined();
  });
});

describe('a capture’s log — #3153', () => {
  it('stamps each event with the frames drawn when it happened, and hands back copies', () => {
    const log = new CaptureLog();
    log.note({ kind: 'race', seed: 7, field: ['a'] });
    log.drew();
    log.drew();
    log.note({ kind: 'lap', lap: 1 });
    const first = log.events();
    log.drew();
    log.note({ kind: 'score', score: 2 });
    expect(log.drawn).toBe(3);
    expect(first).toEqual([
      { kind: 'race', seed: 7, field: ['a'], frame: 0 },
      { kind: 'lap', lap: 1, frame: 2 },
    ]);
    expect(log.events()).toHaveLength(3);
  });
});

describe('what a capture keeps, and races — #3153', () => {
  it('keeps in a store of its own, empty at the start and apart from every other', () => {
    const one = captureStorage();
    const two = captureStorage();
    expect(one.getItem('oyl.delivery.progress')).toBeNull();
    one.setItem('oyl.delivery.progress', '{"day":2}');
    expect(one.getItem('oyl.delivery.progress')).toBe('{"day":2}');
    expect(two.getItem('oyl.delivery.progress')).toBeNull();
  });

  it('races a synthetic best: steady, an hour long, the same every time', () => {
    const ghost = captureGhostTrack();
    expect(ghost.totalTime).toBe(3_600);
    expect(ghost.totalDistance).toBeCloseTo(30_960, 6);
    expect(ghost.distance[10]).toBeCloseTo(86, 6);
    expect(captureGhostTrack()).toEqual(ghost);
  });
});

describe('what a capture publishes — #3152', () => {
  it('writes the frame to the target it is given', () => {
    const target: CaptureTarget = {};
    publishCaptureFrame({ drawn: 3, distance: 12.5, elapsed: 1.05 }, target);
    expect(target.__oylCapture).toEqual({ drawn: 3, distance: 12.5, elapsed: 1.05 });
  });
});
