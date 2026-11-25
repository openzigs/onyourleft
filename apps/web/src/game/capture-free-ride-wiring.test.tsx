// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3154's wiring: a free-ride capture, opened as the capture tool opens it
 * (`tools/capture/capture-args.ts` §`captureHash`, with the command's
 * `--start`), ridden through the real `GameView`, the real open-world session
 * and the product's archive reader and decoder over the open world's
 * invented fixture block of named streets (`open-world/fixture-testing.ts`:
 * no OpenStreetMap data), on the capture's stepped clock.
 *
 * What is read back: the junction prompt in the DOM and the turn the script
 * pressed in it, the event log the page publishes, the page's text, and the
 * names the renderer was handed to paint on the road — every one of them a
 * placeholder, and none the map's. The control is the same ride with no
 * capture, which shows the map's names: so this test can see them.
 */

import { Blob as NodeBlob } from 'node:buffer';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';

import { installCaptureClock, type CaptureClockControl } from '../../tools/capture/capture-clock';
import { captureHash, captureRideName } from '../../tools/capture/capture-args';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { countingSource } from '../world-data/archive-testing';
import { corridorArchiveFrom } from '../world-data/corridor-source';

import { CAPTURE_STREET_NAMES } from './capture-free-ride';
import { CAPTURE_MODE, type CaptureEvent, type CaptureTarget } from './capture-scene';
import { GameView, type GamePort } from './GameView';
import { createOpenWorldEntry } from './open-world/entry';
import {
  fixturePosition,
  fixtureStart,
  GRID_COLUMN_NAMES,
  GRID_ROW_NAMES,
  OPEN_WORLD_GRID_STREETS,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from './open-world/fixture-testing';
import { createOpenWorldSession } from './open-world/session';
import { lazyOpenWorldSessions } from './open-world/session-lazy';
import type { OpenWorldStart } from './open-world/start';
import type { GameRenderer, SceneFrame } from './port';

/** Every name the fixture's map gives a street. */
const MAPPED = [...GRID_ROW_NAMES, ...GRID_COLUMN_NAMES].filter(
  (name): name is string => name !== undefined,
);
/** The fixture's start pin, as the capture command's `--start` writes it. */
const START = ((position) => `${String(position.latitude)},${String(position.longitude)}`)(
  fixturePosition(START_COLUMN, START_ROW),
);
const STEP_MS = 250;

/** Every name the renderer was handed to paint on the road, over the ride. */
const painted = new Set<string>();
/** How many times the archive was read. */
let reads = 0;

async function gamePort(handed?: OpenWorldStart): Promise<GamePort> {
  const entry = createOpenWorldEntry();
  if (handed !== undefined) entry.hand(handed);
  const source = countingSource(await openWorldFixtureArchive(OPEN_WORLD_GRID_STREETS));
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: lazyOpenWorldSessions(
      {
        // On a capture nothing is handed over by a picker: the start is the command's.
        entry,
        basemap: () => ({ archiveUrl: 'https://tiles.example.invalid/a.pmtiles', attribution: '' }),
        mapTilesOn: () => true,
      },
      () =>
        Promise.resolve((start, extras) =>
          createOpenWorldSession({
            start,
            archive: corridorArchiveFrom({
              ...source,
              getBytes: (...args: Parameters<typeof source.getBytes>) => {
                reads += 1;
                return source.getBytes(...args);
              },
            }),
            mapTilesOn: () => true,
            yieldToIdle: () => Promise.resolve(),
            streetName: extras?.streetName,
          }),
        ),
    ),
  };
}

function renderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        for (const label of frame.streetNames?.labels ?? []) painted.add(label.text);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** A stand-in window on the capture clock, as `capture-wiring.test.tsx`'s. */
function stage(): { readonly clock: CaptureClockControl; readonly now: () => number } {
  let nextFrame = 0;
  const target = {
    performance: { now: () => 0 },
    Date,
    requestAnimationFrame: (): number => {
      nextFrame += 1;
      return nextFrame;
    },
    cancelAnimationFrame: () => undefined,
    setTimeout: (handler: unknown, timeout?: number) =>
      setTimeout(handler as () => void, timeout) as unknown as number,
    clearTimeout: (handle?: number) => {
      clearTimeout(handle);
    },
    setInterval: (handler: unknown, timeout?: number) =>
      setInterval(handler as () => void, timeout) as unknown as number,
    clearInterval: (handle?: number) => {
      clearInterval(handle);
    },
  };
  const clock = installCaptureClock(target);
  vi.stubGlobal('requestAnimationFrame', target.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', target.cancelAnimationFrame);
  return { clock, now: () => target.performance.now() };
}

function published(): CaptureTarget['__oylCapture'] {
  return (globalThis as CaptureTarget).__oylCapture;
}

let mounted: Mounted | undefined;

beforeEach(() => {
  painted.clear();
  reads = 0;
  vi.stubEnv('MODE', CAPTURE_MODE);
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  globalThis.location.hash = '';
  delete (globalThis as CaptureTarget).__oylCapture;
});

function rideButton(name: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (button) => button.textContent === name,
  );
}

/** The junction prompt's ways, as their buttons read. */
function ways(): string[] {
  return queryAll<HTMLButtonElement>(
    mounted?.container ?? document,
    '.oyl-hud__junction-popup button[data-oyl-way]',
  ).map((button) => button.textContent ?? '');
}

/**
 * Open `hash` as the capture tool does, press *Ride Open world* on held
 * clocks, then step `steps` frames, telling `onFrame` after each.
 */
async function ride(
  hash: string,
  steps: number,
  onFrame: (frame: number) => void = () => undefined,
  handed?: OpenWorldStart,
): Promise<readonly CaptureEvent[]> {
  const on = stage();
  globalThis.location.hash = hash;
  const port = await gamePort(handed);
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer())}
      now={on.now}
      riderMass={kilograms(72)}
    />,
  );
  const name = `Ride ${captureRideName('free-ride')}`;
  for (let tries = 0; tries < 400 && rideButton(name) === undefined; tries += 1) await settle();
  expect(rideButton(name), name).toBeDefined();
  on.clock.hold();
  await act(async () => {
    rideButton(name)?.click();
    await Promise.resolve();
  });
  await settle();
  for (
    let tries = 0;
    tries < (handed === undefined ? 40 : 4) && (published()?.drawn ?? 0) === 0;
    tries += 1
  ) {
    await act(async () => {
      on.clock.frame();
      await Promise.resolve();
    });
    await settle();
  }
  for (let frame = 1; frame <= steps; frame += 1) {
    await act(async () => {
      on.clock.step(STEP_MS);
      await Promise.resolve();
    });
    await settle();
    onFrame(frame);
  }
  return published()?.events ?? [];
}

describe('a free-ride capture — #3154', () => {
  it('rides the open world from the command’s start, read from the archive it is handed, and takes the scripted turn at the junction', async () => {
    const shown: string[][] = [];
    const chosen: string[] = [];
    const events = await ride(captureHash('free-ride', START), 200, () => {
      if (ways().length > 0) shown.push(ways());
      chosen.push(
        mounted?.container.querySelector('.oyl-hud__junction-way--chosen .oyl-hud__junction-word')
          ?.textContent ?? '-',
      );
    });
    expect(reads).toBeGreaterThan(0);
    // The junction prompt came up, and the scripted left was pressed in it.
    expect(shown.length).toBeGreaterThan(0);
    const turns = events.filter((event) => event.kind === 'cue' && event.cue === 'turn');
    expect(turns.map((event) => event.kind === 'cue' && event.taken)).toEqual([true, true]);
    const [left, right] = turns.map((event) => event.frame) as [number, number];
    // The left at the first junction, pressed on its frame…
    expect([chosen[left - 2], chosen[left - 1]]).toEqual(['Straight on', 'Left']);
    // …and the right at the next one, never the same junction pressed twice.
    expect(right).toBeGreaterThan(left + 40);
    expect(chosen[right - 1]).toBe('Right');
    expect(published()?.drawn).toBe(201);
  });

  it('shows no street by the map’s name: the junction prompt, the page and the road read placeholders only', async () => {
    const shown = new Set<string>();
    await ride(captureHash('free-ride', START), 60, () => {
      for (const way of ways()) shown.add(way);
    });
    const page = document.body.textContent;
    for (const name of MAPPED) {
      expect(page, name).not.toContain(name);
      expect([...shown].join(' | '), name).not.toContain(name);
      expect([...painted], name).not.toContain(name);
    }
    // The placeholders are what was painted and offered, so the names were swapped, not dropped.
    expect([...painted].length).toBeGreaterThan(0);
    for (const text of painted) expect(CAPTURE_STREET_NAMES).toContain(text);
    expect([...shown].some((way) => CAPTURE_STREET_NAMES.some((name) => way.includes(name)))).toBe(
      true,
    );
  });

  it('the control: the same ride with no capture shows the map’s names, so this test can see them', async () => {
    const shown = new Set<string>();
    // An ordinary screen: its start handed over by the picker, as a rider's is.
    await ride(
      '#/game',
      60,
      () => {
        for (const way of ways()) shown.add(way);
      },
      fixtureStart(START_COLUMN, START_ROW),
    );
    expect(published()).toBeUndefined();
    expect(MAPPED.some((name) => painted.has(name))).toBe(true);
    expect([...shown].some((way) => MAPPED.some((name) => way.includes(name)))).toBe(true);
  });
});
