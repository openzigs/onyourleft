// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The grade the trainer is sent on an open-world ride, from real heights**
 * — #2899, ADR 0087 D-3 to D-7.
 *
 * Every assertion here reads what the driver WROTE: the calls a recording
 * trainer received, through the product's own gradient session
 * (`game/gradient.ts`), over a rolling route whose heights come from a
 * fixture terrain archive through the product's reader, decode bounds and
 * tile holder (`heights.ts`). Never the profile, and never the writer's own
 * state. The ride below steps the session in the order `GameView`'s frame
 * loop does: follow the road, hand the session a changed view, then sample
 * with the bounded path where the road's heights are not known.
 *
 * Every ground is a formula in a synthetic tile; no street is a real one.
 */

import {
  altitudeMetres,
  RollingRoute,
  seconds,
  type RollingEdge,
  type RollingStreetGraph,
} from '@onyourleft/domain';
import { heightPixelMetres, type HeightTileId } from '@onyourleft/map-features';
import {
  flatHeightTile,
  heightTileWebp,
  PLATEAU,
  plateauHeightTile,
  VALLEY,
  valleyHeightTile,
} from '@onyourleft/map-features/testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import { describe, expect, it } from 'vitest';

import { CORRECTION_GRADE_STEP_PERCENT_PER_SECOND } from '../../net/correction';
import { terrainArchiveFrom } from '../../terrain/terrain-source';
import {
  buildTerrainArchive,
  fixtureDecode,
  FIXTURE_HEIGHT_TILE,
  placeInTile,
} from '../../terrain/terrain-testing';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import { createGradientSession } from '../gradient';
import { createRoadHeights, type RoadHeights } from './heights';
import { OpenWorldRoad } from './road';

/** The ground one pixel of the fixture tile covers along the street's row, in metres. */
const PIXEL = heightPixelMetres(placeInTile(FIXTURE_HEIGHT_TILE, 256, 192).latitude);
/** The row every west-to-east street here runs along: inside block row 1 of the tile. */
const ROW = 192;
/** Where each ride starts: inside block (1, 1), whose 3 × 3 lies in the one tile. */
const START_COLUMN = 140;

/** A street between two pixels of the fixture tile, its own heights all 0. */
function street(
  id: string,
  from: readonly [number, number],
  to: readonly [number, number],
  span = false,
): RollingEdge {
  return {
    id,
    from: `${String(from[0])},${String(from[1])}`,
    to: `${String(to[0])},${String(to[1])}`,
    points: [from, to].map(([column, row]) => ({
      position: placeInTile(FIXTURE_HEIGHT_TILE, column, row),
      elevation: altitudeMetres(0),
    })),
    roadClass: 1,
    ...(span ? { span: true } : {}),
  };
}

function graphOf(edges: readonly RollingEdge[]): RollingStreetGraph {
  const from = new Map<string, RollingEdge[]>();
  const add = (edge: RollingEdge): void => {
    from.set(edge.from, [...(from.get(edge.from) ?? []), edge]);
  };
  for (const edge of edges) {
    add(edge);
    add({ ...edge, from: edge.to, to: edge.from, points: [...edge.points].reverse() });
  }
  return { edgesFrom: (node) => from.get(node) ?? [] };
}

/** The tile holder over a one-tile archive, its start not yet asked for. */
async function heightsOver(
  bytes: Uint8Array,
  tile: HeightTileId = FIXTURE_HEIGHT_TILE,
): Promise<{ heights: RoadHeights; source: CountingSource }> {
  const source = countingSource(await buildTerrainArchive([{ tile, bytes }]));
  const heights = createRoadHeights({
    archive: terrainArchiveFrom(source),
    mapTilesOn: () => true,
    decode: fixtureDecode,
    // The start's bound never fires in a test: its tiles arrive or fail first.
    schedule: () => () => undefined,
    // A draw of 0 is no delay at all (ADR 0090 R-8's delay is `heights.test.ts`'s).
    random: () => 0,
  });
  return { heights, source };
}

/** One write the trainer received, and where the rider was. */
interface Write {
  /** Ride seconds. */
  readonly at: number;
  /** Ride distance, metres. */
  readonly distance: number;
  /** The grade written, percent. */
  readonly grade: number;
}

/** Everything a recording trainer was asked to do, by method. */
interface Recorded {
  readonly writes: Write[];
  readonly calls: string[];
}

/**
 * Ride `road` at `speed` m/s for `forSeconds`, five frames a second, in the
 * order `GameView`'s frame loop runs: `press` (a junction choice or a U-turn,
 * as the turn input makes them) → follow → a changed view to the session →
 * sample, bounded where the heights are not known.
 */
async function ride(
  road: OpenWorldRoad,
  options: {
    readonly forSeconds: number;
    readonly speed?: number;
    readonly press?: (rider: number, at: number) => void;
    readonly before?: (rider: number, at: number) => void | Promise<void>;
  },
): Promise<Recorded> {
  const recorded: Recorded = { writes: [], calls: [] };
  let now = 0;
  let rider = 0;
  const written: SimulationParameters[] = [];
  const session = createGradientSession({
    profile: road.view.profile,
    control: {
      setSimulationParameters: (parameters) => {
        recorded.calls.push('setSimulationParameters');
        written.push(parameters);
        recorded.writes.push({ at: now, distance: rider, grade: parameters.grade });
        return Promise.resolve();
      },
      letGo: () => {
        recorded.calls.push('letGo');
        return Promise.resolve({ kind: 'stopped' });
      },
    },
  });
  const speed = options.speed ?? 10;
  for (let frame = 0; frame <= options.forSeconds * 5; frame += 1) {
    now = frame / 5;
    rider = now * speed;
    await options.before?.(rider, now);
    options.press?.(rider, now);
    const followed = road.follow(rider);
    if (followed !== undefined) session.follow(followed.profile, followed.origin, followed.turned);
    session.sample(seconds(now), rider, !road.heightsKnownAt(rider));
    await session.settled();
  }
  return recorded;
}

/** The biggest change between one write and the next, in percent a second. */
function steepestWalk(writes: readonly Write[]): number {
  let most = 0;
  for (let index = 1; index < writes.length; index += 1) {
    const before = writes[index - 1] as Write;
    const after = writes[index] as Write;
    most = Math.max(most, Math.abs(after.grade - before.grade) / (after.at - before.at));
  }
  return most;
}

/** The last grade written at or before ride distance `distance`. */
function gradeSentBy(writes: readonly Write[], distance: number): number | undefined {
  let grade: number | undefined;
  for (const write of writes) if (write.distance <= distance) grade = write.grade;
  return grade;
}

describe('the grade written comes from the ground under the road', () => {
  it('writes a steady 5 % on a steady 5 % slope, and nothing but grades', async () => {
    const { heights } = await heightsOver(heightTileWebp((column) => 200 + column * 0.05 * PIXEL));
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const edges = [street('a', [START_COLUMN, ROW], [330, ROW])];
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(edges), edges[0] as RollingEdge, { heights: heights.heightAt }),
      { realHeights: true },
    );
    const { writes, calls } = await ride(road, { forSeconds: 150 });
    // 190 px of street is 2.8 km: the rider is on the climb throughout. The
    // very first samples of a route have half a window behind them, so the
    // grade there is the taper `rolling.ts` gives a road's first 50 m.
    expect(writes.length).toBeGreaterThan(0);
    // It rises to the slope's 5 % and is never written past it; once there,
    // the deadband writes nothing more.
    for (const write of writes) expect(write.grade).toBeLessThan(5.1);
    expect(writes.at(-1)?.distance).toBeLessThan(100);
    expect(gradeSentBy(writes, 1_400)).toBeCloseTo(5, 1);
    // The trainer was sent simulation parameters and nothing else: no
    // resistance level, no ERG target, no other command (ADR 0087 D-5).
    expect(new Set(calls)).toStrictEqual(new Set(['setSimulationParameters']));
  });

  it('writes 0 % on a flat block', async () => {
    const { heights } = await heightsOver(flatHeightTile());
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const edges = [street('a', [START_COLUMN, ROW], [330, ROW])];
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(edges), edges[0] as RollingEdge, { heights: heights.heightAt }),
    );
    const { writes } = await ride(road, { forSeconds: 60 });
    expect(writes.map((write) => write.grade)).toStrictEqual([0]);
  });
});

describe('a bridge over the valley fixture — ADR 0087 D-4.3', () => {
  /** Along the valley tile's row: plateau, the valley between its two rims, plateau. */
  const edges = (span: boolean): RollingEdge[] => [
    street('west', [START_COLUMN, ROW], [VALLEY.westColumn - 4, ROW]),
    street('bridge', [VALLEY.westColumn - 4, ROW], [VALLEY.eastColumn + 4, ROW], span),
    street('east', [VALLEY.eastColumn + 4, ROW], [400, ROW]),
  ];
  async function ridden(span: boolean): Promise<Write[]> {
    const { heights } = await heightsOver(valleyHeightTile());
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const held = edges(span);
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(held), held[0] as RollingEdge, { heights: heights.heightAt }),
    );
    // 260 px, 3.8 km: across the bridge and well past it.
    return (await ride(road, { forSeconds: 250 })).writes;
  }

  it('writes the deck’s grade where the street is marked a bridge: level all the way', async () => {
    const writes = await ridden(true);
    expect(writes.map((write) => write.grade)).toStrictEqual([0]);
  });

  it('writes the valley floor’s without the mark, which is what the bridge is for', async () => {
    const writes = await ridden(false);
    const grades = writes.map((write) => write.grade);
    // 60 m down and 60 m up over 20 px each side: about 20 %.
    expect(Math.min(...grades)).toBeLessThan(-10);
    expect(Math.max(...grades)).toBeGreaterThan(10);
  });
});

describe('a hostile tile — ADR 0087 D-3’s step row, D-7’s walk', () => {
  it('never moves the grade written by more than 1 % a second across a plateau inside the valid range', async () => {
    // A 4 % climb with ADR 0087 D-3's plateau standing on it: 50 m sheer up
    // and 50 m sheer down, 60 px wide, every height a plausible one.
    const climb = 0.04 * PIXEL;
    const { heights } = await heightsOver(
      heightTileWebp(
        (column) =>
          200 +
          column * climb +
          (column >= PLATEAU.westColumn && column < PLATEAU.eastColumn
            ? PLATEAU.topMetres - PLATEAU.groundMetres
            : 0),
      ),
    );
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const edges = [street('a', [START_COLUMN, ROW], [400, ROW])];
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(edges), edges[0] as RollingEdge, { heights: heights.heightAt }),
    );
    const { writes } = await ride(road, { forSeconds: 300 });
    const grades = writes.map((write) => write.grade);
    // It nears on the climb's own 4 %, is eased to 0 % at each edge, and
    // leaves on 4 % again: the plateau's 50 m never reaches the trainer.
    expect(gradeSentBy(writes, 400)).toBeCloseTo(4, 1);
    expect(grades.at(-1)).toBeCloseTo(4, 1);
    expect(Math.min(...grades)).toBe(0);
    expect(Math.max(...grades)).toBeLessThan(4.1);
    expect(steepestWalk(writes)).toBeLessThanOrEqual(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND);
  });

  it('writes nothing but 0 % over the plateau fixture on level ground', async () => {
    const { heights } = await heightsOver(plateauHeightTile());
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const edges = [street('a', [START_COLUMN, ROW], [400, ROW])];
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(edges), edges[0] as RollingEdge, { heights: heights.heightAt }),
    );
    const { writes } = await ride(road, { forSeconds: 300 });
    // The bounded path hands back to the driver, which writes its first
    // sample again: the same 0 %, more than once, and nothing else.
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes.map((write) => write.grade))).toStrictEqual(new Set([0]));
  });
});

describe('heights that are not there, and heights that arrive late — ADR 0087 D-6.4, D-7', () => {
  const slope = (): Uint8Array => heightTileWebp((column) => 200 + column * 0.06 * PIXEL);
  const edges = [street('a', [START_COLUMN, ROW], [400, ROW])];

  it('writes 0 % while no heights are known', async () => {
    const { heights, source } = await heightsOver(slope());
    source.offline = true;
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(edges), edges[0] as RollingEdge, { heights: heights.heightAt }),
      { heightsVersion: () => heights.version },
    );
    expect(road.heightsKnownAt(0)).toBe(false);
    const { writes } = await ride(road, { forSeconds: 60 });
    expect(writes.map((write) => write.grade)).toStrictEqual([0]);
  });
});

describe('a height tile that arrives late — ADR 0087 D-6.4', () => {
  it('walks from 0 % to the road’s 6 % at no more than 1 % a second', async () => {
    const { heights, source } = await heightsOver(
      heightTileWebp((column) => 200 + column * 0.06 * PIXEL),
    );
    source.offline = true;
    const start = placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW);
    await heights.start(start);
    const edges = [street('a', [START_COLUMN, ROW], [400, ROW])];
    const road = new OpenWorldRoad(
      new RollingRoute(graphOf(edges), edges[0] as RollingEdge, { heights: heights.heightAt }),
      { heightsVersion: () => heights.version },
    );
    let asked = false;
    const { writes } = await ride(road, {
      forSeconds: 120,
      before: async (rider, at) => {
        if (asked || at < 30) return;
        asked = true;
        source.offline = false;
        // The read that failed is asked for again on the next report of where
        // the rider is (`heights.ts`); with no delay to wait out in this test.
        heights.moveTo(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN + rider / PIXEL, ROW));
        for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
      },
    });
    const grades = writes.map((write) => write.grade);
    expect(grades[0]).toBe(0);
    expect(grades.at(-1)).toBeCloseTo(6, 1);
    // The tile arrived 30 s in, and the road asked again at once: 15 s later
    // the walk is done. Left to the route's next extension it would begin a
    // minute on.
    expect(gradeSentBy(writes, 450)).toBeCloseTo(6, 1);
    // From flat to the road's own grade, a step a second and never more.
    expect(steepestWalk(writes)).toBeLessThanOrEqual(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND);
    expect(writes.filter((write) => write.at < 30).map((write) => write.grade)).toStrictEqual([0]);
    expect(heights.version).toBe(1);
  });
});

describe('a junction choice and the grade written — ADR 0087 D-6.2, D-5', () => {
  /**
   * A level street east to a junction 1 km on, where the way on is straight
   * (east, climbing) and the other way turns north. Both ways are on the 4 %
   * and −6 % faces of a ridge whose crest runs through the junction, and they
   * are of different lengths.
   */
  const JUNCTION_COLUMN = START_COLUMN + 1_000 / PIXEL;
  const ground = (column: number, row: number): number =>
    300 +
    Math.max(0, column - JUNCTION_COLUMN) * 0.04 * PIXEL -
    Math.max(0, ROW - row) * 0.06 * PIXEL;
  const edges = (): RollingEdge[] => [
    street('approach', [START_COLUMN, ROW], [JUNCTION_COLUMN, ROW]),
    // Straight on: 1.9 km of 4 % climb.
    street('straight', [JUNCTION_COLUMN, ROW], [JUNCTION_COLUMN + 130, ROW]),
    // North: 2.6 km of 6 % descent.
    street('north', [JUNCTION_COLUMN, ROW], [JUNCTION_COLUMN, ROW - 180]),
  ];

  async function ridden(pressAt: number | undefined): Promise<{
    recorded: Recorded;
    outcome: string | undefined;
    junction: number;
  }> {
    const { heights } = await heightsOver(heightTileWebp(ground));
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const held = edges();
    const route = new RollingRoute(graphOf(held), held[0] as RollingEdge, {
      heights: heights.heightAt,
    });
    const road = new OpenWorldRoad(route);
    const junction = route.junctionsAfter(0)[0]?.distance ?? Number.NaN;
    let outcome: string | undefined;
    const recorded = await ride(road, {
      forSeconds: 200,
      press: (rider) => {
        if (pressAt === undefined || outcome !== undefined || junction - rider > pressAt) return;
        outcome = route.choose(junction, 'north', rider);
      },
    });
    return { recorded, outcome, junction };
  }

  it('has a junction about 1 km on, with the straight way as the default', async () => {
    const { junction, recorded } = await ridden(undefined);
    expect(junction).toBeGreaterThan(990);
    expect(junction).toBeLessThan(1_010);
    // Unpressed, the ride climbs the straight way's 4 %.
    expect(recorded.writes.at(-1)?.grade).toBeCloseTo(4, 1);
  });

  it('a press 101 m before the junction takes the other way, and steps no grade written', async () => {
    const straight = await ridden(undefined);
    const turned = await ridden(101);
    expect(turned.outcome).toBe('swapped');
    // Up to the press, and on to the junction, the trainer was written
    // exactly what it would have been with no press at all: the approach is
    // level, and neither way's slope has reached the grade sent.
    const before = (recorded: Recorded): Write[] =>
      recorded.writes.filter((write) => write.distance <= turned.junction - 90);
    expect(before(turned.recorded)).toStrictEqual(before(straight.recorded));
    expect(before(turned.recorded).map((write) => write.grade)).toStrictEqual([0]);
    // Past it the road is the one chosen: the descent, reached by the road's
    // own change over its own window, never in one write.
    expect(turned.recorded.writes.at(-1)?.grade).toBeCloseTo(-6, 1);
    expect(straight.recorded.writes.at(-1)?.grade).toBeCloseTo(4, 1);
    // The press itself wrote nothing: no write falls on the frame it was made.
    const pressedAt = (turned.junction - 101) / 10;
    expect(
      turned.recorded.writes.filter((write) => Math.abs(write.at - pressedAt) < 0.21),
    ).toStrictEqual(
      straight.recorded.writes.filter((write) => Math.abs(write.at - pressedAt) < 0.21),
    );
  });

  it('a press 99 m before the junction is refused, and the grade written is the unpressed ride’s', async () => {
    const straight = await ridden(undefined);
    const late = await ridden(99);
    expect(late.outcome).toBe('locked');
    expect(late.recorded.writes).toStrictEqual(straight.recorded.writes);
    expect(gradeSentBy(late.recorded.writes, late.junction + 500)).toBeCloseTo(4, 1);
  });

  it('writes only simulation parameters whatever is pressed: no resistance, no ERG target', async () => {
    const { heights } = await heightsOver(heightTileWebp(ground));
    await heights.start(placeInTile(FIXTURE_HEIGHT_TILE, START_COLUMN, ROW));
    const held = edges();
    const route = new RollingRoute(graphOf(held), held[0] as RollingEdge, {
      heights: heights.heightAt,
    });
    const road = new OpenWorldRoad(route);
    const junction = route.junctionsAfter(0)[0]?.distance ?? Number.NaN;
    let pressed = 0;
    const recorded = await ride(road, {
      forSeconds: 200,
      press: (rider, at) => {
        // Every game event an open-world ride has: a choice early, a choice
        // inside the lock, and a U-turn.
        if (pressed === 0 && rider > 300) {
          pressed = 1;
          route.choose(junction, 'north', rider);
        } else if (pressed === 1 && junction - rider < 50) {
          pressed = 2;
          route.choose(junction, 'straight', rider);
        } else if (pressed === 2 && at > 150) {
          pressed = 3;
          route.uTurn(rider);
        }
      },
    });
    expect(pressed).toBe(3);
    expect(new Set(recorded.calls)).toStrictEqual(new Set(['setSimulationParameters']));
    // And the U-turn, which the lock cannot prevent, is walked.
    expect(steepestWalk(recorded.writes.filter((write) => write.at > 149))).toBeLessThanOrEqual(
      CORRECTION_GRADE_STEP_PERCENT_PER_SECOND,
    );
  });
});
