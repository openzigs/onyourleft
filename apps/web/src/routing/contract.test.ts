// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  RoutingError,
  type RoutingProvider,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { ROUTING_CONTRACT, runRoutingContract, type ContractInputs } from './contract-testing';
import { RIDING_DEFAULTS } from './preferences';
import { scriptedProvider } from './testing';

// Synthetic points off Null Island, about 330 m apart: no road, no place.
const at = (latitude: number, longitude: number) =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
const POINTS = [at(0.05, 0.05), at(0.053, 0.05), at(0.056, 0.05)] as const;
// About 11 km north of them.
const FAR = at(0.15, 0.05);

const inputs = (provider: RoutingProvider): ContractInputs => ({
  provider,
  points: POINTS,
  preferences: RIDING_DEFAULTS,
  snapMetres: 30,
  farFromRoads: FAR,
});

/** The check called `name`'s failure, read by name so a new check cannot shift it. */
const failureOf = (
  results: Awaited<ReturnType<typeof runRoutingContract>>,
  name: RegExp,
): string | undefined => results.find((result) => name.test(result.name))?.failure;

describe('the routing provider contract (#2734)', () => {
  it.each(ROUTING_CONTRACT.map((contract) => [contract.name, contract] as const))(
    'the scripted double %s',
    async (_name, contract) => {
      await expect(contract.run(inputs(scriptedProvider()))).resolves.toBeUndefined();
    },
  );

  it('fails a provider that draws straight lines and calls them roads', async () => {
    // The control: a contract every provider passes is not a contract.
    const straight: RoutingProvider = {
      route: (request) =>
        Promise.resolve(
          request.waypoints.slice(1).map((waypoint, index) => ({
            shape: [request.waypoints[index]!.position, waypoint.position],
            distance: metres(1_000),
            surface: 'unknown' as const,
          })),
        ),
      heights: () => Promise.reject(new Error('not asked')),
    };
    const results = await runRoutingContract(inputs(straight));
    expect(failureOf(results, /follows a road/)).toMatch(/more than two points/);
    expect(failureOf(results, /fewer than two/)).toMatch(/not refused/);
  });

  it('fails a provider that moves a waypoint far from any road to a road far away, and calls it a road (#3179)', async () => {
    // As Valhalla does with no road near a waypoint: the line ends at the nearest road it has.
    const snapsFar = scriptedProvider();
    const farSnapping: RoutingProvider = {
      route: (request) =>
        snapsFar.route({
          ...request,
          waypoints: request.waypoints.map((waypoint) =>
            waypoint.position === FAR ? { position: at(0.06, 0.05) } : waypoint,
          ),
        }),
      heights: (request) => snapsFar.heights(request),
    };
    const results = await runRoutingContract(inputs(farSnapping));
    expect(failureOf(results, /far from any road/)).toMatch(/does not reach it/);
    // Every other check passes: this one is what catches it.
    expect(results.filter((result) => result.failure !== undefined)).toHaveLength(1);
  });

  it('passes a provider that refuses the far leg with a RoutingError, and fails one that throws anything else', async () => {
    const refusing = (error: Error): RoutingProvider => {
      const double = scriptedProvider();
      return {
        route: (request) =>
          request.waypoints.some((waypoint) => waypoint.position === FAR)
            ? Promise.reject(error)
            : double.route(request),
        heights: (request) => double.heights(request),
      };
    };
    const refused = await runRoutingContract(
      inputs(refusing(new RoutingError('unavailable', 'drawn straight'))),
    );
    expect(failureOf(refused, /far from any road/)).toBeUndefined();
    const broken = await runRoutingContract(inputs(refusing(new TypeError('a bug'))));
    expect(failureOf(broken, /far from any road/)).toMatch(/without a RoutingError/);
  });

  it('reports every check by name, passed or failed', async () => {
    const results = await runRoutingContract(inputs(scriptedProvider()));
    expect(results.map((result) => result.name)).toStrictEqual(
      ROUTING_CONTRACT.map((contract) => contract.name),
    );
    expect(results.every((result) => result.failure === undefined)).toBe(true);
  });
});
