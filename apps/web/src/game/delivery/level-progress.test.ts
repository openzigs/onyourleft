// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';

import {
  KEPT_LEVEL_ID_PATTERN,
  LEVEL_PROGRESS_FIELDS,
  LEVEL_PROGRESS_STORAGE_KEY,
  LEVEL_PROGRESS_VERSION,
  levelStanding,
  MOST_LEVELS_KEPT,
  NO_LEVEL_FINISHED,
  readLevelProgress,
  withLevelFinished,
  writeLevelProgress,
  type LevelProgress,
} from './level-progress';
import { LEVEL_ID_PATTERN } from './levels/level-file';

/** The bytes a device keeps: strings under keys, and nothing else survives a reload. */
type Disk = Map<string, string>;

/** A `localStorage` stand-in over `disk`: a fresh object each call, so a read crosses the boundary. */
function open(disk: Disk): PreferenceStorage {
  return {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => {
      disk.set(key, value);
    },
  };
}

function stored(disk: Disk): Record<string, unknown> {
  const text = disk.get(LEVEL_PROGRESS_STORAGE_KEY);
  expect(text).toBeTypeOf('string');
  return JSON.parse(text ?? '') as Record<string, unknown>;
}

const ORDER = ['first-round', 'second-round', 'third-round'] as const;

describe('which Delivery levels this device has finished — #2363, ADR 0065 D-9.2', () => {
  it('reads back, through a fresh reader over the same storage, what was written', () => {
    const disk: Disk = new Map();
    expect(writeLevelProgress(open(disk), { finished: ['first-round'] })).toBe(true);
    expect([...disk.keys()]).toStrictEqual([LEVEL_PROGRESS_STORAGE_KEY]);
    expect(readLevelProgress(open(disk))).toStrictEqual({ finished: ['first-round'] });
  });

  it('stores exactly its fixed fields, whatever more the object it is handed carries', () => {
    const disk: Disk = new Map();
    const handed = {
      finished: ['first-round'],
      seed: 3_141_592_653,
      house: 4,
      position: { x: 12.5, z: -40.25 },
    } as LevelProgress;
    expect(writeLevelProgress(open(disk), handed)).toBe(true);
    const value = stored(disk);
    expect(Object.keys(value).sort()).toStrictEqual([...LEVEL_PROGRESS_FIELDS].sort());
    expect(value).toStrictEqual({ version: LEVEL_PROGRESS_VERSION, finished: ['first-round'] });
    expect(disk.get(LEVEL_PROGRESS_STORAGE_KEY)).not.toMatch(/seed|house|position|3141592653/);
  });

  it('keeps only level ids: no id out of shape, and none twice', () => {
    const disk: Disk = new Map();
    writeLevelProgress(open(disk), {
      finished: ['first-round', 'first-round', 'Not An Id', '12.5,40.25', 'second-round'],
    });
    expect(stored(disk)['finished']).toStrictEqual(['first-round', 'second-round']);
  });

  it('restates the level reader’s id pattern exactly', () => {
    expect(KEPT_LEVEL_ID_PATTERN.source).toBe(LEVEL_ID_PATTERN.source);
    expect(KEPT_LEVEL_ID_PATTERN.flags).toBe(LEVEL_ID_PATTERN.flags);
  });

  describe('reads anything it cannot read as nothing finished, so level 1 alone is open, and never throws', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['unparseable', '{"version":1,"finished":['],
      ['the wrong version', JSON.stringify({ version: 2, finished: ['first-round'] })],
      ['no version', JSON.stringify({ finished: ['first-round'] })],
      ['not an object', JSON.stringify(['first-round'])],
      ['null', 'null'],
      ['finished not a list', JSON.stringify({ version: 1, finished: 'first-round' })],
      ['an id out of shape', JSON.stringify({ version: 1, finished: ['first-round', 7] })],
      [
        'more levels than any build ships',
        JSON.stringify({
          version: 1,
          finished: Array.from({ length: MOST_LEVELS_KEPT + 1 }, (_, at) => `level-${String(at)}`),
        }),
      ],
    ];
    it.each(cases)('%s', (_label, text) => {
      const disk: Disk = new Map([[LEVEL_PROGRESS_STORAGE_KEY, text]]);
      const progress = readLevelProgress(open(disk));
      expect(progress).toStrictEqual(NO_LEVEL_FINISHED);
      expect(ORDER.map((id) => levelStanding(ORDER, progress, id).state)).toStrictEqual([
        'open',
        'locked',
        'locked',
      ]);
    });

    it('a store that refuses to be read', () => {
      const blocked: PreferenceStorage = {
        getItem: () => {
          throw new DOMException('blocked', 'SecurityError');
        },
        setItem: () => {
          throw new DOMException('blocked', 'SecurityError');
        },
      };
      expect(() => readLevelProgress(blocked)).not.toThrow();
      expect(readLevelProgress(blocked)).toStrictEqual(NO_LEVEL_FINISHED);
      expect(writeLevelProgress(blocked, { finished: ['first-round'] })).toBe(false);
    });

    it('no store at all', () => {
      expect(readLevelProgress(undefined)).toStrictEqual(NO_LEVEL_FINISHED);
      expect(writeLevelProgress(undefined, { finished: ['first-round'] })).toBe(false);
    });
  });
});

describe('levels open in order — #2363, ADR 0065 D-9.1', () => {
  const standings = (progress: LevelProgress): string[] =>
    ORDER.map((id) => {
      const standing = levelStanding(ORDER, progress, id);
      return standing.state === 'locked' ? `locked after ${standing.after}` : standing.state;
    });

  it('opens level 1 alone on a fresh device', () => {
    expect(standings(NO_LEVEL_FINISHED)).toStrictEqual([
      'open',
      'locked after first-round',
      'locked after second-round',
    ]);
  });

  it('opens each level once the one before it is finished, and no further', () => {
    const one = withLevelFinished(NO_LEVEL_FINISHED, 'first-round');
    expect(standings(one)).toStrictEqual(['finished', 'open', 'locked after second-round']);
    const two = withLevelFinished(one, 'second-round');
    expect(standings(two)).toStrictEqual(['finished', 'finished', 'open']);
  });

  it('finishes a level once, however often it is ridden', () => {
    const one = withLevelFinished(NO_LEVEL_FINISHED, 'first-round');
    expect(withLevelFinished(one, 'first-round')).toBe(one);
  });

  it('holds a level that is no step of the order open', () => {
    expect(levelStanding(ORDER, NO_LEVEL_FINISHED, 'fixture-level')).toStrictEqual({
      state: 'open',
    });
  });
});
