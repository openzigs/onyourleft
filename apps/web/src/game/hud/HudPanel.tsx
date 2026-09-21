// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD, for a phone clamped to a handlebar and read at arm's length.
 *
 * ## What the use context forces, and what it forbids
 *
 * #94 is explicit that this is not a shrunk desktop UI, and every decision below
 * follows from the context rather than from taste:
 *
 * - **Read at ~60 cm, in motion, out of breath, possibly sweating on the
 *   screen.** So: large type, high contrast, no hover state anywhere, and no
 *   information that has to be parsed rather than glanced at.
 * - **Found by position, not by reading.** `hudReadings` returns a fixed-length
 *   list in a fixed order, and a field with nothing to show is still rendered
 *   with a dash. A field that vanished would move every field after it, which is
 *   how a rider ends up reading labels at threshold.
 * - **Sweat and gloves break touch.** The two mid-ride controls are sized by
 *   {@link CONTROL_MINIMUM_PIXELS}, well above the WCAG 2.2 minimum, because the
 *   minimum assumes a dry fingertip and a stationary user.
 *
 * ⚠️ **It is DOM over the canvas, not drawn into it**, and that is load-bearing
 * three times over. The text stays vector-sharp when `quality.ts` reduces the
 * world's render scale — which is why reducing resolution is the *first* thing
 * that policy gives up. The a11y gate can audit it, so #94's contrast criterion
 * is checkable at all. And a screen reader can read it, which nothing drawn into
 * a canvas can offer.
 *
 * ## Since #423 it is an OVERLAY, and that changes its shape and not its nature
 *
 * The world is full-bleed while a ride runs and this component is laid over it.
 * So it is no longer one panel: it is **four small solid panels and the gap
 * between them**, because a single panel over a full-bleed world is a panel
 * over the road. `theme.css` §`.oyl-game--riding .oyl-hud` places them; what
 * this file decides is what is *in* each, and the DOM order, which is the order
 * a screen reader and the tab key meet them in and is unchanged from before:
 *
 * | panel | holds | corner (landscape) |
 * |---|---|---|
 * | `primary` | power, cadence, heart rate — `fields.ts` §`ReadingTier` | top, start |
 * | `secondary` | every other reading | top, end |
 * | `route` | the elevation strip and the plan view | bottom, start |
 * | `actions` | the trainer line, then Pause and End ride | bottom, end |
 *
 * ⚠️ **Every panel is OPAQUE and the container paints nothing.** `.oyl-hud`
 * used to carry the surface; it now spans the whole world and must not, so the
 * surface moved to `.oyl-hud__panel` and `hud-surface.a11y.test.ts` moved with
 * it. The frosted-glass look the genre uses is **not available here,
 * deliberately** — `design/tokens.ts` §`hudSurface` says why, and #423 says
 * that changing it is an ADR rather than a CSS edit.
 *
 * ⚠️ **Nothing here assumes what is BEHIND it.** The panels are positioned
 * against the stage, not against the `<canvas>`, and nothing reads the canvas's
 * box. #433 wants a native renderer beneath a transparent WebView; this layer
 * is the prerequisite for that and would not need to change for it.
 */

import type { JSX, ReactNode } from 'react';

import { useUnits } from '../../units/context';

import {
  NO_READING,
  hudReadings,
  profileReading,
  readingTier,
  trainerLine,
  type HudInput,
  type HudReading,
  type ProfileReading,
  type ReadingTier,
  type TrainerLine,
} from './fields';
import { PlanTrace } from './PlanTrace';

/**
 * The smallest a mid-ride control may be, in CSS pixels.
 *
 * WCAG 2.2 SC 2.5.8 asks for 24×24 and SC 2.5.5 (AAA) for 44×44. This is larger
 * than both, because both are written for someone sitting still with a dry
 * finger — #94's context is a gloved, sweating rider at threshold on a moving
 * bike, and a target that is merely conformant is not a target they can hit.
 */
export const CONTROL_MINIMUM_PIXELS = 72;

/**
 * What the HUD needs beyond its readings.
 *
 * ⚠️ `units` is **omitted** from {@link HudInput} rather than inherited: the
 * component reads the preference from `units/context.tsx` and the pure
 * function takes it as a parameter, so there is exactly one way in on each
 * side of the seam. A prop as well would be a second source for the same
 * answer, and the two could disagree on the screen a rider stares at for an
 * hour — which is the failure #238 is about.
 */
export interface HudPanelProps extends Omit<HudInput, 'units'> {
  /** Pauses the ride. Large target — see {@link CONTROL_MINIMUM_PIXELS}. */
  readonly onPause: () => void;
  /** Ends it. Same. */
  readonly onEnd: () => void;
  /** Whether the ride is currently paused, so the control says which it does. */
  readonly paused: boolean;
  /**
   * What the trainer is being asked for, or `undefined` when nothing is (#373).
   *
   * ⚠️ **Absent rather than a nought**, on the `NO_READING` precedent: a rider
   * with no trainer, or one whose machine does not offer simulation mode, is
   * not told a gradient of zero was sent to it. `GameView` supplies this only
   * once a gradient session has written something and has no fault to report —
   * a fault is a `StatusMessage`, because it is a thing to act on rather than a
   * thing to read.
   *
   * `fields.ts` §{@link TrainerLine} records why this is a row of the panel
   * rather than a tenth grid field.
   */
  readonly trainer?: TrainerLine | undefined;
  /**
   * Anything the ride has to *say* — a fault, a road that is not reaching the
   * trainer — laid out by the HUD so that it cannot land on a panel (#423).
   *
   * ⚠️ **A slot rather than a sibling of this component**, and the reason is
   * geometry: over a full-bleed world everything is positioned against the
   * stage, and two things positioned independently against one box overlap the
   * day either grows. Inside the HUD's own grid a notice gets a cell nothing
   * else can occupy. `GameView` still decides *what* is said; the markup it
   * passes is its own `StatusMessage`s, which are opaque and carry token pairs
   * `contrast.a11y.test.ts` already checks.
   */
  readonly notices?: ReactNode;
  /**
   * A notice that stands for the WHOLE ride — the road not reaching the
   * trainer — and that a rider can put away once it is read (#437).
   *
   * ⚠️ **Collapsed is visually hidden by clip, never removed.** The sentence
   * stays in the document where it was, so a screen-reader user who has not
   * reached it yet still can, and so a live region on it is not re-inserted
   * (an element moved between containers is a new element, and a new live
   * region is announced unreliably or twice). What collapsing gives back is
   * the grid cell: on a phone the notice takes the route panel's, and a
   * collapsed one takes none — `theme.css` §"WHERE THERE IS NO FREE CELL".
   *
   * ⚠️ **Separate from {@link notices}**, which are faults and always shown:
   * a refused gradient is a thing to act on NOW, and a rider must not be able
   * to put it away by mistake.
   */
  /**
   * The one sentence the announcer last produced, or `''` — #397.
   *
   * ⚠️ **Required, and that is the wiring, not a style.** CLAUDE.md §4j's
   * third limit is that an optional prop nobody supplies is green in every
   * gate, and an announcer threaded in as one would announce nothing in the
   * shipped app with the whole suite passing. `GameView` computes it through
   * `announce.ts`; the compiler refuses a HUD without it.
   */
  readonly announcement: string;
  readonly standingNotice?:
    | {
        readonly content: ReactNode;
        readonly expanded: boolean;
        readonly onToggle: () => void;
      }
    | undefined;
}

/** The id the notice toggle's `aria-controls` names. One HUD per page. */
export const STANDING_NOTICE_ID = 'oyl-hud-standing-notice';

export function HudPanel(props: HudPanelProps): JSX.Element {
  const units = useUnits();
  const readings = hudReadings({ ...props, units });
  const elevation = profileReading(props.state, props.profile);

  return (
    <section className="oyl-hud" aria-label="Ride metrics">
      {/*
        A description list, because that is what these are: a label and its
        value, seven times. It was an `ol` of `span`s first, which needed
        `aria-labelledby` to associate the two — and the audit rejected it,
        correctly: ARIA prohibits naming an element with no role, so the
        association was decorative and a screen reader would have read seven
        orphaned numbers. `dt`/`dd` carries the same association in HTML, with
        no ARIA at all.

        ⚠️ **Two lists since #423, in the order there was one.** The primary
        three were already first, so splitting the list at the tier boundary
        moves nothing: a screen reader meets the same readings in the same
        order, and a sighted rider finds each where `fields.ts` §`ReadingTier`
        says it is.
      */}
      <FieldList tier="primary" readings={readings} />
      <FieldList tier="secondary" readings={readings} />

      <div className="oyl-hud__panel oyl-hud__route">
        <ElevationStrip reading={elevation} profile={props.profile} />

        {/*
          #285 — the other axis. The strip above says how far is left; this says
          where on the road that is. It is handed the ride's own odometer and
          nothing else, for the reason `ElevationStrip` is handed
          {@link profileReading}: there is no second value in existence for it
          to drift from. ⚠️ **The odometer rather than the strip's fraction**,
          which is already wrapped — this component needs the unwrapped one,
          because `riderMark` composes `distanceOnRoute` itself and wrapping
          twice is not the same as wrapping once. Since #287 both panels wrap
          through `plan.ts` §`planProgress`; before it, the strip clamped and
          this comment recorded why the plan view could not read its number.
        */}
        <PlanTrace profile={props.profile} distance={props.state.ride.distance} />
      </div>

      <div className="oyl-hud__panel oyl-hud__actions">
        {/*
          ⚠️ **Inside a panel, and above the controls** — #373. It used to be a
          `<p className="oyl-muted">` that `GameView` rendered *after* this
          component, on the page background, and in landscape it fell outside
          the viewport with nothing to say it was there. `fields.ts`
          §{@link TrainerLine} argues the placement.

          ⚠️ **#373 did not make it visible in landscape, and a reviewer who
          remembers this comment saying it did is reading the old file.** It
          moved the line into a panel that was itself 572 px tall in a 390 px
          viewport, so the line went from lost below the panel to lost at the
          bottom of it — confirmed on a tablet on 2026-09-20 (#422). What makes
          it visible is #423: it shares a panel with *Pause* and *End ride*,
          that panel is pinned to a corner of the stage, and
          `browser/ride.browser.spec.ts` measures all three inside the viewport
          with no scrolling at a phone and a landscape-tablet viewport.

          Above the controls rather than below them so that a rider who can see
          *Pause* can see this line — which makes its reachability a consequence
          of something that must already be true, rather than a second rule.
        */}
        {props.trainer === undefined ? null : (
          <p className="oyl-hud__trainer">{trainerLine(props.trainer)}</p>
        )}

        <div className="oyl-hud__controls">
          <button
            type="button"
            className="oyl-hud__control"
            onClick={props.onPause}
            style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
          >
            {props.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="oyl-hud__control"
            onClick={props.onEnd}
            style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
          >
            End ride
          </button>
          {/*
            #437. A constant name and `aria-expanded`, rather than a label that
            flips between "Show" and "Hide": a screen reader then says what the
            control is and which way it stands, and a speech-control user has
            one thing to say. Last, so Pause and End ride keep their places.
          */}
          {props.standingNotice === undefined ? null : (
            <button
              type="button"
              className="oyl-hud__control"
              aria-expanded={props.standingNotice.expanded}
              aria-controls={STANDING_NOTICE_ID}
              onClick={props.standingNotice.onToggle}
              style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
            >
              Trainer notice
            </button>
          )}
        </div>
      </div>

      {/*
        Last in the document and placed by the grid, not by this position: a
        notice is an exception, and an exception read out after the instruments
        is the order the screen had before #423 too.

        ⚠️ **The wrapper is rendered only when there is something in it.** An
        empty grid item is still a grid item, and this one would sit across the
        middle of the stage — the part of the screen the whole layout exists to
        keep clear — catching pointer events over nothing.
      */}
      {/*
        #397: the ONE region the announcer writes into. Visually hidden by CLIP
        (`oyl-visually-hidden`) — never `display: none`, `hidden` or
        `aria-hidden`, because no live region announces while hidden — and
        rendered from the first frame, EMPTY, so that the first sentence is a
        change to it rather than the region's arrival. Before the notices in
        the document, which are event messages of their own (#394).
      */}
      <p className="oyl-visually-hidden" role="status" data-oyl-announcer="hud">
        {props.announcement}
      </p>

      {hasContent(props.notices) || props.standingNotice !== undefined ? (
        <div
          className={
            hasContent(props.notices) || props.standingNotice?.expanded === true
              ? 'oyl-hud__notices'
              : 'oyl-hud__notices oyl-hud__notices--collapsed'
          }
        >
          {props.standingNotice === undefined ? null : (
            <div
              id={STANDING_NOTICE_ID}
              className={props.standingNotice.expanded ? undefined : 'oyl-visually-hidden'}
            >
              {props.standingNotice.content}
            </div>
          )}
          {props.notices}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Whether a slot was handed anything React will render.
 *
 * `GameView` builds its notices as an array of *conditionals*, so "nothing to
 * say" arrives as `[undefined, undefined]` rather than as `undefined` — and
 * both have to mean the wrapper is not rendered.
 */
function hasContent(node: ReactNode): boolean {
  if (Array.isArray(node)) {
    return (node as readonly ReactNode[]).some(hasContent);
  }
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** One tier's readings, as the description list `HudPanel` explains. */
function FieldList(props: {
  readonly tier: ReadingTier;
  readonly readings: readonly HudReading[];
}): JSX.Element {
  const mine = props.readings.filter((reading) => readingTier(reading) === props.tier);
  return (
    <dl className={`oyl-hud__panel oyl-hud__fields oyl-hud__fields--${props.tier}`}>
      {mine.map((reading) => (
        <div
          key={reading.key}
          className={reading.stale ? 'oyl-hud__field oyl-hud__field--stale' : 'oyl-hud__field'}
        >
          <dt className="oyl-hud__label">{reading.label}</dt>
          <dd
            className={
              // #259. A word does not fit the slot a number fits — the class
              // is what sets it smaller, and `fields.ts` §`HudReading.word`
              // is the measurement behind it.
              reading.word === true ? 'oyl-hud__value oyl-hud__value--word' : 'oyl-hud__value'
            }
          >
            {reading.value}
            {reading.unit === '' ? null : <span className="oyl-hud__unit"> {reading.unit}</span>}
            {reading.detail === undefined ? null : (
              // ⚠️ Inside the `dd`, not beside it. A screen reader announces
              // one definition per term, so a phrase in a sibling element
              // would be read as loose text after the reading rather than as
              // part of it — and #255's first defect is precisely that the
              // number and the words describing it were heard as one thing
              // while meaning another. `fields.ts` §`HudReading.detail` says
              // why the phrase is not folded into the value instead.
              <span className="oyl-hud__detail"> {reading.detail}</span>
            )}
            {reading.stale ? (
              // ⚠️ Words, not only a tint. #94's second criterion is that a
              // dropped sensor be distinguishable from a zero — and a rider
              // who cannot see the tint, or is looking at a screen washed out
              // by sunlight, gets the distinction from this line and from the
              // dash beside it. The colour is the third signal, not the only
              // one.
              <span className="oyl-hud__stale"> Sensor lost</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The elevation profile with "you are here".
 *
 * #94 calls this *"the single most motivating element — it shows what is coming
 * and what is done"*. It is an SVG rather than a canvas for the same reason the
 * rest of the HUD is DOM, and it is drawn from the profile's own grid so the
 * shape a rider sees is the shape the trainer is about to make them ride.
 *
 * ⚠️ The marker's position, the sentence and the accessible name all come from
 * one {@link profileReading}, which reads the ride state's distance and nothing
 * else. #94's third criterion asks for exactly that — *"a test asserts the
 * marker tracks the physics position rather than a separately-computed value
 * that can drift"* — and the way to satisfy it is to leave no second value in
 * existence to drift from. This component therefore computes no percentage of
 * its own; it is handed one and renders it three ways.
 *
 * ⚠️ **The picture is unchanged on a loop and that is deliberate — #287.** The
 * elevation profile genuinely ends, so there is no more road to draw; what a
 * second lap changes is where the marker is on it, which now sweeps the strip
 * again rather than sitting on the right-hand edge for the rest of the ride.
 */
function ElevationStrip(props: {
  readonly reading: ProfileReading;
  readonly profile: HudInput['profile'];
}): JSX.Element {
  const elevations = props.profile.elevations;
  const points = strip(elevations);
  const percent = props.reading.position * 100;
  return (
    <div className="oyl-hud__profile">
      <svg
        className="oyl-hud__profile-svg"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        role="img"
        aria-label={props.reading.label}
      >
        <polyline className="oyl-hud__profile-line" points={points} />
        <line
          className="oyl-hud__profile-here"
          x1={percent}
          y1={0}
          x2={percent}
          y2={24}
          data-testid="oyl-hud-position"
          // ⚠️ **The contract this attribute carries changed in #287**: it is
          // the fraction along the profile, WRAPPED on a `loop: true` route and
          // clamped on any other, rather than always clamped. It is the same
          // number the marker's `x` is drawn from and the same one the sentence
          // below is rounded from, so a test reading it is reading what the
          // rider sees. `HudPanel.a11y.test.tsx` asserts both halves.
          data-position={String(props.reading.position)}
        />
      </svg>
      {/*
        The non-visual equivalent, which the rest of this app provides for every
        chart (#77's, #50's). A profile is a picture of a number, and the number
        is available.
      */}
      <p className="oyl-hud__profile-text">{props.reading.text}</p>
    </div>
  );
}

/** The profile as SVG polyline points, normalised into the 100×24 viewBox. */
function strip(elevations: readonly number[]): string {
  if (elevations.length === 0) {
    return '';
  }
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const elevation of elevations) {
    lowest = Math.min(lowest, elevation);
    highest = Math.max(highest, elevation);
  }
  // A flat route has no range to normalise against; drawing it down the middle
  // is honest and dividing by zero is not.
  const range = highest - lowest;
  const step = elevations.length > 1 ? 100 / (elevations.length - 1) : 0;
  const parts: string[] = [];
  for (let index = 0; index < elevations.length; index += 1) {
    const height = range > 0 ? ((elevations[index] as number) - lowest) / range : 0.5;
    parts.push(`${(index * step).toFixed(2)},${(24 - height * 24).toFixed(2)}`);
  }
  return parts.join(' ');
}

export { NO_READING };
