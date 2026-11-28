// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Where the chooser offers a group ride, and what its *Ride* hands on —
 * #3303, ADR 0101 D-1: on a route of the rider's own, and never on the open
 * world, a built-in level or a built-in circuit, whose loadouts are their
 * own. The real `RoutePicker`, with the state `GameView` holds for it.
 */

import { type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { DEFAULT_LAP_RACE_CHOICE } from '../lap-race/choice';
import { OPEN_WORLD_ROUTE_ID } from '../open-world/route-id';
import { pacerChoice } from '../pacer-choice';
import { DEFAULT_RIDING_POSITION } from '../rider';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import { RoutePicker, type GroupRideOffer, type RidableRoute } from '../StageChooser';
import { windChoice } from '../wind-choice';

import type { GroupRideAsked } from './choice';

const OWN: RidableRoute = {
  id: 'a',
  name: 'Level road',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};
const OPEN: RidableRoute = { ...OWN, id: OPEN_WORLD_ROUTE_ID, name: 'Open world' };
const LEVEL: RidableRoute = { ...OWN, id: 'level:one', name: 'Level one' };
const CIRCUIT: RidableRoute = {
  id: 'circuit:one',
  name: 'Circuit one',
  profile: circuitRoute(40, () => 0),
  attempts: 0,
};

const ASKED: GroupRideAsked = { ride: { targetSpeed: 8, bots: 4 }, problem: undefined };

function offer(asked: GroupRideAsked = ASKED): GroupRideOffer {
  return {
    chosen: true,
    onChoose: () => undefined,
    speed: '28.8',
    onSpeed: () => undefined,
    speedUnit: 'km/h',
    bots: 4,
    onBots: () => undefined,
    asked,
    unavailable: undefined,
  };
}

type Started = Parameters<Parameters<typeof RoutePicker>[0]['onStart']>;

function Chooser(props: {
  readonly picked: string;
  readonly asked?: GroupRideAsked;
  readonly onStart: (...started: Started) => void;
}): JSX.Element {
  return (
    <main>
      <h1>Trainer game</h1>
      <RoutePicker
        routes={[OPEN, LEVEL, OWN]}
        picked={props.picked}
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
        delivery={undefined}
        level={{ routeId: LEVEL.id, credit: 'Map data credit', houses: 3 }}
        circuits={{ circuits: [CIRCUIT], credit: 'Map data credit' }}
        lapRace={{
          chosen: false,
          onChoose: () => undefined,
          choice: DEFAULT_LAP_RACE_CHOICE,
          onChoice: () => undefined,
          assisted: false,
        }}
        groupRide={offer(props.asked)}
        onStart={(...started) => {
          props.onStart(...started);
          return Promise.resolve();
        }}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function chooser(
  picked: string,
  asked?: GroupRideAsked,
): Promise<{ readonly started: Started[]; readonly root: ParentNode }> {
  const started: Started[] = [];
  const onStart = vi.fn((...each: Started) => {
    started.push(each);
  });
  mounted = await mount(
    <Chooser picked={picked} onStart={onStart} {...(asked === undefined ? {} : { asked })} />,
  );
  await settle();
  return { started, root: mounted.container };
}

const groupSwitch = (root: ParentNode): HTMLInputElement | undefined =>
  queryAll<HTMLInputElement>(root, 'input[type="checkbox"]').find((input) =>
    (input.closest('label')?.textContent ?? '').includes('Ride with a group'),
  );

async function pressRide(root: ParentNode): Promise<void> {
  const ride = queryAll<HTMLButtonElement>(root, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride).toBeDefined();
  ride?.click();
  await settle();
}

/** The group *Ride* handed on: `onStart`'s ninth argument. */
const groupOf = (started: Started | undefined): Started[8] => started?.[8];

describe('where the chooser offers a group ride — #3303', () => {
  it('offers it on a route of the rider’s own, and Ride hands on the group asked for', async () => {
    const { started, root } = await chooser(OWN.id);
    expect(groupSwitch(root)?.checked).toBe(true);
    await pressRide(root);
    expect(started).toHaveLength(1);
    expect(started[0]?.[0].id).toBe(OWN.id);
    expect(groupOf(started[0])).toStrictEqual({ targetSpeed: 8, bots: 4 });
  });

  it('hands on none while the setup makes none, and blocks Ride while it is refused', async () => {
    const none = await chooser(OWN.id, { ride: undefined, problem: undefined });
    await pressRide(none.root);
    expect(none.started).toHaveLength(1);
    expect(groupOf(none.started[0])).toBeUndefined();
    mounted?.unmount();

    const refused = await chooser(OWN.id, { ride: undefined, problem: 'The group cannot.' });
    await pressRide(refused.root);
    expect(refused.started).toHaveLength(0);
  });

  for (const [name, route] of [
    ['the open world', OPEN],
    ['a built-in level', LEVEL],
    ['a built-in circuit', CIRCUIT],
  ] as const) {
    it(`offers none on ${name}, and its Ride hands on none and is not blocked by one`, async () => {
      // Even a refused setup, left over from another card, cannot block this one.
      const { started, root } = await chooser(route.id, {
        ride: { targetSpeed: 8, bots: 4 },
        problem: 'The group cannot.',
      });
      expect(groupSwitch(root)).toBeUndefined();
      expect(root.textContent).not.toContain('The group cannot.');
      await pressRide(root);
      expect(started).toHaveLength(1);
      expect(started[0]?.[0].id).toBe(route.id);
      expect(groupOf(started[0])).toBeUndefined();
    });
  }
});
