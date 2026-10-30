// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Nothing that writes a ride down, exports one or talks to an instance
 * reaches Delivery, and Delivery says no coordinate** — #1817, holding
 * ADR 0059 D-4 item 2 (the owner's ruling DL11 of 2026-10-27).
 *
 * A Delivery round's targets are real mapped houses (CLAUDE.md §6, location
 * data), held in the ride's memory and dropped. Two source rules keep it so:
 *
 * 1. **No import.** No module under `apps/web/src/instance/`,
 *    `apps/web/src/transfer/`, `apps/web/src/recording/` or `apps/instance/`
 *    imports anything under `apps/web/src/game/delivery/` — directly, or
 *    through the relative imports of what it imports. Test files are not
 *    walked: they ship nothing, and
 *    `transfer/delivery-targets-not-exported.test.tsx` imports Delivery to
 *    ride a round.
 * 2. **No log, and no coordinate in an error.** No module under
 *    `game/delivery/` calls `console`, and every error one throws is raised
 *    here with the fixture's coordinates in its input and read back: its
 *    message carries none of their digits, and no decimal number at all
 *    (ADR 0004 D: a message names the field and the constraint, never the
 *    value). The cases are counted against the throw sites in the source, so
 *    a new throw with no case here is red.
 *
 * A documented ban is not a gate (CLAUDE.md §8), and a scan that finds nothing
 * because it read nothing is no gate either: each walk must read files, and a
 * planted import, log and message must be found.
 *
 * ⚠️ This is a source scan, not a proof: a module could hand a target to the
 * recording without importing Delivery, through a value `GameView` passes.
 * `transfer/delivery-targets-not-exported.test.tsx` is the one that reads
 * what a real ride stored, exported and sent.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deliveryTown, DISTINCTIVE_TOWN_LAYOUT } from '../game/delivery/delivery-town-testing';
import { placeObstacles, startObstacles, stepObstacles } from '../game/delivery/obstacles';
import { startDeliveryRide, stepDeliveryRide } from '../game/delivery/ride-round';
import { recordMiss, startRound } from '../game/delivery/round';
import { startSteer, stepSteer } from '../game/delivery/steer';
import { pickRoundTargets, type DeliveryTarget } from '../game/delivery/targets';
import { NO_PARCELS, stepThrows } from '../game/delivery/throw';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DELIVERY_TREE = fileURLToPath(new URL('../game/delivery', import.meta.url));

/** The trees a ride is written down, exported or sent to an instance from. */
const LEAVING_TREES = [
  fileURLToPath(new URL('../instance', import.meta.url)),
  fileURLToPath(new URL('../transfer', import.meta.url)),
  fileURLToPath(new URL('../recording', import.meta.url)),
  fileURLToPath(new URL('../../../instance', import.meta.url)),
] as const;

/** Never source: installed packages and build output. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.wrangler', 'coverage']);

const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const isTest = (file: string): boolean => /\.test\.[cm]?[jt]sx?$/.test(file);

/** Every source file under `root` but the tests, skipping what is not this project's source. */
function sourcesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...sourcesUnder(path));
    } else if (entry.isFile() && SOURCE.test(entry.name) && !isTest(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Every module specifier `source` names: static, re-exported, side-effect, dynamic, required. */
function specifiersIn(source: string): string[] {
  const pattern =
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? '',
  );
}

const inDelivery = (path: string): boolean =>
  path === DELIVERY_TREE || path.startsWith(`${DELIVERY_TREE}${sep}`);

/** The file a relative specifier from `file` names, or `undefined` when it is none here. */
function resolved(file: string, specifier: string): string | undefined {
  const base = resolve(dirname(file), specifier);
  const stem = base.replace(/\.[cm]?js$/, '');
  const candidates = [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find(
    (candidate) => SOURCE.test(candidate) && existsSync(candidate) && statSync(candidate).isFile(),
  );
}

/**
 * The chain from `file` to a module under `game/delivery/`, through relative
 * imports, or `undefined` when it reaches none. Another package is never
 * followed: `packages/` cannot import `apps/` (CLAUDE.md §3), and a bare
 * specifier that names Delivery's path is a reach in itself.
 */
function reachToDelivery(
  file: string,
  read: (path: string) => string,
  seen = new Set<string>(),
): string[] | undefined {
  if (seen.has(file)) return undefined;
  seen.add(file);
  for (const specifier of specifiersIn(read(file))) {
    if (!specifier.startsWith('.')) {
      if (/(?:^|\/)game\/delivery(?:\/|$)/.test(specifier)) return [file, specifier];
      continue;
    }
    if (inDelivery(resolve(dirname(file), specifier))) return [file, specifier];
    const next = resolved(file, specifier);
    if (next === undefined) continue;
    const chain = reachToDelivery(next, read, seen);
    if (chain !== undefined) return [file, ...chain];
  }
  return undefined;
}

const fromDisk = (path: string): string => readFileSync(path, 'utf8');

describe('nothing that leaves the device imports Delivery — #1817', () => {
  it('reads the four trees at all', () => {
    for (const tree of LEAVING_TREES) {
      expect(sourcesUnder(tree).length, relative(REPOSITORY_ROOT, tree)).toBeGreaterThan(5);
    }
  });

  it('finds a planted import, however it is written', () => {
    const planted = join(LEAVING_TREES[1], 'planted.ts');
    const reach = (source: string) => reachToDelivery(planted, () => source);
    expect(reach("import { pickRoundTargets } from '../game/delivery/targets';")).toEqual([
      planted,
      '../game/delivery/targets',
    ]);
    expect(reach("import type { DeliveryTarget } from '../game/delivery/targets';")).toBeDefined();
    expect(reach("export * from '../game/delivery/round';")).toBeDefined();
    expect(reach("const m = await import('../game/delivery/round');")).toBeDefined();
    expect(reach("import '../game/delivery';")).toBeDefined();
    expect(reach("import { x } from '@onyourleft/web/src/game/delivery/round';")).toBeDefined();
    expect(reach("import { exportActivity } from './export-activity';")).toBeUndefined();
  });

  it('finds a reach through a real module that imports Delivery', () => {
    // `GameView` imports Delivery, so a leaving module that imported it would reach it.
    const planted = join(LEAVING_TREES[2], 'planted.ts');
    const read = (path: string): string =>
      path === planted ? "import { GameView } from '../game/GameView';" : fromDisk(path);
    const chain = reachToDelivery(planted, read);
    expect(chain?.[0]).toBe(planted);
    expect(chain?.at(-1)).toMatch(/delivery\//);
  });

  it('finds none in instance/, transfer/, recording/ or apps/instance/', () => {
    const offenders = LEAVING_TREES.flatMap(sourcesUnder).flatMap((file) => {
      const chain = reachToDelivery(file, fromDisk);
      return chain === undefined
        ? []
        : [
            chain
              .map((each) => (each.startsWith('/') ? relative(REPOSITORY_ROOT, each) : each))
              .join(' → '),
          ];
    });
    expect(
      offenders,
      'a Delivery target is never stored with the ride, exported or synced (ADR 0059 D-4)',
    ).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------

const DELIVERY_SOURCES = sourcesUnder(DELIVERY_TREE).filter((file) => !/-testing\.ts$/.test(file));

/** Whether `source` calls `console`, however it reaches it. */
const callsConsole = (source: string): boolean => /\bconsole\s*(?:\.|\[|\?\.)/.test(source);

describe('Delivery logs nothing — #1817, ADR 0059 D-4 item 2', () => {
  it('reads Delivery’s modules at all', () => {
    expect(DELIVERY_SOURCES.length).toBeGreaterThan(8);
  });

  it('finds a planted log', () => {
    expect(callsConsole('console.log(target.x);')).toBe(true);
    expect(callsConsole("console['warn'](seed);")).toBe(true);
    expect(callsConsole('globalThis.console?.error(at);')).toBe(true);
    expect(callsConsole('const consoled = 1;')).toBe(false);
  });

  it('finds no console call in any module under game/delivery/', () => {
    const offenders = DELIVERY_SOURCES.filter((file) => callsConsole(fromDisk(file))).map((file) =>
      relative(REPOSITORY_ROOT, file),
    );
    expect(offenders).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------

/** The fixture's own targets: the town #1817 rides, picked under a distinctive seed. */
const town = deliveryTown('delivery-throws', DISTINCTIVE_TOWN_LAYOUT);
const TARGETS: readonly DeliveryTarget[] = pickRoundTargets(
  {
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    houses: 3,
  },
  3_141_592_653,
).targets;
const FIRST = TARGETS[0] as DeliveryTarget;

/** Every digit run of the fixture's coordinates a message could carry: whole, and to 1 to 3 places. */
function coordinateDigits(): string[] {
  const runs = new Set<string>();
  for (const target of TARGETS) {
    for (const value of [target.distance, target.fromRoad, target.x, target.y, target.z]) {
      const size = Math.abs(value);
      runs.add(String(size));
      for (const places of [1, 2, 3]) runs.add(size.toFixed(places));
    }
  }
  return [...runs];
}

/** What of the fixture a message carries: a coordinate's digits, or any decimal number. */
function coordinatesIn(message: string): string[] {
  const found = coordinateDigits().filter((run) => message.includes(run));
  if (/\d[.,]\d/.test(message)) found.push('a decimal number');
  return found;
}

/** A started ride over the fixture's town, for a step to refuse. */
function aRide() {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
  });
  if (ride === undefined) throw new Error('the fixture town gave the round no house');
  return ride;
}

/**
 * One case for every throw in Delivery's modules, by file, each handed the
 * fixture's coordinates where the input takes a number. Counted against the
 * source below, so a new throw needs a case here.
 */
const THROWS: Readonly<Record<string, readonly (readonly [string, () => unknown])[]>> = {
  'targets.ts': [
    ['the round size', () => pickRoundTargets({ ...pickInput(), houses: FIRST.distance }, 1)],
    ['the seed', () => pickRoundTargets(pickInput(), FIRST.x)],
    ['the rider’s distance', () => pickRoundTargets({ ...pickInput(), riderDistance: FIRST.x }, 1)],
    ['the triangle budget', () => pickRoundTargets({ ...pickInput(), triangleBudget: FIRST.x }, 1)],
  ],
  'obstacles.ts': [
    ['the seed', () => placeObstacles({ from: FIRST.distance, to: FIRST.z }, FIRST.x)],
    ['the stretch', () => placeObstacles({ from: FIRST.z, to: FIRST.distance }, 1)],
    [
      'the rider',
      () =>
        stepObstacles(startObstacles([]), {
          rider: { along: FIRST.distance, lateral: FIRST.x, speed: -FIRST.fromRoad },
          obstacles: [],
        }),
    ],
    [
      'the state',
      () =>
        stepObstacles(startObstacles([]), {
          rider: { along: FIRST.distance, lateral: FIRST.x, speed: FIRST.fromRoad },
          obstacles: placeObstacles({ from: FIRST.distance, to: FIRST.distance + 1_000 }, 1),
        }),
    ],
  ],
  'round.ts': [
    ['the round size', () => startRound(FIRST.distance)],
    // #1818: a short round standing for a day's count it cannot stand for.
    ['the round’s day', () => startRound(3, { dayHouses: FIRST.distance })],
    ['the round position', () => recordMiss(startRound(3), FIRST.z)],
  ],
  'steer.ts': [
    ['the starting offset', () => startSteer(FIRST.x / 0)],
    ['the step', () => stepSteer(startSteer(FIRST.x), -FIRST.fromRoad)],
  ],
  'ride-round.ts': [
    [
      'the ticks',
      () =>
        stepDeliveryRide(aRide(), {
          ticks: FIRST.fromRoad,
          along: FIRST.distance,
          speed: FIRST.fromRoad,
        }),
    ],
  ],
  'throw.ts': [
    [
      'the ticks',
      () =>
        stepThrows(NO_PARCELS, {
          rider: { along: FIRST.distance, speed: FIRST.fromRoad },
          targets: [],
          round: startRound(3),
          ticks: FIRST.fromRoad,
        }),
    ],
  ],
};

function pickInput() {
  return {
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    houses: 3,
  };
}

/** `source` with its comments and string literals taken out, so a word in either is not code. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
}

/** How many errors `source` can raise: each `throw`, and each call of a `refuse` helper. */
function throwSitesIn(source: string): number {
  const code = codeOf(source);
  const throws = code.match(/\bthrow\b/g)?.length ?? 0;
  const helpers = code.match(/\bfunction\s+refuse\s*\(/g)?.length ?? 0;
  const refusals = (code.match(/\brefuse\s*\(/g)?.length ?? 0) - helpers;
  // A helper's own `throw` is counted once for each call of it instead.
  return throws - helpers + refusals;
}

describe('no error Delivery raises carries a coordinate — #1817, ADR 0004 D', () => {
  it('has a case for every throw in Delivery’s modules', () => {
    const sites = Object.fromEntries(
      DELIVERY_SOURCES.map((file): [string, number] => [
        relative(DELIVERY_TREE, file),
        throwSitesIn(fromDisk(file)),
      ]).filter(([, count]) => count !== 0),
    );
    const cases = Object.fromEntries(
      Object.entries(THROWS).map(([file, each]) => [file, each.length]),
    );
    expect(cases).toStrictEqual(sites);
  });

  it('counts a planted throw, and finds a planted coordinate', () => {
    expect(throwSitesIn("if (bad) throw new RangeError('no');")).toBe(1);
    // A word in a comment or a message is not a throw: `throw.ts` says "throw" everywhere.
    expect(
      throwSitesIn("// a throw\nconst said = 'the throw missed';\nstepThrows(s, { throwTo });"),
    ).toBe(0);
    expect(
      throwSitesIn(
        "function refuse(c: string): never { throw new RangeError(c); }\nrefuse('a');\nrefuse(\n  `b`,\n);",
      ),
    ).toBe(2);
    expect(coordinatesIn(`the target at ${String(FIRST.x)} is off the road`)).toContain(
      String(Math.abs(FIRST.x)),
    );
    expect(coordinatesIn(`the rider at ${FIRST.distance.toFixed(1)} m`)).toContain(
      FIRST.distance.toFixed(1),
    );
    expect(coordinatesIn('the rider’s distance is a finite number of metres')).toStrictEqual([]);
  });

  for (const [file, cases] of Object.entries(THROWS)) {
    it.each(cases)(`${file}: refuses %s, naming no coordinate`, (_name, raise) => {
      let message: string | undefined;
      try {
        raise();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message, 'the case raised nothing').toBeDefined();
      expect(coordinatesIn(message ?? '')).toStrictEqual([]);
    });
  }
});
