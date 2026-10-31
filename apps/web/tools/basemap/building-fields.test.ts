// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
