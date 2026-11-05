// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route in plan with the rider on it — #285, drawn on the HUD.
 *
 * `plan.ts` holds every decision this component renders and is where they are
 * written down: north-up, the uniform fit, one `<path>` per unbroken run, and
 * why none of it touches the network. This file is the DOM.
 *
 * ## ⚠️ It is on the HUD rather than over the world, and that is a criterion
 *
 * `tokens.ts` §`hudSurface` is opaque *so that #94's contrast criterion is
 * checkable at all* — a mark drawn over the rendered world would sit on
 * arbitrary pixels that change every metre, which is precisely the situation
 * that criterion cannot be checked under. `hud-surface.a11y.test.ts` would stay
 * green through it, because the accessibility suite renders into jsdom and jsdom
 * composites nothing.
 *
 * So the lines and the mark use the two tokens `contrast.a11y.test.ts` already
 * walks against `hudSurface` and no token is added: {@link PLAN_PAINTS} is the
 * table, and `PlanTrace.a11y.test.tsx` holds it to `theme.css` and every pair
 * in it to a declared 3:1 (SC 1.4.11).
 *
 * ## The road ahead and the road ridden — #2070
 *
 * The owner, 2026-11-03: *the map on the ride screen is hard to see.* It was
 * one 1.5 px grey hairline and a 6 px dot. Since #2070 the road still to ride
 * is a solid 3 px line in `hudInk`, the road ridden on this lap a dashed 2 px
 * line in `hudInkMuted`, and the mark is twice the size: `plan.ts` states each
 * number and why. Ridden and to come differ by dash and width as well as by
 * colour, so neither is told apart by colour alone (SC 1.4.1).
 *
 * ## The rider's mark is a shape, not a colour
 *
 * `port.ts` §`RiderMarker` carries a **kind** rather than a colour because #93
 * asks the rider, the bot and the ghost to be distinguishable at a glance, and a
 * renderer handed a colour could be passed the same one twice. The same argument
 * binds here: the mark is a filled disc with a ring of the panel's own surface
 * around it, so it reads as a different *shape* from the road line
 * underneath it for a rider with a colour-vision deficiency, and in sunlight.
 * Since #2070 the road ahead is `hudInk`, the disc's own colour, so the ring
 * (`hudSurface`, 17:1 against it) is the whole of what separates the two.
 *
 * ⚠️ **The bot and the ghost are deliberately not drawn.** At this size they
 * are within a few pixels of the rider for most of a ride and would merge into
 * one blob — reintroducing exactly the "which of these is me" question the kinds
 * exist to answer. The gap to each is already a *number* on this panel, which is
 * the argument `scene.ts` §`markerAt` makes for the same split: a position tells
 * a rider roughly where, and the HUD field tells them exactly how far.
 */

import { useMemo, type JSX } from 'react';

import type { ColourToken } from '../../design/tokens';
import {
  PLAN_AHEAD_STROKE_PIXELS,
  PLAN_RIDDEN_DASH,
  PLAN_RIDDEN_STROKE_PIXELS,
  PLAN_SIZE,
  RIDER_MARK_RADIUS,
  RIDER_MARK_RING_PIXELS,
  describePlan,
  planCut,
  planPath,
  riderMark,
  routePlan,
  splitPlan,
  type PlanRun,
} from './plan';
import type { HudInput } from './fields';

/**
 * What paints each part of the plan view, and with which token — #2070.
 *
 * `theme.css` sets the colours, by class, and `PlanTrace.a11y.test.tsx`
 * holds the two to each other and every pair a rider has to tell apart to a
 * declared 3:1 (SC 1.4.11): each road against the panel, the mark's ring
 * against each road, and the mark's disc against its ring. The widths and
 * the dash are attributes on the elements rather than CSS, so the rendered
 * SVG is what the tests read them from.
 *
 * @test-facing the classes and colours are `theme.css`'s and the component's
 * own; this table is what `PlanTrace.a11y.test.tsx` holds the two to, and no
 * renderer needs to read it.
 */
export const PLAN_PAINTS: readonly {
  readonly className: string;
  readonly fill: ColourToken | 'none';
  readonly stroke: ColourToken;
}[] = [
  { className: 'oyl-hud__plan-line--ahead', fill: 'none', stroke: 'hudInk' },
  { className: 'oyl-hud__plan-line--ridden', fill: 'none', stroke: 'hudInkMuted' },
  { className: 'oyl-hud__plan-here', fill: 'hudInk', stroke: 'hudSurface' },
];

export interface PlanTraceProps {
  readonly profile: HudInput['profile'];
  /** The rider's own odometer, unwrapped. @see riderMark */
  readonly distance: number;
}

export function PlanTrace(props: PlanTraceProps): JSX.Element {
  /**
   * ⚠️ **Memoised on the profile, which is the only input the road depends on.**
   * `HudPanel` re-renders on every tick of the ride — sixty times a second on a
   * phone that `quality.ts` is already dropping render scale to keep cool — and
   * without this the whole route is re-projected, re-split and re-serialised
   * into a path string on each of them. The route cannot change during a ride:
   * `GameView` picks one before the ride starts and hands the same object down
   * until the rider ends it.
   *
   * The rider's mark below is deliberately *outside* the memo. It is the one
   * thing that does change per frame, and it is two multiplications.
   */
  const plan = useMemo(() => routePlan(props.profile), [props.profile]);
  const mark = riderMark(plan, props.profile, props.distance);
  const description = describePlan(props.profile, props.distance, plan);
  // #2070: memoised on the drawn sample the rider last passed, which changes
  // once a stride rather than once a frame. @see planCut
  const cut = planCut(plan, props.profile, props.distance);
  const split = useMemo(() => splitPlan(plan, cut), [plan, cut]);

  return (
    <div className="oyl-hud__plan">
      <svg
        className="oyl-hud__plan-svg"
        viewBox={`0 0 ${String(PLAN_SIZE)} ${String(PLAN_SIZE)}`}
        // ⚠️ **`meet`, and never the `none` the two SVGs either side of it
        // use.** `preserveAspectRatio="none"` lets the box stretch each axis
        // independently, which is harmless for a profile strip — that is a
        // picture of one number against another — and fatal here: it would
        // squash a circuit into an ellipse and a right-angle junction into a
        // sweeping bend. The shape is the whole content of this panel.
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={description}
      >
        <g aria-hidden="true">
          {/* The ridden road first, so the road ahead is drawn over it where
              the two meet at the rider. */}
          {split.ridden.map((run) => (
            <RoadLine key={`ridden-${String(run.from)}`} run={run} part="ridden" />
          ))}
          {split.ahead.map((run, index) => (
            // By position: the first run starts at the cut, which moves once a
            // stride, and a key that moved with it would remount the <path>.
            <RoadLine key={`ahead-${String(index)}`} run={run} part="ahead" />
          ))}
          <circle
            className="oyl-hud__plan-here"
            cx={mark.x}
            cy={mark.y}
            r={RIDER_MARK_RADIUS}
            strokeWidth={RIDER_MARK_RING_PIXELS}
            data-testid="oyl-hud-plan-here"
            // Read by the tests rather than inferred from the rendered
            // geometry, for the reason `ElevationStrip`'s `data-position` is:
            // an assertion about where the rider is should fail when the rider
            // is in the wrong place, not when the viewBox changes size.
            data-x={mark.x.toFixed(3)}
            data-y={mark.y.toFixed(3)}
          />
        </g>
      </svg>
    </div>
  );
}

/** One run of the road, ridden or to come. @see PLAN_PAINTS */
function RoadLine(props: {
  readonly run: PlanRun;
  readonly part: 'ridden' | 'ahead';
}): JSX.Element {
  const ridden = props.part === 'ridden';
  return (
    <path
      className={`oyl-hud__plan-line oyl-hud__plan-line--${props.part}`}
      // `round` on both, so a one-sample run between two breaks draws as a
      // dot rather than as nothing: a zero-length path with a butt cap paints
      // no pixels, which silently deletes real road from the picture.
      // `TraceChart.tsx` makes the same call.
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={ridden ? PLAN_RIDDEN_STROKE_PIXELS : PLAN_AHEAD_STROKE_PIXELS}
      strokeDasharray={ridden ? PLAN_RIDDEN_DASH : undefined}
      fill="none"
      data-oyl-plan-part={props.part}
      d={planPath(props.run)}
    />
  );
}
