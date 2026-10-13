// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The running workout's graph and the accessibility audit — #1307: on the
 * Ride screen's workout panel and on the game's HUD, with and without a
 * heart-rate hold, the page audits clean, the image has a name, and the
 * sentences that were there before it are still there.
 *
 * ⚠️ Contrast is not measured here — jsdom resolves no custom property. Each
 * mark's token is a declared pair against the well it is drawn on
 * (`WorkoutGraph.tsx` §WORKOUT_GRAPH_PAINTS, held to `theme.css` by
 * `WorkoutGraph.test.tsx`), and `contrast.a11y.test.ts` walks the pairs.
 */

import {
  altitudeMetres,
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  expandWorkout,
  geographicPosition,
  routeProfile,
  seconds,
  thresholdShare,
  type RoutePoint,
} from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { CONTRAST_REQUIREMENTS } from '../design/tokens';
import { HudPanel } from '../game/hud/HudPanel';
import { atStartLine } from '../game/simulation';
import type { RideWorkoutSnapshot } from '../ride/controller';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import { RideView } from '../views/RideView';
import { mount, settle, type Mounted } from '../testing/mount';
import { workoutStub } from '../workouts/testing';

import { HOLD_LABEL, holdSentence, type WorkoutHold } from './hold-text';
import { workoutGraphText, type WorkoutTraceSample } from './workout-graph';
import { WORKOUT_GRAPH_PAINTS, WORKOUT_STRIP_PAINTS } from './WorkoutGraph';

const ATHLETE = athleteId('athlete-a');

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const RANGE = { low: beatsPerMinute(130), high: beatsPerMinute(140) };
const HOLD: WorkoutHold = { reason: 'lowered', range: RANGE, target: 140 };

const samples = (held: boolean): readonly WorkoutTraceSample[] =>
  [296, 297, 298, 299, 300].map((at) => ({
    at,
    target: held ? 150 - (at - 296) * 2 : 150,
    power: 148,
    heartRate: held ? 138 + (at - 296) : undefined,
    range: held ? RANGE : undefined,
  }));

const workout = (held: boolean): RideWorkoutSnapshot => ({
  name: 'Sweet spot',
  status: 'running',
  elapsedSeconds: 300,
  totalSeconds: 1200,
  holdingWatts: held ? 142 : 150,
  nowRiding: '10 min at 60%',
  fault: undefined,
  rescue: undefined,
  hold: held ? HOLD : undefined,
  thresholdWatts: 250,
  trace: samples(held),
  timeline: expandWorkout({
    name: 'Sweet spot',
    blocks: [
      { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
      { kind: 'free-ride', seconds: seconds(120) },
      { kind: 'ramp', seconds: seconds(480), from: thresholdShare(0.5), to: thresholdShare(1.1) },
    ],
  }),
});

/**
 * The Ride screen itself, since the graph is its own group there (#1307's
 * third pass) and not the workout panel's: what is audited is the page a
 * rider has, with the graph where the document puts it.
 */
const panel = (snapshot: RideWorkoutSnapshot): React.ReactElement => {
  const stub = stubRideController(ridingSnapshot());
  stub.set({ workout: snapshot });
  return (
    <main>
      <h1>Ride</h1>
      <RideView controller={stub.controller} workouts={workoutStub(ATHLETE, [])} />
    </main>
  );
};

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 60; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 30 ? index : 60 - index),
    });
  }
  return routeProfile(points);
}

const hud = (snapshot: RideWorkoutSnapshot): React.ReactElement => {
  const profile = route();
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        workout={snapshot}
      />
    </main>
  );
};

const images = (): readonly Element[] => [...document.querySelectorAll('[role="img"]')];

describe.each([
  ['with no hold', false],
  ['in a heart-rate hold', true],
] as const)('the workout graph on the Ride screen, %s — #1307', (_, held) => {
  it('audits clean', async () => {
    mounted = await mount(panel(workout(held)));
    await settle();
    expect(document.querySelector('[data-oyl-workout-graph="panel"]')).not.toBeNull();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is an image named by what it shows, and is not a tab stop', async () => {
    mounted = await mount(panel(workout(held)));
    await settle();
    const graph = document.querySelector('[data-oyl-workout-graph="panel"] [role="img"]');
    expect(graph).not.toBeNull();
    expect(graph?.getAttribute('aria-label')).toBe(workoutGraphText(workout(held)));
    expect(graph?.hasAttribute('tabindex')).toBe(false);
    for (const svg of graph?.querySelectorAll('svg') ?? []) {
      expect(svg.getAttribute('focusable')).toBe('false');
    }
  });

  it('says in its name every number it writes on a lane', async () => {
    mounted = await mount(panel(workout(held)));
    await settle();
    const name =
      document
        .querySelector('[data-oyl-workout-graph="panel"] [role="img"]')
        ?.getAttribute('aria-label') ?? '';
    // The numbers on the lanes are hidden with the marks, so the name carries them.
    expect(name).toContain('5 min of 20 min ridden');
    expect(name).toContain('5:00 left in this block');
    expect(name).toContain(`Target the trainer last confirmed: ${String(held ? 142 : 150)} W`);
    expect(name).toContain('Your power: 148 W');
    if (held) {
      expect(name).toContain('Heart rate: 142 bpm, with a chosen range of 130–140 bpm');
    }
  });

  it('keeps the sentences that were there before the graph', async () => {
    mounted = await mount(panel(workout(held)));
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Now: 10 min at 60%');
    expect(text).toContain(`Holding ${String(held ? 142 : 150)} W.`);
    if (held) {
      expect(text).toContain(HOLD_LABEL);
      expect(text).toContain(holdSentence(HOLD));
    }
  });
});

describe.each([
  ['with no hold', false],
  ['in a heart-rate hold', true],
] as const)('the workout graph on the game’s HUD, %s — #1307', (_, held) => {
  it('audits clean, and is the one image where the route plan was', async () => {
    mounted = await mount(hud(workout(held)));
    expect(formatViolations(auditAccessibility(document))).toBe('');
    const named = images().map((image) => image.getAttribute('aria-label'));
    expect(named).toContain(workoutGraphText(workout(held)));
    // The strip's one line is inside the image, and the image's name says its numbers.
    const strip = document.querySelector('[data-oyl-workout-graph="hud"]');
    expect(strip?.querySelector('p')?.getAttribute('aria-hidden')).toBe('true');
    expect(strip?.querySelector('p')?.textContent).toBe(
      held ? '142 bpm, range 130–140 · Target 142 W' : 'Target 150 W · 5:00 left in block',
    );
    // Every image on the HUD has a name, and no two share one.
    expect(named.every((name) => name !== null && name !== '')).toBe(true);
    expect(new Set(named).size).toBe(named.length);
  });
});

describe('the graph’s marks are declared contrast pairs — #1307', () => {
  // What each mark is drawn OVER: the graph's own frame, or a shaded step.
  const OVER: Readonly<Record<string, readonly string[]>> = {
    'oyl-workout-graph__done': ['surface'],
    'oyl-workout-graph__replaced': ['surface'],
    // The plan's outline where the trainer holds something else: over the
    // frame when it holds less, and over the shaded step when it holds more.
    'oyl-workout-graph__asked': ['surface', 'surfaceRaised'],
    'oyl-workout-graph__held-edge': ['surface'],
    'oyl-workout-graph__now': ['surface'],
    'oyl-workout-graph__now-cap': ['surface'],
    'oyl-workout-graph__range-edge': ['surface'],
    'oyl-workout-graph__heart-rate': ['surface', 'surfaceRaised'],
    'oyl-workout-graph__target-edge': ['surface'],
    'oyl-workout-graph__power': ['surface', 'surfaceRaised'],
  };

  it('says what every mark that is not a shaded area is drawn over', () => {
    const marks = WORKOUT_GRAPH_PAINTS.filter(({ token }) => token !== 'surfaceRaised').map(
      ({ className }) => className,
    );
    expect(Object.keys(OVER).sort()).toEqual([...marks].sort());
  });

  for (const { className, token } of WORKOUT_GRAPH_PAINTS) {
    for (const background of OVER[className] ?? []) {
      it(`${className}: ${token} on ${background} is a pair the contrast gate walks`, () => {
        expect(
          CONTRAST_REQUIREMENTS.some(
            (pair) => pair.foreground === token && pair.background === background,
          ),
        ).toBe(true);
      });
    }
  }

  // The numbers written on the lanes: `theme.css` paints them these, on the frame.
  for (const token of ['ink', 'inkMuted'] as const) {
    it(`a lane’s number: ${token} on surface is a pair the contrast gate walks`, () => {
      expect(
        CONTRAST_REQUIREMENTS.some(
          (pair) => pair.foreground === token && pair.background === 'surface',
        ),
      ).toBe(true);
    });
  }

  // The HUD's strip draws on the HUD panel's own surface, and no mark of it
  // is a filled area another crosses.
  for (const { className, token } of WORKOUT_STRIP_PAINTS) {
    it(`${className}: ${token} on hudSurface is a pair the contrast gate walks`, () => {
      expect(token.startsWith('hud')).toBe(true);
      expect(
        CONTRAST_REQUIREMENTS.some(
          (pair) => pair.foreground === token && pair.background === 'hudSurface',
        ),
      ).toBe(true);
    });
  }
});
