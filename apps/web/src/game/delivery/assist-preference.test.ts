// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';
import {
  DELIVERY_ASSIST_DEFAULTS,
  DELIVERY_ASSIST_STORAGE_KEY,
  OBSTACLE_SETTINGS,
  readDeliveryAssist,
  writeDeliveryAssist,
  type DeliveryAssist,
} from './assist-preference';
import { readDeliveryProgress, writeDeliveryProgress } from './delivery-progress';
import { placeObstacles } from './obstacles';
import {
  endRound,
  FRESH_WEEK,
  recordDelivery,
  recordMiss,
  startRound,
  type WeekProgress,
} from './round';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  type Landing,
  NO_PARCELS,
  PARCEL_FLIGHT_TICKS,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  stepThrows,
  TARGET_CATCH_RADIUS_METRES,
  type ThrowTarget,
} from './throw';

/** A `localStorage` stand-in, so a write can be read back through a fresh reader over the same storage. */
function disk(): PreferenceStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Keep `assist` on a fresh device, then read it back as a ride would: a new reader over that storage. */
function keptAndReadBack(assist: DeliveryAssist): DeliveryAssist {
  const store = disk();
  expect(writeDeliveryAssist(store, assist)).toBe(true);
  // Only the storage carries it across: the reader is handed a copy of the values.
  const fresh = new Map(store.values);
  return readDeliveryAssist({ getItem: (key) => fresh.get(key) ?? null, setItem: () => undefined });
}

describe('the assisted Delivery setting is kept on this device — #1813, DL10', () => {
  it('reads back every combination written, under its own key and holding only its three parts', () => {
    for (const obstacles of OBSTACLE_SETTINGS) {
      for (const widerWindows of [false, true]) {
        for (const noFail of [false, true]) {
          const assist: DeliveryAssist = { widerWindows, obstacles, noFail };
          expect(keptAndReadBack(assist)).toEqual(assist);
        }
      }
    }
    const store = disk();
    const carrying = { widerWindows: true, obstacles: 'none', noFail: true, house: 3 } as const;
    writeDeliveryAssist(store, carrying);
    expect([...store.values.keys()]).toEqual([DELIVERY_ASSIST_STORAGE_KEY]);
    const stored = JSON.parse(store.values.get(DELIVERY_ASSIST_STORAGE_KEY) ?? '{}') as object;
    expect(Object.keys(stored).sort()).toEqual(['noFail', 'obstacles', 'widerWindows']);
  });

  it('reads as nothing assisted on a device that has never chosen', () => {
    expect(readDeliveryAssist(disk())).toEqual({
      widerWindows: false,
      obstacles: 'normal',
      noFail: false,
    });
    expect(readDeliveryAssist(undefined)).toBe(DELIVERY_ASSIST_DEFAULTS);
  });

  it('reads a stored value it cannot parse as the defaults, as a whole', () => {
    const unreadable = [
      'not json',
      '',
      'null',
      '7',
      '"on"',
      '[]',
      '{}',
      // One part wrong, the others fine: the whole reads as the defaults.
      JSON.stringify({ widerWindows: 'yes', obstacles: 'none', noFail: true }),
      JSON.stringify({ widerWindows: true, obstacles: 'slower', noFail: true }),
      JSON.stringify({ widerWindows: true, obstacles: 'none', noFail: 1 }),
      JSON.stringify({ widerWindows: true, noFail: true }),
    ];
    for (const text of unreadable) {
      const store = disk();
      store.setItem(DELIVERY_ASSIST_STORAGE_KEY, text);
      expect(readDeliveryAssist(store), text).toEqual(DELIVERY_ASSIST_DEFAULTS);
    }
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readDeliveryAssist(throwing)).toEqual(DELIVERY_ASSIST_DEFAULTS);
  });

  it('reports a device with no storage, or one that refuses, as not keeping it', () => {
    const assist: DeliveryAssist = { widerWindows: true, obstacles: 'none', noFail: true };
    expect(writeDeliveryAssist(undefined, assist)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeDeliveryAssist(refusing, assist)).toBe(false);
    expect(readDeliveryAssist(refusing)).toEqual(DELIVERY_ASSIST_DEFAULTS);
  });
});

/** A doorstep 1.6 m off the carriageway, reached 0.51 s after the throw. */
const DOORSTEP: ThrowTarget = { position: 0, along: 110, side: 'right', clear: 1.6 };

/** Throw once to the right from `along` at 10 m/s, fly the parcel out, and say how it came down. */
function throwFrom(along: number, widerWindows: boolean): Landing['kind'][] {
  let state = NO_PARCELS;
  let round = startRound(1);
  const kinds: Landing['kind'][] = [];
  for (let tick = 0; tick <= PARCEL_FLIGHT_TICKS; tick += 1) {
    const step = stepThrows(state, {
      rider: { along, speed: 10 },
      targets: [DOORSTEP],
      round,
      ...(tick === 0 ? { throwTo: 'right' as const } : {}),
      widerWindows,
    });
    state = step.state;
    round = step.round;
    kinds.push(...step.landings.map((landing) => landing.kind));
  }
  return kinds;
}

describe('each part, read back from the device, changes what its own module does — #1813', () => {
  it('wider windows: a throw that misses at the default delivers', () => {
    // Crosses the doorstep's depth 2.6 m short of it: outside 1.5 m, inside 4.5 m.
    const reach =
      (CARRIAGEWAY_HALF_WIDTH_METRES + DOORSTEP.clear) / PARCEL_THROW_SPEED_METRES_PER_SECOND;
    const launch = DOORSTEP.along - 10 * reach - 2.6;
    expect(2.6).toBeGreaterThan(TARGET_CATCH_RADIUS_METRES);

    const usual = keptAndReadBack(DELIVERY_ASSIST_DEFAULTS);
    expect(throwFrom(launch, usual.widerWindows)).toEqual(['wasted']);
    const wider = keptAndReadBack({ ...DELIVERY_ASSIST_DEFAULTS, widerWindows: true });
    expect(throwFrom(launch, wider.widerWindows)).toEqual(['delivery']);
  });

  it('obstacles off: none are placed; fewer: half of them, each where it would have been', () => {
    const span = { from: 0, to: 5_000 };
    const seed = 0x5eed_1813;
    const usual = placeObstacles(span, seed, keptAndReadBack(DELIVERY_ASSIST_DEFAULTS).obstacles);
    expect(usual).toHaveLength(20);

    const none = keptAndReadBack({ ...DELIVERY_ASSIST_DEFAULTS, obstacles: 'none' });
    expect(placeObstacles(span, seed, none.obstacles)).toEqual([]);

    const fewer = keptAndReadBack({ ...DELIVERY_ASSIST_DEFAULTS, obstacles: 'fewer' });
    const placed = placeObstacles(span, seed, fewer.obstacles);
    expect(placed).toHaveLength(10);
    for (const obstacle of placed) expect(usual).toContainEqual(obstacle);
  });

  it('no fail: a round of misses leaves the next day’s count unchanged, read back from the week kept', () => {
    /** Ride the first day missing `misses` houses, keep the week, and read it back as the next ride does. */
    function nextDay(noFail: boolean, misses: number): WeekProgress {
      let round = startRound(FRESH_WEEK.houses, { assisted: noFail });
      for (let position = 0; position < FRESH_WEEK.houses; position += 1) {
        round = position < misses ? recordMiss(round, position) : recordDelivery(round, position);
      }
      const store = disk();
      expect(writeDeliveryProgress(store, endRound(FRESH_WEEK, round).next)).toBe(true);
      return readDeliveryProgress(store);
    }
    const usual = keptAndReadBack(DELIVERY_ASSIST_DEFAULTS).noFail;
    const assisted = keptAndReadBack({ ...DELIVERY_ASSIST_DEFAULTS, noFail: true }).noFail;
    // Two houses missed, as the tablet step rides it: they drop out unless no fail is on.
    expect(nextDay(usual, 2)).toEqual({ day: 2, houses: FRESH_WEEK.houses - 2, score: 6 });
    expect(nextDay(assisted, 2)).toEqual({ day: 2, houses: FRESH_WEEK.houses, score: 6 });
    // Every house missed: the week is over at the default, and tomorrow is the same round assisted.
    expect(nextDay(usual, FRESH_WEEK.houses)).toEqual(FRESH_WEEK);
    expect(nextDay(assisted, FRESH_WEEK.houses)).toEqual({
      day: 2,
      houses: FRESH_WEEK.houses,
      score: 0,
    });
  });
});

const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const THIS_MODULE = fileURLToPath(new URL('./assist-preference.ts', import.meta.url));

/** Every shipped source file under `apps/web/src`: no test, and no `*-testing.ts` support. */
function shippedSources(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...shippedSources(path));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !/-testing\.tsx?$/.test(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

/** Every relative module a source names: `import … from`, `export … from` and `import('…')`. */
function relativeImports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const specifiers = [
    ...text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
    ...text.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ...text.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g),
  ].map((match) => match[1] ?? '');
  return specifiers.map((specifier) => resolve(dirname(path), specifier));
}

describe('the setting changes nothing on an ordinary ride — #1813', () => {
  const sources = shippedSources(SOURCE_ROOT);

  it('walks the client’s own tree, not an empty one', () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(sources).toContain(THIS_MODULE);
  });

  it('is read only by the Settings screen and by Delivery’s own modules', () => {
    const target = THIS_MODULE.replace(/\.ts$/, '');
    const readers = sources
      .filter((path) => path !== THIS_MODULE)
      .filter((path) =>
        relativeImports(path).some((name) => name === target || name === THIS_MODULE),
      )
      .map((path) => relative(SOURCE_ROOT, path).split('\\').join('/'));
    expect(readers).toContain('views/SettingsView.tsx');
    expect(readers.filter((path) => !path.startsWith('game/delivery/'))).toEqual([
      'views/SettingsView.tsx',
    ]);
  });

  it('keeps its stored key in this module alone, so nothing reads the storage around it', () => {
    const naming = sources
      .filter((path) => readFileSync(path, 'utf8').includes('oyl.game.delivery.assist'))
      .map((path) => relative(SOURCE_ROOT, path).split('\\').join('/'));
    expect(naming).toEqual(['game/delivery/assist-preference.ts']);
  });

  it('as its defaults, leaves the throw and the obstacles exactly as they are with no setting', () => {
    const span = { from: 0, to: 2_000 };
    expect(placeObstacles(span, 42, DELIVERY_ASSIST_DEFAULTS.obstacles)).toEqual(
      placeObstacles(span, 42),
    );
    expect(startRound(4, { assisted: DELIVERY_ASSIST_DEFAULTS.noFail })).toEqual(startRound(4));
    for (let along = 95; along <= 112; along += 0.1) {
      const input = { rider: { along, speed: 10 }, targets: [DOORSTEP], round: startRound(1) };
      const thrown = stepThrows(NO_PARCELS, { ...input, throwTo: 'right' });
      const flown = stepThrows(thrown.state, { ...input, ticks: PARCEL_FLIGHT_TICKS });
      const assisted = stepThrows(thrown.state, {
        ...input,
        ticks: PARCEL_FLIGHT_TICKS,
        widerWindows: DELIVERY_ASSIST_DEFAULTS.widerWindows,
      });
      expect(assisted).toEqual(flown);
    }
  });
});
