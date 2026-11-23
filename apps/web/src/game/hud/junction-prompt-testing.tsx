// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the HUD's junction prompt (#2898): the ride HUD handed a
 * real junction choice on a real rolling route, as the open-world ride
 * session (#2896) will hand it, and the ways it draws. Never shipped.
 */

import { act, useMemo, useState, type JSX } from 'react';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { queryAll } from '../../testing/mount';
import type { JunctionChoice } from '../open-world/junction-choice';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

/** A short flat route for the HUD's own panels: the junction prompt reads none of it. */
function panelRoute(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

/**
 * The ride HUD on an open-world ride with the rider at ride distance `rider`:
 * the prompt is the choice's for that distance, and a press goes to the choice
 * at it, after which the HUD renders again, as a ride's next frame would.
 */
export function JunctionHud(props: {
  readonly choice: JunctionChoice;
  readonly rider: number;
  readonly announcement?: string;
}): JSX.Element {
  const profile = useMemo(panelRoute, []);
  const [, frame] = useState(0);
  const { choice, rider } = props;
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
        announcement={props.announcement ?? ''}
        junction={{
          prompt: choice.prompt(rider),
          press: (press) => {
            choice.press(press, rider);
            frame((count) => count + 1);
          },
        }}
      />
    </main>
  );
}

/** Every way the prompt draws, in its order, from the furthest left: in its pop-up (#3053). */
export function wayButtons(): HTMLButtonElement[] {
  return queryAll<HTMLButtonElement>(document, '.oyl-hud__junction-popup button[data-oyl-way]');
}

/** The way the prompt draws for the edge `id`. */
export function wayButton(id: string): HTMLButtonElement {
  const found = wayButtons().find((each) => each.dataset.oylWay === id);
  if (found === undefined) throw new Error(`no way drawn for ${id}`);
  return found;
}

/** A control's text, its runs of space made one. */
export function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The word a way's button shows for it. */
export function wordOn(button: Element): string {
  return textOf(button.querySelector('.oyl-hud__junction-word') ?? button);
}

/** The key glyphs a way's button shows, in order. */
export function keysOn(button: Element): string[] {
  return queryAll(button, 'kbd').map((each) => textOf(each));
}

/** A key going down on the page, as a keyboard or a bar remote sends it. */
export function pressKey(key: string): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }),
    );
  });
}
