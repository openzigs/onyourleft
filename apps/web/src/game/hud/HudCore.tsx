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

import { useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import type { UnitSystem } from '@onyourleft/store';

import { RIDE_SIZE_CLASS } from '../../design/Button';
import { TOUCH_LOCK_EXEMPT, useTouchLock } from '../../design/touch-lock';
import { TouchLockButton } from '../../design/TouchLockButton';

import {
  CLOCK_KEY,
  GRADIENT_KEY,
  ELAPSED_TIME_KEY,
  EMPTY_GAP_KEY,
  MOVING_TIME_KEY,
  givesWayToTheRoom,
  hudReadings,
  isDeliveryReading,
  isEffortReading,
  isRideTotalReading,
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
import { isLapRaceReading, riderHolds } from './lap-race-hud';
import {
  GRADE_BANDS,
  LOOK_AHEAD_METRES,
  LOOK_AHEAD_RISE_METRES,
  LOOK_AHEAD_WORDS,
  gradeBand,
  lookAhead,
  nextClimbLabel,
  nextClimbText,
  routeBands,
  type GradeBand,
  type GradeBandKey,
  type LookAhead,
} from './look-ahead';
import { ControllerIntents } from './ControllerIntents';
import { GamepadIntents } from './GamepadIntents';
import { ItemControl } from './ItemControl';
import { RecentGraph } from './RecentGraph';
import { FOCUS_MORE_KEYS, focusReadings } from './focus-readout';
import { DEFAULT_HUD_LAYOUT, focusArrangement, panelShown } from './hud-layout-preference';
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
   * The time of day — #2072, `fields.ts` §`HudInput.timeOfDay`. `HudPanel`
   * reads it from the device; the demo passes none, and has no clock.
   */
  readonly timeOfDay?: Date | undefined;
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
  /**
   * Leaves out the second control, *End ride* (*Stop* on the demo), and keeps
   * *Pause*. The demo's `?controls=0` (#1654, owner ruling of 2026-10-30): an
   * embedding site may drop *Stop*, but *Pause* and *Play* always stay, so the
   * demo meets WCAG 2.2 SC 2.2.2 on its own. A rider's ride never passes it.
   */
  readonly withoutEnd?: boolean;
  /**
   * Leaves out *Elapsed* (#2072). The demo's: its clock stops while it is
   * paused, so it has no elapsed time apart from the moving time it shows,
   * and the same figure under two labels would say it had never paused. A
   * rider's ride keeps it.
   */
  readonly withoutElapsed?: boolean;
  /**
   * Leaves out *Distance*, *Climbed* and *Avg power* (#2076). The demo's: it
   * records nothing, so the three would be dashes for as long as it plays.
   * A rider's ride keeps them.
   */
  readonly withoutTotals?: boolean;
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
  primary: 'Power, cadence, heart rate and gradient',
  secondary: 'Ride readings',
};

/**
 * The focus readout's two lists' accessible names — #2383, as
 * {@link PANEL_NAMES} names each tier.
 */
export const FOCUS_NAMES = {
  main: 'Power, cadence and heart rate',
  more: 'Speed, average power, distance and ride time',
} as const;

/**
 * Whether a reading is a mode's own — a room's, a Delivery round's, a lap
 * race's — which is the ride itself rather than a reading of it.
 *
 * #2383: **a ride with any keeps the full arrangement**, whatever the rider
 * chose. Every one of those layouts — a race's standings, the room's row, a
 * round's houses and its map credit — is fitted around the two tiers' own
 * heights at each viewport, and the focus readout in their place put a panel
 * over the leaning rider on an upright phone and the standings over the
 * controls on the 4:3 tablet (`ride-hud-layout.browser.spec.ts` §"#2383",
 * measured). A mode is chosen before the ride and held for it, so the
 * arrangement never changes under a rider mid-ride.
 */
function isModeReading(reading: HudReading): boolean {
  return isRoomReading(reading) || isDeliveryReading(reading) || isLapRaceReading(reading);
}

/**
 * What stays of the secondary tier when a rider turns its readings off —
 * #2079: the ride's three times (drawn beside the controls and in the primary
 * panel's clock row on most layouts) and whatever the ride's mode is about —
 * a room's, a Delivery round's, a lap race's — which are the ride itself
 * rather than a reading of it.
 */
function keptWithReadingsHidden(reading: HudReading): boolean {
  return (
    reading.key === MOVING_TIME_KEY ||
    reading.key === ELAPSED_TIME_KEY ||
    reading.key === CLOCK_KEY ||
    isModeReading(reading)
  );
}

/** The HUD every ride shows. @see HudCoreProps */
export function HudCore(props: HudCoreProps): JSX.Element {
  const all = hudReadings(props);
  // #2079: the rider's own choice of panels and text size, as the ride began.
  const layout = props.layout ?? DEFAULT_HUD_LAYOUT;
  // #2383: the focus readout in place of the two tiers, on a ride with no
  // mode of its own. @see isModeReading
  const focus = focusArrangement(layout) && !all.some(isModeReading);
  const readings = all.filter(
    (reading) =>
      !(props.withoutPacer === true && reading.key === EMPTY_GAP_KEY) &&
      !(props.withoutElapsed === true && reading.key === ELAPSED_TIME_KEY) &&
      !(props.withoutTotals === true && isRideTotalReading(reading)) &&
      !(
        !panelShown(layout, 'readings') &&
        readingTier(reading) === 'secondary' &&
        !keptWithReadingsHidden(reading) &&
        // The focus readout names its own readings (speed, average power,
        // distance): turning "Ride readings" off must not empty it silently.
        !(focus && (FOCUS_MORE_KEYS as readonly string[]).includes(reading.key))
      ),
  );
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
  // #2349: while the end-of-ride question is open it stands where Pause and
  // End ride do, and when it closes with the ride still on (Keep riding),
  // focus goes back to End ride — the control that opened it (SC 2.4.3).
  const asking = props.endQuestion !== undefined;
  const endButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && !asking) {
      endButton.current?.focus();
    }
    wasAsking.current = asking;
  }, [asking]);

  return (
    <section
      ref={hud}
      className={[
        'oyl-hud',
        ...(layout.textSize === 'normal' ? [] : [`oyl-hud--text-${layout.textSize}`]),
        ...(focus ? ['oyl-hud--focus'] : []),
      ].join(' ')}
      aria-label="Ride metrics"
      data-oyl-hud-text={layout.textSize}
      data-oyl-hud-arrangement={focus ? 'focus' : 'full'}
    >
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
      {focus ? (
        // #2383: one compact readout in place of the two tiers.
        <FocusReadout readings={readings} />
      ) : (
        <>
          <FieldList tier="primary" readings={readings} />
          <FieldList tier="secondary" readings={readings} />
        </>
      )}

      {/*
        #2079: the route panel holds the strip and the plan, and the recent
        graph; each may be turned off, and with both off there is no panel.
      */}
      {!panelShown(layout, 'route') &&
      (props.recent === undefined || !panelShown(layout, 'graph')) ? null : (
        <div className="oyl-hud__panel oyl-hud__route">
          {panelShown(layout, 'route') ? (
            <>
              <ElevationStrip
                reading={elevation}
                profile={props.profile}
                distance={props.state.ride.distance}
                units={props.units}
              />

              {props.routeFigure}
            </>
          ) : null}

          {/* #2078: the last ten minutes of power and heart rate. */}
          {props.recent === undefined || !panelShown(layout, 'graph') ? null : (
            <RecentGraph
              samples={props.recent.samples}
              written={props.recent.written}
              threshold={props.thresholdPower}
            />
          )}
        </div>
      )}

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

        {props.endQuestion === undefined ? null : props.endQuestion}
        {props.endQuestion !== undefined ? null : (
          <div className="oyl-hud__controls">
            <button
              type="button"
              className={`oyl-hud__control ${RIDE_SIZE_CLASS}`}
              onClick={props.onPause}
              style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
            >
              {props.paused ? props.labels.resume : 'Pause'}
            </button>
            {props.withoutEnd === true ? null : (
              <button
                ref={endButton}
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
            )}
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
        )}
        {/*
          #1810: a Delivery round's throws, under the controls a rider presses
          every ride so those keep their places. Inside this region, so the
          touch lock refuses a tap on them as on Pause: none is exempt
          (ADR 0059 D-5). What the lock does to them is why it is handed in.
        */}
        {props.throwing === undefined || asking ? null : (
          <ThrowControl port={props.throwing} touchLocked={touchLocked} />
        )}
        {/*
          #1901: a lap race's item use, where the throws stand on a round.
          Inside this region, so the lock refuses a tap on it as on Pause: it
          is not exempt (ADR 0060 D-13), and a key or a pad still uses the item.
        */}
        {props.items === undefined || asking ? null : (
          <ItemControl
            port={props.items}
            touchLocked={touchLocked}
            // #1968: unavailable while the race says nothing is held. A HUD
            // handed an item port and no race cannot know, and refuses nothing.
            held={props.lapRace === undefined || riderHolds(props.lapRace)}
          />
        )}
        {/* #1820: a Delivery round's or a lap race's lane keys. Nothing drawn, so nothing the lock refuses. */}
        {props.steering === undefined ? null : <SteerKeys port={props.steering} />}
        {/* #1821: a gamepad's throws, items and lane changes, to the same ports. Nothing drawn. */}
        {props.throwing === undefined &&
        props.steering === undefined &&
        props.items === undefined ? null : (
          <GamepadIntents throwing={props.throwing} steering={props.steering} items={props.items} />
        )}
        {/* #1827: a paired steering controller's lane changes, lanes and throws, to a round's ports. Nothing drawn. */}
        {props.controller === undefined ||
        (props.throwing === undefined && props.steering === undefined) ? null : (
          <ControllerIntents
            controller={props.controller}
            throwing={props.throwing}
            steering={props.steering}
            lanes={props.lanes}
          />
        )}
        {asking ? null : props.moreActions}
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
    // #2071: the gradient, which an upright phone with no room for a fourth
    // primary track draws in the secondary panel (`theme.css`
    // §"THE GRADIENT, PRIMARY").
    ...(reading.key === GRADIENT_KEY ? ['oyl-hud__field--gradient'] : []),
    // #2291: the gradient's digits and glyph in its band's colour (`theme.css`
    // §"THE GRADIENT IN ITS BAND'S COLOUR").
    ...(reading.grade === undefined ? [] : [`oyl-hud__field--grade-${bandOf(reading)}`]),
    // #2072: the clock row's two (`theme.css` §"THE CLOCK ROW").
    ...(reading.key === ELAPSED_TIME_KEY ? ['oyl-hud__field--elapsed'] : []),
    ...(reading.key === CLOCK_KEY ? ['oyl-hud__field--clock'] : []),
    // #1356: on a phone a room's readings take the places of these.
    ...(isRoomReading(reading) ? ['oyl-hud__field--room'] : []),
    // #1812: and a Delivery round's, the same way (`theme.css` §"A ROOM RIDE ON A PHONE").
    ...(isDeliveryReading(reading) ? ['oyl-hud__field--delivery'] : []),
    // #1904: and a lap race's, the same way; and a field warning of a hit
    // coming is outlined (`theme.css` §"A LAP RACE ON THE HUD").
    ...(isLapRaceReading(reading) ? ['oyl-hud__field--lap-race'] : []),
    ...(reading.alert === true ? ['oyl-hud__field--alert'] : []),
    ...(givesWayToTheRoom(reading) ? ['oyl-hud__field--gives-way'] : []),
    // #2076: the ride so far (`theme.css` §"THE RIDE SO FAR").
    ...(isRideTotalReading(reading) ? ['oyl-hud__field--total'] : []),
    // #2077: and the rider's own effort, drawn where the ride so far is.
    ...(isEffortReading(reading) ? ['oyl-hud__field--effort'] : []),
    // #2213 with #2076: the 4:3 tablet sets *Avg power* in its narrowest
    // track (`theme.css` §"THE RIDE SO FAR AT ARM'S LENGTH").
    ...(reading.key === 'averagePower' ? ['oyl-hud__field--average-power'] : []),
    // And the distance and the climb by name, which it sets in the second
    // row's wide tracks there (the same section).
    ...(reading.key === 'distance' ? ['oyl-hud__field--distance'] : []),
    ...(reading.key === 'climbed' ? ['oyl-hud__field--climbed'] : []),
    // #2080: a room's draft by name, which gives way to a race's standings
    // with the swap in them at large text (`theme.css` §"A LOOP'S LAP SPLITS").
    ...(reading.key === 'room-draft' ? ['oyl-hud__field--draft'] : []),
  ].join(' ');
}

/**
 * One reading: its label and its value, as the description list `HudPanel`
 * explains. Shared by the two tiers and by #2383's focus readout, so a reading
 * is drawn the same way wherever it is.
 */
function Field(props: { readonly reading: HudReading }): JSX.Element {
  const { reading } = props;
  return (
    <div
      className={fieldClass(reading)}
      data-grade-band={reading.grade === undefined ? undefined : bandOf(reading)}
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
        <Value reading={reading} />
        {reading.unit === '' ? null : (
          <span className="oyl-hud__unit">
            {' '}
            {reading.unit}
            {reading.slope === undefined ? null : (
              <SlopeGlyph
                slope={reading.slope}
                band={reading.grade === undefined ? undefined : bandOf(reading)}
              />
            )}
          </span>
        )}
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
        {reading.zone === undefined ? null : <ZoneBar shares={reading.zone.shares} />}
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
  );
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
        <Field key={reading.key} reading={reading} />
      ))}
    </dl>
  );
}

/**
 * #2383's focus readout: one panel, two description lists — the three large
 * readings, and the four smaller ones under them (`focus-readout.ts`). Two
 * lists rather than one so each row is named, as each tier is, and a screen
 * reader meets them in the order a sighted rider reads them.
 */
function FocusReadout(props: { readonly readings: readonly HudReading[] }): JSX.Element {
  const { main, more } = focusReadings(props.readings);
  return (
    <div className="oyl-hud__panel oyl-hud__focus">
      <dl className="oyl-hud__fields oyl-hud__focus-main" aria-label={FOCUS_NAMES.main}>
        {main.map((reading) => (
          <Field key={reading.key} reading={reading} />
        ))}
      </dl>
      <dl className="oyl-hud__fields oyl-hud__focus-more" aria-label={FOCUS_NAMES.more}>
        {more.map((reading) => (
          <Field key={reading.key} reading={reading} />
        ))}
      </dl>
    </div>
  );
}

/**
 * This ride's time in each power zone — #2077: one thin bar, each zone's share
 * a segment in its colour, in zone order. `aria-hidden`, and never the only
 * carrier: the zone indicator's number and name say where the rider is now,
 * and the Analysis screen's zone chart says the whole ride in words. Its
 * outline alone with nothing recorded.
 */
function ZoneBar(props: { readonly shares: readonly number[] }): JSX.Element {
  let from = 0;
  return (
    <svg
      className="oyl-hud__zone-bar"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-oyl-zone-shares={props.shares.map((share) => share.toFixed(3)).join(',')}
    >
      {props.shares.map((share, index) => {
        const width = share * 100;
        const x = from;
        from += width;
        return width > 0 ? (
          <rect
            key={index}
            className={`oyl-hud__zone-bar-part oyl-hud__zone-bar-part--${String(index + 1)}`}
            x={x}
            y={0}
            width={width}
            height={10}
          />
        ) : null;
      })}
      <rect className="oyl-hud__zone-bar-scale" x="0" y="0" width="100" height="10" />
    </svg>
  );
}

/**
 * A reading's value — and, for a signed one (#2071, the gradient's), its sign
 * in a span of its own: `theme.css` §"THE GRADIENT, PRIMARY" sets the sign
 * smaller than the digits, which is what lets `+12.5` fit a primary track on
 * a phone on its side. The text is the value's own, so a reader of the `dd`
 * reads `+4.5` exactly as `fields.ts` formatted it.
 *
 * #2291: the gradient's DIGITS are a span of their own too, which `theme.css`
 * colours by the band, and the sign is not in it. The digits are never under
 * 24 px, so a band's colour is a large-text pair (3:1, declared in
 * `tokens.ts`); the sign is half their size, small text, and keeps the ink.
 */
function Value(props: { readonly reading: HudReading }): JSX.Element {
  const { value, slope, grade, zone } = props.reading;
  // #2077: the zone's number beside a swatch of the zone's own colour. The
  // swatch is `aria-hidden`: the number IS the reading, and the name under it
  // says the same in words, so the colour is never the only carrier.
  if (zone?.current !== undefined) {
    return (
      <>
        <svg
          className={`oyl-hud__zone-swatch oyl-hud__zone-swatch--${String(zone.current)}`}
          viewBox="0 0 10 10"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="0" y="0" width="10" height="10" rx="2" />
        </svg>
        {value}
      </>
    );
  }
  const sign = value.charAt(0);
  const signed = slope !== undefined && (sign === '+' || sign === '-');
  const digits = signed ? value.slice(1) : value;
  const drawn = grade === undefined ? digits : <span className="oyl-hud__digits">{digits}</span>;
  if (!signed) return <>{drawn}</>;
  return (
    <>
      <span className="oyl-hud__sign">{sign}</span>
      {drawn}
    </>
  );
}

/** The band of the grade a reading shows — #2291. @see HudReading.grade */
function bandOf(reading: HudReading): GradeBandKey {
  return gradeBand(reading.grade ?? 0).key;
}

/**
 * The gradient's slope glyph — #2071: a short stroke beside its unit, rising
 * for a climb, falling for a descent, flat for level road, so the sign is
 * read as a shape as well as a character (`fields.ts`
 * §`HudReading.slope`). ⚠️ `aria-hidden`: the signed value says it in text.
 *
 * #2291: STEEPER for a steeper band ({@link SLOPE_RISE}), and in the band's
 * colour, so the band the digits are coloured by is a shape as well — colour
 * is never the only thing that says it.
 */
function SlopeGlyph(props: {
  readonly slope: 'up' | 'down' | 'level';
  readonly band: GradeBandKey | undefined;
}): JSX.Element {
  const rise = props.slope === 'level' ? 0 : SLOPE_RISE[props.band ?? 'wall'];
  const half = rise / 2;
  // Top-down in its 16 × 12 box: a rising stroke ends higher than it starts.
  const [from, to] = props.slope === 'up' ? [6 + half, 6 - half] : [6 - half, 6 + half];
  return (
    <svg
      className="oyl-hud__slope"
      viewBox="0 0 16 12"
      aria-hidden="true"
      focusable="false"
      data-oyl-slope={props.slope}
    >
      <line x1="1" y1={from} x2="15" y2={to} />
    </svg>
  );
}

/**
 * How far the slope glyph's stroke climbs or falls across its box, by band —
 * #2291. A flat stretch that is not level is a slight tilt, and each band up
 * is a steeper one; a descent (every grade at or below −3 %) falls as a steep
 * climb rises. 10 is the box's whole usable height, #2071's one angle.
 */
const SLOPE_RISE: Readonly<Record<GradeBandKey, number>> = {
  descent: 8,
  flat: 3,
  climb: 6,
  steep: 8,
  wall: 10,
};

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
 * The elevation profile with "you are here", and the road ahead beside it.
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
 *
 * ## Filled, and the road ahead beside it — #2075
 *
 * The whole route is a FILLED shape since #2075 (in `hudBorder` until
 * #2291), with the marker in `hudInk` over a wider stroke of the panel's
 * surface, so it reads against the fill and the empty sky alike. Beside it,
 * {@link LookAheadStrip} draws the road ahead (2 km since #2291) at a fixed
 * scale, and the next climb is written under it.
 *
 * ## Shaded by steepness — #2291
 *
 * The whole route's fill is its grade bands since #2291 ({@link routeBands}),
 * where it was one grey: each band's run a column of its colour and pattern,
 * as on the road ahead, CLIPPED to the route's filled shape so the shape is
 * the route's and the shading says how steep each part of it is. The patterns
 * are the road ahead's, sized for this strip's 100 × 24 box ({@link
 * ROUTE_PATTERN}), so a band is not told by colour alone here either. The
 * marker is drawn over the bands as before, its surface-coloured edge what
 * separates it from each band's colour (each a declared 3:1 on the surface).
 */
function ElevationStrip(props: {
  readonly reading: ProfileReading;
  readonly profile: HudInput['profile'];
  readonly distance: number;
  readonly units: UnitSystem;
}): JSX.Element {
  // React's ids carry punctuation a `url(#…)` reference need not survive.
  const id = `oyl-route-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { profile } = props;
  // Once per route: the HUD renders many times a second, the route never changes.
  const fill = useMemo(() => {
    const points = strip(profile.elevations);
    if (points === '') return null;
    return (
      <>
        <defs>
          <clipPath id={`${id}-shape`}>
            <polygon className="oyl-hud__profile-shape" points={`0,24 ${points} 100,24`} />
          </clipPath>
          {GRADE_BANDS.map((band) => (
            <BandPattern key={band.key} id={`${id}-${band.key}`} band={band} {...ROUTE_PATTERN} />
          ))}
        </defs>
        <g className="oyl-hud__profile-fill" clipPath={`url(#${id}-shape)`}>
          {routeBands(profile).map((run) => (
            <rect
              key={`${run.band}-${String(run.from)}`}
              className={`oyl-hud__profile-run oyl-hud__profile-run--${run.band}`}
              x={run.from * 100}
              y={0}
              width={(run.to - run.from) * 100}
              height={24}
              fill={`url(#${id}-${run.band})`}
              data-band={run.band}
            />
          ))}
        </g>
      </>
    );
  }, [id, profile]);
  const percent = props.reading.position * 100;
  const ahead = lookAhead(profile, props.distance);
  const climb = nextClimbText(ahead.climb, props.units);
  return (
    <div className="oyl-hud__profile">
      <div className="oyl-hud__strips">
        <svg
          className="oyl-hud__profile-svg"
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          role="img"
          aria-label={props.reading.label}
        >
          {fill}
          <line className="oyl-hud__profile-here-edge" x1={percent} y1={0} x2={percent} y2={24} />
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
        <LookAheadStrip ahead={ahead} label={nextClimbLabel(ahead.climb, props.units)} />
      </div>
      {/*
        The non-visual equivalent, which the rest of this app provides for every
        chart (#77's, #50's). A profile is a picture of a number, and the number
        is available. The next climb is its own line beside it (#2075), so a
        sentence other features read whole stays the sentence it was; since
        #2291 it names the top of the climb the rider is on.
      */}
      <div className="oyl-hud__profile-captions">
        <p className="oyl-hud__profile-text">{props.reading.text}</p>
        {climb === undefined ? null : (
          <p className="oyl-hud__ahead-text" data-testid="oyl-hud-next-climb">
            {climb}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The road ahead — #2075, `look-ahead.ts`; 2 km of it since #2291.
 *
 * The viewBox is the window itself: {@link LOOK_AHEAD_METRES} across and
 * {@link LOOK_AHEAD_RISE_METRES} of height up, so a metre of climb is the same
 * height on every route and a steeper road is a steeper line. The rider is the
 * left edge. Each run of one grade band is a column of the strip's full
 * height filled with its band's PATTERN — the band's colour under hatching or
 * dots in the panel's own surface — so a band is never told by colour alone
 * (SC 1.4.1), and a descent is as tall as a climb (the owner's review of
 * 2026-11-05). The road is a line over the bands; the caption under the
 * strips says the next climb in words.
 *
 * `role="img"` with the next climb as its name, as the whole route's strip is
 * named by its sentence.
 *
 * #2291: the top of the climb the rider is on, or of the next one, is a
 * dashed ink line across the strip where the climb ends, when the window
 * reaches it — a SHAPE, unlike the rider's solid edge. On a climb the caption
 * says how far it is; before one, the strip's name does, and the caption
 * keeps #2075's phrase (`look-ahead.ts` §`nextClimbText` says why).
 */
function LookAheadStrip(props: { readonly ahead: LookAhead; readonly label: string }): JSX.Element {
  // React's ids carry punctuation a `url(#…)` reference need not survive.
  const id = `oyl-ahead-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { ahead } = props;
  const yOf = (height: number): number =>
    LOOK_AHEAD_RISE_METRES - Math.min(LOOK_AHEAD_RISE_METRES, Math.max(0, height));
  const road = ahead.points
    .map((point) => `${String(point.ahead)},${String(yOf(point.height))}`)
    .join(' ');
  // The climb's top, where the window reaches it.
  const top =
    ahead.climb !== undefined && ahead.climb.topIn <= ahead.length ? ahead.climb.topIn : undefined;
  return (
    <svg
      className="oyl-hud__ahead-svg"
      viewBox={`0 0 ${String(LOOK_AHEAD_METRES)} ${String(LOOK_AHEAD_RISE_METRES)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`The ${LOOK_AHEAD_WORDS}: ${props.label}`}
      data-testid="oyl-hud-look-ahead"
    >
      <defs>
        {GRADE_BANDS.map((band) => (
          <BandPattern key={band.key} id={`${id}-${band.key}`} band={band} {...AHEAD_PATTERN} />
        ))}
      </defs>
      {ahead.runs.map((run) => (
        // The owner's review of 2026-11-05: each band at the strip's FULL
        // height, not under the road's line. At the fixed scale a descent or
        // a flat ends at the window's floor and was a sliver a pixel or two
        // tall; a band's height now says nothing, so every band is as
        // readable as a climb's, and the road's shape is the line below.
        <rect
          key={`${run.band}-${String(run.start)}`}
          className={`oyl-hud__ahead-run oyl-hud__ahead-run--${run.band}`}
          x={run.start}
          y={0}
          width={run.end - run.start}
          height={LOOK_AHEAD_RISE_METRES}
          fill={`url(#${id}-${run.band})`}
          data-band={run.band}
          data-start={String(run.start)}
          data-end={String(run.end)}
        />
      ))}
      {/*
        The road itself, at the fixed scale, over the bands: the ink line on a
        wider stroke of the panel's surface, as the whole route's marker is
        drawn, so it reads on every band's colour and pattern alike.
      */}
      <polyline className="oyl-hud__ahead-road-edge" points={road} />
      <polyline className="oyl-hud__ahead-road" points={road} data-testid="oyl-hud-road-ahead" />
      {top === undefined ? null : (
        <>
          <line
            className="oyl-hud__ahead-top-edge"
            x1={top}
            y1={0}
            x2={top}
            y2={LOOK_AHEAD_RISE_METRES}
          />
          <line
            className="oyl-hud__ahead-top"
            x1={top}
            y1={0}
            x2={top}
            y2={LOOK_AHEAD_RISE_METRES}
            data-testid="oyl-hud-climb-top"
            data-ahead={String(top)}
          />
        </>
      )}
      <line
        className="oyl-hud__ahead-here"
        x1={0}
        y1={0}
        x2={0}
        y2={LOOK_AHEAD_RISE_METRES}
        data-height={String(ahead.riderHeight)}
      />
    </svg>
  );
}

/**
 * One pattern cell, in its strip's own units — #2291, so the road ahead and
 * the whole route draw the same patterns at about the same size on screen.
 */
interface PatternCell {
  readonly width: number;
  readonly height: number;
}

/**
 * The road ahead's cell, in metres across and metres up: about 11 by 10 px on
 * a 270 px strip 3.5 rem tall, as it was at 1 km (40 by 20 then).
 */
const AHEAD_PATTERN: PatternCell = {
  width: LOOK_AHEAD_METRES / 25,
  height: LOOK_AHEAD_RISE_METRES / 5,
};

/** The whole route's, in its 100 × 24 box: about 11 by 10 px on a 270 px strip 2.5 rem tall. */
const ROUTE_PATTERN: PatternCell = { width: 4, height: 6 };

/** One band's fill: its colour, and the marks that tell it apart without colour. */
function BandPattern(
  props: { readonly id: string; readonly band: GradeBand } & PatternCell,
): JSX.Element {
  const { width, height } = props;
  const { pattern } = props.band;
  return (
    <pattern
      id={props.id}
      className={`oyl-hud__band oyl-hud__band--${props.band.key}`}
      patternUnits="userSpaceOnUse"
      width={width}
      height={height}
      data-pattern={pattern}
    >
      <rect className="oyl-hud__band-fill" x={0} y={0} width={width} height={height} />
      {pattern === 'dots' ? (
        <ellipse
          className="oyl-hud__band-dot"
          cx={width / 2}
          cy={height / 2}
          rx={width * 0.15}
          ry={height * 0.15}
        />
      ) : null}
      {pattern === 'hatch' || pattern === 'dense-hatch' || pattern === 'cross-hatch' ? (
        <line className="oyl-hud__band-mark" x1={0} y1={height} x2={width} y2={0} />
      ) : null}
      {pattern === 'dense-hatch' ? (
        <line className="oyl-hud__band-mark" x1={-width / 2} y1={height} x2={width / 2} y2={0} />
      ) : null}
      {pattern === 'dense-hatch' ? (
        <line className="oyl-hud__band-mark" x1={width / 2} y1={height} x2={width * 1.5} y2={0} />
      ) : null}
      {pattern === 'cross-hatch' ? (
        <line className="oyl-hud__band-mark" x1={0} y1={0} x2={width} y2={height} />
      ) : null}
    </pattern>
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
