// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic ladder's rungs, each shedding one named thing — #3282.
 *
 * Three halves:
 *
 * 1. **The table.** Each rung differs from the one above it in exactly the
 *    fields this file names for it, and every rung before the stylised top is
 *    realistic. A tuning that slips a second change into a rung, or moves a
 *    belt's stop, is a red case here.
 * 2. **The walk.** A run of slow frames walks every realistic rung in order,
 *    and only then the stylised world; a run that recovers at rung 3 climbs
 *    back to rung 0, through every rung between.
 * 3. **The belt census.** Every class `three-renderer.ts` draws with is named
 *    here, either with the rung fields it reads or as one no rung sheds, and
 *    every field named is read by the view off the rung it was handed. A belt
 *    added to the renderer (#3253's track, #3279's signs) is red here until it
 *    says which.
 *
 * What a rung costs is measured by `browser/realistic-rungs.ts`; what it
 * saves on the tablet is validation 0002's rows for #3282.
 */

import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  ALL_SCENERY,
  INITIAL_REALISTIC_QUALITY,
  FRAME_MS_REDUCE_ABOVE,
  FRAME_MS_RESTORE_BELOW,
  OPTIONAL_SCENERY,
  QUALITY_LADDER,
  REALISTIC_FLOOR,
  REALISTIC_LADDER,
  REDUCED_MAPPED_BUILDING_REACH_METRES,
  SCENERY_STOPS_AT,
  SUSTAINED_SAMPLES,
  nextWorldQuality,
  sceneryAt,
  worldRung,
  type QualitySample,
  type QualitySettings,
  type WorldQualityState,
} from './quality';
import { MAPPED_BUILDING_REACH_METRES } from './realistic-budget';
import type { PeopleInView, Person } from './people';
import { PeopleBelt } from './three-renderer';

const HOT: QualitySample = { frameMs: FRAME_MS_REDUCE_ABOVE + 5 };
const COOL: QualitySample = { frameMs: FRAME_MS_RESTORE_BELOW - 10 };

/** A rung's fields, one key a value, its scenery record spread as `scenery.<belt>`. */
function flat(rung: QualitySettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rung)) {
    if (key === 'scenery') {
      for (const [belt, on] of Object.entries(value as Record<string, boolean>)) {
        out[`scenery.${belt}`] = on;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The fields `below` changes from `above`, the label apart. */
function changed(above: QualitySettings, below: QualitySettings): string[] {
  const a = flat(above);
  const b = flat(below);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => key !== 'label' && !Object.is(a[key], b[key]))
    .sort();
}

/**
 * What each step down gives up, the walk's order: rungs 1 to 4 of the
 * realistic ladder, and then the stylised top. #3282's proposal, rung by rung.
 */
const STEPS: readonly { readonly to: string; readonly sheds: readonly string[] }[] = [
  {
    to: 'realistic, no cyclists or litter',
    // #382 and #390: the work that is not the world goes with the first of it.
    sheds: ['scenery.sceneryCyclists', 'scenery.litter', 'capture', 'presence'],
  },
  {
    to: 'realistic, no park dressing or decorations',
    sheds: [
      'scenery.parkDressing',
      'scenery.decorations',
      'scenery.farPeople',
      'scenery.parkedCars',
    ],
  },
  {
    to: 'realistic, simpler trees and a shorter town',
    sheds: ['nearestTrees', 'mappedBuildingReach'],
  },
  {
    to: 'realistic, reduced resolution and scenery',
    // The stylised ladder's first step down inside the realistic world, the
    // near people with it, and #619's mip — the second rung before #3282.
    sheds: [
      'renderScale',
      'scatterItems',
      'sceneryVariants',
      'terrainBands',
      'water',
      'surfaceDetail',
      'people',
      'textureLodBias',
    ],
  },
  {
    to: 'full',
    // Leaving realism: the stylised top, every kind at once (D-3), so the
    // realistic-only fields go back to the stylised ladder's own.
    sheds: [
      'world',
      'renderScale',
      'scatterItems',
      'sceneryVariants',
      'terrainBands',
      'water',
      'surfaceDetail',
      'structureItems',
      'textureLodBias',
      'capture',
      'presence',
      'scenery.sceneryCyclists',
      'scenery.litter',
      'scenery.parkDressing',
      'scenery.decorations',
      'scenery.farPeople',
      'scenery.parkedCars',
      'nearestTrees',
      'mappedBuildingReach',
    ],
  },
];

/** The whole walk from the realistic top: its five rungs, then the stylised top. */
const WALK: readonly QualitySettings[] = [
  ...REALISTIC_LADDER,
  QUALITY_LADDER[0] as QualitySettings,
];

describe('each realistic rung sheds exactly what it names — #3282', () => {
  it('has five realistic rungs, and every rung before the last of the walk is realistic', () => {
    expect(REALISTIC_LADDER).toHaveLength(STEPS.length);
    WALK.slice(0, -1).forEach((rung) => expect(rung.world, rung.label).toBe('realistic'));
    expect(WALK.at(-1)?.world).toBe('stylised');
    expect(REALISTIC_FLOOR).toBe(REALISTIC_LADDER.at(-1));
  });

  it.each(STEPS.map((step, at) => [at + 1, step] as const))(
    'rung %i differs from the one above in exactly the fields it names',
    (at, step) => {
      const above = WALK[at - 1] as QualitySettings;
      const below = WALK[at] as QualitySettings;
      expect(below.label).toBe(step.to);
      expect(changed(above, below)).toEqual([...step.sheds].sort());
    },
  );

  it('only ever sheds: no field a step names is drawn more of below than above, inside realism', () => {
    const more = (above: unknown, below: unknown): boolean =>
      typeof above === 'number' && typeof below === 'number'
        ? below > above
        : // A belt or a capability switched back on; a level of detail back up.
          (above === false && below === true) || (above === 'middle' && below === 'full');
    for (let at = 1; at < REALISTIC_LADDER.length; at += 1) {
      const above = flat(REALISTIC_LADDER[at - 1] as QualitySettings);
      const below = flat(REALISTIC_LADDER[at] as QualitySettings);
      for (const key of Object.keys(below)) {
        // The mip bias goes UP as the photographs get coarser.
        if (key === 'textureLodBias' || key === 'label') continue;
        expect(more(above[key], below[key]), `rung ${String(at)}: ${key}`).toBe(false);
      }
    }
  });

  it('never raises or lowers the frame cap inside realism', () => {
    for (const rung of REALISTIC_LADDER) {
      expect(rung.frameCap, rung.label).toBe(QUALITY_LADDER[0]?.frameCap);
    }
  });

  it('has every optional belt say where it stops, inside the realistic ladder', () => {
    for (const belt of OPTIONAL_SCENERY) {
      const stop = SCENERY_STOPS_AT[belt];
      expect(stop, belt).toBeGreaterThan(0);
      expect(stop, belt).toBeLessThan(REALISTIC_LADDER.length);
      REALISTIC_LADDER.forEach((rung, level) => {
        expect(rung.scenery[belt], `${belt} on rung ${String(level)}`).toBe(level < stop);
      });
    }
    // The control: the stops are read, not a constant.
    expect(sceneryAt(0)).toEqual(ALL_SCENERY);
    expect(Object.values(sceneryAt(REALISTIC_LADDER.length)).some(Boolean)).toBe(false);
  });

  it('leaves the stylised ladder as it was: every belt drawn, the full trees, the whole reach', () => {
    for (const rung of QUALITY_LADDER) {
      expect(rung.scenery, rung.label).toEqual(ALL_SCENERY);
      expect(rung.nearestTrees, rung.label).toBe('full');
      expect(rung.mappedBuildingReach, rung.label).toBe(MAPPED_BUILDING_REACH_METRES);
    }
    expect(REDUCED_MAPPED_BUILDING_REACH_METRES).toBeLessThan(MAPPED_BUILDING_REACH_METRES);
  });
});

/** Feeds the same sample `count` times to the two-ladder policy, and every rung it visits. */
function ride(
  from: WorldQualityState,
  sample: QualitySample,
  count: number,
): { readonly state: WorldQualityState; readonly visited: readonly QualitySettings[] } {
  let state = from;
  const visited: QualitySettings[] = [];
  for (let at = 0; at < count; at += 1) {
    state = nextWorldQuality(state, sample);
    const rung = worldRung(state);
    if (visited.at(-1) !== rung) visited.push(rung);
  }
  return { state, visited };
}

describe('the walk down the realistic ladder, and back up — #3282', () => {
  it('walks every realistic rung in order before it reaches the stylised world', () => {
    const { state, visited } = ride(
      INITIAL_REALISTIC_QUALITY,
      HOT,
      SUSTAINED_SAMPLES * (REALISTIC_LADDER.length + 2),
    );
    expect(visited.map((rung) => rung.label).slice(0, REALISTIC_LADDER.length + 1)).toEqual([
      ...REALISTIC_LADDER.map((rung) => rung.label),
      'full',
    ]);
    expect(visited.slice(0, REALISTIC_LADDER.length)).toEqual(REALISTIC_LADDER);
    expect(visited[REALISTIC_LADDER.length]).toBe(QUALITY_LADDER[0]);
    expect(state.realistic).toBe(false);
  });

  it('takes one whole sustained run a rung: one sample short of leaving, it is still on the floor', () => {
    const almost = ride(
      INITIAL_REALISTIC_QUALITY,
      HOT,
      SUSTAINED_SAMPLES * REALISTIC_LADDER.length - 1,
    );
    expect(almost.state.realistic).toBe(true);
    expect(worldRung(almost.state)).toBe(REALISTIC_FLOOR);
    expect(nextWorldQuality(almost.state, HOT).realistic).toBe(false);
  });

  it('climbs back from rung 3 to rung 0 through every rung between, and stays realistic', () => {
    const down = ride(INITIAL_REALISTIC_QUALITY, HOT, SUSTAINED_SAMPLES * 3);
    expect(down.state).toMatchObject({ realistic: true, quality: { level: 3 } });
    expect(worldRung(down.state)).toBe(REALISTIC_LADDER[3]);
    const up = ride(down.state, COOL, SUSTAINED_SAMPLES * 4);
    expect(up.visited).toEqual([
      REALISTIC_LADDER[3],
      REALISTIC_LADDER[2],
      REALISTIC_LADDER[1],
      REALISTIC_LADDER[0],
    ]);
    expect(up.state).toMatchObject({ realistic: true, quality: { level: 0 } });
  });

  it('never climbs back into realism once it has left — the latch, as before', () => {
    const left = ride(INITIAL_REALISTIC_QUALITY, HOT, SUSTAINED_SAMPLES * REALISTIC_LADDER.length);
    expect(left.state.realistic).toBe(false);
    const cooled = ride(left.state, COOL, SUSTAINED_SAMPLES * 20);
    expect(cooled.visited.every((rung) => rung.world === 'stylised')).toBe(true);
  });
});

/**
 * The classes `three-renderer.ts` draws with, and what each reads off its rung
 * — #3282. A `string[]` names the rung fields the belt is shed by (a scenery
 * key as `scenery.<belt>`); a `core` names why no rung sheds it. Every field
 * named must be read by the view off the rung it was handed.
 */
const BELT_RUNGS: Readonly<Record<string, readonly string[] | { readonly core: string }>> = {
  // The world's own rungs, before #3282.
  ScatterBelt: ['scatterItems', 'sceneryVariants', 'structureItems'],
  TerrainBelt: ['terrainBands', 'surfaceDetail'],
  WaterBelt: ['water'],
  ContactShadowBelt: ['riderShadows'],
  RiderSilhouetteBelt: ['riderShadows'],
  RealisticStructureBelts: ['structureItems'],
  VillageHouseBelt: ['structureItems'],
  // #3282's.
  RealisticVegetationBelt: ['scatterItems', 'nearestTrees'],
  MappedBuildingBelt: ['structureItems', 'mappedBuildingReach'],
  FurnitureBelt: ['scenery.litter'],
  DecorationBelt: ['scenery.decorations'],
  ParkDressingBelt: ['scenery.parkDressing'],
  ParkedCarBelt: ['scenery.parkedCars'],
  PeopleBelt: ['scenery.farPeople', 'scenery.sceneryCyclists'],
  RealisticRiderBelt: ['scenery.sceneryCyclists'],
  // What no rung sheds.
  RiderBelt: { core: 'the riders: the rider, the pacer and the remote riders' },
  GroundBlobBelt: { core: 'the scenery’s grounding, which goes with what it grounds' },
  HorizonRing: { core: 'the horizon the fog fades into' },
  SkyDome: { core: 'the stylised sky' },
  WorldLamps: { core: 'the sun and the ambient' },
  BridgeBelt: { core: 'the bridges the road crosses' },
  GantryBelt: { core: 'the start and finish lines' },
  LogoBelt: { core: 'the wordmark boards at the lines' },
  PavementBelt: { core: 'the village kerbs the people walk on' },
  SideRoadBelt: { core: 'the cross streets, which are road' },
  FootwayBelt: { core: 'the mapped footways and zebras, which are road surface' },
  StreetNameBelt: { core: 'the street names an open-world rider steers by' },
  DeliveryBelt: { core: 'a Delivery round’s game pieces' },
  LapRaceBelt: { core: 'a lap race’s game pieces' },
  RealisticDrawing: { core: 'the realistic world’s container, not a belt' },
};

const RENDERER = ts.createSourceFile(
  'three-renderer.ts',
  readFileSync(new URL('./three-renderer.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);

/** Every class the renderer draws with: a belt by name, or anything with an `addTo`. */
function drawingClasses(file: ts.SourceFile): string[] {
  const found: string[] = [];
  file.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || node.name === undefined) return;
    const name = node.name.text;
    const addsItself = node.members.some(
      (member) =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'addTo',
    );
    if (addsItself || /Belts?$/.test(name)) found.push(name);
  });
  return found.sort();
}

/**
 * The rung fields read inside `classes`: `<rung>.<field>` and
 * `<rung>.scenery.<belt>`, where the rung is the view's `this.#quality` or a
 * parameter named `settings`, the two names the renderer hands a rung by.
 */
function rungFieldsReadIn(file: ts.SourceFile, classes: readonly string[]): Set<string> {
  const read = new Set<string>();
  const isRung = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && node.text === 'settings') ||
    (ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.name.text === '#quality');
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const owner = node.expression;
      if (
        ts.isPropertyAccessExpression(owner) &&
        owner.name.text === 'scenery' &&
        isRung(owner.expression)
      ) {
        read.add(`scenery.${node.name.text}`);
      } else if (isRung(owner) && node.name.text !== 'scenery') {
        read.add(node.name.text);
      }
    }
    // `const { shading } = this.#quality;`, which the view also writes.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      isRung(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name;
        if (ts.isIdentifier(name)) read.add(name.text);
      }
    }
    node.forEachChild(visit);
  };
  file.forEachChild((node) => {
    if (ts.isClassDeclaration(node) && classes.includes(node.name?.text ?? '')) visit(node);
  });
  return read;
}

describe('every belt the renderer draws reads its rung, or says why none sheds it — #3282', () => {
  const classes = drawingClasses(RENDERER);
  const read = rungFieldsReadIn(RENDERER, ['ThreeGameView', 'RealisticDrawing']);

  it('names every class the renderer draws with, and no class it does not', () => {
    // Non-vacuity: the census found the belts #3282 sheds.
    expect(classes).toEqual(
      expect.arrayContaining(['FurnitureBelt', 'PeopleBelt', 'ParkedCarBelt']),
    );
    expect(classes).toEqual(Object.keys(BELT_RUNGS).sort());
  });

  it('has the view read every field a belt is said to be shed by, off the rung it was handed', () => {
    for (const [belt, fields] of Object.entries(BELT_RUNGS)) {
      if ('core' in fields) continue;
      for (const field of fields) {
        expect(read.has(field), `${belt}: the view never reads ${field} off its rung`).toBe(true);
      }
    }
  });

  it('gives every optional belt, and both of #3282’s other fields, a belt that reads it', () => {
    const claimed = new Set<string>(
      Object.values(BELT_RUNGS).flatMap((fields): readonly string[] =>
        'core' in fields ? [] : fields,
      ),
    );
    for (const belt of OPTIONAL_SCENERY) expect(claimed.has(`scenery.${belt}`), belt).toBe(true);
    expect(claimed.has('nearestTrees')).toBe(true);
    expect(claimed.has('mappedBuildingReach')).toBe(true);
  });

  it('reads a field off the parsed code, not its text: a comment naming one is not a read', () => {
    const file = ts.createSourceFile(
      'probe.ts',
      [
        'class ThreeGameView {',
        '  // this.#quality.scenery.litter is only named here',
        '  a(settings: unknown) { return settings.scenery.parkedCars; }',
        '  b() { return this.#quality.nearestTrees; }',
        '  e() { const { water: drawn } = this.#quality; return drawn; }',
        '  c(other: unknown) { return other.scenery.decorations; }',
        '}',
        'class Elsewhere { d(settings: unknown) { return settings.water; } }',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    expect([...rungFieldsReadIn(file, ['ThreeGameView'])].sort()).toEqual([
      'nearestTrees',
      'scenery.parkedCars',
      'water',
    ]);
  });
});

describe('the far band of people, on a rung that draws it — #3282', () => {
  const person = (z: number, distance: number): Person => ({
    x: 0,
    y: 0,
    z,
    yaw: 0,
    gait: 'walk',
    phase: 0,
    height: 1.7,
    look: { skin: 0, top: 0, bottoms: 0, shoes: 0, hair: 0, build: 0.5 },
    distance,
    on: 'pavement',
  });
  const view: PeopleInView = { near: [], far: [person(80, 80), person(120, 120)] };

  it('draws the impostors until the rung sheds them, and again once it does not', () => {
    const belt = new PeopleBelt(undefined, () => undefined as never);
    belt.update(view);
    // Non-vacuity: the far band is drawn on the top rung.
    expect(belt.impostors.count).toBe(2);
    expect(belt.impostors.visible).toBe(true);
    belt.setFarBand(false);
    belt.update(view);
    expect(belt.impostors.count).toBe(0);
    expect(belt.impostors.visible).toBe(false);
    belt.setFarBand(true);
    belt.update(view);
    expect(belt.impostors.count).toBe(2);
    belt.dispose();
  });
});
