// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The lap race's assisted setting — #1905: kept on this device and read back
 * through the one reader the race reads it with, and each part seen to change
 * the race the model runs.
 *
 * ⚠️ **Read back through a fresh module over a fresh store handle**
 * (`docs/agents/store-harness.md`): the setting is written to the device's
 * own `localStorage`, the module is loaded again (`vi.resetModules`) and the
 * new copy's `readLapRaceAssist` is handed `window.localStorage` afresh, so
 * nothing written can be read back out of an object the writer still holds.
 */

import {
  BOT_TIERS,
  createItemRace,
  raceCourse,
  stepRace,
  type ItemKind,
  type ItemRaceState,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';
import { assistedBotTier, assistedRaceSetup, assistedTick } from './assist';
import {
  LAP_RACE_ASSIST_DEFAULTS,
  LAP_RACE_ASSIST_PARTS,
  LAP_RACE_ASSIST_STORAGE_KEY,
  readLapRaceAssist,
  writeLapRaceAssist,
  type LapRaceAssist,
} from './assist-preference';

afterEach(() => {
  localStorage.clear();
});

/** Every combination of the four parts. */
function everyAssist(): LapRaceAssist[] {
  const all: LapRaceAssist[] = [];
  for (let bits = 0; bits < 16; bits += 1) {
    all.push({
      itemsOff: (bits & 1) !== 0,
      autoUse: (bits & 2) !== 0,
      noKnockBack: (bits & 4) !== 0,
      gentlerBots: (bits & 8) !== 0,
    });
  }
  return all;
}

const RIDER = 'rider';
const BOTS = ['bot-1', 'bot-2', 'bot-3'] as const;

function startRace(assist: LapRaceAssist, laps = 3, lap = 400): ItemRaceState {
  return createItemRace(
    assistedRaceSetup(
      assist,
      {
        course: raceCourse(lap, laps),
        seed: 1_905,
        itemsOn: true,
        racerIds: [RIDER, ...BOTS],
        startMs: 0,
      },
      RIDER,
    ),
  );
}

function holding(race: ItemRaceState, id: string, kind: ItemKind): ItemRaceState {
  return {
    ...race,
    racers: race.racers.map((entry) => (entry.racer.id === id ? { ...entry, held: kind } : entry)),
  };
}

function riderOf(race: ItemRaceState) {
  const found = race.racers.find((entry) => entry.racer.id === RIDER);
  if (found === undefined) throw new Error('no rider in the race');
  return found;
}

describe('the lap race’s assisted setting is kept on this device — #1905', () => {
  it('reads back through a fresh module over a fresh store handle, as the race reads it', async () => {
    for (const assist of everyAssist()) {
      expect(writeLapRaceAssist(localStorage, assist)).toBe(true);
      vi.resetModules();
      const fresh = await import('./assist-preference');
      expect(fresh.readLapRaceAssist).not.toBe(readLapRaceAssist);
      expect(fresh.readLapRaceAssist(window.localStorage)).toEqual(assist);
    }
  });

  it('keeps only its four parts, under its own key', () => {
    const carrying = { ...LAP_RACE_ASSIST_DEFAULTS, itemsOff: true, seed: 7, place: 'x' };
    writeLapRaceAssist(localStorage, carrying);
    expect(Object.keys(localStorage)).toEqual([LAP_RACE_ASSIST_STORAGE_KEY]);
    const stored = JSON.parse(localStorage.getItem(LAP_RACE_ASSIST_STORAGE_KEY) ?? '{}') as object;
    expect(Object.keys(stored).sort()).toEqual([...LAP_RACE_ASSIST_PARTS].sort());
  });

  it('reads as nothing assisted on a device that never chose, and on one it cannot read', () => {
    expect(readLapRaceAssist(localStorage)).toEqual(LAP_RACE_ASSIST_DEFAULTS);
    expect(readLapRaceAssist(undefined)).toEqual(LAP_RACE_ASSIST_DEFAULTS);
    for (const text of [
      'not json',
      'null',
      '7',
      '{"itemsOff":true}',
      '{"itemsOff":"yes","autoUse":true,"noKnockBack":true,"gentlerBots":true}',
    ]) {
      localStorage.setItem(LAP_RACE_ASSIST_STORAGE_KEY, text);
      expect(readLapRaceAssist(localStorage), text).toEqual(LAP_RACE_ASSIST_DEFAULTS);
    }
  });

  it('says when the device refused to keep it', () => {
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeLapRaceAssist(refusing, { ...LAP_RACE_ASSIST_DEFAULTS, autoUse: true })).toBe(
      false,
    );
    expect(writeLapRaceAssist(undefined, LAP_RACE_ASSIST_DEFAULTS)).toBe(false);
  });
});

describe('each part, read back from the device, changes the race — #1905', () => {
  /** The setting with only `part` on, kept and read back as the race reads it. */
  function keptWith(part: keyof LapRaceAssist): LapRaceAssist {
    writeLapRaceAssist(localStorage, { ...LAP_RACE_ASSIST_DEFAULTS, [part]: true });
    return readLapRaceAssist(window.localStorage);
  }

  it('items off: the race is started with no items', () => {
    expect(startRace(keptWith('itemsOff')).itemsOn).toBe(false);
    expect(startRace(LAP_RACE_ASSIST_DEFAULTS).itemsOn).toBe(true);
  });

  it('no knock-back on me: with every bot targeting the rider, the rider’s offset is never below 0', () => {
    function offsets(assist: LapRaceAssist): number[] {
      let race = startRace(assist);
      const seen: number[] = [];
      for (let second = 1; second <= 90; second += 1) {
        for (const id of BOTS) race = holding(race, id, 'crosswind-gust');
        const rider = second * 9;
        race = stepRace(race, {
          atMs: second * 1_000,
          effortDistances: {
            [RIDER]: rider,
            'bot-1': rider - 4,
            'bot-2': rider - 12,
            'bot-3': rider - 20,
          },
          uses: [...BOTS],
        });
        seen.push(riderOf(race).racer.raceOffset);
      }
      return seen;
    }
    expect(Math.min(...offsets(keptWith('noKnockBack')))).toBeGreaterThanOrEqual(0);
    // The control: the same race, the same bots, without the setting.
    expect(Math.min(...offsets(LAP_RACE_ASSIST_DEFAULTS))).toBeLessThan(0);
  });

  it('auto-use: a race completes with no item input from the rider, and the rider’s items still fire', () => {
    const assist = keptWith('autoUse');
    let race = startRace(assist, 3, 400);
    let fired = 0;
    for (let second = 1; second <= 200 && riderOf(race).racer.finishedAtMs === null; second += 1) {
      const before = riderOf(race).held;
      const rider = second * 8;
      // No `uses` at all: nothing the rider pressed.
      const input = assistedTick(assist, race, RIDER, {
        atMs: second * 1_000,
        effortDistances: { [RIDER]: rider, 'bot-1': rider * 0.9, 'bot-2': rider * 0.8, 'bot-3': 0 },
      });
      race = stepRace(race, input);
      if (before !== null && riderOf(race).held === null) fired += 1;
    }
    expect(riderOf(race).racer.finishedAtMs).not.toBeNull();
    expect(fired).toBeGreaterThan(0);
    // Without it, the rider picks up an item and holds it to the line.
    let plain = startRace(LAP_RACE_ASSIST_DEFAULTS, 3, 400);
    for (let second = 1; second <= 200; second += 1) {
      const rider = second * 8;
      plain = stepRace(
        plain,
        assistedTick(LAP_RACE_ASSIST_DEFAULTS, plain, RIDER, {
          atMs: second * 1_000,
          effortDistances: {
            [RIDER]: rider,
            'bot-1': rider * 0.9,
            'bot-2': rider * 0.8,
            'bot-3': 0,
          },
        }),
      );
    }
    expect(riderOf(plain).held).not.toBeNull();
  });

  it('auto-use leaves a press already in the input as it is, and adds none with nothing held', () => {
    const assist = keptWith('autoUse');
    const race = startRace(assist);
    const input = { atMs: 1_000, effortDistances: {} };
    expect(assistedTick(assist, race, RIDER, input)).toBe(input);
    const held = holding(race, RIDER, 'tailwind');
    expect(assistedTick(assist, held, RIDER, input).uses).toEqual([RIDER]);
    const pressed = { ...input, uses: [RIDER, 'bot-1'] };
    expect(assistedTick(assist, held, RIDER, pressed)).toBe(pressed);
  });

  it('gentler bots: every tier one easier, and the easiest stays the easiest', () => {
    const assist = keptWith('gentlerBots');
    expect(BOT_TIERS.map((tier) => assistedBotTier(assist, tier))).toEqual([
      'steady',
      'steady',
      'brisk',
      'hard',
    ]);
    expect(BOT_TIERS.map((tier) => assistedBotTier(LAP_RACE_ASSIST_DEFAULTS, tier))).toEqual([
      ...BOT_TIERS,
    ]);
  });

  it('as its defaults, starts and steps the race exactly as it is with no setting', () => {
    const plain = createItemRace({
      course: raceCourse(400, 3),
      seed: 1_905,
      itemsOn: true,
      racerIds: [RIDER, ...BOTS],
      startMs: 0,
    });
    expect(startRace(LAP_RACE_ASSIST_DEFAULTS)).toEqual(plain);
  });
});
