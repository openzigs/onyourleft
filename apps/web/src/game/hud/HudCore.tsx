// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD that every ride shows — the readings, the elevation strip, the
 * route's second figure, *Pause* and *End ride*, the announcer's region, the
 * notices and the map credit — split out of `HudPanel.tsx` by #1650.
 *
 * `HudPanel.tsx`'s header is this component's: what the use context forces,
 * the four opaque panels and their order, and why it is DOM over the canvas.
 * Read it there; nothing it says changed.
 *
 * ## Why it is its own module — #1650
 *
 * The demo (epic #1643) shows its scripted riders' numbers through the real
 * ride HUD, never a copy. But `HudPanel` renders a room's report and
 * standings, which import `net/`, a workout's strip, and the units context,
 * which imports `@onyourleft/store`: none of which the demo build may carry
 * (`tools/demo/forbidden-modules.ts`, `demo/no-recorded-data.test.ts`). So
 * the part of the HUD that every ride shows lives here and imports none of
 * them, `HudPanel` renders it with the ride's own extras in its three slots
 * ({@link HudCoreProps.routeFigure}, {@link HudCoreProps.moreActions},
 * {@link HudCoreProps.afterActions}), and the demo renders it with none.
 * `demo/hud-overlay.test.tsx` holds both halves: the demo imports this, and
 * `HudPanel` renders it.
 */

import { useRef, useState, type JSX, type ReactNode } from 'react';

import type { UnitSystem } from '@onyourleft/store';

import { RIDE_SIZE_CLASS } from '../../design/Button';
import { TOUCH_LOCK_EXEMPT, useTouchLock } from '../../design/touch-lock';
import { TouchLockButton } from '../../design/TouchLockButton';

import {
  EMPTY_GAP_KEY,
  MOVING_TIME_KEY,
  givesWayToTheRoom,
  hudReadings,
  isDeliveryReading,
  isRoomReading,
  profileReading,
  readingTier,
  trainerLine,
  type HudInput,
  type HudReading,
  type ProfileReading,
  type ReadingTier,
} from './fields';
import type { HudPanelProps } from './HudPanel';
import { SteerKeys } from './SteerKeys';
import { ThrowControl } from './ThrowControl';

/**
 * The smallest a mid-ride control may be, in CSS pixels.
 *
 * WCAG 2.2 SC 2.5.8 asks for 24×24 and SC 2.5.5 (AAA) for 44×44. This is larger
 * than both, because both are written for someone sitting still with a dry
 * finger — #94's context is a gloved, sweating rider at threshold on a moving
 * bike, and a target that is merely conformant is not a target they can hit.
 */
export const CONTROL_MINIMUM_PIXELS = 72;

/** The props of {@link HudPanel} that every ride has. They are documented there. */
type SharedProps = Omit<
  HudPanelProps,
  | 'workout'
  | 'sound'
  | 'sideCamera'
  | 'ghostStop'
  | 'onFollowNext'
  | 'report'
  | 'keepPlan'
  | 'onReplansOff'
  | 'standings'
>;

/** What {@link HudCore} draws. */
export interface HudCoreProps extends SharedProps {
  /**
   * The rider's units. `HudPanel` reads them from `units/context.tsx`, which
   * this module may not import (the header says why); the demo passes metric.
   */
  readonly units: UnitSystem;
  /**
   * Whether the HUD offers #1482's touch lock: a rider's every ride does; the
   * demo, which nobody rides with wet gloves, does not.
   */
  readonly touchLock: boolean;
  /** What the two controls say. `HudPanel`'s are *Resume* and *End ride*. */
  readonly labels: { readonly resume: string; readonly end: string };
  /**
   * The route panel's second figure, under the elevation strip: the route's
   * plan (`PlanTrace`), or a workout's strip in its place (#1307).
   */
  readonly routeFigure: ReactNode;
  /** The actions panel's rows under *Pause* and *End ride*, in their order. */
  readonly moreActions?: ReactNode;
  /** After the actions panel in the document: a race's standings (#1347). */
  readonly afterActions?: ReactNode;
  /**
   * Leaves out the dashed *Pacer* field a ride with nobody to chase shows.
   * The demo's (owner ruling of 2026-10-25, #1650): the demo has no pacer, so
   * *Pacer —* would name a field it can never fill. A rider's ride keeps it,
   * because there a pacer is one choice away. A chased rider's gap still shows.
   */
  readonly withoutPacer?: boolean;
}

/** The id the notice toggle's `aria-controls` names. One HUD per page. */
export const STANDING_NOTICE_ID = 'oyl-hud-standing-notice';

/**
 * Each readings panel's accessible name — #1650, so a screen reader that
 * walks the HUD hears what each list is, as a sighted rider knows it by its
 * corner. The route panel needs none of its own: its elevation strip is a
 * named image and its plan says where the rider is (`PlanTrace.tsx`).
 */
export const PANEL_NAMES: Readonly<Record<ReadingTier, string>> = {
  primary: 'Power, cadence and heart rate',
  secondary: 'Ride readings',
};

/** The HUD every ride shows. @see HudCoreProps */
export function HudCore(props: HudCoreProps): JSX.Element {
  const all = hudReadings(props);
  const readings =
    props.withoutPacer === true ? all.filter((reading) => reading.key !== EMPTY_GAP_KEY) : all;
  // #1312: the lap's time joins the lap's number in the strip's sentence.
  const elevation = profileReading(props.state, props.profile, props.lapSeconds);
  // #1312: a lap gives way to every other notice. @see HudPanelProps.lapNotice
  const lap =
    hasContent(props.notices) || props.standingNotice?.expanded === true
      ? undefined
      : props.lapNotice;
  // #1482: the touch lock, over the whole HUD. The HUD's own state rather than
  // the ride controller's: a game ride need not be recording, and the
  // controller refuses the lock with no recording in progress. This component
  // is mounted for exactly one game ride, so a lock never outlives the ride.
  const hud = useRef<HTMLElement>(null);
  const [touchLocked, setTouchLocked] = useState(false);
  useTouchLock(hud, touchLocked);

  return (
    <section ref={hud} className="oyl-hud" aria-label="Ride metrics">
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

        {props.routeFigure}
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
            className={`oyl-hud__control ${RIDE_SIZE_CLASS}`}
            onClick={props.onPause}
            style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
          >
            {props.paused ? props.labels.resume : 'Pause'}
          </button>
          <button
            type="button"
            className={`oyl-hud__control ${RIDE_SIZE_CLASS}`}
            onClick={props.onEnd}
            style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
            // #1482: never stopped by the touch lock. It ends the game's
            // gradient session — what the app asks of the trainer — and a
            // rider who wants that gone must not first have to unlock, the
            // rule `End ERG` and `End workout` follow on the Ride screen. It
            // does not end the recording (`GameView.tsx` §`teardown`).
            {...{ [TOUCH_LOCK_EXEMPT]: '' }}
          >
            {props.labels.end}
          </button>
          {props.touchLock ? (
            <TouchLockButton
              locked={touchLocked}
              onLock={() => {
                setTouchLocked(true);
              }}
              onUnlock={() => {
                setTouchLocked(false);
              }}
              className="oyl-hud__lock"
            />
          ) : null}
          {/*
            #437. A constant name and `aria-expanded`, rather than a label that
            flips between "Show" and "Hide": a screen reader then says what the
            control is and which way it stands, and a speech-control user has
            one thing to say. Last, so Pause and End ride keep their places.
          */}
          {props.standingNotice === undefined ? null : (
            <button
              type="button"
              className="oyl-hud__control oyl-hud__notice-toggle"
              aria-expanded={props.standingNotice.expanded}
              aria-controls={STANDING_NOTICE_ID}
              onClick={props.standingNotice.onToggle}
              style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
            >
              Trainer notice
            </button>
          )}
        </div>
        {/*
          #1810: a Delivery round's throws, under the controls a rider presses
          every ride so those keep their places. Inside this region, so the
          touch lock refuses a tap on them as on Pause: none is exempt
          (ADR 0059 D-5). What the lock does to them is why it is handed in.
        */}
        {props.throwing === undefined ? null : (
          <ThrowControl port={props.throwing} touchLocked={touchLocked} />
        )}
        {/* #1820: a Delivery round's lane keys. Nothing drawn, so nothing the lock refuses. */}
        {props.steering === undefined ? null : <SteerKeys port={props.steering} />}
        {props.moreActions}
      </div>

      {props.afterActions}

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
        change to it rather than the region's arrival.

        ⚠️ **The notices below are NOT live regions since #445**, and a
        reviewer who remembers "event messages of their own (#394)" here is
        reading the old file: each was a second voice beside this one, and the
        HUD carried three while a notice stood. `GameView` feeds both into the
        announcer as rank-1 events, so this is the only thing on the stage that
        speaks by itself.

        ⚠️ **It sets its text IN PLACE, unlike the Ride screen's region since
        #655**, which inserts a node per sentence (`RideAnnouncer.tsx` §"said
        twice", held by `ride-announcer.a11y.test.tsx` §"#740"). So the same
        sentence twice in a row is set to the text it already holds and is
        not heard the second time here. Recorded as a known difference
        (#740), not claimed by any test of this region.
      */}
      <p className="oyl-visually-hidden" role="status" data-oyl-announcer="hud">
        {props.announcement}
      </p>

      {hasContent(props.notices) || props.standingNotice !== undefined || hasContent(lap) ? (
        <div
          className={
            hasContent(props.notices) || props.standingNotice?.expanded === true || hasContent(lap)
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
          {lap}
        </div>
      ) : null}

      {/*
        #1552 — the map data's credit, OUT of every panel since the owner's
        ruling on #1572 (ADR 0054 D-3.6, D-8 Q3: "a small line in a corner of
        the game view, clear of the HUD"). A child of the HUD itself, so that
        on the stage `theme.css` §`.oyl-hud__attribution` can set it in the
        bottom-start corner of the open road on its own opaque backing, and
        last in the document because it is read once, if at all. Plain text:
        never a live region.
      */}
      {props.attribution === undefined ? null : (
        <p className="oyl-hud__attribution">{props.attribution}</p>
      )}
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

/**
 * A field's classes. `oyl-hud__field--moving` is #1111's: on an upright phone
 * `theme.css` §"THE MOVING TIME ON AN UPRIGHT PHONE" lifts that one field out
 * of the secondary grid and sets it beside *Pause* and *End ride*, because a
 * seventh secondary reading is a third row the column layout has no height
 * for. It stays in this list in the document, where a screen reader and
 * #94's order meet it.
 */
function fieldClass(reading: HudReading): string {
  return [
    'oyl-hud__field',
    ...(reading.stale ? ['oyl-hud__field--stale'] : []),
    ...(reading.key === MOVING_TIME_KEY ? ['oyl-hud__field--moving'] : []),
    // #1356: on a phone a room's readings take the places of these.
    ...(isRoomReading(reading) ? ['oyl-hud__field--room'] : []),
    // #1812: and a Delivery round's, the same way (`theme.css` §"A ROOM RIDE ON A PHONE").
    ...(isDeliveryReading(reading) ? ['oyl-hud__field--delivery'] : []),
    ...(givesWayToTheRoom(reading) ? ['oyl-hud__field--gives-way'] : []),
  ].join(' ');
}

/** One tier's readings, as the description list `HudPanel` explains. */
function FieldList(props: {
  readonly tier: ReadingTier;
  readonly readings: readonly HudReading[];
}): JSX.Element {
  const mine = props.readings.filter((reading) => readingTier(reading) === props.tier);
  return (
    <dl
      className={`oyl-hud__panel oyl-hud__fields oyl-hud__fields--${props.tier}`}
      aria-label={PANEL_NAMES[props.tier]}
    >
      {mine.map((reading) => (
        <div key={reading.key} className={fieldClass(reading)}>
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
            {reading.gauge === undefined ? null : <Gauge fraction={reading.gauge} />}
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
 * A field's gauge — #787, the draft's (#327's indicator criteria): a bar
 * filled to `fraction` inside an outline that IS the full scale, with the
 * full-scale end drawn heavier, so "I am getting all there is" is legible.
 *
 * ⚠️ `aria-hidden`: the value and the phrase under it say the same thing in
 * words (`fields.ts` §`HudReading.gauge`). An SVG, as the elevation strip is,
 * so the fill is an attribute and no inline style is needed.
 */
function Gauge(props: { readonly fraction: number }): JSX.Element {
  const filled = Math.max(0, Math.min(1, props.fraction)) * 100;
  return (
    <svg
      className="oyl-hud__gauge"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-oyl-gauge={filled.toFixed(1)}
    >
      <rect className="oyl-hud__gauge-fill" x="0" y="0" width={filled} height="10" />
      <rect className="oyl-hud__gauge-scale" x="0" y="0" width="100" height="10" />
      <line className="oyl-hud__gauge-full" x1="100" y1="0" x2="100" y2="10" />
    </svg>
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
