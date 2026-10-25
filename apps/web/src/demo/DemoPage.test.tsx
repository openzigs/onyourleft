// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The demo page — #1647: its controls, reduced motion, hidden-means-paused
 * and the refused query, driven through the page with the renderer and the
 * frame clock replaced. Every distance is read off the published snapshot,
 * which is what the demo's browser gate (#1648) reads.
 */

import { Blob as NodeBlob } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  bakeFixtureRouteInto,
  expectedRouteCounts,
  routeFilesIn,
} from '../../browser/demo-route-fixture';
import type { RealisticWorldOutcome } from '../game/realistic-assets';
import { ODBL_LICENCE_URL, OSM_ATTRIBUTION } from '../map/basemap';
import { OSM_COPYRIGHT_URL } from '../../tools/demo/route-bundle';
import { BAKED_ROUTE_UNAVAILABLE, type ReadDemoFile } from './baked-route';

import { CONTROL_MINIMUM_PIXELS } from '../game/hud/HudCore';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { DemoPage } from './DemoPage';
import { REFERENCE_ASPECT } from '../game/camera';
import type { SceneFrame } from '../game/port';
import { projectThrough } from './camera-tour-testing';
import type { DemoSnapshot } from './stage';
import { fakeDrawnSeason, fakeDrawnWorld, fakeRenderer, SteppedFrames } from './stage-testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  Reflect.deleteProperty(document, 'visibilityState');
});

interface Page {
  readonly frames: SteppedFrames;
  readonly last: () => DemoSnapshot | undefined;
  readonly button: (name: string) => HTMLButtonElement | undefined;
  readonly step: (steps: number) => Promise<void>;
  readonly setInView: (inView: boolean) => void;
  /** The last frame the renderer was handed. */
  readonly drawn: () => SceneFrame | undefined;
}

/** A reader with no files: the synthetic road's cases never ask it for one. */
const NO_FILES: ReadDemoFile = (path) => Promise.reject(new Error(`no ${path}`));

interface PageOptions {
  readonly search?: string;
  readonly reducedMotion?: boolean;
  readonly readFile?: ReadDemoFile;
  /** What the realistic world's load comes to; never, by default. */
  readonly outcome?: Promise<RealisticWorldOutcome>;
}

async function page(options: PageOptions = {}): Promise<Page> {
  const frames = new SteppedFrames();
  const { renderer, views } = fakeRenderer(options.outcome ?? new Promise(() => undefined));
  const snapshots: DemoSnapshot[] = [];
  let inViewChange: ((inView: boolean) => void) | undefined;
  mounted = await mount(
    <DemoPage
      search={options.search ?? '?preset=climb'}
      renderer={renderer}
      drawnWorld={fakeDrawnWorld}
      frames={frames}
      reducedMotion={options.reducedMotion ?? false}
      observeInView={(_element, onChange) => {
        inViewChange = onChange;
        return () => {
          inViewChange = undefined;
        };
      }}
      publish={(snapshot) => void snapshots.push(snapshot)}
      readFile={options.readFile ?? NO_FILES}
      drawnSeason={fakeDrawnSeason}
    />,
  );
  await settle();
  const container = mounted.container;
  return {
    frames,
    last: () => snapshots.at(-1),
    button: (name) =>
      [...container.querySelectorAll('button')].find((each) => each.textContent === name),
    step: async (steps) => {
      await act(async () => {
        frames.step(steps);
        await Promise.resolve();
      });
    },
    setInView: (inView) => inViewChange?.(inView),
    drawn: () => views[0]?.rendered.at(-1),
  };
}

/** 60 Hz steps in two seconds of clock. */
const TWO_SECONDS = 120;

describe('the demo page — #1647', () => {
  it('rides the preset its query names', async () => {
    const shown = await page({ search: '?preset=group' });
    await shown.step(60);
    expect(shown.last()).toMatchObject({ preset: 'group', state: 'playing' });
    expect(shown.last()?.distance).toBeGreaterThan(30);
  });

  it('pause holds the distance for 2 s of clock, and play resumes from the same distance', async () => {
    const shown = await page();
    await shown.step(300);
    const pause = shown.button('Pause');
    expect(pause).toBeDefined();
    await activateWithKeyboard(pause as HTMLButtonElement);
    await shown.step(1);
    const held = shown.last()?.distance ?? Number.NaN;
    expect(held).toBeGreaterThan(0);
    expect(shown.last()?.state).toBe('paused');
    await shown.step(TWO_SECONDS);
    expect(shown.last()?.distance).toBe(held);
    const play = shown.button('Play');
    expect(play).toBeDefined();
    await activateWithKeyboard(play as HTMLButtonElement);
    await shown.step(1);
    expect(shown.last()?.distance).toBe(held);
    await shown.step(60);
    expect(shown.last()?.distance).toBeGreaterThan(held);
    expect((shown.last()?.distance ?? 0) - held).toBeLessThan(15);
  });

  it('stop returns to the start line and stays there', async () => {
    const shown = await page();
    await shown.step(120);
    await activateWithKeyboard(shown.button('Stop') as HTMLButtonElement);
    await shown.step(TWO_SECONDS);
    expect(shown.last()).toMatchObject({ state: 'stopped', distance: 0 });
    expect(shown.button('Play')).toBeDefined();
  });

  it('with reduced motion, starts paused on a still frame until Play is pressed', async () => {
    const shown = await page({ reducedMotion: true });
    await shown.step(TWO_SECONDS);
    expect(shown.last()).toMatchObject({ state: 'paused', distance: 0 });
    expect(shown.last()?.framesDrawn).toBe(1);
    expect(shown.button('Pause')).toBeUndefined();
    const play = shown.button('Play');
    expect(play).toBeDefined();
    await activateWithKeyboard(play as HTMLButtonElement);
    await shown.step(60);
    expect(shown.last()?.state).toBe('playing');
    expect(shown.last()?.distance).toBeGreaterThan(0);
  });

  it('runs no frame callback while the page is hidden', async () => {
    const shown = await page();
    await shown.step(30);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const ran = shown.frames.ran;
    await shown.step(TWO_SECONDS);
    expect(shown.frames.ran).toBe(ran);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await shown.step(5);
    expect(shown.frames.ran).toBeGreaterThan(ran);
  });

  it('keeps its status region mounted, empty, before there is anything to say', async () => {
    await page();
    const region = mounted?.container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
  });

  it.each([
    [true, 'the overhead shot itself, the rider centred'],
    [false, 'half way through the blend into it'],
  ])(
    'with reduced motion %s, half a second into the overhead shot is %s — #1649',
    async (reducedMotion) => {
      const shown = await page({ reducedMotion });
      if (reducedMotion) await activateWithKeyboard(shown.button('Play') as HTMLButtonElement);
      // `camera-tour.ts` §`DEMO_TOURS`: the climb's overhead shot starts at 20 s.
      await act(async () => {
        shown.frames.step(42, 500);
        await Promise.resolve();
      });
      const frame = shown.drawn();
      const rider = frame?.markers[0];
      if (frame === undefined || rider === undefined) throw new Error('nothing drawn');
      const at = projectThrough(
        frame.camera,
        { x: rider.x, y: rider.y + 1, z: rider.z },
        REFERENCE_ASPECT,
      );
      const offCentre = Math.abs(at.x) + Math.abs(at.y);
      if (reducedMotion) expect(offCentre).toBeLessThan(1e-6);
      else expect(offCentre).toBeGreaterThan(0.02);
    },
  );

  it('runs no frame callback when the page loads in a hidden tab', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const shown = await page();
    await shown.step(TWO_SECONDS);
    expect(shown.frames.ran).toBe(0);
  });

  it('runs no frame callback while the canvas is out of view', async () => {
    const shown = await page();
    await shown.step(30);
    shown.setInView(false);
    const ran = shown.frames.ran;
    await shown.step(TWO_SECONDS);
    expect(shown.frames.ran).toBe(ran);
    shown.setInView(true);
    await shown.step(5);
    expect(shown.frames.ran).toBeGreaterThan(ran);
  });

  it('sizes its controls as the ride HUD sizes its own', async () => {
    const shown = await page();
    for (const name of ['Pause', 'Stop']) {
      const button = shown.button(name);
      expect(button?.type).toBe('button');
      expect(button?.style.minWidth).toBe(`${CONTROL_MINIMUM_PIXELS}px`);
      expect(button?.style.minHeight).toBe(`${CONTROL_MINIMUM_PIXELS}px`);
    }
  });

  it.each([
    ['an unknown parameter', '?preset=climb&speed=2', 'This demo has no setting called “speed”.'],
    [
      'an unknown preset',
      '?preset=sprnt',
      'This demo’s preset is one of climb, sprint, group, not “sprnt”.',
    ],
  ])('refuses %s, visibly, and rides nothing', async (_what, search, message) => {
    const shown = await page({ search });
    await shown.step(10);
    const shownText = [...document.querySelectorAll('main > p')].map((each) => each.textContent);
    expect(shownText).toContain(message);
    expect(document.querySelector('canvas')).toBeNull();
    expect(shown.last()).toBeUndefined();
    expect(shown.frames.requested).toBe(0);
  });
});

describe('the demo page on a baked route — #1652', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-page-'));
  let files: Map<string, Uint8Array<ArrayBuffer>>;
  let bundlePath = '';

  // `corridor.ts` gzips and gunzips through `Blob.stream`, which a browser's
  // `Blob` has and jsdom's lacks: Node's own, for the bake and the page's
  // loader, as the browser gate (`shell-demo.browser.spec.ts`) has a real one.
  beforeAll(async () => {
    vi.stubGlobal('Blob', NodeBlob);
    bundlePath = `./routes/${(await bakeFixtureRouteInto(scratch)).file}`;
    files = routeFilesIn(scratch);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(scratch, { recursive: true, force: true });
  });

  const served =
    (overrides: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map()): ReadDemoFile =>
    (path) => {
      const bytes = overrides.get(path) ?? files.get(path);
      return bytes === undefined ? Promise.reject(new Error(path)) : Promise.resolve(bytes);
    };

  /** Settle until `done`, the loader's digest and gunzip taking a few turns. */
  async function until(done: () => boolean): Promise<void> {
    for (let turn = 0; turn < 50 && !done(); turn += 1) await settle();
    expect(done()).toBe(true);
  }

  const credit = (): string | null | undefined =>
    mounted?.container.querySelector('.oyl-hud__attribution')?.textContent;
  const status = (): string | null | undefined =>
    mounted?.container.querySelector('[role="status"]:not([data-oyl-announcer])')?.textContent;

  it('rides the route, reports its corridor’s counts, and credits OpenStreetMap', async () => {
    const shown = await page({ search: '?preset=climb&route=fixture', readFile: served() });
    await until(() => shown.last()?.mapData !== undefined);
    await shown.step(10);
    expect(shown.last()?.mapData).toEqual({ route: 'fixture', counts: expectedRouteCounts() });
    expect(shown.last()?.mappedBuildings).toBeGreaterThan(0);
    expect(credit()).toBe(OSM_ATTRIBUTION);
  });

  it('keeps the credit for the whole run when the world drawn is the stylised one', async () => {
    const shown = await page({
      search: '?preset=climb&route=fixture',
      readFile: served(),
      outcome: Promise.resolve({ loaded: false, offline: false, detail: 'refused' }),
    });
    await until(() => shown.last()?.mapData !== undefined);
    await shown.step(10);
    expect(shown.last()?.world).toBe('stylised');
    expect(credit()).toBe(OSM_ATTRIBUTION);
  });

  it('offers the ODbL notice, the licence and the file from a keyboard-reachable “Map data”', async () => {
    const shown = await page({ search: '?preset=climb&route=fixture', readFile: served() });
    await until(() => shown.last()?.mapData !== undefined);
    const summary = [...document.querySelectorAll('summary')].find(
      (each) => each.textContent === 'Map data',
    );
    if (summary === undefined) throw new Error('no “Map data” disclosure');
    const details = summary.parentElement as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await activateWithKeyboard(summary);
    expect(details.open).toBe(true);
    expect(details.textContent).toContain(
      'Contains information from OpenStreetMap, which is made available here under the Open Database License (ODbL).',
    );
    const links = [...details.querySelectorAll('a')].map((each) => each.getAttribute('href'));
    expect(links).toEqual([
      OSM_COPYRIGHT_URL,
      ODBL_LICENCE_URL,
      ODBL_LICENCE_URL,
      bundlePath,
      './routes/LICENCE-ODbL.txt',
    ]);
  });

  it('on the synthetic road shows no credit and no “Map data”: nothing is owed', async () => {
    const shown = await page({ search: '?preset=climb' });
    await shown.step(10);
    expect(shown.last()?.mapData).toBeUndefined();
    expect(credit()).toBeUndefined();
    expect(document.querySelector('summary')).toBeNull();
    expect(mounted?.container.textContent).not.toMatch(/OpenStreetMap/);
  });

  it('rides the synthetic road on a truncated file, and says so — never a crash', async () => {
    const whole = files.get(bundlePath) as Uint8Array<ArrayBuffer>;
    const shown = await page({
      search: '?preset=climb&route=fixture',
      readFile: served(new Map([[bundlePath, whole.slice(0, whole.length >> 1)]])),
    });
    await until(() => shown.last() !== undefined);
    await shown.step(60);
    expect(shown.last()).toMatchObject({
      mapData: undefined,
      mappedBuildings: 0,
      state: 'playing',
    });
    expect(shown.last()?.distance).toBeGreaterThan(0);
    expect(status()).toBe(BAKED_ROUTE_UNAVAILABLE);
    expect(credit()).toBeUndefined();
    expect(document.querySelector('summary')).toBeNull();
  });
});

describe('the demo page’s showcase — #1653', () => {
  const caption = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.oyl-demo__caption');

  it('captions its moments in a polite status region in the HUD’s tokens, mounted before it has text', async () => {
    const shown = await page({ search: '?showcase', outcome: Promise.resolve({ loaded: true }) });
    expect(caption()?.getAttribute('role')).toBe('status');
    expect(caption()?.getAttribute('aria-live')).toBeNull();
    expect(caption()?.textContent).toBe('');
    expect(caption()?.style.background).toBe('var(--oyl-color-hud-surface)');
    expect(caption()?.style.color).toBe('var(--oyl-color-hud-ink)');
    await act(async () => {
      shown.frames.step(2, 1000);
      await Promise.resolve();
    });
    expect(shown.last()?.preset).toBe('group');
    expect(caption()?.textContent).toBe('The stylised world');
    expect(shown.last()?.showcase?.caption).toBe('The stylised world');
    await act(async () => {
      shown.frames.step(5, 1000);
      await Promise.resolve();
    });
    expect(caption()?.textContent).toBe('');
  });

  it('has no caption region, and runs no timeline, without ?showcase', async () => {
    const shown = await page({ search: '?preset=group' });
    await shown.step(10);
    expect(caption()).toBeNull();
    expect(shown.last()?.showcase).toBeUndefined();
    expect(shown.last()?.skipped).toEqual([]);
  });
});
