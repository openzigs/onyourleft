// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3107: the street names' belt is ready before a name is in view.
 *
 * The belt was built on the first frame that carried a name, with a geometry
 * that carried no attribute while it named nothing. Either way its program
 * was linked inside the frame the first name came into view: one of the
 * stalls on the owner's tablet (2026-11-23). What jsdom can hold is what the
 * renderer keys a program on — that a ride which may name a street says so
 * on its first frame, and that the belt's geometry carries a named frame's
 * attributes while it names nothing. That the view then builds the belt with
 * that first frame, and links no program mid-ride, is the browser gate's
 * (`browser/open-world.browser.spec.ts`), on a real context: a view with no
 * context stages no frame.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import { northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { streetNameLabels, streetNamesInView } from './street-names';
import { corridorOrigin } from './terrain';
import { StreetNameBelt } from './three-renderer';

const ROAD = northRoute(3_000, () => 30);

function frame(extra: object = {}): ReturnType<typeof sceneFrame> {
  const start = atStartLine(ROAD);
  return sceneFrame({
    profile: ROAD,
    origin: corridorOrigin(ROAD),
    state: { ...start, ride: { ...start.ride, distance: metres(1_000) } },
    ...extra,
  });
}

/** What three keys a program on, of a geometry: the attributes it carries. */
const attributesOf = (belt: StreetNameBelt): string[] =>
  Object.keys(belt.mesh.geometry.attributes).sort();

describe('the street names’ belt is ready before a name is in view — #3107', () => {
  it('a ride that may name a street carries its names on every frame, the ones with none in sight too', () => {
    // An open-world ride hands the scene its names, here none yet: no named street is held.
    const unnamed = frame({ streetNames: [] });
    expect(unnamed.streetNames).toBeDefined();
    expect(unnamed.streetNames?.cells).toHaveLength(0);
    // Every other ride hands none, and its frames carry none.
    expect(frame().streetNames).toBeUndefined();
  });

  it('carries a named frame’s attributes while it names nothing', () => {
    const belt = new StreetNameBelt(undefined);
    const named = streetNamesInView(
      streetNameLabels([{ id: 'a', line: [0, 0, -150, 0], name: 'Main Street' }]),
      { x: -75, z: 0 },
      0,
      () => 0,
    );
    expect(named.cells.length).toBeGreaterThan(0);
    // As built, naming nothing.
    expect(attributesOf(belt)).toStrictEqual(['normal', 'position', 'uv']);
    expect(belt.mesh.geometry.index?.count).toBe(0);
    // Naming a street: the same attributes, now holding its letters.
    belt.update(named, 'stylised');
    expect(attributesOf(belt)).toStrictEqual(['normal', 'position', 'uv']);
    expect(belt.mesh.geometry.index?.count).toBe(named.cells.length * 6);
    // And naming nothing again, with or without a view: the same still.
    belt.update(
      streetNamesInView([], { x: 0, z: 0 }, 0, () => 0),
      'stylised',
    );
    expect(attributesOf(belt)).toStrictEqual(['normal', 'position', 'uv']);
    belt.update(undefined, 'stylised');
    expect(attributesOf(belt)).toStrictEqual(['normal', 'position', 'uv']);
    expect(belt.mesh.visible).toBe(false);
    belt.dispose();
  });
});
