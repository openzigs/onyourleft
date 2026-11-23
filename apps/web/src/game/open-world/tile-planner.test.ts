// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2901: an open-world ride's tiles planned in a worker. The plan the worker's
 * own file sends back — through `structuredClone` with its buffers
 * transferred, as a reply crosses a thread — is held byte for byte against the
 * plan `planTile` makes on this thread for the same synthetic tile. A worker
 * that fails is said in words with no coordinate or tile in them, and the
 * planner goes on on this thread. Every feature here is written by hand in
 * metres from the fixture frame: no OpenStreetMap data.
 */

import { FIXTURE_FRAME, FIXTURE_TILE } from '@onyourleft/map-features/testing';
import {
  NO_BUILDING_FIELDS,
  NO_ROAD_FIELDS,
  tileBox,
  type BuildingFeature,
  type DecodedStreetFeature,
  type LandUseFeature,
  type TileId,
} from '@onyourleft/map-features';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { planTile, tilePlanBuffers, type TileBlockFeatures, type TilePlan } from './tile-plan';
import {
  createTilePlanner,
  describeTilePlanFailure,
  tilePlanWorkerCore,
  type TilePlanRequest,
  type TilePlanWorkerLike,
} from './tile-planner';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const TILE: TileId = FIXTURE_TILE;
const EAST: TileId = { z: 15, x: TILE.x + 1, y: TILE.y };
const BOX = tileBox(FIXTURE_FRAME, TILE);
const MID_X = (BOX.minX + BOX.maxX) / 2;
const MID_Z = (BOX.minZ + BOX.maxZ) / 2;

function square(x: number, z: number, half: number): Float32Array {
  return Float32Array.from([
    x - half,
    z - half,
    x + half,
    z - half,
    x + half,
    z + half,
    x - half,
    z + half,
  ]);
}

function building(x: number, z: number, half = 5, height: number | null = null): BuildingFeature {
  return {
    ...NO_BUILDING_FIELDS,
    kind: 'building',
    rings: [square(x, z, half)],
    heightMetres: height,
    minHeightMetres: null,
  };
}

function street(line: number[], kindDetail = 'residential'): DecodedStreetFeature {
  return {
    ...NO_ROAD_FIELDS,
    kind: 'minor_road',
    kindDetail,
    grade: 'ground',
    line: Float32Array.from(line),
  };
}

/** The synthetic block: three footprints, a park and a wood, and two streets. */
function fixtureBlock(): TileBlockFeatures {
  const park: LandUseFeature = {
    layer: 'landuse',
    kind: 'park',
    rings: [square(MID_X, MID_Z + 150, 60)],
  };
  const wood: LandUseFeature = {
    layer: 'landuse',
    kind: 'wood',
    rings: [square(MID_X - 200, MID_Z - 150, 80)],
  };
  return {
    buildings: [
      building(MID_X, MID_Z, 5, 9),
      // Its centroid is 3 m past the tile's east edge (`minX`: x is metres west):
      // the eastern tile's, though this tile's buffer carries it.
      building(BOX.minX - 3, MID_Z),
      building(BOX.minX + 3, MID_Z + 40),
    ],
    landUse: [park, wood],
    tiles: [
      {
        tile: TILE,
        streets: [
          street([BOX.minX + 10, MID_Z - 20, BOX.maxX - 10, MID_Z - 20]),
          street([MID_X + 30, BOX.minZ + 10, MID_X + 30, BOX.maxZ - 10], 'service'),
        ],
      },
      { tile: EAST, streets: [] },
    ],
  };
}

/** Every buffer of a plan, as bytes. */
function bytesOf(plan: TilePlan): number[][] {
  return tilePlanBuffers(plan).map((buffer) => Array.from(new Uint8Array(buffer)));
}

/** The worker's own file, driven through its global scope; replies cross as a thread's would. */
async function workerFile(): Promise<{
  send(message: TilePlanRequest): void;
  replies: unknown[];
}> {
  const replies: unknown[] = [];
  vi.stubGlobal('postMessage', (message: unknown, transfer: Transferable[]) => {
    replies.push(structuredClone(message, { transfer }));
  });
  vi.stubGlobal('onmessage', null);
  await import('./tile-plan-worker');
  const scope = globalThis as unknown as { onmessage: (event: { data: unknown }) => void };
  return {
    send: (message) => {
      scope.onmessage({ data: structuredClone(message) });
    },
    replies,
  };
}

describe('a tile planned in the worker is the tile planned here — #2901', () => {
  it('sends back the same buffers, byte for byte, as planTile makes on this thread', async () => {
    const block = fixtureBlock();
    const here = planTile(FIXTURE_FRAME, block, TILE, 'full');
    const worker = await workerFile();
    worker.send({ kind: 'frame', frame: FIXTURE_FRAME });
    worker.send({ kind: 'hold', block: 'b', features: block });
    worker.send({ kind: 'plan', id: 4, block: 'b', tile: TILE, detail: 'full' });
    expect(worker.replies).toHaveLength(1);
    const reply = worker.replies[0] as { kind: string; id: number; plan: TilePlan };
    expect(reply.kind).toBe('plan');
    expect(reply.id).toBe(4);
    expect(bytesOf(reply.plan)).toStrictEqual(bytesOf(here));
    expect(reply.plan.box).toStrictEqual(here.box);
    expect(reply.plan.land.columns * reply.plan.land.rows).toBe(here.land.classes.length);
  });

  it('control: a plan of the tile is not empty, and is the tile’s own', () => {
    const plan = planTile(FIXTURE_FRAME, fixtureBlock(), TILE, 'full');
    // The middle house and the one just inside the east edge; the one whose
    // centroid is past the edge is the eastern tile's.
    expect(Array.from(plan.buildings.source)).toStrictEqual([0, 2]);
    expect(plan.buildings.heights[0]).toBe(9);
    expect(Number.isNaN(plan.buildings.heights[1])).toBe(true);
    const east = planTile(FIXTURE_FRAME, fixtureBlock(), EAST, 'full');
    expect(Array.from(east.buildings.source)).toStrictEqual([1]);
    expect(plan.streets.count).toBe(2);
    expect(Array.from(plan.streets.widthClasses)).toStrictEqual([2, 3]);
    const classes = new Set(plan.land.classes);
    // park (3) and wood (2) painted, the rest of the covered tile `other` (7).
    expect(classes.has(3)).toBe(true);
    expect(classes.has(2)).toBe(true);
    expect(classes.has(7)).toBe(true);
  });

  it('plans a building two tiles both carry once, the larger copy — #2902, #3060’s rule', () => {
    const whole = building(MID_X, MID_Z, 5);
    // The neighbour's copy: its vertices on its own grid, 0.3 m off, and clipped smaller.
    const copy = building(MID_X + 0.3, MID_Z - 0.2, 4.8);
    const part: BuildingFeature = {
      ...building(MID_X, MID_Z, 4.9),
      kind: 'building_part',
      minHeightMetres: 3,
    };
    const apart = building(MID_X + 3, MID_Z, 5);
    const block: TileBlockFeatures = {
      buildings: [copy, whole, part, apart],
      landUse: [],
      tiles: [{ tile: TILE, streets: [] }],
    };
    const plan = planTile(FIXTURE_FRAME, block, TILE, 'full');
    // The whole copy, kept in the place the first was read; the part, whose
    // tags differ; and the house 3 m along, which is not a copy.
    expect(Array.from(plan.buildings.source)).toStrictEqual([1, 2, 3]);
  });

  it('plans at reduced detail on a coarser lattice', () => {
    const full = planTile(FIXTURE_FRAME, fixtureBlock(), TILE, 'full');
    const reduced = planTile(FIXTURE_FRAME, fixtureBlock(), TILE, 'reduced');
    expect(reduced.land.cellMetres).toBe(4 * full.land.cellMetres);
    expect(reduced.land.classes.length).toBeLessThan(full.land.classes.length / 10);
  });

  it('answers a plan with no frame or no block held as failed', () => {
    const core = tilePlanWorkerCore();
    expect(
      core.handle({ kind: 'plan', id: 1, block: 'b', tile: TILE, detail: 'full' })?.reply,
    ).toStrictEqual({ kind: 'failed', id: 1 });
    core.handle({ kind: 'frame', frame: FIXTURE_FRAME });
    expect(
      core.handle({ kind: 'plan', id: 2, block: 'b', tile: TILE, detail: 'full' })?.reply,
    ).toStrictEqual({ kind: 'failed', id: 2 });
    expect(core.handle('nonsense')).toBeUndefined();
  });
});

/** A worker that runs the core a microtask later and records what it is asked. */
function recordingWorker(fails?: (message: TilePlanRequest) => 'error' | 'failed' | undefined): {
  worker: TilePlanWorkerLike;
  asked: TilePlanRequest[];
  terminated: () => boolean;
} {
  const core = tilePlanWorkerCore();
  const asked: TilePlanRequest[] = [];
  let terminated = false;
  const worker: TilePlanWorkerLike = {
    postMessage: (message) => {
      asked.push(message);
      queueMicrotask(() => {
        if (terminated) return;
        const failure = fails?.(message);
        if (failure === 'error') {
          worker.onerror?.({});
          return;
        }
        if (failure === 'failed' && message.kind === 'plan') {
          worker.onmessage?.({ data: { kind: 'failed', id: message.id } });
          return;
        }
        const answer = core.handle(message);
        if (answer !== undefined) worker.onmessage?.({ data: answer.reply });
      });
    },
    terminate: () => {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  return { worker, asked, terminated: () => terminated };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const blocks = (): Map<string, TileBlockFeatures> => new Map([['b', fixtureBlock()]]);

describe('the tile planner — #2901', () => {
  it('plans what it is asked, one at a time, first first, and keeps each plan', async () => {
    const { worker, asked } = recordingWorker();
    const planner = createTilePlanner({ frame: FIXTURE_FRAME, make: () => worker });
    planner.hold(blocks());
    planner.want([EAST, TILE]);
    // One request in flight: the first wanted.
    expect(asked.filter((each) => each.kind === 'plan')).toHaveLength(1);
    await settle();
    expect(planner.plan(EAST)?.buildings.count).toBe(1);
    expect(planner.plan(TILE)?.buildings.count).toBe(2);
    const plans = asked.filter((each) => each.kind === 'plan');
    expect(plans.map((each) => each.tile.x)).toStrictEqual([EAST.x, TILE.x]);
    expect(planner.inWorker).toBe(true);
    expect(planner.plan(TILE)?.detail).toBe('full');
    expect(planner.version).toBe(2);
    planner.stop();
  });

  it('lets a plan go with its block', async () => {
    const { worker, asked } = recordingWorker();
    const planner = createTilePlanner({ frame: FIXTURE_FRAME, make: () => worker });
    planner.hold(blocks());
    planner.want([TILE]);
    await settle();
    expect(planner.plan(TILE)).toBeDefined();
    planner.hold(new Map());
    expect(planner.plan(TILE)).toBeUndefined();
    expect([...planner.plans()]).toHaveLength(0);
    expect(asked.at(-1)).toStrictEqual({ kind: 'drop', block: 'b' });
    planner.stop();
  });

  it('keeps no plan whose block was let go while it was planned', async () => {
    const { worker } = recordingWorker();
    const planner = createTilePlanner({ frame: FIXTURE_FRAME, make: () => worker });
    planner.hold(blocks());
    planner.want([TILE]);
    planner.hold(new Map());
    await settle();
    expect(planner.plan(TILE)).toBeUndefined();
    expect(planner.version).toBe(0);
    planner.stop();
  });

  it('asks for nothing of a tile no held block decoded', async () => {
    const { worker, asked } = recordingWorker();
    const planner = createTilePlanner({ frame: FIXTURE_FRAME, make: () => worker });
    planner.hold(blocks());
    planner.want([{ z: 15, x: TILE.x + 9, y: TILE.y }]);
    await settle();
    expect(asked.filter((each) => each.kind === 'plan')).toHaveLength(0);
    planner.stop();
  });

  for (const how of ['error', 'failed'] as const) {
    it(`says a worker’s ${how} with no coordinate or tile, and plans on here — #2901`, async () => {
      const { worker, terminated } = recordingWorker((message) =>
        message.kind === 'plan' ? how : undefined,
      );
      const lines: string[] = [];
      const planner = createTilePlanner({
        frame: FIXTURE_FRAME,
        make: () => worker,
        log: (line) => lines.push(line),
        schedule: (run) => {
          queueMicrotask(run);
        },
      });
      planner.hold(blocks());
      planner.want([TILE, EAST]);
      await settle();
      expect(terminated()).toBe(true);
      expect(lines).toStrictEqual([describeTilePlanFailure()]);
      // No number at all, so no coordinate, tile or block id can be in it.
      expect(lines[0]).not.toMatch(/\d/);
      expect(lines[0]).not.toContain(String(TILE.x));
      // The ride goes on: the page plans every wanted tile, at reduced detail.
      expect(planner.inWorker).toBe(false);
      expect(planner.plan(TILE)?.detail).toBe('reduced');
      expect(planner.plan(EAST)?.buildings.count).toBe(1);
      planner.stop();
    });
  }

  it('plans the buildings round the rider again on here when the worker fails them — #2902', async () => {
    const { worker } = recordingWorker((message) =>
      message.kind === 'buildings' ? 'error' : undefined,
    );
    const planner = createTilePlanner({
      frame: FIXTURE_FRAME,
      make: () => worker,
      schedule: (run) => {
        queueMicrotask(run);
      },
    });
    planner.hold(blocks());
    planner.want([TILE]);
    await settle();
    const at = (north: number) => ({
      position: geographicPosition(
        degreesLatitude(FIXTURE_FRAME.latitude + north),
        degreesLongitude(FIXTURE_FRAME.longitude),
      ),
      elevation: altitudeMetres(0),
    });
    const profile = routeProfile([at(0), at(0.003)]);
    // Asked once: the ask the worker failed is the one planned on here.
    planner.planBuildings({ profile, x: MID_X, z: MID_Z });
    await settle();
    await settle();
    expect(planner.inWorker).toBe(false);
    expect(planner.buildings).toBeDefined();
    planner.stop();
  });

  it('plans on here when no worker can be made', async () => {
    const lines: string[] = [];
    const planner = createTilePlanner({
      frame: FIXTURE_FRAME,
      make: () => {
        throw new Error('refused');
      },
      log: (line) => lines.push(line),
      schedule: (run) => {
        queueMicrotask(run);
      },
    });
    planner.hold(blocks());
    planner.want([TILE]);
    await settle();
    expect(lines).toStrictEqual([describeTilePlanFailure()]);
    expect(planner.plan(TILE)?.detail).toBe('reduced');
    planner.stop();
  });

  it('makes the real worker where the platform has one', () => {
    const made: unknown[][] = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        onerror = null;
        constructor(...args: unknown[]) {
          made.push(args);
        }
        postMessage(): void {}
        terminate(): void {}
      },
    );
    const planner = createTilePlanner({ frame: FIXTURE_FRAME });
    expect(made).toHaveLength(0);
    planner.hold(blocks());
    expect(made).toHaveLength(1);
    expect(String((made[0] as [string])[0])).toMatch(/tile-plan-worker\.ts$/);
    expect(made[0]?.[1]).toMatchObject({ type: 'module', name: 'oyl-tile-plans' });
    planner.stop();
  });
});
