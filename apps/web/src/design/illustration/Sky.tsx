// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { paint } from './paint';
import { IllustrationSvg, type IllustrationProps } from './svg';

/**
 * The scene's width and height, shared by every landscape layer — `Sky`,
 * `Hills` and `RoadRibbon` — so that a screen stacking them gets one scene and
 * not three that disagree about where the horizon is.
 */
export const SCENE_WIDTH = 320;
/** @see SCENE_WIDTH */
export const SCENE_HEIGHT = 120;

/** Where the sun stands, and how big it is, in scene units. */
const SUN = { x: 250, y: 34, radius: 16 } as const;

/**
 * A cloud is three overlapping circles on a flat base — the simplest shape that
 * reads as one at any size. Each is placed by its base line's left end, and
 * scaled from one drawing.
 */
const CLOUDS = [
  { x: 36, y: 40, scale: 1 },
  { x: 150, y: 24, scale: 0.7 },
] as const;

/** The one cloud, at scale 1: circles as `[x, y, radius]` from the base's left end. */
const CLOUD_PUFFS = [
  [12, -6, 10],
  [26, -12, 13],
  [40, -6, 9],
] as const;
/** The flat underside, as a rectangle under the puffs. */
const CLOUD_BASE = { width: 46, height: 8 } as const;

function Cloud({ x, y, scale }: (typeof CLOUDS)[number]): JSX.Element {
  return (
    <g className={paint('light')}>
      {CLOUD_PUFFS.map(([dx, dy, radius]) => (
        <circle key={dx} cx={x + dx * scale} cy={y + dy * scale} r={radius * scale} />
      ))}
      <rect
        x={x + 3 * scale}
        y={y - CLOUD_BASE.height * scale}
        width={CLOUD_BASE.width * scale}
        height={CLOUD_BASE.height * scale}
        rx={(CLOUD_BASE.height * scale) / 2}
      />
    </g>
  );
}

/**
 * The sky behind a scene, with its sun and clouds — #938.
 *
 * Drawn first and cropped to fill its box. The sun and the clouds are optional
 * so a screen with a busy top edge can leave them out; nothing else about the
 * sky changes with a screen.
 */
export function Sky({
  className,
  sun = true,
  clouds = true,
}: IllustrationProps & {
  readonly sun?: boolean;
  readonly clouds?: boolean;
}): JSX.Element {
  return (
    <IllustrationSvg
      aspect="xMidYMax slice"
      className={className}
      viewBox={`0 0 ${String(SCENE_WIDTH)} ${String(SCENE_HEIGHT)}`}
    >
      <rect className={paint('sky')} width={SCENE_WIDTH} height={SCENE_HEIGHT} />
      {sun && <circle className={paint('sun')} cx={SUN.x} cy={SUN.y} r={SUN.radius} />}
      {clouds && CLOUDS.map((cloud) => <Cloud key={cloud.x} {...cloud} />)}
    </IllustrationSvg>
  );
}
