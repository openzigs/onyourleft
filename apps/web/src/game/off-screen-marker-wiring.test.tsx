// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2755's wiring: the marker at the world's edge for a pacer the rider has
 * dropped, laid by the real `GameView` from the frame it hands the renderer.
 *
 * `off-screen-marker.test.ts` holds the placement against frames built by
 * `scene.ts`; this file holds that `GameView` lays it at all — a correct,
 * tested marker wired to nothing is #278's defect shape — and that it is
 * drawing only: the same ride, ridden into a view that draws and into one
 * that cannot (`blind-view-wiring.test.tsx`'s pair), sends the trainer the
 * same writes on the same frames.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { OFF_SCREEN_MARKER_CLASS } from './off-screen-marker';
import type { GameRenderer, SceneFrame } from './port';
import { northRoute } from './route-fixtures-testing';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

const START_MS = 1_000_000;
const FRAME_MS = 250;
/** Twenty seconds: long enough for a strong rider to drop a weak pacer behind the camera. */
const FRAMES = 80;

const ROUTE: RidableRoute = {
  id: 'north',
  name: 'North road',
  profile: northRoute(2_000, (along) => 6 * Math.sin(along / 80)),
  attempts: 0,
};

/** A weak pacer, so a rider at {@link RIDER_WATTS} leaves it behind. */
const PACER_INTENSITY = '1';
const RIDER_WATTS = 420;

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
let sizeReads = 0;

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom lays nothing out, so the world's canvas is given the size of the
  // owner's small laptop window: the markers are placed from it.
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => {
      sizeReads += 1;
      return 1024;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight');
});

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(RIDER_WATTS), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 150, live: true, paired: true },
  }),
};

function toggle(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
    (input) => (input.closest('label')?.textContent ?? '').includes(words),
  );
}

function labelled(words: string): HTMLInputElement {
  const label = queryAll<HTMLLabelElement>(mounted?.container ?? document, 'label').find(
    (candidate) => candidate.textContent === words,
  );
  const control = label?.control;
  if (!(control instanceof HTMLInputElement)) throw new Error(`no control labelled “${words}”`);
  return control;
}

async function press(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) throw new Error('no such control');
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

function trainerPort(written: unknown[], frame: () => number): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      written.push({ parameters, frame: frame() });
      return Promise.resolve();
    },
    letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: async () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

function renderer(hasContext: boolean, rendered: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        rendered.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** One marker as the page has it, and the HUD's pacer field beside it. */
interface Seen {
  readonly markers: readonly {
    readonly to: string | undefined;
    readonly edge: string | undefined;
    readonly gap: string;
  }[];
  readonly pacerField: string;
  /** Reads of the world's size this frame. */
  readonly reads: number;
}

interface Ridden {
  readonly written: readonly unknown[];
  readonly seen: readonly Seen[];
  readonly layerHidden: string | null | undefined;
}

async function ride(hasContext: boolean, observed = false): Promise<Ridden> {
  if (observed) {
    // A browser's observer, which reports the size when it starts watching.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {}
        observe(): void {
          this.callback();
        }
        disconnect(): void {}
      },
    );
  }
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  const written: unknown[] = [];
  const rendered: SceneFrame[] = [];
  let frame = 0;
  mounted = await mount(
    <GameView
      port={PORT}
      trainer={trainerPort(written, () => frame)}
      renderer={() => Promise.resolve(renderer(hasContext, rendered))}
      now={() => nowMs}
    />,
  );
  await settle();
  await press(toggle('pacer'));
  const intensity = labelled('Pacer intensity, watts per kilogram');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    setter?.set?.call(intensity, PACER_INTENSITY);
    intensity.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await press(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  const seen: Seen[] = [];
  for (frame = 1; frame <= FRAMES; frame += 1) {
    const due = pending;
    if (due.length === 0) throw new Error(`the ride asked for no frame at ${String(frame)}`);
    pending = [];
    nowMs += FRAME_MS;
    sizeReads = 0;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
    const field = queryAll(mounted.container, '.oyl-hud__field').find(
      (each) => each.querySelector('dt')?.textContent === 'Pacer',
    );
    seen.push({
      markers: queryAll<HTMLElement>(mounted.container, `.${OFF_SCREEN_MARKER_CLASS}`).map(
        (each) => ({
          to: each.dataset.to,
          edge: each.dataset.edge,
          gap: each.textContent ?? '',
        }),
      ),
      pacerField: field?.querySelector('dd')?.textContent ?? '',
      reads: sizeReads,
    });
  }
  const layerHidden = mounted.container
    .querySelector('.oyl-game__off-screens')
    ?.getAttribute('aria-hidden');
  await settle();
  mounted.unmount();
  mounted = undefined;
  return { written, seen, layerHidden };
}

describe('the pacer’s marker at the world’s edge, through GameView — #2755', () => {
  it('is laid once the rider drops the pacer behind the camera, on the bottom edge, with the HUD’s gap — and is drawing only', async () => {
    const drawing = await ride(true);
    const blind = await ride(false);
    // Level at the start, so drawn in view, and no marker.
    expect(drawing.seen[0]?.markers).toEqual([]);
    const last = drawing.seen.at(-1);
    expect(last?.pacerField).toMatch(/^\d+\s*s\s*behind you$/);
    expect(last?.markers).toHaveLength(1);
    const marker = last?.markers[0];
    expect(marker?.to).toBe('bot');
    expect(marker?.edge).toBe('bottom');
    // The HUD's own number and unit, as it writes them in the pacer's field.
    expect(last?.pacerField.startsWith(marker?.gap ?? '-')).toBe(true);
    // Decorative for a screen reader: the HUD's field says it as text.
    expect(drawing.layerHidden).toBe('true');
    // A view with no drawing context lays none.
    expect(blind.seen.every((each) => each.markers.length === 0)).toBe(true);
    // And it is drawing only: the same writes on the same frames.
    expect(drawing.written.length).toBeGreaterThan(5);
    expect(blind.written).toStrictEqual(drawing.written);
  });

  it('reads no layout on a frame with the pacer in view, and still lays the marker once it is dropped', async () => {
    const drawing = await ride(true, true);
    expect(drawing.seen[0]?.markers).toEqual([]);
    const inView = drawing.seen.filter((each) => each.markers.length === 0);
    expect(inView.length).toBeGreaterThan(3);
    expect(inView.map((each) => each.reads)).toEqual(inView.map(() => 0));
    expect(drawing.seen.at(-1)?.markers).toHaveLength(1);
  });
});
