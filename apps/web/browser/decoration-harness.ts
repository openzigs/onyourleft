// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The holiday decorations' belt in a real WebGL context — #1624. What jsdom
 * cannot do for `decoration-belt.test.ts`: draw, count the draw calls three
 * makes, and read a colour back off the drawing buffer. The drawing is
 * `three-renderer.ts`' own (`decorationCallsProbe`, `decorationGlowProbe`),
 * because nothing but that file may import three (`three-seam.test.ts`).
 *
 * Published on `window.__oylDecoration`:
 *
 * 1. **`calls`** — the REAL belt holding two villages' items — the 150°
 *    corner fixture `decoration-belt.test.ts` finds two villages in reach on —
 *    with a probe on every anchor, drawn from straight above:
 *    `renderer.info.render.calls` with the belt shown and hidden. Nothing else
 *    is in that scene, so the difference is the belt's.
 * 2. **`glow`** — one box built and worn as the belt builds and wears its
 *    items, under one directional light at its face or turned away and no
 *    other light: the pixel at its middle, marked glowing or not.
 * 3. **`halloweenFace`** — since #1625, the same for the product's own
 *    jack-o'-lantern face colour, glowing, the light turned away.
 *
 * ⚠️ Not the product's frame: the owner's page (`realistic-town.browser.spec.ts`)
 * is where the belt's one call is held inside a real view's frame.
 */

import {
  ANCHOR_KINDS,
  HOLIDAY_DECORATIONS,
  type DecorationKind,
  type ItemTable,
} from '../src/game/decorations';
import { plannerCornerRoute } from '../src/game/route-fixtures-testing';
import { streetsAt } from '../src/game/streets';
import { corridorOrigin } from '../src/game/terrain';
import {
  decorationCallsProbe,
  decorationGlowProbe,
  type DecorationPixel,
} from '../src/game/three-renderer';

/** The colour the glow probe's box wears, sRGB: what a glowing one must read back as. */
const GLOW_PROBE_COLOUR = 0xc06030;

declare global {
  interface Window {
    __oylDecoration?: {
      readonly ready: boolean;
      /** The draw calls of one frame of two villages' items, with the belt shown and hidden. */
      calls(): { readonly shown: number; readonly hidden: number; readonly triangles: number };
      /** One frame of a box, glowing or lit, the light at its face or turned away. */
      glow(
        world: 'stylised' | 'realistic',
        light: 'toward' | 'away',
        glows: boolean,
      ): DecorationPixel;
      /**
       * #1625: the product's Halloween face — the first glowing part of
       * `decorations.ts` §`HOLIDAY_DECORATIONS`' Halloween set — built and
       * worn as {@link glow}'s box is, with the light turned away: its pixel,
       * and the colour it is painted, 0–255 sRGB.
       */
      halloweenFace(world: 'stylised' | 'realistic'): {
        readonly pixel: DecorationPixel;
        readonly colour: DecorationPixel;
      };
    };
  }
}

const PROBE: DecorationKind = {
  item: 'probe',
  anchors: ANCHOR_KINDS,
  chance: 1,
  radius: 0.15,
  parts: [{ size: [0.3, 0.3, 0.3], at: [0, 0.15, 0], colour: 0xe07a1f, glows: false }],
};
const PROBE_TABLE: ItemTable = { halloween: [PROBE] };

/** A fresh canvas a call, so no reading inherits another's context. */
function canvas(): HTMLCanvasElement {
  const made = document.createElement('canvas');
  document.body.append(made);
  return made;
}

function calls(): { shown: number; hidden: number; triangles: number } {
  const corner = plannerCornerRoute(150);
  const streets = streetsAt(corner, corridorOrigin(corner), 2, 0, corner.totalDistance);
  // Halfway between the two villages' nearest anchors: both in reach.
  let best = Number.POSITIVE_INFINITY;
  let camera = { x: 0, z: 0 };
  for (const a of streets[0]?.anchors ?? []) {
    for (const b of streets[1]?.anchors ?? []) {
      const apart = Math.hypot(a.x - b.x, a.z - b.z);
      if (apart < best) {
        best = apart;
        camera = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      }
    }
  }
  return decorationCallsProbe(canvas(), streets, camera, PROBE_TABLE);
}

function halloweenFace(world: 'stylised' | 'realistic'): {
  pixel: DecorationPixel;
  colour: DecorationPixel;
} {
  const face = (HOLIDAY_DECORATIONS.halloween ?? [])
    .flatMap((kind) => kind.parts)
    .find((part) => part.glows);
  if (face === undefined) throw new Error('the Halloween set has no glowing face');
  return {
    pixel: decorationGlowProbe(canvas(), world, 'away', face.colour, true),
    colour: [(face.colour >> 16) & 0xff, (face.colour >> 8) & 0xff, face.colour & 0xff],
  };
}

window.__oylDecoration = {
  ready: true,
  calls,
  glow: (world, light, glows) =>
    decorationGlowProbe(canvas(), world, light, GLOW_PROBE_COLOUR, glows),
  halloweenFace,
};
