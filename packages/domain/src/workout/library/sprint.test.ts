// SPDX-License-Identifier: Apache-2.0

/**
 * A built-in sprint session through the player — #2301.
 *
 * The library adds templates and nothing else: no new block kind reaches the
 * player, and `player.ts` and `erg-safety.ts` are unchanged. This proves the
 * half that matters for a rider who sprints and then cannot turn the pedals:
 * the stall rescue (#585) fires in the ERG riding after a built-in's sprint,
 * read from the intents the player emits, the same intents the ride screen
 * turns into writes.
 */

import { describe, expect, it } from 'vitest';

import { revolutionsPerMinute, seconds, watts } from '../../quantities';
import { RELIEF_SHARE, type CadenceReading } from '../erg-safety';
import { createWorkoutPlayer, type PlayerState, type WorkoutPlayer } from '../player';
import { tailorWorkout } from '../template';
import { expandWorkout, type WorkoutSegment } from '../timeline';

import { BUILT_IN_WORKOUTS } from '.';

const THRESHOLD = watts(250);

/** A rider turning the pedals at this cadence, as the last two readings. */
function pedalling(rpm: number, at: number): readonly CadenceReading[] {
  return [
    { at: seconds(Math.max(0, at - 1)), cadence: revolutionsPerMinute(rpm) },
    { at: seconds(at), cadence: revolutionsPerMinute(rpm) },
  ];
}

/**
 * A trainer that answers every write with the watts it was asked for, and a
 * rider at 90 rpm, ridden one second at a time up to `until`.
 */
function rideTo(player: WorkoutPlayer, from: number, until: number): PlayerState {
  let state = player.state();
  for (let now = from; now <= until; now += 1) {
    state = player.tick(seconds(now), { cadence: pedalling(90, now) });
    if (state.intent.kind === 'write-target') {
      state = player.acknowledge(state.intent.watts);
    }
  }
  return state;
}

function sprintSession() {
  const template = BUILT_IN_WORKOUTS.find((t) => t.id === 'sprint-6x15');
  if (template === undefined) {
    throw new Error('the sprint template is missing');
  }
  const timeline = expandWorkout(tailorWorkout(template, {}));
  const sprint = timeline.segments.find((segment) => segment.label === 'Sprint');
  const after = timeline.segments.find(
    (segment) => sprint !== undefined && segment.startsAt === sprint.endsAt,
  );
  if (sprint === undefined || after === undefined) {
    throw new Error('the template has no sprint followed by riding');
  }
  const player = createWorkoutPlayer({ timeline, thresholdPower: THRESHOLD });
  player.start(seconds(0));
  return { player, sprint, after };
}

/** A second inside a segment. */
function inside(segment: WorkoutSegment, offset: number): number {
  return segment.startsAt + offset;
}

describe('a built-in sprint session through the player', () => {
  it('releases the trainer for the sprint, then holds the easy target in ERG', () => {
    const { player, sprint, after } = sprintSession();
    expect(sprint.from).toBeUndefined();
    const during = rideTo(player, 0, inside(sprint, 5));
    expect(during.intent.kind).toBe('release');
    expect(during.rescue).toBeUndefined();

    const easy = rideTo(player, inside(sprint, 6), inside(after, 5));
    expect(easy.segment?.from).toBe(after.from);
    expect(easy.held).toBe(watts(0.6 * 250));
  });

  it('fires the stall rescue when the rider stops pedalling after the sprint', () => {
    const { player, after } = sprintSession();
    rideTo(player, 0, inside(after, 10));

    // Down from 30 rpm to 4 in six seconds: the rider has stopped.
    const at = inside(after, 16);
    const stalled = player.tick(seconds(at), {
      cadence: [
        { at: seconds(at - 6), cadence: revolutionsPerMinute(30) },
        { at: seconds(at), cadence: revolutionsPerMinute(4) },
      ],
    });
    expect(stalled.intent.kind).toBe('release');
    expect(stalled.rescue).toMatchObject({ kind: 'floor' });
    expect(stalled.intent.kind === 'release' && stalled.intent.reason).toBe(stalled.rescue?.reason);

    // Turning the pedals again at 35 rpm: the relief, never the full target.
    const restarting = player.tick(seconds(at + 4), {
      cadence: [
        { at: seconds(at), cadence: revolutionsPerMinute(4) },
        { at: seconds(at + 4), cadence: revolutionsPerMinute(35) },
      ],
    });
    expect(restarting.intent).toMatchObject({ kind: 'write-target', eased: true });
    expect(restarting.intent.kind === 'write-target' && restarting.intent.watts).toBeCloseTo(
      RELIEF_SHARE * 0.6 * 250,
      6,
    );
  });

  it('eases the target when the rider spirals after the sprint without stopping', () => {
    const { player, after } = sprintSession();
    rideTo(player, 0, inside(after, 10));

    // From 80 rpm to 45 in six seconds, still pedalling: a spiral.
    const at = inside(after, 16);
    const spiralling = player.tick(seconds(at), {
      cadence: [
        { at: seconds(at - 6), cadence: revolutionsPerMinute(80) },
        { at: seconds(at), cadence: revolutionsPerMinute(45) },
      ],
    });
    expect(spiralling.intent).toMatchObject({ kind: 'write-target', eased: true });
    expect(spiralling.rescue).toMatchObject({ kind: 'relief' });
  });
});
