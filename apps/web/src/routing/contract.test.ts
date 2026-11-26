// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
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

const inputs = (provider: RoutingProvider): ContractInputs => ({
  provider,
  points: POINTS,
  preferences: RIDING_DEFAULTS,
  snapMetres: 30,
});

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
    expect(results[0]?.failure).toMatch(/more than two points/);
    expect(results[2]?.failure).toMatch(/not refused/);
  });

  it('reports every check by name, passed or failed', async () => {
    const results = await runRoutingContract(inputs(scriptedProvider()));
    expect(results.map((result) => result.name)).toStrictEqual(
      ROUTING_CONTRACT.map((contract) => contract.name),
    );
    expect(results.every((result) => result.failure === undefined)).toBe(true);
  });
});
