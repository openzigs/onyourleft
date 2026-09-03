// SPDX-License-Identifier: Apache-2.0

/**
 * The capability lists exist so nothing has to restate the union, and a
 * restated list is the one that goes stale. These tests are what make that
 * true: adding a capability without adding it to the list fails here.
 */

import { describe, expect, it } from 'vitest';

import {
  isMeasurementCapability,
  MEASUREMENT_CAPABILITIES,
  SENSOR_CAPABILITIES,
  type SensorCapability,
} from './index';

describe('the capability lists', () => {
  it('name the four quantities #41-#43 deliver', () => {
    expect([...MEASUREMENT_CAPABILITIES]).toEqual(['power', 'cadence', 'heart-rate', 'speed']);
  });

  it('add trainer control, and nothing else, to make the full set', () => {
    expect([...SENSOR_CAPABILITIES]).toEqual([...MEASUREMENT_CAPABILITIES, 'trainer-control']);
  });

  it('contain no duplicates', () => {
    expect(new Set(SENSOR_CAPABILITIES).size).toBe(SENSOR_CAPABILITIES.length);
  });
});

describe('separating what a device reports from what it accepts', () => {
  it('calls every measurement capability a measurement capability', () => {
    const measurement = SENSOR_CAPABILITIES.filter((capability: SensorCapability) =>
      isMeasurementCapability(capability),
    );
    expect(measurement).toEqual([...MEASUREMENT_CAPABILITIES]);
  });

  it('does not call trainer control one', () => {
    // It carries no measurement, which is why it is outside
    // MeasurementCapability rather than inside it with an empty payload.
    expect(isMeasurementCapability('trainer-control')).toBe(false);
  });
});
