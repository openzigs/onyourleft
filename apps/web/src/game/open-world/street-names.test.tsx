// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Street names on the open world's roads, and in its junction prompt** —
 * #3052, ADR 0096.
 *
 * - `streetNameLabels` places a named street's name at each mouth and along
 *   it, and none for an unnamed street or a name the atlas cannot paint.
 * - Through the real `GameView`, the real session and the product's decoder
 *   over a fixture block of named and unnamed streets: every name the scene
 *   is handed and every letter the renderer is handed lies on its own street,
 *   and the unnamed streets carry none. The junction prompt names each way.
 * - The names cost **one draw call** however many streets there are: one mesh
 *   of the real `StreetNameBelt`, one material, no groups.
 */

import { Blob as NodeBlob } from 'node:buffer';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { openActivityStore, type ActivityStore } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import type { RiddenBlockCacheOptions } from '../../world-data/ridden-blocks';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { GameView, type GamePort } from '../GameView';
import type { GameRenderer, SceneFrame } from '../port';
import type { SceneInput } from '../scene';
import {
  paintedLength,
  STREET_NAME_GLYPH_HEIGHT_METRES,
  STREET_NAME_GLYPHS_PER_FRAME,
  STREET_NAME_MOUTH_METRES,
  STREET_NAME_REPEAT_METRES,
  STREET_NAMES_PER_FRAME,
  streetNameLabels,
  streetNamesInView,
  type StreetNameLabel,
} from '../street-names';
import { corridorOrigin, localGroundPosition } from '../terrain';
import { StreetNameBelt } from '../three-renderer';
import { createOpenWorldEntry } from './entry';
import {
  fixturePosition,
  fixtureStart,
  GRID_COLUMN_NAMES,
  GRID_COLUMNS,
  GRID_ROW_NAMES,
  GRID_ROWS,
  OPEN_WORLD_GRID_STREETS,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { createOpenWorldSession } from './session';
import { lazyOpenWorldSessions } from './session-lazy';

const inputs: SceneInput[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

describe('where a street’s name is painted — #3052', () => {
  /** A straight street east, `metres` long, in local metres (`x` WEST). */
  const street = (id: string, metres: number, name?: string) => ({
    id,
    line: [0, 0, -metres, 0],
    ...(name === undefined ? {} : { name }),
  });

  it('paints a named street at each mouth, clear of the junction, and every 200 m between', () => {
    const labels = streetNameLabels([street('a', 900, 'Main Street')]);
    const half = paintedLength('Main Street') / 2;
    // From the west end: x is WEST, so a street drawn east runs to −x.
    const along = labels.map((label) => -label.x);
    expect(along[0]).toBeCloseTo(STREET_NAME_MOUTH_METRES + half, 6);
    expect(along.at(-1)).toBeCloseTo(900 - STREET_NAME_MOUTH_METRES - half, 6);
    for (let index = 1; index < along.length - 1; index += 1) {
      expect((along[index] as number) - (along[index - 1] as number)).toBeCloseTo(
        STREET_NAME_REPEAT_METRES,
        6,
      );
    }
    expect(labels.length).toBe(5);
    for (const label of labels) {
      expect(label.text).toBe('Main Street');
      expect([label.alongX, label.alongZ]).toStrictEqual([-1, 0]);
    }
  });

  it('paints nothing on an unnamed street, a blank name, a name the atlas cannot paint, or a street too short for its name', () => {
    expect(
      streetNameLabels([
        street('unnamed', 500),
        street('blank', 500, '   '),
        street('script', 500, 'Улица Ленина'),
        street(
          'short',
          paintedLength('Main Street') + 2 * STREET_NAME_MOUTH_METRES - 1,
          'Main Street',
        ),
      ]),
    ).toStrictEqual([]);
    // Control: the same short street, a metre longer, takes its name.
    expect(
      streetNameLabels([
        street(
          'fits',
          paintedLength('Main Street') + 2 * STREET_NAME_MOUTH_METRES + 1,
          'Main Street',
        ),
      ]),
    ).toHaveLength(1);
  });

  it('reads from the rider’s side: the letters’ tops away from them, and laid on the street', () => {
    const [label] = streetNameLabels([street('a', 100, 'Oak')]) as [StreetNameLabel];
    for (const side of [-1, 1]) {
      const rider = { x: label.x, z: label.z + side * 30 };
      const view = streetNamesInView([label], rider, side === -1 ? 0 : 1_000, () => 0);
      const corners = view.corners;
      // Bottom-left (0) to top-left (3) of the first letter: away from the rider.
      const upZ = (corners[3 * 3 + 2] as number) - (corners[2] as number);
      expect(Math.sign(upZ)).toBe(-side);
      expect(Math.abs(upZ)).toBeCloseTo(STREET_NAME_GLYPH_HEIGHT_METRES, 6);
      // Every corner on the street's own surface, across its line by at most half a letter.
      for (let at = 0; at < corners.length; at += 3) {
        expect(Math.abs((corners[at + 2] as number) - label.z)).toBeLessThanOrEqual(
          STREET_NAME_GLYPH_HEIGHT_METRES / 2 + 1e-9,
        );
        expect(corners[at + 1]).toBeGreaterThan(0);
      }
    }
  });

  it('draws at most a frame’s names and letters, the nearest first, however many streets are named', () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      street(`s${String(index)}`, 120, `Street Number ${String(index)}`),
    ).map((each, index) => ({
      ...each,
      line: [0, index * 2, -120, index * 2],
    }));
    const labels = streetNameLabels(many);
    expect(labels.length).toBeGreaterThan(STREET_NAMES_PER_FRAME * 10);
    const view = streetNamesInView(labels, { x: -60, z: 0 }, 0, () => 0);
    expect(view.labels).toHaveLength(STREET_NAMES_PER_FRAME);
    expect(view.cells.length).toBeLessThanOrEqual(STREET_NAME_GLYPHS_PER_FRAME);
    expect(view.corners.length).toBe(view.cells.length * 12);
    // The nearest: every label drawn is no farther than every label left out.
    const gap = (label: StreetNameLabel): number => Math.hypot(label.x + 60, label.z);
    const farthest = Math.max(...view.labels.map(gap));
    const left = labels.filter((label) => !view.labels.includes(label));
    expect(Math.min(...left.map(gap))).toBeGreaterThanOrEqual(farthest);
  });
});

describe('the names cost one draw call however many streets are named — #3052', () => {
  it('draws every name in view as one mesh, one material and no groups: one call', () => {
    // The belt's own mesh, read back: `three-seam.test.ts` keeps `three` to
    // the renderer, so no scene is built here. The belt adds exactly this one
    // mesh to the view's scene (`StreetNameBelt.addTo`).
    const belt = new StreetNameBelt(undefined);
    const mesh = belt.mesh;
    for (const count of [1, 40, 400]) {
      const streets = Array.from({ length: count }, (_, index) => ({
        id: `s${String(index)}`,
        line: [0, index * 3, -150, index * 3],
        name: `Street ${String(index)}`,
      }));
      const view = streetNamesInView(streetNameLabels(streets), { x: -75, z: 0 }, count, () => 0);
      belt.update(view, 'stylised');
      // The same one mesh whatever the count, drawn in one material with no groups.
      expect(belt.mesh).toBe(mesh);
      expect(mesh.visible).toBe(true);
      expect(Array.isArray(mesh.material)).toBe(false);
      expect(mesh.geometry.groups).toHaveLength(0);
      // Every letter in view is in that one mesh: two triangles a letter.
      expect(view.cells.length).toBeGreaterThan(0);
      expect(mesh.geometry.index?.count).toBe(view.cells.length * 6);
    }
    // A frame that names nothing draws nothing.
    belt.update(undefined, 'stylised');
    expect(mesh.visible).toBe(false);
    belt.dispose();
  });
});

// --- Through the real game screen and the real session ---------------------

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
const frames: { readonly frame: SceneFrame; readonly input: SceneInput }[] = [];

beforeEach(() => {
  inputs.length = 0;
  frames.length = 0;
  pending = [];
  nowMs = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom's `Blob` has no `stream()`, which the fixture archive's gzip uses.
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function pump(frameMs: number): Promise<void> {
  const next = pending.shift();
  if (next === undefined) return;
  nowMs += frameMs;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
  });
}

function capturingRenderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        const input = inputs[inputs.length - 1];
        if (input !== undefined) frames.push({ frame, input });
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

async function rideTheNamedGrid(
  metres: number,
  options: {
    readonly riddenBlocks?: RiddenBlockCacheOptions;
    readonly source?: CountingSource;
  } = {},
): Promise<void> {
  const source =
    options.source ?? countingSource(await openWorldFixtureArchive(OPEN_WORLD_GRID_STREETS));
  const entry = createOpenWorldEntry();
  entry.hand(fixtureStart(START_COLUMN, START_ROW));
  const port: GamePort = {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: lazyOpenWorldSessions(
      {
        entry,
        basemap: () => ({ archiveUrl: 'https://tiles.example.invalid/a.pmtiles', attribution: '' }),
        mapTilesOn: () => true,
      },
      () =>
        Promise.resolve((start) =>
          createOpenWorldSession({
            start,
            archive: corridorArchiveFrom(source),
            mapTilesOn: () => true,
            yieldToIdle: () => Promise.resolve(),
            riddenBlocks: options.riddenBlocks,
          }),
        ),
    ),
  };
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(capturingRenderer())}
      now={() => nowMs}
    />,
  );
  const ride = (): HTMLButtonElement | undefined =>
    queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
  for (let tries = 0; tries < 400 && ride()?.textContent !== 'Ride Open world'; tries++) {
    await settle();
  }
  expect(ride()?.textContent).toBe('Ride Open world');
  await act(async () => {
    ride()?.click();
    await Promise.resolve();
  });
  await settle();
  const odometer = (): number =>
    (inputs[inputs.length - 1]?.state.ride.distance as number | undefined) ?? 0;
  for (let frame = 0; frame < 400 && odometer() < metres; frame += 1) await pump(500);
  expect(odometer()).toBeGreaterThanOrEqual(metres);
}

/** Every fixture street as a segment in `input`'s local metres, with its name. */
function fixtureStreets(input: SceneInput) {
  const origin = corridorOrigin(input.profile);
  const local = (column: number, row: number) =>
    localGroundPosition(origin, fixturePosition(column, row));
  return [
    ...GRID_ROWS.map((row, index) => ({
      name: GRID_ROW_NAMES[index],
      a: local(-4000, row),
      b: local(3500, row),
    })),
    ...GRID_COLUMNS.map((column, index) => ({
      name: GRID_COLUMN_NAMES[index],
      a: local(column, 300),
      b: local(column, 7900),
    })),
  ];
}

function toSegment(
  x: number,
  z: number,
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
): number {
  const span = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
  const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / span));
  return Math.hypot(x - a.x - t * (b.x - a.x), z - a.z - t * (b.z - a.z));
}

/** The fixture street nearest `(x, z)` among those running along `(alongX, alongZ)`, and how far. */
function streetUnder(
  streets: ReturnType<typeof fixtureStreets>,
  x: number,
  z: number,
  alongX: number,
  alongZ: number,
) {
  let best: { name: string | undefined; distance: number } | undefined;
  for (const each of streets) {
    const length = Math.hypot(each.b.x - each.a.x, each.b.z - each.a.z);
    const parallel =
      Math.abs(((each.b.x - each.a.x) * alongX + (each.b.z - each.a.z) * alongZ) / length) > 0.99;
    if (!parallel) continue;
    const distance = toSegment(x, z, each.a, each.b);
    if (best === undefined || distance < best.distance) best = { name: each.name, distance };
  }
  return best;
}

describe('street names through the real game screen and session — #3052', () => {
  it('lays every name on its own street, and none on the two streets the map does not name', async () => {
    await rideTheNamedGrid(150);
    const last = frames[frames.length - 1];
    if (last === undefined) throw new Error('no frame drawn');
    const streets = fixtureStreets(last.input);
    // What the game handed the scene: every name the held graph paints.
    const labels = last.input.streetNames ?? [];
    const texts = new Set(labels.map((label) => label.text));
    // Not vacuous: the streets either side of the unnamed column are named and held.
    for (const named of [
      'Main Street',
      'Oak Street',
      'Elm Street',
      'Pine Street',
      'First Avenue',
    ]) {
      expect(texts.has(named), named).toBe(true);
    }
    for (const label of labels) {
      const under = streetUnder(streets, label.x, label.z, label.alongX, label.alongZ);
      expect(under?.name, `${label.key}: ${label.text}`).toBe(label.text);
      expect(under?.distance, label.key).toBeLessThan(0.5);
    }
    // What the renderer was handed: the nearest names, every letter on its street.
    const view = last.frame.streetNames;
    expect(view?.labels.length ?? 0).toBeGreaterThan(0);
    let letter = 0;
    for (const label of view?.labels ?? []) {
      for (let each = 0; each < Array.from(label.text).length; each += 1, letter += 1) {
        for (let corner = 0; corner < 4; corner += 1) {
          const at = (letter * 4 + corner) * 3;
          const x = view?.corners[at] as number;
          const z = view?.corners[at + 2] as number;
          const under = streetUnder(streets, x, z, label.alongX, label.alongZ);
          expect(under?.name).toBe(label.text);
          expect(under?.distance).toBeLessThanOrEqual(STREET_NAME_GLYPH_HEIGHT_METRES / 2 + 0.5);
        }
      }
    }
    expect(letter).toBe(view?.cells.length);
  });

  it('names each way in the junction prompt by its street', async () => {
    // 60 m on, inside the first crossroads' 250 m prompt and short of its
    // lock: Oak Street crosses Main Street there.
    await rideTheNamedGrid(60);
    const ways = queryAll<HTMLButtonElement>(
      document,
      '.oyl-hud__junction-popup button[data-oyl-way]',
    ).map((button) => button.textContent ?? '');
    expect(ways.some((text) => text.includes('onto Oak Street'))).toBe(true);
    expect(ways.some((text) => text.includes('along Main Street'))).toBe(true);
  });
});

describe('a ridden block shows the same names as a fresh read — #2891, ADR 0098', () => {
  let harness: ReturnType<typeof createStoreHarness>;
  const handles: ActivityStore[] = [];

  beforeEach(async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    await harness.discard();
  });

  afterEach(async () => {
    for (const store of handles.splice(0)) store.close();
    await harness.destroy();
  });

  /** The ridden-block cache over a fresh handle on the harness's database. */
  function riddenBlocks(): RiddenBlockCacheOptions {
    const store = openActivityStore(harness.databaseName);
    handles.push(store);
    return {
      store,
      owner: ATHLETE_A,
      archiveUrl: 'https://tiles.example.invalid/a.pmtiles',
      now: () => new Date('2026-11-25T09:00:00Z'),
    };
  }

  /** What the scene was handed to paint, and what the junction prompt says, after 60 m. */
  async function namesAfter60m(options: Parameters<typeof rideTheNamedGrid>[1]) {
    frames.length = 0;
    inputs.length = 0;
    await rideTheNamedGrid(60, options);
    const labels = (frames[frames.length - 1]?.input.streetNames ?? []).map((label) => ({
      text: label.text,
      x: label.x,
      z: label.z,
    }));
    const ways = queryAll<HTMLButtonElement>(
      document,
      '.oyl-hud__junction-popup button[data-oyl-way]',
    ).map((button) => button.textContent ?? '');
    mounted?.unmount();
    mounted = undefined;
    return { labels, ways };
  }

  it('paints the same names on the road, and says them in the prompt, with no request for the kept blocks', async () => {
    const fresh = await namesAfter60m({ riddenBlocks: riddenBlocks() });
    // Not vacuous: the fresh ride named streets on the road and in the prompt.
    expect(fresh.labels.map((label) => label.text)).toContain('Main Street');
    expect(fresh.ways.some((text) => text.includes('onto Oak Street'))).toBe(true);
    for (const store of handles.splice(0)) store.close();

    // Ride 2, on a fresh handle, every block of the fixture kept by ride 1.
    const source = countingSource(await openWorldFixtureArchive(OPEN_WORLD_GRID_STREETS));
    const kept = await namesAfter60m({ riddenBlocks: riddenBlocks(), source });
    expect(source.calls).toStrictEqual([]);
    // The same names, in the same order, each where the fresh read put it to
    // the centimetre the cache packs to.
    expect(kept.labels.map((label) => label.text)).toStrictEqual(
      fresh.labels.map((label) => label.text),
    );
    for (const [index, label] of kept.labels.entries()) {
      const was = fresh.labels[index];
      expect(Math.abs(label.x - (was?.x ?? Infinity)), label.text).toBeLessThanOrEqual(0.01);
      expect(Math.abs(label.z - (was?.z ?? Infinity)), label.text).toBeLessThanOrEqual(0.01);
    }
    expect(kept.ways).toStrictEqual(fresh.ways);
  });
});
