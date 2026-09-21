// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride's sounds, through the two screens that play them — #400.
 *
 * `audio-cues.test.ts` holds the rules against a port double; this is the
 * wiring: that the game and the workout panel resume audio only inside the
 * rider's press, feed the tone the ACKNOWLEDGED target and the LIVE reading,
 * play each short sound on the frame its SENTENCE is said, put the mute and
 * the volume on the ride's own screen, and stop the tone when the workout or
 * the ride ends.
 *
 * An `.a11y.test` because three of its claims are accessibility claims — SC
 * 1.4.2's controls, the sound never being the only carrier of a message, and
 * nothing sounding for a rider who did not ask.
 *
 * ⚠️ Nothing here hears anything. jsdom has no Web Audio, and whether the
 * sounds are distinguishable at ride intensity is
 * `docs/validation/0003-screen-reader-and-assistive-technology.md` Part I.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  expandWorkout,
  geographicPosition,
  routeProfile,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type RoutePoint,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { athleteId as toAthleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';

import type { RideWorkoutSnapshot, TrainerSnapshot } from '../ride/controller';
import { WorkoutPanel } from '../ride/WorkoutPanel';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { workoutStub } from '../workouts/testing';

import { recordingOutput, type RecordingOutput } from './audio-testing';
import { CUES_STORAGE_KEY, DEFAULT_CUES } from './cue-preference';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { GameRenderer } from './port';

function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-flat', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([flatRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(230), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  create: () => ({
    hasContext: true,
    render: () => undefined,
    setQuality: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
let output: RecordingOutput;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  output = recordingOutput();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function chooseSounds(muted = false): void {
  localStorage.setItem(CUES_STORAGE_KEY, JSON.stringify({ ...DEFAULT_CUES, enabled: true, muted }));
}

function chooseDistanceTicks(): void {
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({
      ...DEFAULT_ANNOUNCEMENTS,
      enabled: true,
      powerEverySeconds: 'never',
      distanceEvery: 0.5,
    }),
  );
}

function button(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith(words),
  );
}

async function press(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

const hudRegion = (): string =>
  document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';

describe('the game — #400', () => {
  async function openGame(): Promise<void> {
    mounted = await mount(
      <GameView
        port={PORT}
        renderer={() => Promise.resolve(RENDERER)}
        now={() => nowMs}
        sounds={output}
      />,
    );
    await settle();
  }

  /** Frames of half a second, noting the region's text and the port's calls after each. */
  async function pump(frames: number): Promise<{ said: string; cues: number }[]> {
    const seen: { said: string; cues: number }[] = [];
    for (let index = 0; index < frames; index += 1) {
      const next = pending.shift();
      if (next === undefined) break;
      nowMs += 500;
      await act(async () => {
        next(nowMs);
        await Promise.resolve();
      });
      seen.push({ said: hudRegion(), cues: output.count('playCue') });
    }
    return seen;
  }

  it('resumes audio only inside the press on Ride, never at mount', async () => {
    chooseSounds();
    await openGame();
    expect(output.calls).toEqual([]);
    await press(button('Ride '));
    expect(output.calls[0]).toEqual({ kind: 'resume' });
  });

  it('resumes audio SYNCHRONOUSLY inside the press on Ride, before any awaited work', async () => {
    // ⚠️ The test above passes with `begin()` moved below an `await`: it reads
    // the calls only after `press` has flushed every promise. A browser grants
    // audio to the gesture's own synchronous turn, so what is asserted here is
    // the port's state on the SAME turn as the click — no `act` flush and no
    // microtask between the two. The ride races a ghost, so that `start`'s own
    // first `await` (the ghost's load) is actually taken rather than skipped.
    chooseSounds();
    mounted = await mount(
      <GameView
        port={{ ...PORT, listRoutes: () => Promise.resolve([{ ...flatRoute(), attempts: 1 }]) }}
        renderer={() => Promise.resolve(RENDERER)}
        now={() => nowMs}
        sounds={output}
      />,
    );
    await settle();
    const ghost = document.querySelector<HTMLInputElement>('li input[type="checkbox"]');
    await press(ghost ?? undefined);
    expect(ghost?.checked, 'the ghost was not chosen, so no await is taken').toBe(true);
    const ride = button('Ride ');
    expect(ride).toBeDefined();
    let resumedInThePress = -1;
    await act(async () => {
      ride?.click();
      resumedInThePress = output.count('resume');
      await Promise.resolve();
    });
    await settle();
    expect(resumedInThePress, 'audio was not resumed inside the press on Ride').toBe(1);
  });

  it('makes no call at all for a rider who did not turn sounds on, and shows no control', async () => {
    chooseDistanceTicks();
    await openGame();
    await press(button('Ride '));
    await pump(200);
    expect(output.calls).toEqual([]);
    expect(button('Mute sounds')).toBeUndefined();
  });

  it('plays the distance sound on the frame its sentence is said, and on no other', async () => {
    chooseSounds();
    chooseDistanceTicks();
    await openGame();
    await press(button('Ride '));
    const seen = await pump(300);
    const sounds = seen.filter((frame, index) => frame.cues > (seen[index - 1]?.cues ?? 0));
    expect(sounds.length, 'no distance sound was played at all').toBeGreaterThan(0);
    for (const frame of sounds) {
      // The sentence is in the region on the very frame the sound played.
      expect(frame.said).toMatch(/kilometres to go$/);
    }
    const said = new Set(seen.map((frame) => frame.said).filter((text) => text !== ''));
    expect(sounds).toHaveLength(said.size);
    expect(
      output.calls
        .filter((call) => call.kind === 'playCue')
        .every((call) => call.cue === 'distance'),
    ).toBe(true);
  });

  it('puts Mute sounds and the volume on the ride’s own screen, and the mute silences', async () => {
    chooseSounds();
    chooseDistanceTicks();
    await openGame();
    await press(button('Ride '));
    const mute = button('Mute sounds');
    expect(mute?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.oyl-hud input[type="range"]')).not.toBeNull();

    await press(mute);
    expect(button('Mute sounds')?.getAttribute('aria-pressed')).toBe('true');
    const before = output.count('playCue');
    const seen = await pump(300);
    // Sentences still came — a rider with the sound off loses nothing…
    expect(seen.some((frame) => /to go$/.test(frame.said))).toBe(true);
    // …and no sound did.
    expect(output.count('playCue')).toBe(before);
    // The choice is kept on this device.
    expect(JSON.parse(localStorage.getItem(CUES_STORAGE_KEY) ?? '{}')).toMatchObject({
      muted: true,
    });
  });
});

describe('a workout — #400', () => {
  const ATHLETE = toAthleteId('athlete-a');
  const blocks: readonly WorkoutBlock[] = [
    { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
    { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.95) },
  ];
  const TIMELINE = expandWorkout({ name: 'Sweet spot', blocks });
  const record: WorkoutRecord = {
    id: workoutId('w1'),
    createdBy: ATHLETE,
    name: 'Sweet spot',
    workout: { name: 'Sweet spot', blocks },
    createdAt: unixSeconds(1),
    updatedAt: unixSeconds(1),
  };
  const trainer: TrainerSnapshot = {
    paired: true,
    controllable: true,
    controlChoice: { kind: 'none' },
    canSetPower: true,
    canSimulate: false,
    powerRange: undefined,
    hasControl: true,
    target: { kind: 'none' },
    requested: undefined,
    lost: undefined,
    refusal: undefined,
    releaseFault: undefined,
  };

  function riding(overrides: Partial<RideWorkoutSnapshot> = {}): RideWorkoutSnapshot {
    return {
      name: 'Sweet spot',
      status: 'running',
      elapsedSeconds: 30,
      totalSeconds: 900,
      holdingWatts: 150,
      nowRiding: '10 min at 60%',
      fault: undefined,
      timeline: TIMELINE,
      ...overrides,
    };
  }

  const panel = (workout: RideWorkoutSnapshot | undefined, power: number | undefined) => (
    <WorkoutPanel
      trainer={trainer}
      workout={workout}
      port={workoutStub(ATHLETE, [record])}
      thresholdPower={watts(250)}
      onStart={() => undefined}
      onEnd={() => undefined}
      power={power}
      sounds={output}
    />
  );

  async function show(workout: RideWorkoutSnapshot | undefined, power: number | undefined) {
    if (mounted === undefined) mounted = await mount(panel(workout, power));
    else await mounted.rerender(panel(workout, power));
    await settle();
  }

  const workoutRegion = (): string =>
    document.querySelector('[data-oyl-announcer="workout"]')?.textContent ?? '';

  it('resumes audio in the press on a workout’s Ride button, and not before', async () => {
    chooseSounds();
    await show(undefined, 200);
    expect(output.calls).toEqual([]);
    await press(button('Ride Sweet spot'));
    expect(output.calls).toEqual([{ kind: 'resume' }]);
  });

  it('tracks the ACKNOWLEDGED target, and a dropped reading silences it', async () => {
    chooseSounds();
    await show(undefined, 150);
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    expect(output.count('startTone')).toBe(1);
    expect(output.sounding).toBe(1);

    await show(riding(), 190);
    const moved = output.calls.at(-1);
    expect(moved?.kind).toBe('setTone');

    await show(riding(), undefined);
    expect(output.sounding).toBe(0);
    expect(output.calls.at(-1)).toEqual({ kind: 'stopTone' });
  });

  it('is silent while paused, and stops when the workout ends — nothing left sounding', async () => {
    chooseSounds();
    await show(undefined, 150);
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    await show(riding({ status: 'paused' }), 150);
    expect(output.sounding).toBe(0);
    await show(riding(), 150);
    expect(output.sounding).toBe(1);
    await show(undefined, 150);
    expect(output.sounding).toBe(0);
    expect(output.mostSounding).toBe(1);
  });

  it('stops the tone when the rider leaves the screen mid-workout', async () => {
    chooseSounds();
    await show(undefined, 150);
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    expect(output.sounding).toBe(1);
    mounted?.unmount();
    mounted = undefined;
    expect(output.sounding).toBe(0);
    expect(output.calls.at(-1)).toEqual({ kind: 'stopTone' });
  });

  it('plays the interval sound with the "Now:" sentence, never without it', async () => {
    chooseSounds();
    await show(undefined, 150);
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    expect(output.count('playCue')).toBe(0);
    await show(riding({ nowRiding: '5 min at 95%', elapsedSeconds: 600 }), 230);
    expect(workoutRegion()).toBe('Now: 5 min at 95%');
    expect(output.calls.filter((call) => call.kind === 'playCue')).toEqual([
      expect.objectContaining({ cue: 'interval' }),
    ]);
  });

  it('puts the mute and the volume in the panel while a workout runs', async () => {
    chooseSounds();
    await show(undefined, 150);
    expect(button('Mute sounds')).toBeUndefined();
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    await press(button('Mute sounds'));
    expect(output.sounding).toBe(0);
    await show(riding(), 200);
    expect(output.count('startTone')).toBe(1);
    expect(output.count('setTone')).toBe(0);
  });

  it('moves the volume mid-workout from the slider, independently of the system’s', async () => {
    chooseSounds();
    await show(undefined, 150);
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    const started = output.calls.find((call) => call.kind === 'startTone');
    const slider = document.querySelector<HTMLInputElement>('.oyl-sound input[type="range"]');
    expect(slider?.value).toBe('50');
    await act(async () => {
      // React tracks an input's value through the prototype's setter, so a
      // plain assignment would not register as a change.
      Reflect.set(HTMLInputElement.prototype, 'value', '10', slider);
      slider?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    // No new power reading: the volume must reach the tone on its own.
    const moved = output.calls.filter((call) => call.kind === 'setTone').at(-1);
    expect(moved?.kind).toBe('setTone');
    const gain = (call: (typeof output.calls)[number] | undefined): number =>
      call !== undefined && 'gain' in call ? call.gain : Number.NaN;
    // Half volume to a tenth: a fifth of the level, same pitch.
    expect(gain(moved) / gain(started)).toBeCloseTo(0.2);
    expect(JSON.parse(localStorage.getItem(CUES_STORAGE_KEY) ?? '{}')).toMatchObject({
      volume: 0.1,
    });
  });

  it('makes no call at all for a rider who did not turn sounds on', async () => {
    await show(undefined, 150);
    await press(button('Ride Sweet spot'));
    await show(riding(), 150);
    await show(riding({ nowRiding: '5 min at 95%' }), 230);
    expect(output.calls).toEqual([]);
  });
});
