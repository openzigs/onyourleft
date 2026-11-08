// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Delivery level build tool — #2361, ADR 0065 D-3.2, D-5.4 and D-7.3.
 *
 * The network half (the archive and 3DEP) runs by hand outside CI. Here the
 * tool is run whole, `main` and all, on sources that hand it the synthetic
 * fixture level's line and buildings (D-7.5), and every outcome is read back
 * from the output directory afterwards: a refusal is a non-zero exit AND no
 * file, seen on disk, not a return value taken on trust.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BuildingFeature } from '@onyourleft/map-features';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLevelFile, type LevelFile } from '../../src/game/delivery/levels/level-file';
import { levelBuildingFeature } from '../../src/game/delivery/levels/levels';
import {
  bakedBuildings,
  LEVEL_HOUSE_MARGIN,
  main,
  serialise,
  type LevelSources,
} from './author-level';
import { LEVELS_TOTAL_MAX_BYTES } from './level-sizes';

const FIXTURE_TEXT = readFileSync(
  new URL('../../src/game/delivery/levels/fixtures/fixture-level.json', import.meta.url),
  'utf8',
);
const FIXTURE: LevelFile = parseLevelFile(JSON.parse(FIXTURE_TEXT), 'fixture-level');
const ARCHIVE = `https://tiles.example.invalid/${FIXTURE.archive.build}.pmtiles`;

/** What the fixture's own digest was made from: no tile, no answer, a sentence. */
const FIXTURE_READ = 'the synthetic fixture level of #2361';

/** Sources that draw the fixture's line and hand back `buildings` as its corridor's. */
function fixtureSources(
  buildings: readonly BuildingFeature[] = FIXTURE.buildings.map(levelBuildingFeature),
): LevelSources {
  return {
    drawLine: () =>
      Promise.resolve({
        shape: FIXTURE.shape,
        points: FIXTURE.points,
        resolutionMetres: FIXTURE.heights.resolutionMetres,
        digest: createHash('sha256').update(FIXTURE_READ),
      }),
    readBuildings: () => Promise.resolve(buildings),
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'oyl-author-level-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let out: string;
let draftPath: string;
let printed: string[];

function writeDraft(round: unknown = FIXTURE.round): void {
  const [latitude, longitude] = FIXTURE.points[0] as readonly [number, number, number];
  writeFileSync(
    draftPath,
    JSON.stringify({
      id: FIXTURE.id,
      name: FIXTURE.name,
      start: [latitude, longitude],
      targetMetres: 2000,
      round,
    }),
  );
}

function run(sources: LevelSources): Promise<number> {
  return main(['--draft', draftPath, '--archive', ARCHIVE, '--out', out], sources);
}

beforeEach(() => {
  const here = mkdtempSync(join(scratch, 'case-'));
  // The output directory exists and is empty, as `data/` is of level files before #2362.
  out = join(here, 'out');
  mkdirSync(out);
  draftPath = join(here, 'draft.json');
  printed = [];
  const capture = (chunk: unknown): boolean => {
    printed.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  writeDraft();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The files in the output directory, read off the disk. */
function written(): string[] {
  return readdirSync(out).sort();
}

describe('main — #2361', () => {
  it('writes the fixture byte for byte from the fixture’s own line and buildings, and exits 0', async () => {
    await expect(run(fixtureSources())).resolves.toBe(0);
    expect(written()).toStrictEqual(['fixture-level.json']);
    expect(readFileSync(join(out, 'fixture-level.json'), 'utf8')).toBe(FIXTURE_TEXT);
  });

  it(`refuses a corridor short of the round’s houses plus the margin of ${String(LEVEL_HOUSE_MARGIN)}: exits non-zero and writes no file (D-5.4)`, async () => {
    // Ten footprints: four round houses, against six asked and a margin of two.
    const few = FIXTURE.buildings.slice(0, 10).map(levelBuildingFeature);
    await expect(run(fixtureSources(few))).resolves.toBe(1);
    expect(written()).toStrictEqual([]);
    const said = printed.join('');
    expect(said).toContain('houses: not written; the level holds 4 round houses');
    expect(said).toContain('asks for 6 plus a margin of 2');
  });

  it('refuses one house short of the margin, and writes the level at exactly it', async () => {
    // The fixture holds 12 (capped at MOST_HOUSES): a round of 10 needs all 12.
    writeDraft({ ...FIXTURE.round, houses: 12 - LEVEL_HOUSE_MARGIN + 1 });
    await expect(run(fixtureSources())).resolves.toBe(1);
    expect(written()).toStrictEqual([]);
    writeDraft({ ...FIXTURE.round, houses: 12 - LEVEL_HOUSE_MARGIN });
    await expect(run(fixtureSources())).resolves.toBe(0);
    expect(written()).toStrictEqual(['fixture-level.json']);
    const file = parseLevelFile(JSON.parse(readFileSync(join(out, 'fixture-level.json'), 'utf8')));
    expect(file.round.houses).toBe(10);
  });

  it('refuses a level over the ceiling for every level together, and leaves the others as they were (D-3.2)', async () => {
    const other = join(out, 'other.json');
    writeFileSync(other, new Uint8Array(LEVELS_TOTAL_MAX_BYTES - 1000));
    await expect(run(fixtureSources())).resolves.toBe(1);
    expect(written()).toStrictEqual(['other.json']);
    expect(printed.join('')).toContain('size: not written');
  });

  it('refuses a round the reader refuses, before it counts or writes anything', async () => {
    writeDraft({ ...FIXTURE.round, houses: 20 });
    await expect(run(fixtureSources())).resolves.toBe(1);
    expect(written()).toStrictEqual([]);
    expect(printed.join('')).toContain('level file: round.houses must be between 3 and 12');
  });

  it('prints no coordinate: not the start, not a point, not a corner', async () => {
    await run(fixtureSources());
    await run(fixtureSources(FIXTURE.buildings.slice(0, 10).map(levelBuildingFeature)));
    const said = printed.join('');
    const [latitude, longitude] = FIXTURE.points[0] as readonly [number, number, number];
    expect(said).not.toContain(String(latitude));
    expect(said).not.toContain(String(Math.abs(longitude)));
    expect(said).not.toContain('41.05');
  });

  it('refuses a draft that is not JSON without quoting it', async () => {
    // V8 quotes the text it could not read, start and all.
    writeFileSync(draftPath, '{"start": [0.25, -20.5, oops]}');
    await expect(run(fixtureSources())).resolves.toBe(1);
    expect(written()).toStrictEqual([]);
    expect(printed.join('')).not.toContain('20.5');
  });
});

describe('bakedBuildings — #2361, D-2.2', () => {
  it('keeps a footprint with a corner in the corridor, and drops one wholly past it', () => {
    const near = levelBuildingFeature(FIXTURE.buildings[0] as LevelFile['buildings'][number]);
    // 300 m west of the line, past CORRIDOR_HALF_WIDTH_METRES.
    const far: BuildingFeature = {
      ...near,
      rings: [Float32Array.from([300, 40, 308, 40, 308, 48, 300, 48])],
    };
    const edge: BuildingFeature = {
      ...near,
      rings: [Float32Array.from([249, 40, 260, 40, 260, 48, 249, 48])],
    };
    const baked = bakedBuildings(FIXTURE.points, FIXTURE.shape, [near, far, edge]);
    expect(baked).toHaveLength(2);
    expect(baked[1]?.rings[0]?.[0]).toBe(249);
  });

  it('keeps only the fields that are set, at centimetres', () => {
    const near = levelBuildingFeature(FIXTURE.buildings[1] as LevelFile['buildings'][number]);
    const [baked] = bakedBuildings(FIXTURE.points, FIXTURE.shape, [
      { ...near, heightMetres: 6.123_456 },
    ]);
    expect(baked?.fields).toStrictEqual({ buildingType: 'house' });
    expect(baked?.heightMetres).toBe(6.12);
  });
});

describe('serialise — #2361', () => {
  it('writes the fixture as it is committed, so a redraw diffs only what moved', () => {
    expect(serialise(FIXTURE)).toBe(FIXTURE_TEXT);
  });

  it('writes a level with no buildings as one the reader reads', () => {
    const bare = serialise({ ...FIXTURE, buildings: [] });
    expect(bare).toContain('"buildings": [],\n');
    expect(parseLevelFile(JSON.parse(bare)).buildings).toStrictEqual([]);
  });
});
