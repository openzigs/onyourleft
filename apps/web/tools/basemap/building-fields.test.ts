// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as decoder from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_TYPES,
  LANDMARKS,
  PALETTE_SIZE,
  ROOF_MATERIALS,
  ROOF_ORIENTATIONS,
  ROOF_SHAPES,
  WALL_MATERIALS,
  buildingFieldRules,
} from './building-fields';

const JAVA = fileURLToPath(
  new URL('./profile/src/main/java/dev/openzigs/onyourleft/basemap/', import.meta.url),
);
const tags = readFileSync(`${JAVA}BuildingTags.java`, 'utf8');
const palette = readFileSync(`${JAVA}BuildingPalette.java`, 'utf8');

/** The string literals of `public static final List<String> NAME = List.of(…);` in the Java source. */
function javaList(name: string): string[] {
  const match = new RegExp(`List<String> ${name} = List\\.of\\(([^;]*)\\);`).exec(tags);
  if (!match) throw new Error(`BuildingTags.java declares no list ${name}`);
  return [...match[1]!.matchAll(/"([^"]*)"|(LANDMARK_[A-Z]+)/g)].map(([, literal, constant]) => {
    if (literal !== undefined) return literal;
    const value = new RegExp(`String ${constant} = "([^"]*)";`).exec(tags);
    if (!value) throw new Error(`BuildingTags.java declares no constant ${constant}`);
    return value[1]!;
  });
}

function javaKeys(): string[] {
  const names = /List<String> KEYS = List\.of\(([^;]*)\);/.exec(tags)![1]!.match(/KEY_[A-Z_]+/g)!;
  return names.map((name) => new RegExp(`String ${name} = "([^"]*)";`).exec(tags)![1]!);
}

function javaInt(name: string): number {
  return Number(new RegExp(`int ${name} = (\\d+);`).exec(tags)![1]);
}

describe('building-fields.ts is the Java profile’s schema, list for list', () => {
  it.each([
    ['BUILDING_TYPES', BUILDING_TYPES],
    ['ROOF_SHAPES', ROOF_SHAPES],
    ['ROOF_ORIENTATIONS', ROOF_ORIENTATIONS],
    ['WALL_MATERIALS', WALL_MATERIALS],
    ['ROOF_MATERIALS', ROOF_MATERIALS],
    ['LANDMARKS', LANDMARKS],
  ] as const)('%s', (name, list) => {
    expect([...list]).toEqual(javaList(name));
  });

  it('has a rule for every key the profile writes, and for nothing else', () => {
    expect([...buildingFieldRules(2026).keys()]).toEqual(javaKeys());
  });

  it('bounds each number as the profile clamps it', () => {
    const rules = buildingFieldRules(2026);
    expect(rules.get('levels')).toMatchObject({
      min: javaInt('MIN_LEVELS'),
      max: javaInt('MAX_LEVELS'),
    });
    expect(rules.get('roof_levels')).toMatchObject({
      min: javaInt('MIN_ROOF_LEVELS'),
      max: javaInt('MAX_ROOF_LEVELS'),
    });
    expect(rules.get('roof_direction')).toMatchObject({ step: javaInt('DIRECTION_STEP') });
    expect(rules.get('start_year')).toMatchObject({ min: javaInt('MIN_START_YEAR'), max: 2026 });
  });

  it('counts the palette the profile indexes into', () => {
    expect(PALETTE_SIZE).toBe(palette.match(/new Entry\("/g)?.length);
  });
});

describe('the client’s decoder reads the same fields, list for list — #1789', () => {
  // `@onyourleft/map-features` is the third implementation of the schema, and
  // the one the client runs: a key, a value or a bound this profile writes
  // and the decoder does not know would be dropped at read without a word.
  it('looks up the keys the profile writes, and no other', () => {
    expect(
      decoder.BUILDING_FIELD_NAMES.map((name) => decoder.BUILDING_FIELD_RULES[name].key),
    ).toEqual(javaKeys());
  });

  it.each([
    ['BUILDING_TYPES', decoder.BUILDING_TYPES],
    ['ROOF_SHAPES', decoder.ROOF_SHAPES],
    ['ROOF_ORIENTATIONS', decoder.ROOF_ORIENTATIONS],
    ['WALL_MATERIALS', decoder.WALL_MATERIALS],
    ['ROOF_MATERIALS', decoder.ROOF_MATERIALS],
    ['LANDMARKS', decoder.LANDMARKS],
  ] as const)('whitelists %s as the profile does', (name, list) => {
    expect([...list]).toEqual(javaList(name));
  });

  it('bounds each number as the profile does, but the start year at its own fixed bounds', () => {
    const rules = buildingFieldRules(2026);
    for (const name of decoder.BUILDING_FIELD_NAMES) {
      const ours = decoder.BUILDING_FIELD_RULES[name];
      const profile = rules.get(ours.key);
      switch (ours.kind) {
        case 'enum':
          expect(profile).toStrictEqual({ kind: 'enum', values: ours.values });
          break;
        case 'index':
          expect(profile).toMatchObject({ kind: 'integer', min: 0, max: ours.size - 1 });
          break;
        case 'direction':
          expect(profile).toMatchObject({ kind: 'integer', min: 0, max: 360 - ours.step });
          expect(profile).toMatchObject({ step: ours.step });
          break;
        case 'clamped':
          expect(profile).toMatchObject({ kind: 'integer', min: ours.min });
          // ADR 0054's entry of 2026-11-01: the build year is the build's, so
          // the decoder clamps `start_year` at a fixed 2100 instead.
          if (name !== 'startYear') expect(profile).toMatchObject({ max: ours.max });
          break;
      }
    }
    expect(decoder.BUILDING_FIELD_RULES.startYear.max).toBe(2100);
  });
});
