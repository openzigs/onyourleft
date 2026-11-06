// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The plan view as a street map around the rider — #2290, drawn on the HUD.
 *
 * `street-map.ts` holds every decision this renders and why: drawn from the
 * ride's corridor and never from a request, north up, about a kilometre
 * across, and redrawn only when the rider has moved. This file is the DOM.
 *
 * ## In the plan view's box, so nothing on the HUD moves
 *
 * The SVG carries `oyl-hud__plan-svg`, the class every layout in `theme.css`
 * sizes the plan view by — including the phones' give-way rules (the short
 * corners layout's 4.5 rem, the middle band's 6 rem, a landscape tablet's
 * 8 rem) — so the panel is the size and in the place it was, covers no more of
 * the rider, and moves no ride-time control.
 *
 * ## The colours are the map's own, the dark ones
 *
 * The land, the water, the streets and the route are `map/basemap.ts`
 * §`MAP_COLOURS`' dark table — the ride map's and the route planner's own
 * cartography, dark because the HUD's panels are dark in every palette
 * (`tokens.ts` §`hudSurface`). The route is that table's `track`, whose
 * contrast against each fill is already recorded there (SC 1.4.11). The
 * rider's mark is the plan view's: a `hudInk` disc in a `hudSurface` ring,
 * painted by the same class. `StreetMap.a11y.test.tsx` measures each pair a
 * rider has to tell apart.
 */

import { useMemo, type JSX } from 'react';

import { MAP_COLOURS } from '../../map/basemap';
import type { WorldCorridor } from '../world-data/corridor';
import type { HudInput } from './fields';
import { PLAN_AHEAD_STROKE_PIXELS, RIDER_MARK_RING_PIXELS, planWhere } from './plan';
import {
  STREET_MAP_MARK_RADIUS,
  STREET_MAP_METRES,
  streetMapCell,
  streetMapCentre,
  streetMapIndex,
  streetMapLayers,
  streetMapViewBox,
} from './street-map';

/** The map is dark on every palette: see the module note. */
const COLOURS = MAP_COLOURS.dark;

/**
 * How each layer is painted, in the order it is drawn — #2290. The widths
 * are screen pixels (`theme.css` §`.oyl-hud__street-map-line` keeps them so).
 * The component paints from this, and `StreetMap.a11y.test.tsx` holds the
 * rendered SVG to it and measures each pair in it.
 */
export const STREET_MAP_PAINTS = {
  land: { fill: COLOURS.earth },
  water: { fill: COLOURS.water },
  streets: { stroke: COLOURS.road, width: 2 },
  paths: { stroke: COLOURS.road, width: 1 },
  route: { stroke: COLOURS.track, width: PLAN_AHEAD_STROKE_PIXELS },
} as const;

export interface StreetMapProps {
  /** The corridor this ride's world was given at the press (`GameView` §`worldCorridorRef`). */
  readonly corridor: WorldCorridor;
  readonly profile: HudInput['profile'];
  /** The rider's own odometer, unwrapped. @see streetMapCentre */
  readonly distance: number;
}

/** The sentence a rider who is not looking at the panel hears. */
function describe(props: StreetMapProps): string {
  const across = `${String(STREET_MAP_METRES / 1000)} km`;
  return (
    `Street map around you, north up, about ${across} from top to bottom, with the route on ` +
    `it. ${planWhere(props.profile, props.distance)}`
  );
}

export function StreetMap(props: StreetMapProps): JSX.Element {
  // Once per ride: the corridor and the route are both fixed at the press.
  const index = useMemo(
    () => streetMapIndex(props.corridor, props.profile),
    [props.corridor, props.profile],
  );
  // Per frame, and cheap. The drawing below changes only when this moves to
  // another grid point, and its shapes only when it moves to another cell.
  const centre = streetMapCentre(props.corridor.origin, props.profile, props.distance);
  const { column, row } = streetMapCell(centre);
  const layers = useMemo(() => streetMapLayers(index, { column, row }), [index, column, row]);

  return (
    <div className="oyl-hud__plan">
      <svg
        className="oyl-hud__plan-svg oyl-hud__street-map"
        viewBox={streetMapViewBox(centre)}
        // `meet`, as the plan view's: one scale for both axes, so the box's
        // height is the kilometre and its width is more of the same map.
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={describe(props)}
      >
        <g aria-hidden="true">
          <path fill={STREET_MAP_PAINTS.land.fill} data-oyl-street-map="land" d={layers.land} />
          <path fill={STREET_MAP_PAINTS.water.fill} data-oyl-street-map="water" d={layers.water} />
          <path
            className="oyl-hud__street-map-line"
            fill="none"
            stroke={STREET_MAP_PAINTS.streets.stroke}
            strokeWidth={STREET_MAP_PAINTS.streets.width}
            data-oyl-street-map="streets"
            d={layers.streets}
          />
          <path
            className="oyl-hud__street-map-line"
            fill="none"
            stroke={STREET_MAP_PAINTS.paths.stroke}
            strokeWidth={STREET_MAP_PAINTS.paths.width}
            data-oyl-street-map="paths"
            d={layers.paths}
          />
          <path
            className="oyl-hud__street-map-line"
            fill="none"
            stroke={STREET_MAP_PAINTS.route.stroke}
            strokeWidth={STREET_MAP_PAINTS.route.width}
            data-oyl-street-map="route"
            d={layers.route}
          />
          <circle
            className="oyl-hud__plan-here"
            cx={centre.east}
            cy={centre.south}
            r={STREET_MAP_MARK_RADIUS}
            strokeWidth={RIDER_MARK_RING_PIXELS}
            data-testid="oyl-hud-plan-here"
          />
        </g>
      </svg>
    </div>
  );
}
