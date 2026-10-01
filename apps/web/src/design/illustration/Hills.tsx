// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { slotHash, uniformFrom } from '../../game/seeded';
import { paint, type PaintName } from './paint';
import { SCENE_HEIGHT, SCENE_WIDTH } from './Sky';
import { coordinate, IllustrationSvg, type IllustrationProps } from './svg';

/**
 * One layer of hills: how many crests across the scene, and the band their
 * tops are drawn from, in scene units from the top. The far layer is higher
 * and gentler; the near one lower and steeper, which is all the depth a flat
 * drawing has besides its colours (`tokens.ts` §`ILLUSTRATION_DEPTH`).
 */
interface HillLayer {
  readonly paint: PaintName;
  /** Which hash stream the layer draws from, so the two never correlate. */
  readonly stream: number;
  readonly crests: number;
  readonly highest: number;
  readonly lowest: number;
}

const FAR: HillLayer = { paint: 'hillFar', stream: 1, crests: 4, highest: 48, lowest: 72 };
const NEAR: HillLayer = { paint: 'hillNear', stream: 2, crests: 3, highest: 76, lowest: 96 };

/**
 * The outline of one layer, closed along the bottom of the scene.
 *
 * Seeded and stateless, like the game's scenery (`game/seeded.ts`): the same
 * `seed` draws the same hills on every render and every device, so a card does
 * not change shape when it re-renders, and two cards with different seeds do
 * not look stamped. Each crest is a height drawn from its own slot; the line
 * between them is a quadratic curve through the midpoints, which is smooth
 * without a spline library and never overshoots the band.
 */
function hillOutline(seed: number, layer: HillLayer): string {
  const step = SCENE_WIDTH / layer.crests;
  const crests: (readonly [number, number])[] = [];
  for (let crest = 0; crest <= layer.crests; crest += 1) {
    const share = uniformFrom(slotHash(seed, layer.stream, crest), 0);
    crests.push([crest * step, layer.highest + share * (layer.lowest - layer.highest)]);
  }
  const point = ([x, y]: readonly [number, number]): string => `${coordinate(x)} ${coordinate(y)}`;
  const middle = (index: number): string => {
    const [ax, ay] = crests[index] ?? [0, 0];
    const [bx, by] = crests[index + 1] ?? [0, 0];
    return point([(ax + bx) / 2, (ay + by) / 2]);
  };
  const first = crests[0] ?? [0, layer.lowest];
  const last = crests[layer.crests] ?? [SCENE_WIDTH, layer.lowest];
  let outline = `M0 ${coordinate(SCENE_HEIGHT)} L${point(first)} L${middle(0)}`;
  for (let crest = 1; crest < layer.crests; crest += 1) {
    outline += ` Q${point(crests[crest] ?? first)} ${middle(crest)}`;
  }
  outline += ` L${point(last)} L${coordinate(SCENE_WIDTH)} ${coordinate(SCENE_HEIGHT)} Z`;
  return outline;
}

/**
 * Rolling hills, far and near — #938.
 *
 * `seed` is any whole number a screen has to hand — a route's or a card's
 * index — and decides the shape. Drawn over `Sky` and under `RoadRibbon`.
 */
export function Hills({
  className,
  seed = 0,
}: IllustrationProps & { readonly seed?: number }): JSX.Element {
  return (
    <IllustrationSvg
      aspect="xMidYMax slice"
      className={className}
      viewBox={`0 0 ${String(SCENE_WIDTH)} ${String(SCENE_HEIGHT)}`}
    >
      <path className={paint(FAR.paint)} d={hillOutline(seed, FAR)} />
      <path className={paint(NEAR.paint)} d={hillOutline(seed, NEAR)} />
    </IllustrationSvg>
  );
}
