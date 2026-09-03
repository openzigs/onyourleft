// SPDX-License-Identifier: Apache-2.0

/**
 * The connection budget, and the design rule it exists to make natural.
 *
 * The scenario in the first block is the one #39 names: a rider with a smart
 * trainer, a separate power meter, a separate cadence sensor and a heart-rate
 * strap. Four devices, a budget of three, and a plan that must reach for the
 * trainer's own stream rather than opening a second connection for power.
 */

import { describe, expect, it } from 'vitest';

import {
  deviceId,
  MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
  planCapabilitySources,
  WEB_BLUETOOTH,
  type SensorCapability,
  type SensorDevice,
} from './index';

function device(id: string, capabilities: readonly SensorCapability[]): SensorDevice {
  return {
    identity: { transport: WEB_BLUETOOTH, id: deviceId(id) },
    name: id,
    capabilities: new Set(capabilities),
  };
}

const strap = device('hrm', ['heart-rate']);
const powerMeter = device('power-meter', ['power']);
const trainer = device('trainer', ['power', 'cadence', 'speed', 'trainer-control']);
const cadenceSensor = device('cadence-sensor', ['cadence']);

describe('the budget', () => {
  it('is three, the number CLAUDE.md section 8 says to design against', () => {
    expect(MAX_RECOMMENDED_CONCURRENT_CONNECTIONS).toBe(3);
  });
});

describe('power and cadence come from the trainer, not from separate sensors', () => {
  // Deliberately ordered so that taking the first device that covers anything
  // gives the wrong answer: the strap and the power meter both come before the
  // trainer, and each covers exactly one outstanding capability.
  const available = [strap, powerMeter, trainer, cadenceSensor];

  it('uses two connections where first-fit would use three', () => {
    const plan = planCapabilitySources(available, {
      required: ['power', 'cadence', 'heart-rate'],
    });

    expect(plan.connections.map((chosen) => chosen.name)).toEqual(['trainer', 'hrm']);
    expect(plan.unsatisfied).toEqual([]);
  });

  it('assigns power and cadence to the trainer and heart rate to the strap', () => {
    const plan = planCapabilitySources(available, {
      required: ['power', 'cadence', 'heart-rate'],
    });

    const source = (capability: SensorCapability) =>
      plan.assignments.find((assignment) => assignment.capability === capability)?.device.name;

    expect(source('power')).toBe('trainer');
    expect(source('cadence')).toBe('trainer');
    expect(source('heart-rate')).toBe('hrm');
  });

  it('leaves the standalone power meter and cadence sensor unconnected', () => {
    const plan = planCapabilitySources(available, {
      required: ['power', 'cadence', 'heart-rate'],
    });

    expect(plan.connections.map((chosen) => chosen.name)).not.toContain('power-meter');
    expect(plan.connections.map((chosen) => chosen.name)).not.toContain('cadence-sensor');
  });
});

describe('the budget is spent, not exceeded', () => {
  it('stops at three connections and reports what it could not afford', () => {
    const single = [
      device('a', ['power']),
      device('b', ['cadence']),
      device('c', ['heart-rate']),
      device('d', ['speed']),
    ];

    const plan = planCapabilitySources(single, {
      required: ['power', 'cadence', 'heart-rate', 'speed'],
    });

    expect(plan.connections).toHaveLength(MAX_RECOMMENDED_CONCURRENT_CONNECTIONS);
    expect(plan.assignments).toHaveLength(3);
    // `required` is in priority order, so the last one is the one that goes.
    expect(plan.unsatisfied).toEqual(['speed']);
  });

  it('honours a smaller budget when a transport declares one', () => {
    const plan = planCapabilitySources([trainer, strap], {
      required: ['power', 'heart-rate'],
      budget: 1,
    });

    expect(plan.connections.map((chosen) => chosen.name)).toEqual(['trainer']);
    expect(plan.unsatisfied).toEqual(['heart-rate']);
  });

  it('connects to nothing when the budget is zero', () => {
    const plan = planCapabilitySources([trainer, strap], {
      required: ['power', 'heart-rate'],
      budget: 0,
    });

    expect(plan.connections).toEqual([]);
    expect(plan.assignments).toEqual([]);
    expect(plan.unsatisfied).toEqual(['power', 'heart-rate']);
  });
});

describe('capabilities nothing supplies', () => {
  it('reports them rather than throwing, because riding without a strap is a ride', () => {
    const plan = planCapabilitySources([trainer], {
      required: ['power', 'heart-rate'],
    });

    expect(plan.connections.map((chosen) => chosen.name)).toEqual(['trainer']);
    expect(plan.unsatisfied).toEqual(['heart-rate']);
  });

  it('does not spend a connection on a device that covers nothing outstanding', () => {
    // The cadence sensor covers nothing that the trainer has not already
    // covered, so the plan stops at one connection rather than filling the
    // budget for its own sake.
    const plan = planCapabilitySources([trainer, cadenceSensor, powerMeter], {
      required: ['power', 'cadence'],
    });

    expect(plan.connections).toHaveLength(1);
  });

  it('reports an empty plan for an empty request', () => {
    const plan = planCapabilitySources([trainer], { required: [] });

    expect(plan.connections).toEqual([]);
    expect(plan.assignments).toEqual([]);
    expect(plan.unsatisfied).toEqual([]);
  });

  it('reports everything unsatisfied when no device is available', () => {
    const plan = planCapabilitySources([], { required: ['power'] });

    expect(plan.connections).toEqual([]);
    expect(plan.unsatisfied).toEqual(['power']);
  });
});

describe('a repeated capability', () => {
  it('is satisfied once rather than twice', () => {
    const plan = planCapabilitySources([trainer], { required: ['power', 'power', 'cadence'] });

    expect(plan.connections).toHaveLength(1);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.unsatisfied).toEqual([]);
  });
});

describe('trainer control is planned for like any other capability', () => {
  it('does not cost a second connection when the trainer is already chosen', () => {
    const plan = planCapabilitySources([strap, trainer], {
      required: ['trainer-control', 'power', 'heart-rate'],
    });

    expect(plan.connections).toHaveLength(2);
    expect(
      plan.assignments.filter((assignment) => assignment.device.name === 'trainer'),
    ).toHaveLength(2);
  });
});
