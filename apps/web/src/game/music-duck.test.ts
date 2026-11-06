// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The music ducked under a short sound — #2059 — read from the fake context's
 * recorded automation: the plan the duck gain's `AudioParam` was given, as it
 * stands after any cancellation, never the level a test set.
 */

import { describe, expect, it } from 'vitest';

import { EVERY_BUS_ON, fakeAudioContext, musicPath, type FakeAudio } from './audio-testing';
import type { CueOutput } from './audio-port';
import {
  MUSIC_DUCK_BACK_SECONDS,
  MUSIC_DUCK_DOWN_SECONDS,
  MUSIC_DUCK_LEVEL,
  webAudioOutput,
} from './web-audio';

function playing(): {
  readonly fake: FakeAudio;
  readonly output: CueOutput;
  at: (t: number) => void;
} {
  const fake = fakeAudioContext();
  const output = webAudioOutput(() => fake.context, EVERY_BUS_ON);
  output.resume();
  return {
    fake,
    output,
    at: (time) => {
      (fake.context as { currentTime: number }).currentTime = time;
    },
  };
}

/** The duck's plan, less the level it was made at. */
function duckPlan(fake: FakeAudio) {
  return musicPath(fake).duck.automation.filter((event) => event.method !== 'value');
}

describe('the music ducks under a short sound — #2059', () => {
  it('ramps down to the duck level as a menu effect starts, and back to 1 after it ends', () => {
    const { fake, output, at } = playing();
    output.setMusicOn(true);
    at(10);
    output.playCue('confirm', 0.1);
    // `confirm` is two notes: 0–50 ms and 60–130 ms.
    expect(duckPlan(fake)).toEqual([
      {
        method: 'setTargetAtTime',
        value: MUSIC_DUCK_LEVEL,
        at: 10,
        constant: MUSIC_DUCK_DOWN_SECONDS,
      },
      {
        method: 'setTargetAtTime',
        value: 1,
        at: expect.closeTo(10.13, 9) as number,
        constant: MUSIC_DUCK_BACK_SECONDS,
      },
    ]);
    expect(MUSIC_DUCK_LEVEL).toBeGreaterThan(0);
    expect(MUSIC_DUCK_LEVEL).toBeLessThan(1);
  });

  it('a second sound inside the first one’s duck moves the way back up, rather than landing mid-sound', () => {
    const { fake, output, at } = playing();
    output.setMusicOn(true);
    at(10);
    output.playCue('confirm', 0.1);
    at(10.05);
    output.playCue('select', 0.1);
    const plan = duckPlan(fake);
    // The first sound's way back up at 10.13 is gone; the second's is at 10.11.
    expect(plan.filter((event) => event.value === 1)).toEqual([
      {
        method: 'setTargetAtTime',
        value: 1,
        at: expect.closeTo(10.11, 9) as number,
        constant: MUSIC_DUCK_BACK_SECONDS,
      },
    ]);
    expect(plan.filter((event) => event.value === MUSIC_DUCK_LEVEL)).toHaveLength(2);
  });

  it('never steps: no direct level and no set value on the duck after it is made', () => {
    const { fake, output, at } = playing();
    output.setMusicOn(true);
    for (const [time, cue] of [
      [1, 'select'],
      [2, 'back'],
      [3, 'confirm'],
    ] as const) {
      at(time);
      output.playCue(cue, 0.1);
    }
    const steps = musicPath(fake).duck.automation.filter(
      (event) => event.method === 'value' || event.method === 'setValueAtTime',
    );
    // The one step is the duck being MADE at 1, before any sound.
    expect(steps).toEqual([{ method: 'value', value: 1 }]);
  });

  it('does nothing while no music plays', () => {
    const { fake, output, at } = playing();
    at(10);
    output.playCue('select', 0.1);
    expect(duckPlan(fake)).toEqual([]);
    output.setMusicOn(true);
    output.setMusicOn(false);
    output.playCue('select', 0.1);
    expect(duckPlan(fake)).toEqual([]);
  });
});
