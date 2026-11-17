// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2755 — the markers at the world's edge for a pacer and a ghost the rider
 * has dropped behind the chase camera, laid by the real `GameView` over the
 * real HUD, cover no HUD control at the owner's small laptop window, 1024×600.
 *
 * `ride.html?dropped=on` (`ride-harness.tsx` §`DROPPED`) rides the widest
 * ride with a ghost at a tenth of its speed and a pacer at 1 W/kg, so a
 * rider at 342 W drops both, and hands the shell a view that has a context
 * and draws nothing: the markers are DOM, and this page measures the HUD.
 * Where they are placed is `game/off-screen-marker.test.ts`'s, against frames
 * `scene.ts` builds; this is where they land on a laid-out page.
 *
 * jsdom lays nothing out, so no other gate can say a marker is clear of a
 * panel (`apps/web/CLAUDE.md`).
 */

import { expect, test } from '@playwright/test';

import {
  LAPTOP_VIEWPORTS,
  describeItem,
  inside,
  measure,
  openRide,
  overlap,
  type Viewport,
} from './ride-stage';

const SMALL_LAPTOP = LAPTOP_VIEWPORTS.find(
  (each) => each.width === 1024 && each.height === 600,
) as Viewport;

/** One marker as the page lays it out. */
interface Laid {
  readonly to: string | undefined;
  readonly edge: string | undefined;
  readonly gap: string;
  readonly opacity: number;
  readonly hidden: boolean;
  readonly box: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
  };
}

test('#2755 the markers for a dropped pacer and ghost cover no HUD control or panel at 1024×600', async ({
  page,
}) => {
  await openRide(page, SMALL_LAPTOP, '?dropped=on');
  // Every frame from the first marker until both are dropped well behind the
  // camera — one marker each, drawn whole, three seconds or more back. While
  // each is still passing the eye a little to one side its marker swings
  // across the bottom of the frame toward the corner panels and is moved in
  // along its ray to clear them (`off-screen-marker.ts` §`clearAlong`), so
  // the frames before the end are the ones that can cover the HUD.
  const watched = await page.evaluate(
    () =>
      new Promise<{ readonly frames: number; readonly faults: readonly string[] }>((resolve) => {
        const faults: string[] = [];
        let frames = 0;
        const step = (): void => {
          const markers = [...document.querySelectorAll<HTMLElement>('.oyl-game__off-screen')];
          if (markers.length > 0) frames += 1;
          const covers = [
            ...document.querySelectorAll(
              '.oyl-hud > :not([data-oyl-announcer]), .oyl-hud__control, .oyl-hud__lock',
            ),
          ].map((each) => ({ name: each.className, box: each.getBoundingClientRect() }));
          for (const marker of markers) {
            if (Number(marker.style.opacity) === 0) continue;
            const box = marker.getBoundingClientRect();
            for (const cover of covers) {
              // `ride-stage.ts` §`overlap`'s pixel of tolerance.
              if (
                box.left < cover.box.right - 1 &&
                cover.box.left < box.right - 1 &&
                box.top < cover.box.bottom - 1 &&
                cover.box.top < box.bottom - 1
              ) {
                faults.push(
                  `frame ${String(frames)}: ${String(marker.dataset.to)} × ${cover.name}`,
                );
              }
            }
          }
          const settled = markers.filter(
            (each) =>
              each.style.opacity === '1' &&
              Number(/^(\d+) s$/.exec(each.textContent ?? '')?.[1]) >= 3,
          );
          const to = settled.map((each) => each.dataset.to);
          if (to.includes('bot') && to.includes('ghost')) {
            resolve({ frames, faults });
          } else {
            requestAnimationFrame(step);
          }
        };
        requestAnimationFrame(step);
      }),
  );
  console.log(`#2755 1024×600: ${String(watched.frames)} frames with a marker watched`);
  expect(watched.faults).toEqual([]);
  expect(watched.frames).toBeGreaterThan(10);
  const laid: Laid[] = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.oyl-game__off-screen')].map((each) => {
      const rect = each.getBoundingClientRect();
      return {
        to: each.dataset.to,
        edge: each.dataset.edge,
        gap: each.textContent ?? '',
        opacity: Number(window.getComputedStyle(each).opacity),
        hidden: each.closest('[aria-hidden="true"]') !== null,
        box: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      };
    }),
  );
  const seen = await measure(page);
  const ours = (each: Laid): string =>
    `${String(each.to)} [${each.box.left.toFixed(0)},${each.box.top.toFixed(0)} → ` +
    `${each.box.right.toFixed(0)},${each.box.bottom.toFixed(0)}]`;
  console.log(`#2755 1024×600: ${laid.map(ours).join(', ')}`);
  expect(laid.map((each) => each.to).sort()).toEqual(['bot', 'ghost']);
  // The HUD was there to be measured: its controls and its panels.
  expect(seen.items.map((each) => each.name)).toEqual(
    expect.arrayContaining(['control: Pause', 'control: End ride']),
  );
  expect(seen.panels.length).toBeGreaterThan(2);
  for (const marker of laid) {
    // Drawn, on the page, behind the rider — so on the bottom edge — and
    // never read: the HUD's gap field says it.
    expect(marker.opacity, ours(marker)).toBeGreaterThan(0.5);
    expect(inside(marker.box, SMALL_LAPTOP), ours(marker)).toBe(true);
    expect(marker.edge, ours(marker)).toBe('bottom');
    expect(marker.gap, ours(marker)).toMatch(/^\d+ s$/);
    expect(marker.hidden, ours(marker)).toBe(true);
    // Over no control and no panel.
    for (const item of [...seen.items, ...seen.panels]) {
      expect(overlap(marker.box, item.box), `${ours(marker)} × ${describeItem(item)}`).toBe(false);
    }
  }
  // Nor over each other.
  const [one, other] = laid as [Laid, Laid];
  expect(overlap(one.box, other.box), `${ours(one)} × ${ours(other)}`).toBe(false);
  // And at the edge: the lower of the two sits within its margin (12 px) and
  // a pixel of the bottom of the world, so it was placed there and not
  // merely somewhere clear.
  const lowest = Math.max(one.box.bottom, other.box.bottom);
  expect(SMALL_LAPTOP.height - lowest).toBeLessThanOrEqual(13);
});
