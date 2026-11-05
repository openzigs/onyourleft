// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2038 — cards stop reading as flat slabs: a contrast floor between adjacent
 * surface levels, in BOTH palettes, inside the a11y gate.
 *
 * ## The floor, and where it comes from
 *
 * **1.15:1** (WCAG luminance ratio) between each pair of neighbouring levels
 * on the elevation ramp — [ADR 0063](../../../../docs/adr/0063-the-design-system-direction-hi-vis.md)
 * D-3, on the owner's choice of direction A on #2035 (2026-11-03), which
 * carried spike 0034's proposal. WCAG states no number for surface against
 * surface, so this is the design system's own. The 2026-11-03 audit of #2030
 * found every step of the teal palette at about 1.1:1 and a raised card on the
 * dark canvas at 1.23:1; the owner called the cards flat slabs.
 *
 * Elevation is a colour step and never a shadow (#307): a `box-shadow` is
 * invisible to every gate here, so this is the only place depth is checked.
 *
 * ## What it reads
 *
 * The levels are `tokens.ts` §`ELEVATION_SURFACES`, walked in order, so a
 * fifth level added to the ramp is checked without editing this file. The
 * values are each palette's own (`paletteColours`), which `theme.a11y.test.ts`
 * holds equal to what `theme.css` paints.
 *
 * `tokens.test.ts` checks the same ramp against {@link MINIMUM_ELEVATION_STEP}
 * outside the a11y gate; this file states the floor itself, so lowering that
 * constant is a red build here rather than a quieter gate.
 */

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../design/contrast';
import {
  ELEVATION_SURFACES,
  MINIMUM_ELEVATION_STEP,
  THEMES,
  paletteColours,
  type ElevationSurface,
} from '../design/tokens';

/** ADR 0063 D-3's floor, written here and not read from the module it checks. */
const ADJACENT_SURFACE_FLOOR = 1.15;

/** Every pair of neighbouring levels on the ramp, from the page up. */
function adjacentLevels(): readonly (readonly [ElevationSurface, ElevationSurface])[] {
  return ELEVATION_SURFACES.slice(1).map((above, index) => {
    const below = ELEVATION_SURFACES[index];
    if (below === undefined) throw new Error('the ramp is shorter than its own length');
    return [below, above] as const;
  });
}

describe('the floor between adjacent surface levels — #2038, ADR 0063 D-3', () => {
  it('is the floor ADR 0063 states, and tokens.ts says the same', () => {
    expect(MINIMUM_ELEVATION_STEP).toBe(ADJACENT_SURFACE_FLOOR);
  });

  it('walks a ramp with something to walk', () => {
    // Four levels today: canvas, surface, raised, overlay. A ramp of one
    // level has no step, and every assertion below would pass over nothing.
    expect(adjacentLevels().length).toBeGreaterThanOrEqual(3);
  });

  describe.each(THEMES)('in the %s palette', (theme) => {
    const colours = paletteColours(theme);

    it.each(adjacentLevels().map(([below, above]) => [below.token, above.token] as const))(
      '%s to %s clears the floor',
      (below, above) => {
        const step = contrastRatio(colours[above], colours[below]);
        expect(
          step,
          `${theme}: ${below} (${colours[below]}) to ${above} (${colours[above]}) is ` +
            `${step.toFixed(3)}:1, under the ${String(ADJACENT_SURFACE_FLOOR)}:1 floor — a card ` +
            'on it reads as a flat slab (ADR 0063 D-3)',
        ).toBeGreaterThanOrEqual(ADJACENT_SURFACE_FLOOR);
      },
    );
  });
});
