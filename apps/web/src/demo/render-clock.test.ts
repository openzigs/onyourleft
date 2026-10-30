// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The video render's clock — #1655: nothing runs until it is stepped, and each
 * step hands the stage exactly its time.
 */

import { describe, expect, it } from 'vitest';

import {
  INITIAL_REALISTIC_QUALITY,
  REALISTIC_LADDER,
  SUSTAINED_SAMPLES,
  worldRung,
} from '../game/quality';
import { createDemoPlayer } from './player';
import { CLIMB_PRESET } from './presets';
import { RenderClock } from './render-clock';
import { startDemoStage, type DemoSnapshot } from './stage';
import { fakeDrawnWorld, fakeRenderer, type FakeView } from './stage-testing';

describe('the render clock — #1655', () => {
  it('runs nothing until stepped, then each waiting callback once, at the step’s time', () => {
    const clock = new RenderClock();
    const seen: number[] = [];
    clock.request((now) => seen.push(now));
    clock.request((now) => seen.push(now));
    expect(seen).toEqual([]);
    expect(clock.step(40)).toBe(2);
    expect(seen).toEqual([40, 40]);
    // Nothing was asked for since: a step runs nothing, and the time still moves.
    expect(clock.step(40)).toBe(0);
    clock.request((now) => seen.push(now));
    expect(clock.step(40)).toBe(1);
    expect(seen.at(-1)).toBe(120);
  });

  it('runs no callback that was cancelled', () => {
    const clock = new RenderClock();
    let ran = false;
    clock.cancel(
      clock.request(() => {
        ran = true;
      }),
    );
    expect(clock.step(10)).toBe(0);
    expect(ran).toBe(false);
  });

  it('puts the nth step at n × the step, with no drift from a running sum', () => {
    const clock = new RenderClock();
    let last = 0;
    const thirtieth = 1000 / 30;
    for (let step = 0; step < 900; step += 1) {
      clock.request((now) => {
        last = now;
      });
      clock.step(thirtieth);
    }
    expect(last).toBe(900 * thirtieth);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a step of %s', (step) => {
    expect(() => new RenderClock().step(step)).toThrow(RangeError);
  });

  it('drives a stepped stage one drawn frame a step, each 1 / fps of ride further on', () => {
    const clock = new RenderClock();
    const { renderer, views } = fakeRenderer(Promise.resolve({ loaded: true }));
    const player = createDemoPlayer(CLIMB_PRESET);
    player.play();
    const snapshots: DemoSnapshot[] = [];
    startDemoStage({
      canvas: {} as HTMLCanvasElement,
      renderer,
      drawnWorld: fakeDrawnWorld,
      player,
      frames: clock,
      stepped: true,
      publish: (snapshot) => void snapshots.push(snapshot),
    });
    const view = views[0] as FakeView;
    const rideMs: number[] = [];
    for (let frame = 0; frame < 10; frame += 1) {
      expect(clock.step(100)).toBe(1);
      rideMs.push(player.rideMs);
    }
    expect(view.rendered).toHaveLength(10);
    expect(rideMs).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(snapshots.at(-1)?.framesDrawn).toBe(10);
  });

  it.each([
    [true, 'keeps the rung it started on'],
    [false, 'steps down the ladder (the control)'],
  ])('a stage stepped %s at 10 a second %s', (stepped) => {
    const clock = new RenderClock();
    // The realistic world never arrives: what moves the rung is the ladder alone.
    const { renderer, views } = fakeRenderer(new Promise(() => undefined));
    const player = createDemoPlayer(CLIMB_PRESET);
    player.play();
    startDemoStage({
      canvas: {} as HTMLCanvasElement,
      renderer,
      drawnWorld: fakeDrawnWorld,
      player,
      frames: clock,
      stepped,
      publish: () => undefined,
    });
    // 100 ms a frame is slower than the ladder allows (`FRAME_MS_REDUCE_ABOVE`).
    for (let frame = 0; frame < 1 + REALISTIC_LADDER.length * SUSTAINED_SAMPLES; frame += 1) {
      clock.step(100);
    }
    const view = views[0] as FakeView;
    if (stepped) {
      expect(view.qualities).toEqual([worldRung(INITIAL_REALISTIC_QUALITY)]);
    } else {
      expect(view.qualities.length).toBeGreaterThan(1);
      expect(view.qualities.at(-1)?.world).toBe('stylised');
    }
  });
});
