// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { paint } from './paint';
import { SCENE_HEIGHT, SCENE_WIDTH } from './Sky';
import { coordinate, IllustrationSvg, type IllustrationProps } from './svg';

type Point = readonly [number, number];
type Cubic = readonly [Point, Point, Point, Point];

/**
 * The road's two edges, each one cubic curve from the bottom of the scene to
 * the horizon. Wide at the front and a few units across where it meets the far
 * hills, which is the whole of the perspective: one bend, no vanishing-point
 * arithmetic, and the same road on every screen.
 */
const LEFT_EDGE: Cubic = [
  [112, SCENE_HEIGHT],
  [156, 102],
  [206, 92],
  [196, 72],
];
const RIGHT_EDGE: Cubic = [
  [236, SCENE_HEIGHT],
  [214, 104],
  [214, 90],
  [201, 72],
];

/** How many dashes run down the middle, and how much of each stretch is dash. */
const DASHES = 5;
const DASH_SHARE = 0.5;
/** A dash's width as a share of the road's at the same point. */
const DASH_WIDTH_SHARE = 0.08;

function onCubic([a, b, c, d]: Cubic, t: number): Point {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return [
    weights[0] * a[0] + weights[1] * b[0] + weights[2] * c[0] + weights[3] * d[0],
    weights[0] * a[1] + weights[1] * b[1] + weights[2] * c[1] + weights[3] * d[1],
  ];
}

function cubicPath([a, b, c, d]: Cubic): string {
  const at = ([x, y]: Point): string => `${coordinate(x)} ${coordinate(y)}`;
  return `${at(a)} C${at(b)} ${at(c)} ${at(d)}`;
}

/** Where across the road a share of the way from its left edge to its right is, at `t`. */
function across(t: number, share: number): Point {
  const [lx, ly] = onCubic(LEFT_EDGE, t);
  const [rx, ry] = onCubic(RIGHT_EDGE, t);
  return [lx + (rx - lx) * share, ly + (ry - ly) * share];
}

/** One dash: the quadrilateral between `from` and `to` along the middle. */
function dash(from: number, to: number): string {
  const corners = [
    across(from, 0.5 - DASH_WIDTH_SHARE / 2),
    across(to, 0.5 - DASH_WIDTH_SHARE / 2),
    across(to, 0.5 + DASH_WIDTH_SHARE / 2),
    across(from, 0.5 + DASH_WIDTH_SHARE / 2),
  ];
  return `M${corners.map(([x, y]) => `${coordinate(x)} ${coordinate(y)}`).join(' L')} Z`;
}

const ROAD = `M${cubicPath(LEFT_EDGE)} L${cubicPath([
  RIGHT_EDGE[3],
  RIGHT_EDGE[2],
  RIGHT_EDGE[1],
  RIGHT_EDGE[0],
])} Z`;

const CENTRE_LINE = Array.from({ length: DASHES }, (_, index) =>
  dash(index / DASHES, (index + DASH_SHARE) / DASHES),
).join(' ');

/**
 * A road running away from the viewer into the hills — #938. Drawn over
 * `Hills`, with a broken centre line in the page's own light.
 */
export function RoadRibbon({ className }: IllustrationProps): JSX.Element {
  return (
    <IllustrationSvg
      aspect="xMidYMax slice"
      className={className}
      viewBox={`0 0 ${String(SCENE_WIDTH)} ${String(SCENE_HEIGHT)}`}
    >
      <path className={paint('road')} d={ROAD} />
      <path className={paint('light')} d={CENTRE_LINE} />
    </IllustrationSvg>
  );
}
