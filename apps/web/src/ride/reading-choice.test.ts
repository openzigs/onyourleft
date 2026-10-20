// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1433: the Ride screen's chosen readings — what is stored, what is read
 * back, and what the screen is handed. Every write here is asserted by
 * reading it back through `readRideReadings`, the path `RideView` and
 * Settings both read it by, not by inspecting the object written.
 */

import { describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';

import type { RideMetric } from './controller';
import {
  chosenReadings,
  moveReading,
  readRideReadings,
  RIDE_READINGS_STORAGE_KEY,
  showReading,
  shownReadings,
  writeRideReadings,
  ZOOMED_READING_COUNT,
} from './reading-choice';

function memory(initial?: string): Storage {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(RIDE_READINGS_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  } as unknown as Storage;
}

const METRICS: readonly RideMetric[] = [
  { id: 'power', state: { kind: 'live', value: 248, at: unixSeconds(1) } },
  { id: 'cadence', state: { kind: 'live', value: 91, at: unixSeconds(1) } },
  { id: 'heartRate', state: { kind: 'waiting' } },
  { id: 'speed', state: { kind: 'unpaired' } },
];

const DEFAULT_ORDER = ['power', 'cadence', 'heartRate', 'speed'];

describe('what this device has stored', () => {
  it('is the screen as it was before #1433 when nothing is stored', () => {
    const choice = readRideReadings(memory());
    expect(choice).toEqual({ order: DEFAULT_ORDER, hidden: [], zoomed: false });
    expect(readRideReadings(undefined)).toEqual(choice);
  });

  it('is the default for a value that is not JSON, or not an object', () => {
    for (const stored of ['{', 'null', '7', '"power"']) {
      expect(readRideReadings(memory(stored)).order).toEqual(DEFAULT_ORDER);
    }
  });

  it('is the default where reading the store throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    } as unknown as Storage;
    expect(readRideReadings(throwing).order).toEqual(DEFAULT_ORDER);
  });

  it('drops unknown ids and duplicates, and adds a missing one back at the end', () => {
    const choice = readRideReadings(
      memory(JSON.stringify({ order: ['speed', 'gradient', 'speed', 'power'], hidden: ['ftp'] })),
    );
    expect(choice.order).toEqual(['speed', 'power', 'cadence', 'heartRate']);
    expect(choice.hidden).toEqual([]);
  });

  it('shows everything rather than nothing when every reading is stored hidden', () => {
    const choice = readRideReadings(memory(JSON.stringify({ hidden: DEFAULT_ORDER })));
    expect(chosenReadings(choice)).toEqual(DEFAULT_ORDER);
  });

  it('is zoomed only for a stored true', () => {
    expect(readRideReadings(memory(JSON.stringify({ zoomed: true }))).zoomed).toBe(true);
    expect(readRideReadings(memory(JSON.stringify({ zoomed: 'yes' }))).zoomed).toBe(false);
  });
});

describe('keeping a choice', () => {
  it('is read back as written', () => {
    const storage = memory();
    const choice = showReading(
      moveReading(readRideReadings(storage), 'speed', -1),
      'cadence',
      false,
    );
    expect(writeRideReadings(storage, { ...choice, zoomed: true })).toBe(true);

    const read = readRideReadings(storage);
    expect(read.order).toEqual(['power', 'cadence', 'speed', 'heartRate']);
    expect(chosenReadings(read)).toEqual(['power', 'speed', 'heartRate']);
    expect(read.zoomed).toBe(true);
  });

  it('says so when the device refuses, and when there is no device store', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const choice = readRideReadings(undefined);
    expect(writeRideReadings(full, choice)).toBe(false);
    expect(writeRideReadings(undefined, choice)).toBe(false);
  });
});

describe('what the Ride screen is handed', () => {
  it('is every chosen reading, in the rider’s order', () => {
    const choice = showReading(
      moveReading(moveReading(readRideReadings(undefined), 'speed', -1), 'speed', -1),
      'power',
      false,
    );
    expect(shownReadings(METRICS, choice).map((metric) => metric.id)).toEqual([
      'speed',
      'cadence',
      'heartRate',
    ]);
  });

  it('is the top two, zoomed — the rider’s top two, not the first two channels', () => {
    const choice = {
      ...moveReading(moveReading(readRideReadings(undefined), 'heartRate', -1), 'heartRate', -1),
      zoomed: true,
    };
    const shown = shownReadings(METRICS, choice);
    expect(shown).toHaveLength(ZOOMED_READING_COUNT);
    expect(shown.map((metric) => metric.id)).toEqual(['heartRate', 'power']);
    // The state travels with the reading: a waiting channel stays waiting.
    expect(shown[0]?.state).toEqual({ kind: 'waiting' });
  });

  it('is the one chosen reading, zoomed, when only one is chosen', () => {
    let choice = readRideReadings(undefined);
    for (const id of ['power', 'cadence', 'heartRate'] as const) {
      choice = showReading(choice, id, false);
    }
    expect(shownReadings(METRICS, { ...choice, zoomed: true }).map((m) => m.id)).toEqual(['speed']);
  });
});

describe('changing the order and what is shown', () => {
  it('does not move the top reading up, or the bottom one down', () => {
    const choice = readRideReadings(undefined);
    expect(moveReading(choice, 'power', -1)).toBe(choice);
    expect(moveReading(choice, 'speed', 1)).toBe(choice);
    expect(moveReading(choice, 'power', 1).order).toEqual([
      'cadence',
      'power',
      'heartRate',
      'speed',
    ]);
  });

  it('never hides the last reading shown', () => {
    let choice = readRideReadings(undefined);
    for (const id of ['power', 'cadence', 'heartRate'] as const) {
      choice = showReading(choice, id, false);
    }
    expect(showReading(choice, 'speed', false)).toBe(choice);
    expect(chosenReadings(showReading(choice, 'power', true))).toEqual(['power', 'speed']);
  });
});
