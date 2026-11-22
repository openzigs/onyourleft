// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the junction prompt's half of the browser gate drives — #2898.
 *
 * It renders the **real** `game/hud/HudPanel.tsx` under the **real**
 * `design/theme.css`, on the game's riding stage, handed a **real** junction
 * choice on a **real** rolling route over a synthetic street grid
 * (`@onyourleft/domain/rolling-testing`, never a real place), 200 m before a
 * crossroads, as the open-world ride session (#2896) will hand it. `?ways=`
 * picks the junction: `cross` (left, straight on and right, the default) or
 * `tee` (left and straight on only).
 *
 * ## What it does not prove
 *
 * Where the prompt lands on a ride that has a world behind it: no ride mounts
 * it until #2896, which measures it on its own stage, and the owner's tablet
 * check is the moving-ride half. This page measures the prompt's own targets
 * at the tablet's size, through real layout, and gives the owner the
 * screenshots.
 */

import { StrictMode, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
  metresPerSecond,
  RollingRoute,
  routeProfile,
  seconds,
  watts,
} from '@onyourleft/domain';
import { graphOf, roughGround, streetThrough } from '@onyourleft/domain/rolling-testing';

import { HudPanel } from '../src/game/hud/HudPanel';
import { createJunctionChoice } from '../src/game/open-world/junction-choice';
import type { GameState } from '../src/game/simulation';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

declare global {
  interface Window {
    __oylJunction?: { readonly ready: boolean; readonly errors: readonly string[] };
  }
}

const errors: string[] = [];
const WAYS = new URL(window.location.href).searchParams.get('ways') === 'tee' ? 'tee' : 'cross';

/** A 500 m street east to one junction, whose ways leave at `turns` (degrees, negative left). */
function junctionRide(turns: readonly number[]) {
  const approach = {
    id: 'in',
    from: 'start',
    to: 'junction',
    points: streetThrough(
      [
        [0, 0],
        [500, 0],
      ],
      roughGround,
    ),
    roadClass: 1,
  };
  const ways = turns.map((turn, index) => {
    const radians = (turn * Math.PI) / 180;
    return {
      id: `way${String(index)}`,
      from: 'junction',
      to: `end${String(index)}`,
      points: streetThrough(
        [
          [500, 0],
          [500 + 400 * Math.cos(radians), -400 * Math.sin(radians)],
        ],
        roughGround,
      ),
      roadClass: 1,
    };
  });
  const route = new RollingRoute(graphOf([approach, ...ways]), approach);
  const junction = route.nextJunctionAfter(0);
  return { route, choice: createJunctionChoice(route), rider: (junction?.distance ?? 500) - 200 };
}

const RIDE = junctionRide(WAYS === 'tee' ? [-90, 0] : [-90, 0, 90]);

/** A flat route for the HUD's own panels: the prompt reads none of it. */
const PROFILE = routeProfile(
  Array.from({ length: 21 }, (_, index) => ({
    position: geographicPosition(
      degreesLatitude(40 + (index * 10) / 111_320),
      degreesLongitude(-105),
    ),
    elevation: altitudeMetres(1_600),
  })),
);

const STATE: GameState = {
  ride: { speed: metresPerSecond(8), distance: metres(100) },
  elapsed: seconds(450),
  ridden: seconds(450),
  grade: gradePercent(0),
  input: { power: watts(210), live: true },
  headwindMetresPerSecond: 0,
};

function Harness(): JSX.Element {
  const [, frame] = useState(0);
  return (
    <section className="oyl-game oyl-game--riding" aria-label="Trainer game">
      <HudPanel
        profile={PROFILE}
        state={STATE}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        movingSeconds={450}
        elapsedSeconds={450}
        chases={[]}
        paused={false}
        onPause={() => undefined}
        onEnd={() => undefined}
        announcement=""
        junction={{
          prompt: RIDE.choice.prompt(RIDE.rider),
          press: (press) => {
            RIDE.choice.press(press, RIDE.rider);
            frame((count) => count + 1);
          },
        }}
      />
    </section>
  );
}

try {
  const host = document.getElementById('hud');
  if (host === null) throw new Error('no #hud on the page');
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
} catch (error) {
  errors.push(String(error));
}
window.__oylJunction = { ready: errors.length === 0, errors };
