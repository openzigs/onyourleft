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
 * So the line and the mark use the two tokens `contrast.a11y.test.ts` already
 * walks against `hudSurface` — `hudInkMuted` for the road and `hudInk` for the
 * rider — and no token is added. The measured contrast of this panel is
 * therefore unchanged rather than re-measured.
 *
 * ## The rider's mark is a shape, not a colour
 *
 * `port.ts` §`RiderMarker` carries a **kind** rather than a colour because #93
 * asks the rider, the bot and the ghost to be distinguishable at a glance, and a
 * renderer handed a colour could be passed the same one twice. The same argument
 * binds here: the mark is a filled disc with a ring of the panel's own surface
 * around it, so it reads as a different *shape* from the one-pixel line
 * underneath it for a rider with a colour-vision deficiency, and in sunlight.
 *
 * ⚠️ **The bot and the ghost are deliberately not drawn.** At this size they
 * are within a few pixels of the rider for most of a ride and would merge into
 * one blob — reintroducing exactly the "which of these is me" question the kinds
 * exist to answer. The gap to each is already a *number* on this panel, which is
 * the argument `scene.ts` §`markerAt` makes for the same split: a position tells
 * a rider roughly where, and the HUD field tells them exactly how far.
 */

import { useMemo, type JSX } from 'react';

import { PLAN_SIZE, RIDER_MARK_RADIUS, describePlan, planPath, riderMark, routePlan } from './plan';
import type { HudInput } from './fields';

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
          {plan.runs.map((run) => (
            <path
              key={run.from}
              className="oyl-hud__plan-line"
              // `round` on both, so a one-sample run between two breaks draws
              // as a dot rather than as nothing: a zero-length path with a butt
              // cap paints no pixels, which silently deletes real road from the
              // picture. `TraceChart.tsx` makes the same call.
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              d={planPath(run)}
            />
          ))}
          <circle
            className="oyl-hud__plan-here"
            cx={mark.x}
            cy={mark.y}
            r={RIDER_MARK_RADIUS}
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
