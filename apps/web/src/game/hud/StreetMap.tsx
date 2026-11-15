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
 * The box carries `oyl-hud__plan-svg`, the class every layout in `theme.css`
 * sizes the plan view by — including the phones' give-way rules (the short
 * corners layout's 4.5 rem, the middle band's 6 rem, a landscape tablet's
 * 8 rem) — so the panel is the size and in the place it was, covers no more of
 * the rider, and moves no ride-time control.
 *
 * ⚠️ **Except on a tall upright phone**, by the owner's ruling of 2026-11-06:
 * there the map is a larger square than the outline's box, as far as the room
 * above the rider allows (`theme.css` §"THE STREET MAP ON A TALL UPRIGHT
 * PHONE"). The route panel grows downwards into the sky, and still moves no
 * control.
 *
 * ## A box, a sheet that moves in it, and a mark that does not — #2380
 *
 * The box is an HTML element, the image a rider is told about, and it holds
 * two drawings: the sheet of map (`street-map.ts` §"The cost"), placed by a
 * CSS `transform` that is the only thing to change as the rider moves, and
 * the rider's mark over it in the middle, which never changes. Not one SVG,
 * as #2290 drew it: a change anywhere in an SVG repaints all of it, so moving
 * its view box re-stroked every street on the GPU, and an SVG's own shapes
 * are not given compositor layers of their own.
 *
 * ## The colours are the HUD's own `hudMap*` tokens
 *
 * Dark, because the HUD's panels are dark in every palette (`tokens.ts`
 * §`hudSurface`), and each layer is painted by its CLASS in `theme.css`, as
 * the plan view's are. Until the owner's screenshot ruling of 2026-11-06 they
 * were `map/basemap.ts` §`MAP_COLOURS`' dark table, whose road is 1.61:1 on
 * its land: in a box 72 px across the streets were hard to see. The streets
 * and paths are now 4.49:1 on the land and 3.32 on the water, and a little
 * wider. The route is the ride map's `track` colour still, over a casing of
 * the panel's surface (as the elevation strip's marker is), because no colour
 * light enough to be 3:1 against those streets is still that orange. The
 * rider's mark is the plan view's: a `hudInk` disc in a `hudSurface` ring.
 * {@link STREET_MAP_PAINTS} is the table; `StreetMap.a11y.test.tsx` holds it
 * to `theme.css` and every pair in it to a declared 3:1 (SC 1.4.11).
 */

import { useMemo, type JSX } from 'react';

import { metres } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import type { ColourToken } from '../../design/tokens';
import { useUnits } from '../../units/context';
import { formatDistance, spokenDistanceUnit } from '../../units/format';
import type { WorldCorridor } from '../world-data/corridor';
import type { HudInput } from './fields';
import { PLAN_AHEAD_STROKE_PIXELS, RIDER_MARK_RING_PIXELS, planWhere } from './plan';
import {
  STREET_MAP_MARK_RADIUS,
  STREET_MAP_METRES,
  streetMapCentre,
  streetMapIndex,
  streetMapLayers,
  streetMapRegion,
  streetMapSheetStyle,
  streetMapViewBox,
} from './street-map';

/** One layer of the map: the class `theme.css` paints it by, and its line's width. */
export interface StreetMapPaint {
  readonly className: string;
  readonly fill: ColourToken | 'none';
  readonly stroke: ColourToken | 'none';
  /** In screen pixels (`theme.css` §`.oyl-hud__street-map-line`); `0` for a fill. */
  readonly width: number;
}

/**
 * How each layer is painted, in the order it is drawn — #2290. The component
 * paints from this; `StreetMap.a11y.test.tsx` holds the rendered SVG and
 * `theme.css` to it, and measures each pair in it.
 *
 * The streets are 2.5 px and the paths 1.5 (2 and 1 before the owner's
 * ruling of 2026-11-06). The route is {@link PLAN_AHEAD_STROKE_PIXELS} over a
 * casing two pixels wider each side, which is what it is told apart from a
 * street by: the casing is 6.74:1 against the route's colour.
 */
export const STREET_MAP_PAINTS = {
  land: { className: 'oyl-hud__street-map-land', fill: 'hudMapLand', stroke: 'none', width: 0 },
  water: { className: 'oyl-hud__street-map-water', fill: 'hudMapWater', stroke: 'none', width: 0 },
  streets: {
    className: 'oyl-hud__street-map-street',
    fill: 'none',
    stroke: 'hudMapStreet',
    width: 2.5,
  },
  paths: {
    className: 'oyl-hud__street-map-street',
    fill: 'none',
    stroke: 'hudMapStreet',
    width: 1.5,
  },
  routeEdge: {
    className: 'oyl-hud__street-map-route-edge',
    fill: 'none',
    stroke: 'hudSurface',
    width: PLAN_AHEAD_STROKE_PIXELS + 4,
  },
  route: {
    className: 'oyl-hud__street-map-route',
    fill: 'none',
    stroke: 'hudMapRoute',
    width: PLAN_AHEAD_STROKE_PIXELS,
  },
} as const satisfies Record<string, StreetMapPaint>;

export interface StreetMapProps {
  /** The corridor this ride's world was given at the press (`GameView` §`worldCorridorRef`). */
  readonly corridor: WorldCorridor;
  readonly profile: HudInput['profile'];
  /** The rider's own odometer, unwrapped. @see streetMapCentre */
  readonly distance: number;
}

/**
 * The sentence a rider who is not looking at the panel hears. The span is in
 * the rider's own units and SAID, not printed (`units/format.ts`
 * §`spokenDistanceUnit`): "about 1.0 kilometres", "about 0.6 miles".
 */
function describe(props: StreetMapProps, units: UnitSystem): string {
  const span = formatDistance(metres(STREET_MAP_METRES), units).value;
  const across = `${span} ${spokenDistanceUnit(units)}`;
  return (
    `Street map around you, north up, about ${across} from top to bottom, with the route on ` +
    `it. ${planWhere(props.profile, props.distance)}`
  );
}

/** A line layer: its class, the line class that keeps its width, and its width. */
function Line(props: {
  readonly layer: 'streets' | 'paths' | 'routeEdge' | 'route';
  readonly d: string;
}): JSX.Element {
  const paint = STREET_MAP_PAINTS[props.layer];
  return (
    <path
      className={`oyl-hud__street-map-line ${paint.className}`}
      strokeWidth={paint.width}
      data-oyl-street-map={props.layer === 'routeEdge' ? 'route-edge' : props.layer}
      d={props.d}
    />
  );
}

/** The mark's drawing: {@link STREET_MAP_METRES} square on the rider, fitted to the box's shorter side. */
const MARK_VIEW_BOX = [
  -STREET_MAP_METRES / 2,
  -STREET_MAP_METRES / 2,
  STREET_MAP_METRES,
  STREET_MAP_METRES,
].join(' ');

export function StreetMap(props: StreetMapProps): JSX.Element {
  const units = useUnits();
  // Once per ride: the corridor and the route are both fixed at the press.
  const index = useMemo(
    () => streetMapIndex(props.corridor, props.profile),
    [props.corridor, props.profile],
  );
  // Per frame, and cheap. The sheet's place changes only when this moves to
  // another grid point, and its shapes only when its region does (#2380).
  const centre = streetMapCentre(props.corridor.origin, props.profile, props.distance);
  const { left, top, width, height } = streetMapRegion(centre);
  const layers = useMemo(
    () => streetMapLayers(index, { left, top, width, height }),
    [index, left, top, width, height],
  );
  const region = { left, top, width, height };

  return (
    <div className="oyl-hud__plan">
      <div
        className="oyl-hud__plan-svg oyl-hud__street-map"
        role="img"
        aria-label={describe(props, units)}
      >
        <svg
          className="oyl-hud__street-map-sheet"
          viewBox={streetMapViewBox(region)}
          style={streetMapSheetStyle(region, centre)}
          aria-hidden="true"
          data-oyl-street-map="sheet"
        >
          <path
            className={STREET_MAP_PAINTS.land.className}
            data-oyl-street-map="land"
            d={layers.land}
          />
          <path
            className={STREET_MAP_PAINTS.water.className}
            data-oyl-street-map="water"
            d={layers.water}
          />
          <Line layer="streets" d={layers.streets} />
          <Line layer="paths" d={layers.paths} />
          <Line layer="routeEdge" d={layers.route} />
          <Line layer="route" d={layers.route} />
        </svg>
        <svg
          className="oyl-hud__street-map-here"
          viewBox={MARK_VIEW_BOX}
          // `meet`, as the plan view's: the box's shorter side is the kilometre,
          // as it is the sheet's (`street-map.ts` §`streetMapSheetStyle`).
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <circle
            className="oyl-hud__plan-here"
            cx={0}
            cy={0}
            r={STREET_MAP_MARK_RADIUS}
            strokeWidth={RIDER_MARK_RING_PIXELS}
            data-testid="oyl-hud-plan-here"
          />
        </svg>
      </div>
    </div>
  );
}
