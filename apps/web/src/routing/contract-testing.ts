// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What every {@link RoutingProvider} must do, as a list of checks that run
 * anywhere (#2734): against `testing.ts`'s scripted double in Vitest
 * (`contract.test.ts`), and against the in-browser Valhalla adapter on the
 * synthetic grid in the browser gate (`browser/routing.browser.spec.ts`),
 * where a real WebAssembly engine runs. One list, so the double and the real
 * engine are held to the same promises and neither can drift alone.
 *
 * Each check throws a plain `Error` naming what broke, so a browser page can
 * run it and hand back the message. The points are the caller's: three
 * waypoints on roads, in order, close enough together that the double's fixed
 * leg length is not shorter than the straight line between them, and one
 * inside the graph's coverage but far from any road it holds (#3179).
 *
 * No real place: the gate's points are on the grid off Null Island
 * (`tools/valhalla/synthetic-grid.ts`), and the Vitest run's are beside them.
 */

import {
  distanceBetween,
  RoutingError,
  type GeographicPosition,
  type RidingPreferences,
  type RoutingProvider,
} from '@onyourleft/domain';

/** What a contract check is given. */
export interface ContractInputs {
  readonly provider: RoutingProvider;
  /** Three waypoints on roads, in order. */
  readonly points: readonly [GeographicPosition, GeographicPosition, GeographicPosition];
  readonly preferences: RidingPreferences;
  /** How far a leg's ends may sit from its waypoints: the engine's snapping. Metres. */
  readonly snapMetres: number;
  /**
   * A point inside the graph's coverage with no road for kilometres: where
   * Valhalla moves a waypoint to the nearest road, however far (#3179).
   */
  readonly farFromRoads: GeographicPosition;
}

export interface ContractCheck {
  readonly name: string;
  run(inputs: ContractInputs): Promise<void>;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SURFACES = new Set(['paved', 'unpaved', 'unknown']);

export const ROUTING_CONTRACT: readonly ContractCheck[] = [
  {
    name: 'answers two waypoints with one leg that follows a road, from the first to the second',
    async run({ provider, points, preferences, snapMetres }) {
      const legs = await provider.route({
        waypoints: [{ position: points[0] }, { position: points[1] }],
        preferences,
      });
      check(legs.length === 1, `expected 1 leg, got ${String(legs.length)}`);
      const [leg] = legs;
      if (leg === undefined) throw new Error('no leg');
      check(
        leg.shape.length > 2,
        `a snapped leg has more than two points; got ${String(leg.shape.length)}`,
      );
      const first = leg.shape[0];
      const last = leg.shape.at(-1);
      if (first === undefined || last === undefined) throw new Error('an empty shape');
      check(
        distanceBetween(first, points[0]) <= snapMetres,
        'the leg does not start at its first waypoint',
      );
      check(
        distanceBetween(last, points[1]) <= snapMetres,
        'the leg does not end at its second waypoint',
      );
      check(Number.isFinite(leg.distance) && leg.distance > 0, 'the leg has no distance');
      check(
        leg.distance >= distanceBetween(points[0], points[1]) - 2 * snapMetres,
        'the leg is shorter than the straight line between its waypoints',
      );
      check(SURFACES.has(leg.surface), `an unknown surface word: ${leg.surface}`);
    },
  },
  {
    name: 'answers three waypoints with two legs, in order, meeting at the middle one',
    async run({ provider, points, preferences, snapMetres }) {
      const legs = await provider.route({
        waypoints: points.map((position) => ({ position })),
        preferences,
      });
      check(legs.length === 2, `expected 2 legs, got ${String(legs.length)}`);
      const end = legs[0]?.shape.at(-1);
      const start = legs[1]?.shape[0];
      if (end === undefined || start === undefined) throw new Error('an empty leg');
      check(
        distanceBetween(end, points[1]) <= snapMetres,
        'the first leg does not end at the middle waypoint',
      );
      check(
        distanceBetween(start, points[1]) <= snapMetres,
        'the second leg does not start at the middle waypoint',
      );
    },
  },
  {
    name: 'never answers a leg to a waypoint far from any road with a line that does not reach it',
    async run({ provider, points, preferences, snapMetres, farFromRoads }) {
      let legs;
      try {
        legs = await provider.route({
          waypoints: [{ position: points[0] }, { position: farFromRoads }],
          preferences,
        });
      } catch (error) {
        // Refusing the leg keeps the promise; any other throw does not.
        check(error instanceof RoutingError, 'the far leg was refused without a RoutingError');
        return;
      }
      const last = legs[0]?.shape.at(-1);
      check(
        last !== undefined && distanceBetween(last, farFromRoads) <= snapMetres,
        'a leg to a waypoint far from any road was answered with a line that does not reach it',
      );
    },
  },
  {
    name: 'refuses fewer than two waypoints as an invalid request, with a RoutingError',
    async run({ provider, points, preferences }) {
      let caught: unknown;
      try {
        await provider.route({ waypoints: [{ position: points[0] }], preferences });
      } catch (error) {
        caught = error;
      }
      check(
        caught instanceof RoutingError,
        'a single waypoint was not refused with a RoutingError',
      );
      check(
        (caught as RoutingError).code === 'invalid-request',
        'a single waypoint was not an invalid request',
      );
    },
  },
];

/** Runs every check; resolves to each one's name and, where it failed, why. */
export async function runRoutingContract(
  inputs: ContractInputs,
): Promise<readonly { readonly name: string; readonly failure: string | undefined }[]> {
  const results: { name: string; failure: string | undefined }[] = [];
  for (const contract of ROUTING_CONTRACT) {
    try {
      await contract.run(inputs);
      results.push({ name: contract.name, failure: undefined });
    } catch (error) {
      results.push({
        name: contract.name,
        failure: error instanceof Error ? error.message : 'a value that is not an Error was thrown',
      });
    }
  }
  return results;
}
