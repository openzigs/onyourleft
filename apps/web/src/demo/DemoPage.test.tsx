// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The demo page — #1647: its controls, reduced motion, hidden-means-paused
 * and the refused query, driven through the page with the renderer and the
 * frame clock replaced. Every distance is read off the published snapshot,
 * which is what the demo's browser gate (#1648) reads.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CONTROL_MINIMUM_PIXELS } from '../game/hud/HudCore';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { DemoPage } from './DemoPage';
import type { DemoSnapshot } from './stage';
import { fakeDrawnWorld, fakeRenderer, SteppedFrames } from './stage-testing';

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
}

async function page(options: { search?: string; reducedMotion?: boolean } = {}): Promise<Page> {
  const frames = new SteppedFrames();
  const { renderer } = fakeRenderer(new Promise(() => undefined));
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
