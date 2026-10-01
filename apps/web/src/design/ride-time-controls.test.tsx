// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The fast half of #669: every control on `RIDE_TIME_CONTROLS` that the Ride
 * screen, the sound controls and the game's stage chooser (#940) render wears
 * the ride-time size, and nothing else on those screens does.
 *
 * jsdom performs no layout, so this cannot say a box is 48 px — that is
 * `browser/ride-targets.browser.spec.ts`. What it can say, in the suite a
 * contributor runs on every save, is that the declaration is attached to the
 * controls the ruling names: a call site that drops `size="ride"` is red here
 * before a browser is ever started. The game HUD's *Pause* and *End ride* are
 * not `Button`s and are held by `HudPanel.a11y.test.tsx` §"the mid-ride
 * controls are usable with gloves on".
 */

import { afterEach, describe, expect, it } from 'vitest';

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
} from '@onyourleft/domain';
import { athleteId, workoutId, type AthleteRecord, type WorkoutRecord } from '@onyourleft/store';

import { stubAnalysis } from '../analysis/testing';
import { pacerChoice } from '../game/pacer-choice';
import { DEFAULT_RIDING_POSITION } from '../game/rider';
import { SoundControls } from '../game/SoundControls';
import { RoutePicker, type RidableRoute } from '../game/StageChooser';
import { windChoice } from '../game/wind-choice';
import type { RideSnapshot } from '../ride/controller';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { RideView } from '../views/RideView';
import { workoutStub } from '../workouts/testing';
import { RIDE_SIZE_CLASS } from './Button';
import { RIDE_TIME_CONTROLS, namesControl, type RideTimeControl } from './ride-time-controls';

const ATHLETE = athleteId('ride-time');
const RIDER: AthleteRecord = {
  id: ATHLETE,
  displayName: 'Ride time',
  createdAt: unixSeconds(1),
  thresholdPower: watts(250),
};
const WORKOUT: WorkoutRecord = {
  id: workoutId('sweet-spot'),
  createdBy: ATHLETE,
  name: 'Sweet spot',
  workout: {
    name: 'Sweet spot',
    blocks: [{ kind: 'steady', seconds: seconds(720), target: thresholdShare(0.9) }],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

/** The states that between them put every Ride-screen entry on the screen. */
function states(): readonly RideSnapshot[] {
  const riding = ridingSnapshot();
  return [
    {
      ...riding,
      phase: 'idle',
      trainer: { ...riding.trainer, hasControl: false, target: { kind: 'none' } },
    },
    riding,
    { ...riding, phase: 'paused', stopArmed: true },
    {
      ...riding,
      workout: {
        name: WORKOUT.name,
        status: 'running',
        elapsedSeconds: 10,
        totalSeconds: 720,
        holdingWatts: 225,
        nowRiding: '12 min at 90%',
        fault: undefined,
        rescue: undefined,
        timeline: expandWorkout(WORKOUT.workout),
      },
    },
  ];
}

interface Rendered {
  readonly name: string;
  readonly ride: boolean;
}

function buttons(): readonly Rendered[] {
  return [...document.querySelectorAll('button')].map((each) => ({
    name: (each.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ride: each.classList.contains(RIDE_SIZE_CLASS),
  }));
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('#669 — the ride-time size is on the controls the ruling names', () => {
  it('on the Ride screen, every listed control wears it and no other button does', async () => {
    const screen = RIDE_TIME_CONTROLS.filter(
      (entry) => entry.surface !== 'game-hud' && entry.surface !== 'stage-chooser',
    );
    const found = new Set<RideTimeControl>();
    for (const snapshot of states()) {
      mounted = await mount(
        <RideView
          controller={stubRideController(snapshot).controller}
          workouts={workoutStub(ATHLETE, [WORKOUT])}
          analysis={stubAnalysis(ATHLETE, [], RIDER)}
        />,
      );
      await settle();
      const rendered = buttons();
      expect(rendered.length).toBeGreaterThan(0);
      for (const button of rendered) {
        const entry = screen.find((each) => namesControl(each, button.name));
        if (entry !== undefined) found.add(entry);
        expect(button.ride, `“${button.name}”`).toBe(entry !== undefined);
      }
      mounted.unmount();
      mounted = undefined;
    }
    // The apparatus: a listed control no state rendered would pass the loop
    // above by never being looked at.
    expect(screen.filter((entry) => !found.has(entry)).map((entry) => entry.name)).toEqual([]);
  });

  it('on the sound controls, the mute wears it', async () => {
    mounted = await mount(
      <SoundControls
        preference={{ enabled: true, muted: false, volume: 0.5 }}
        onChange={() => undefined}
      />,
    );
    const mute = buttons().find((each) =>
      RIDE_TIME_CONTROLS.some(
        (entry) => entry.surface === 'game-hud' && namesControl(entry, each.name),
      ),
    );
    expect(mute?.name).toBe('Mute sounds');
    expect(mute?.ride).toBe(true);
  });

  it('on the stage chooser, Ride wears it and no other button does', async () => {
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 20; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (index * 50) / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(20),
      });
    }
    const route: RidableRoute = {
      id: 'box-hill',
      name: 'Box Hill',
      profile: routeProfile(points),
      attempts: 1,
    };
    mounted = await mount(
      <RoutePicker
        routes={[route]}
        picked={route.id}
        onPick={() => undefined}
        units="metric"
        withGhost={false}
        onGhost={() => undefined}
        withPacer={false}
        onPacer={() => undefined}
        intensity="2.5"
        onIntensity={() => undefined}
        choice={pacerChoice(false, '2.5')}
        withWind={false}
        onWind={() => undefined}
        windSpeed=""
        onWindSpeed={() => undefined}
        windFrom="270"
        onWindFrom={() => undefined}
        air={windChoice(false, '', '270', 'metric')}
        windUnit="km/h"
        trainerNotice={undefined}
        trainerPromise={undefined}
        asking={false}
        releaseNotice={undefined}
        position={DEFAULT_RIDING_POSITION}
        onPosition={() => undefined}
        worldChosen={false}
        onStart={() => Promise.resolve()}
      />,
    );
    await settle();
    const chooser = RIDE_TIME_CONTROLS.filter((entry) => entry.surface === 'stage-chooser');
    const rendered = buttons();
    for (const button of rendered) {
      const listed = chooser.some((entry) => namesControl(entry, button.name));
      expect(button.ride, `“${button.name}”`).toBe(listed);
    }
    // The apparatus: every chooser entry is rendered.
    expect(
      chooser.filter((entry) => !rendered.some((button) => namesControl(entry, button.name))),
    ).toEqual([]);
  });
});
