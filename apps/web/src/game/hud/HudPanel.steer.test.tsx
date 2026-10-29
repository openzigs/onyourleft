// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1820 — steering from the HUD's keys.
 *
 * The HUD is the real `HudPanel`. Behind its steer port is a ride in
 * miniature, the shape #1816 gives `GameView`: each intent goes through
 * `steer.ts` §`steerToward` into the round's steer state, and "the rider
 * changed lane" is read off that state's lane, never off a counter of calls.
 * Beside it is a throw port, so a key is shown to reach one of the two and
 * never both.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, useMemo, useState, type JSX } from 'react';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, queryAll, type Mounted } from '../../testing/mount';
import { startSteer, steerToward, type SteerState } from '../delivery/steer';
import type { SteerInputPort } from '../delivery/steer-port';
import type { ThrowIntent } from '../delivery/throw-input';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index),
    });
  }
  return routeProfile(points);
}

/** What the ride last rendered the HUD from. */
let steered: SteerState | undefined;
let thrown: ThrowIntent[] = [];

function RideWithSteering(props: { readonly steering: boolean }): JSX.Element {
  const profile = useMemo(route, []);
  const [steer, setSteer] = useState<SteerState>(() => startSteer(0));
  steered = steer;
  const steering = useMemo<SteerInputPort>(
    () => ({
      steer: (intent) => {
        setSteer((now) => steerToward(now, intent));
      },
    }),
    [],
  );
  const throwing = useMemo<ThrowInputPort>(
    () => ({
      throwParcel: (intent) => {
        thrown = [...thrown, intent];
      },
    }),
    [],
  );
  return (
    <HudPanel
      profile={profile}
      state={atStartLine(profile)}
      cadence={{ value: 88, live: true }}
      heartRate={{ value: 150, live: true }}
      announcement=""
      paused={false}
      onPause={() => undefined}
      onEnd={() => undefined}
      throwing={throwing}
      steering={props.steering ? steering : undefined}
    />
  );
}

async function ride(steering = true): Promise<void> {
  steered = undefined;
  thrown = [];
  mounted = await mount(<RideWithSteering steering={steering} />);
}

/** A key from a keyboard or a remote, with nothing focused: it lands on the page. */
function press(key: string, on: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    on.dispatchEvent(event);
  });
  return event;
}

describe('steering from the HUD’s keys — #1820', () => {
  it('changes lane on D and A, read off the round’s steer state, and takes the key', async () => {
    await ride();
    expect(steered?.lane).toBe(1);

    const right = press('d');
    expect(steered?.lane).toBe(2);
    expect(right.defaultPrevented).toBe(true);

    press('A');
    press('a');
    expect(steered?.lane).toBe(0);
  });

  it('keeps the throw keys the throws’: an arrow throws and never steers, a lane key never throws', async () => {
    await ride();

    press('ArrowLeft');
    press('PageDown');
    expect(steered?.lane).toBe(1);
    expect(thrown).toEqual(['left', 'right']);

    press('d');
    expect(thrown).toEqual(['left', 'right']);
    expect(steered?.lane).toBe(2);
  });

  it('leaves a field its own keys', async () => {
    await ride();
    const field = document.createElement('input');
    mounted?.container.append(field);
    const typed = press('d', field);
    expect(typed.defaultPrevented).toBe(false);
    expect(steered?.lane).toBe(1);
  });

  it('draws nothing for steering, and listens for nothing on a ride with no round', async () => {
    await ride(false);
    const withoutButtons = queryAll(mounted?.container ?? document, 'button').length;
    expect(press('d').defaultPrevented).toBe(false);
    expect(steered?.lane).toBe(1);
    mounted?.unmount();

    await ride(true);
    expect(queryAll(mounted?.container ?? document, 'button')).toHaveLength(withoutButtons);
  });
});
