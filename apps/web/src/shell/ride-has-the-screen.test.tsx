// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The shell provides its OWN `immersive` state as `RideHasTheScreen` — #1107
 * (#1072's review, N9).
 *
 * `ListDetail.test.tsx` supplies the context itself, so a shell that stopped
 * providing it — the provider in `AppShell.tsx` replaced by a fragment, every
 * view reading the default `false` — left every test green. This mounts the
 * REAL `AppShell` at the game route, enters immersion the way a rider does
 * (`immersive.test.tsx`: the picker's own *Ride* press), and reads the context
 * from inside the view the shell renders.
 *
 * The reader is a probe rendered beside the real `GameView`, by mocking that
 * module with a wrapper: no view under a ride's stage reads the context today
 * (only list–detail routes do, and none of them is immersive), so without a
 * probe there is nothing inside the provider to ask.
 */

import { act, useContext, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import type { GamePort, GameViewProps, RidableRoute } from '../game/GameView';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { RideHasTheScreen } from './route-motion';
import { hrefFor, routeById } from './routes';

const PROBE = 'data-oyl-ride-has-the-screen';

vi.mock('../game/GameView', async (importOriginal) => {
  const real = await importOriginal<typeof import('../game/GameView')>();
  function Probe(): JSX.Element {
    const value = useContext(RideHasTheScreen);
    return <span hidden {...{ [PROBE]: String(value) }} />;
  }
  function GameViewWithProbe(props: GameViewProps): JSX.Element {
    return (
      <>
        <Probe />
        <real.GameView {...props} />
      </>
    );
  }
  return { ...real, GameView: GameViewWithProbe };
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function ridableRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id: 'route-1', name: 'Test climb', profile: routeProfile(points), attempts: 0 };
}

const GAME: GamePort = {
  listRoutes: () => Promise.resolve([ridableRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(240), live: true, paired: true },
    cadence: { value: 85, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  globalThis.location.hash = hrefFor(routeById('game'));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  globalThis.location.hash = '';
});

/** What the context reads inside the view the shell rendered. */
function rideHasTheScreen(): string | null {
  return document.querySelector(`[${PROBE}]`)?.getAttribute(PROBE) ?? null;
}

async function openTheGame(): Promise<void> {
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={GAME} />);
  await settle();
}

async function pressRide(): Promise<void> {
  const target = [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  if (target === undefined) {
    throw new Error('the picker offers no Ride control');
  }
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
  await settle();
}

describe('the shell provides its own immersive state — #1107', () => {
  it('reads false while a rider is choosing a route (the control)', async () => {
    await openTheGame();
    expect(document.querySelector('.oyl-game--riding')).toBeNull();
    expect(rideHasTheScreen()).toBe('false');
  });

  it('reads true once a ride has the screen', async () => {
    await openTheGame();
    await pressRide();
    // The shell really is immersive: its header is gone (`immersive.test.tsx`).
    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    expect(document.querySelector('header.oyl-header')).toBeNull();
    expect(rideHasTheScreen()).toBe('true');
  });
});
