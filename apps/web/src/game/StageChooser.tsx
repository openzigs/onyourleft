// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The trainer game's pre-ride chooser — #940, epic #935.
 *
 * What a rider sees before a ride: the routes as CARDS, each with its own
 * elevation drawn from its profile and its distance and climb in words; the
 * ride's LOADOUT (the ghost, the pacer, the riding position and the wind); and
 * ONE *Ride*, for the chosen route. It was a bulleted list with a checkbox and
 * a button per route (`GameView.tsx` until #940), and everything that list did
 * is still done here — moved out of `GameView.tsx` so that what the picker
 * imports is its own graph (`stage-chooser-imports.test.ts` walks it: no
 * renderer, no map, no network).
 *
 * ## What did NOT change, and must not
 *
 * - **Every standing notice is ABOVE *Ride*, in its old order and words**:
 *   the release fault (#372), *Asking your trainer* or the trainer promise
 *   (#509, #503), the trainer notice (#362) and the realistic world (#475).
 *   #503 is the one that matters most: the promise is what makes the press
 *   that asks the trainer for control the rider's decision, so it has to be
 *   read before *Ride*. They come FIRST, under the heading, and *Ride* comes
 *   straight after them — before the cards and the loadout — all in the flow
 *   and none of it pinned. #940's first review found a pinned stack of the
 *   notices covering the controls a rider tabs to (WCAG 2.2 SC 2.4.11); its
 *   second found a pinned *Ride* alone covering the promise on a phone held
 *   sideways (#503) and outgrowing its padding with a long route name (SC
 *   2.4.11 again). In the flow neither can happen whatever the screen, the
 *   notices or the name: *Ride* is on the page after every notice, and
 *   nothing covers anything.
 * - **Tab order** is therefore the notices' one link (Settings, when the
 *   realistic world is chosen), *Ride*, the route cards (one stop, arrow keys
 *   between them), then the loadout. *Ride* names the chosen route, so a rider
 *   who chooses a card hears the change on *Ride*'s name and reaches it again
 *   with Shift+Tab; the issue's "the loadout and then Ride" is the order this
 *   gave up, for the reason above.
 * - **A refused *Ride* is `aria-disabled` with `aria-describedby`**, never
 *   `disabled` (#255), and the handler still refuses.
 * - **A route with no attempt offers the ghost disabled, with the reason as
 *   its label** (#93) — one checkbox now, for the chosen route.
 * - ***Ride* is 48 px** (`Button` §`size`, #669), and it is on
 *   `design/ride-time-controls.ts` §`RIDE_TIME_CONTROLS` as the
 *   `stage-chooser` entry: it starts the ride, so it is *Start* in the owner's
 *   ruling, and `browser/ride-targets.browser.spec.ts` measures it with the
 *   rest.
 *
 * ## Why native radios
 *
 * The routes are ONE choice, so they are one radio group (the #668 segmented
 * control's precedent): the platform supplies the arrow keys, the single tab
 * stop and the announced position, and nothing here re-implements them. Each
 * card is its radio's label, stretched over the card, so the whole card is the
 * target and still holds exactly one control.
 */

import { useId, type JSX } from 'react';

import {
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  type BotPacerPlan,
  type Metres,
  type RouteProfile,
  type Wind,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { Button, ButtonLink } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { ProfileShape } from '../design/illustration/ProfileShape';
import { StatusMessage } from '../design/StatusMessage';
import { NO_ROUTES_YET } from '../routes/two-importers';
import { hrefFor, routeById, ROUTE_BUILDER_ROUTE } from '../shell/routes';
import { formatDistance, formatSmallDistance, measurementText } from '../units/format';
import type { PacerChoice } from './pacer-choice';
import { realisticWorldChosenText } from './realistic-assets';
import { RIDING_POSITIONS, RIDING_POSITION_ORDER, type RidingPosition } from './rider';
import { MAXIMUM_BEARING_DEGREES, type WindChoice, type WindProblemField } from './wind-choice';

/** One route the rider could ride, as the picker needs it. */
export interface RidableRoute {
  readonly id: string;
  readonly name: string;
  readonly profile: RouteProfile;
  /**
   * How many previous attempts this rider has on it.
   *
   * ⚠️ A **count**, not the attempts themselves. #93's fourth criterion is that
   * a rider with no previous attempt sees the ghost option *absent or disabled
   * with an explanation*, and answering that needs only a number — loading every
   * attempt's stream to render a list would be a stream decode per route, which
   * is the read budget every other screen in this app is careful about.
   */
  readonly attempts: number;
}

/**
 * The id the pacer refusal is announced under, and referred to from both the
 * control that caused it and every control it blocks (#255).
 *
 * ⚠️ **A module constant rather than `useId`, and that is a decision.** The
 * refusal is referenced from two *different* components — the intensity box
 * inside {@link PacerControls} and the one *Ride* in
 * {@link RoutePicker} — so a generated id would have to be threaded through
 * both, and a mismatch would be a **dangling `aria-describedby`**: the one
 * failure `a11y/audit.ts`'s `aria-reference-resolves` rule exists to catch, and
 * silent to everyone who is not using a screen reader. A constant cannot
 * collide because the picker is rendered at most once — this screen has exactly
 * one intensity control, and `PacerControls`'s own header says why it belongs
 * to the ride rather than to a route.
 */
const PACER_PROBLEM_ID = 'oyl-game-pacer-problem';

/**
 * The same, for the wind refusal (#326) — a second id for the same reason the
 * first one is a module constant, and it must not be the same string.
 *
 * Two independent refusals can be live at once: a rider may slip a decimal in
 * the pacer box *and* leave the wind speed blank. One shared id would make
 * `aria-describedby` on *Ride* point at whichever of the two happened
 * to render, so the rider would be told about one problem and blocked by two.
 */
const WIND_PROBLEM_ID = 'oyl-game-wind-problem';

/** Everything the chooser is handed. */
interface RoutePickerProps {
  readonly routes: readonly RidableRoute[] | undefined;
  /**
   * The route the rider chose — #940. `undefined`, or an id no longer in
   * {@link routes}, is the first route: a chooser always has one chosen, so
   * there is always exactly one *Ride* and it always names a route.
   */
  readonly picked: string | undefined;
  readonly onPick: (routeId: string) => void;
  /** The rider's units, for each card's distance and climb (#238). */
  readonly units: UnitSystem;
  readonly withGhost: boolean;
  readonly onGhost: (value: boolean) => void;
  readonly withPacer: boolean;
  readonly onPacer: (value: boolean) => void;
  readonly intensity: string;
  readonly onIntensity: (value: string) => void;
  readonly choice: PacerChoice;
  readonly withWind: boolean;
  readonly onWind: (value: boolean) => void;
  readonly windSpeed: string;
  readonly onWindSpeed: (value: string) => void;
  readonly windFrom: string;
  readonly onWindFrom: (value: string) => void;
  readonly air: WindChoice;
  /** The label the speed box is in, from `units/format.ts`. @see WindControls */
  readonly windUnit: string;
  /**
   * What the rider is told about the road not reaching their trainer, if
   * anything — #362. `undefined` for a ready trainer and for no trainer at all.
   */
  readonly trainerNotice: string | undefined;
  /**
   * What pressing *Ride* will do to the trainer — #503. `undefined` unless the
   * route's hills will reach it. @see trainerRoadPromise
   */
  readonly trainerPromise: string | undefined;
  /**
   * Whether *Ride* has been pressed and the trainer has not yet answered the
   * request for control — #509. The picker says so in place of the promise,
   * and every *Ride* is marked unavailable. The refusal of a second press is
   * `GameView`'s own (§`startingRef`); this is only what the rider is told.
   */
  readonly asking: boolean;
  /**
   * The last release the trainer did not confirm — #372. `undefined` almost
   * always. @see GameTrainer.releaseFault
   */
  readonly releaseNotice: string | undefined;
  /** Where the rider's hands are — #365. @see RIDING_POSITIONS */
  readonly position: RidingPosition;
  readonly onPosition: (value: RidingPosition) => void;
  /** Whether this device chose the realistic world — #475. @see realisticWorldChosenText */
  readonly worldChosen: boolean;
  readonly onStart: (
    route: RidableRoute,
    ghost: boolean,
    pacer: BotPacerPlan | undefined,
    air: Wind | undefined,
    position: RidingPosition,
  ) => Promise<void>;
}

/**
 * A route's length, at the scale a route is discussed in. The Routes screen's
 * own rule (`views/RoutesView.tsx` §`routeLength`), through the one place a
 * number becomes a unit.
 */
function routeLength(distance: Metres, units: UnitSystem): string {
  return measurementText(formatDistance(distance, units));
}

/** A route's climb, at the small scale — a kilometre would erase it. */
function routeClimb(climb: number, units: UnitSystem): string {
  return measurementText(formatSmallDistance(climb, units));
}

/** What a card says about its route, in words: the drawing above it says nothing more. */
function routeFacts(profile: RouteProfile, units: UnitSystem): string {
  return `${routeLength(profile.totalDistance, units)} · climb ${routeClimb(profile.totalAscent, units)}`;
}

/** Choosing a route, whether to race yourself on it, and whether to be paced. */
export function RoutePicker(props: RoutePickerProps): JSX.Element {
  const ids = useId();
  if (props.routes === undefined) {
    return <p>Loading your routes…</p>;
  }
  const first = props.routes[0];
  if (first === undefined) {
    // ⚠️ #232's second criterion: an empty picker says **how a route gets
    // here**, not only that there are none. The sentence it used to carry named
    // one of the two ways and named neither screen as a link — and it did not
    // mention the thing a rider who has already tried has most likely done,
    // which is to import the course on the Files screen and get a ride. The
    // wording is a constant in `routes/two-importers.ts` so this screen, the
    // Files screen and the Routes screen cannot drift apart.
    return (
      <div className="oyl-game__picker">
        {/*
          #668: both next steps are actions, so both are drawn as buttons
          rather than links in sentences. Importing is the primary — it is
          the one a rider with a course from a planner, the common case, takes
          — and since #943 it is the empty state's one action, with drawing a
          route stepping down beneath it.
        */}
        <EmptyState
          art="road"
          seed={5}
          heading="Choose a route"
          level={2}
          action={
            <ButtonLink href={hrefFor(routeById('routes'))}>
              Import a GPX file on the Routes screen
            </ButtonLink>
          }
          note="— a course from a route planner, read on this device."
        >
          <p>{NO_ROUTES_YET}</p>
        </EmptyState>
        <p>
          <ButtonLink variant="secondary" href={hrefFor(ROUTE_BUILDER_ROUTE)}>
            Draw one on this device
          </ButtonLink>{' '}
          — place waypoints and have the roads between them worked out.
        </p>
      </div>
    );
  }

  // ⚠️ The ride control is BLOCKED rather than silently dropping the pacer.
  // Starting a ride that quietly has no bot in it, because the number in the box
  // could not make one, is the same defect #237 is about arriving from the other
  // side — and this time the rider would have asked for it.
  // ⚠️ **Either refusal blocks the ride**, and the button describes whichever
  // ones are live. A wind the numbers could not make would otherwise start a
  // ride in still air after the rider had asked for a gale — #237's defect
  // arriving from the side the rider can see, which is what the pacer control
  // already refuses for its own box.
  const pacerRefused = props.choice.problem !== undefined;
  const windRefused = props.air.problem !== undefined;
  const refused = pacerRefused || windRefused;
  const describedBy =
    [pacerRefused ? PACER_PROBLEM_ID : undefined, windRefused ? WIND_PROBLEM_ID : undefined]
      .filter((id) => id !== undefined)
      .join(' ') || undefined;
  const chosen = props.routes.find((route) => route.id === props.picked) ?? first;
  const headingId = `${ids}-heading`;
  const notices = [
    props.releaseNotice === undefined ? undefined : (
      // #372: first, because it is about the machine under the rider now
      // rather than the road they are about to choose.
      <StatusMessage key="release" tone="danger" label="Not released" live>
        {props.releaseNotice}
      </StatusMessage>
    ),
    props.asking ? (
      // #509: the press has asked, and the machine has up to the FTMS
      // procedure's timeout to answer. Said here, in the promise's place,
      // and `live` because it is a change the rider caused.
      <StatusMessage key="asking" tone="info" label="Your trainer" live>
        Asking your trainer for control. The ride starts when it answers.
      </StatusMessage>
    ) : props.trainerPromise === undefined ? undefined : (
      // ⚠️ #503: **the sentence that makes the Ride press the rider's
      // decision** rather than the screen's. It is above the button, so a
      // rider reads that the trainer will follow the hills before the press
      // that asks it for control. Not `live`: nothing changed, it is simply
      // what this screen says.
      <StatusMessage key="promise" tone="info" label="Your trainer">
        {props.trainerPromise}
      </StatusMessage>
    ),
    props.trainerNotice === undefined ? undefined : (
      // ⚠️ **Before the ride rather than only during it**, because a rider
      // who can end a workout, or choose to ride without resistance, can only
      // do so before they start. It does not block the ride: a rider who
      // wants to ride a route with no resistance is allowed to, and #362's
      // criterion is that they are told, not that they are stopped. Since
      // #503 `no-control` is not one of these — the press asks.
      <StatusMessage key="trainer" tone="warning" label="The road will not reach your trainer">
        {props.trainerNotice}
      </StatusMessage>
    ),
    props.worldChosen ? (
      // #475: the offline fallback stated BEFORE the ride, where a rider can
      // still act on it, and the way back to the choice.
      // @see realisticWorldChosenText
      <StatusMessage key="world" tone="info" label="Realistic world">
        {realisticWorldChosenText()}{' '}
        <a href={hrefFor(routeById('settings'))}>Change this in Settings</a>.
      </StatusMessage>
    ) : undefined,
  ].filter((each) => each !== undefined);
  return (
    <div className="oyl-game__picker oyl-chooser">
      {/*
        ⚠️ **Every standing notice, and then Ride, come FIRST — in the flow,
        before the cards and the loadout, and nothing here is pinned** (#940's
        two reviews). A rider reads #503's promise before the one control that
        asks the trainer for control, on any screen and at any scroll: Ride is
        below the notices on the page, and nothing can cover them. Ride's name
        is the chosen route's, so it can stand before the cards: choosing a
        card renames it in place. They come before the "Choose a route"
        heading, which names the cards' radio group and is about the cards; on
        a phone held sideways that heading's 30 px is what lets Ride stand on
        the screen at the top of the page.
      */}
      <div className="oyl-chooser__lead tw:mb-md">
        {notices.length === 0 ? undefined : <div className="oyl-chooser__notices">{notices}</div>}
        <div className="oyl-chooser__go">
          {/*
            ⚠️ **`aria-disabled`, deliberately, and not the `disabled`
            attribute** — #255's second defect. The attribute removes the
            button from the tab order, so a rider who slips a decimal point
            tabs from the intensity box straight past it to whatever follows,
            with no indication that the control they were heading for exists
            at all. `aria-disabled` keeps the button reachable and announced as
            unavailable, and {@link PACER_PROBLEM_ID} tells it *why* — so the
            control that is blocked says it is blocked, rather than only the
            field that blocked it.

            The refusal itself is unchanged: `onStart` is not called. A
            guard in the handler is what enforces that now, because
            `aria-disabled` is a promise to a screen reader and nothing
            whatever to a click.
          */}
          <Button
            size="ride"
            // #509: unavailable while the trainer is being asked, as well
            // as while a box refuses. The click is not guarded on `asking`
            // here — `GameView` §`startingRef` refuses it, so the refusal
            // holds for a press that lands before this re-renders.
            unavailable={refused || props.asking}
            describedBy={describedBy}
            onClick={() => {
              if (refused) {
                return;
              }
              void props.onStart(
                chosen,
                props.withGhost && chosen.attempts > 0,
                props.choice.plan,
                props.air.wind,
                props.position,
              );
            }}
          >
            {/*
              ⚠️ ONE line, ending in an ellipsis when the route's name is
              longer than the screen is wide (`theme.css`
              §`.oyl-chooser__ride-label`): a name may be
              `routes/save.ts` §`MAXIMUM_ROUTE_NAME_LENGTH` characters, and
              wrapped it made Ride five lines tall. The text is all still in
              the button, so its accessible name is the whole name and what is
              visible is a prefix of it (WCAG 2.2 SC 2.5.3); the chosen card,
              just below, shows the name in full.
            */}
            <span className="oyl-chooser__ride-label">Ride {chosen.name}</span>
          </Button>
        </div>
      </div>
      <h2 id={headingId}>Choose a route</h2>
      <RouteCards
        routes={props.routes}
        chosen={chosen}
        onPick={props.onPick}
        units={props.units}
        labelledBy={headingId}
        idPrefix={ids}
      />
      <div className="oyl-chooser__loadout tw:mb-md tw:bg-surface-raised tw:rounded-card">
        <h3 className="tw:mt-0">Your ride</h3>
        <GhostControl route={chosen} withGhost={props.withGhost} onGhost={props.onGhost} />
        <PacerControls
          withPacer={props.withPacer}
          onPacer={props.onPacer}
          intensity={props.intensity}
          onIntensity={props.onIntensity}
          problem={props.choice.problem}
        />
        <PositionControl position={props.position} onPosition={props.onPosition} />
        <WindControls
          withWind={props.withWind}
          onWind={props.onWind}
          speed={props.windSpeed}
          onSpeed={props.onWindSpeed}
          fromBearing={props.windFrom}
          onFromBearing={props.onWindFrom}
          speedUnit={props.windUnit}
          problem={props.air.problem}
          field={props.air.field}
        />
      </div>
    </div>
  );
}

/**
 * The routes, as cards — #940.
 *
 * One native radio group, named by the chooser's heading. Each card is a list
 * item holding its radio, its name as a heading (the radio's label, stretched
 * over the whole card by `theme.css`), the route's elevation drawn from its own
 * profile, and its distance and climb in words, which the radio is described
 * by. ⚠️ The drawing is `aria-hidden` and says nothing the words do not
 * (epic #935, principle 1): it is RELATIVE, highest point near the top whatever
 * the metres (`ProfileShape`), so the climb in metres is only in the text.
 */
function RouteCards(props: {
  readonly routes: readonly RidableRoute[];
  readonly chosen: RidableRoute;
  readonly onPick: (routeId: string) => void;
  readonly units: UnitSystem;
  readonly labelledBy: string;
  readonly idPrefix: string;
}): JSX.Element {
  const group = `${props.idPrefix}-route`;
  return (
    <fieldset
      className="oyl-chooser__routes tw:mt-0 tw:mx-0 tw:mb-md tw:p-0 tw:border-0 tw:min-w-0"
      aria-labelledby={props.labelledBy}
    >
      <ul className="oyl-chooser__cards tw:grid tw:gap-sm tw:m-0 tw:p-0 tw:list-none">
        {props.routes.map((route, index) => {
          const radioId = `${group}-${String(index)}`;
          const factsId = `${radioId}-facts`;
          return (
            <li
              key={route.id}
              className="oyl-chooser__card tw:relative tw:grid tw:gap-x-sm tw:items-center tw:py-sm tw:px-md tw:bg-surface-raised tw:text-ink tw:border-2 tw:border-surface-raised tw:rounded-card"
            >
              <input
                className="oyl-chooser__radio tw:m-0"
                type="radio"
                id={radioId}
                name={group}
                value={route.id}
                checked={route.id === props.chosen.id}
                aria-describedby={factsId}
                onChange={() => {
                  props.onPick(route.id);
                }}
              />
              <h3 className="oyl-chooser__name tw:m-0 tw:text-md tw:wrap-anywhere">
                <label htmlFor={radioId} className="tw:cursor-pointer">
                  {route.name}
                </label>
              </h3>
              <ProfileShape
                className="oyl-chooser__shape tw:col-span-full tw:block tw:w-full tw:my-xs"
                profile={route.profile}
              />
              <p className="oyl-chooser__facts oyl-muted tw:col-span-full tw:m-0" id={factsId}>
                {routeFacts(route.profile, props.units)}
              </p>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * Whether to race the rider's own best on the chosen route — #93.
 *
 * One checkbox for the chosen route, where it was one per route: a ghost
 * belongs to a road, and the chooser has one road chosen. #93's fourth
 * criterion holds unchanged: a route with no previous attempt offers it
 * DISABLED, and the label is the explanation, rather than an empty ghost
 * sitting on the start line pretending to be a rider.
 */
function GhostControl(props: {
  readonly route: RidableRoute;
  readonly withGhost: boolean;
  readonly onGhost: (value: boolean) => void;
}): JSX.Element {
  return (
    <div className="oyl-game__ghost tw:flex tw:flex-col tw:items-start tw:gap-xs tw:mb-sm">
      <label>
        <input
          type="checkbox"
          // #940's review: the box is for the CHOSEN route, so a tick made on a
          // route with an attempt does not show on one without — checked and
          // disabled would read as "the ghost is on" beside "ride it once
          // first". `onStart` already ignores it there (`attempts > 0`).
          checked={props.withGhost && props.route.attempts > 0}
          disabled={props.route.attempts === 0}
          onChange={(event) => {
            props.onGhost(event.target.checked);
          }}
        />
        {props.route.attempts === 0
          ? 'Race your best — ride it once first'
          : 'Race your own best attempt'}
      </label>
    </div>
  );
}

/**
 * Whether to be paced, and how hard.
 *
 * In the loadout, once for the ride: a pacer belongs to the ride, where a
 * ghost belongs to a particular road — it is *your* previous attempt on
 * *that* route, which is why the ghost's box follows the chosen card.
 */
function PacerControls(props: {
  readonly withPacer: boolean;
  readonly onPacer: (value: boolean) => void;
  readonly intensity: string;
  readonly onIntensity: (value: string) => void;
  readonly problem: string | undefined;
}): JSX.Element {
  return (
    <div className="oyl-game__pacer tw:flex tw:flex-col tw:items-start tw:gap-xs tw:mb-sm">
      <label>
        <input
          type="checkbox"
          checked={props.withPacer}
          onChange={(event) => {
            props.onPacer(event.target.checked);
          }}
        />
        Ride against a pacer
      </label>
      <label className="tw:flex tw:flex-col tw:items-start tw:gap-xs">
        Pacer intensity, watts per kilogram
        <input
          type="number"
          // `inputMode` rather than only `type`, because this is read and typed
          // on a phone clamped to a handlebar: a decimal keypad is the
          // difference between 2.5 and 25 at the moment a rider is setting up.
          inputMode="decimal"
          min={MINIMUM_INTENSITY_WATTS_PER_KILOGRAM}
          max={MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM}
          step={0.1}
          value={props.intensity}
          // ⚠️ **The two attributes that make the refusal part of the control
          // rather than text near it — #255.** A `role="alert"` is announced
          // once, when it appears. A rider who tabs *back* to this box
          // afterwards heard "Pacer intensity, watts per kilogram, 70" and
          // nothing about why nothing worked; `aria-describedby` is what makes
          // the reason travel with the field, every time it is reached, and
          // `aria-invalid` is what says the value in it is the problem.
          aria-invalid={props.problem === undefined ? undefined : true}
          aria-describedby={props.problem === undefined ? undefined : PACER_PROBLEM_ID}
          onChange={(event) => {
            props.onIntensity(event.target.value);
          }}
        />
      </label>
      {/*
        ⚠️ `min`/`max` above are a hint to the browser and nothing more — they
        are trivially bypassed by typing, and they do not exist at all for the
        rider who pastes. The refusal that counts is `pacerChoice`'s, which is
        `botPacerPlan`'s own bounds, and it is what blocks the ride control.

        Rendered only when there is a problem, which is also what keeps the two
        `aria-describedby` references above and on *Ride* from dangling:
        the attribute and the element it names appear and disappear together,
        under the same condition.
      */}
      {props.problem === undefined ? null : (
        <p className="oyl-game__problem tw:m-0" id={PACER_PROBLEM_ID} role="alert">
          {props.problem}
        </p>
      )}
    </div>
  );
}

/**
 * Where the rider's hands are — #365.
 *
 * ⚠️ **A `<select>` rather than three numbers**, and the labels name hands
 * rather than square metres: a drag area is a wind-tunnel measurement nobody
 * knows about themselves, and #365's first criterion is that the choice be
 * rider-facing. `rider.ts` §`ridingPositionDragArea` is where each one becomes
 * a `c_d · A`, and it says why they are the game's own numbers rather than
 * `packages/physics`'.
 *
 * ⚠️ **No refusal branch, unlike the pacer and the wind beside it**, because
 * there is nothing to refuse: every option is one of three this file rendered,
 * so a value that is not one of them cannot come off the control. That is what
 * `pacer-choice.ts` and `wind-choice.ts` exist for and why this has no
 * counterpart.
 */
function PositionControl(props: {
  readonly position: RidingPosition;
  readonly onPosition: (value: RidingPosition) => void;
}): JSX.Element {
  return (
    <div className="oyl-game__position tw:flex tw:flex-col tw:items-start tw:gap-xs tw:mb-sm">
      <label className="tw:flex tw:flex-col tw:items-start tw:gap-xs">
        How you are riding
        <select
          value={props.position}
          onChange={(event) => {
            // The cast is safe because every option below is a `RidingPosition`
            // this component itself rendered; `select.value` is simply typed as
            // `string` by the DOM.
            props.onPosition(event.target.value as RidingPosition);
          }}
        >
          {RIDING_POSITION_ORDER.map((id) => (
            <option key={id} value={id}>
              {RIDING_POSITIONS[id].label}
            </option>
          ))}
        </select>
      </label>
      <p className="oyl-muted tw:m-0">
        This sets how much air you are pushing, which is most of what decides your speed on the
        flat. Your weight is set on the Settings screen and is most of it on a climb.
      </p>
    </div>
  );
}

/**
 * Whether there is a wind, how strong, and where from — #326.
 *
 * In the loadout, beside {@link PacerControls} and for its reason: a wind
 * belongs to the ride rather than to a route.
 *
 * ⚠️ **The speed's unit label arrives as a prop and is not written here.**
 * #238's fifth criterion and `units/no-inline-units.ts`: this client has
 * exactly one place a number becomes a unit, and a `km/h` typed into a label
 * on this screen is the defect that rule was written after finding in the HUD.
 *
 * ⚠️ **The direction is a bearing in degrees rather than a compass point.**
 * A "north-west" picker would need a name-to-bearing table that nothing else
 * in this program has, and the game screen is not where a new vocabulary
 * should be introduced; a number box maps one-for-one onto `DegreesBearing`
 * and onto what a forecast quotes.
 */
function WindControls(props: {
  readonly withWind: boolean;
  readonly onWind: (value: boolean) => void;
  readonly speed: string;
  readonly onSpeed: (value: string) => void;
  readonly fromBearing: string;
  readonly onFromBearing: (value: string) => void;
  readonly speedUnit: string;
  readonly problem: string | undefined;
  /** Which box {@link problem} is about. @see markedFor */
  readonly field: WindProblemField | undefined;
}): JSX.Element {
  /**
   * The validity attributes for one box: set on the box the refusal is
   * **about**, and on no other.
   *
   * ⚠️ Marking both boxes was the first version of this, and it is wrong in a
   * way only a screen reader hears: a rider who left the speed blank was told
   * their perfectly good direction was invalid too, and following its
   * `aria-describedby` took them to a sentence about the speed. #255's pattern
   * is one refusal and one box, so it carries no answer for a second box; this
   * is that answer.
   */
  const markedFor = (
    field: WindProblemField,
  ): {
    readonly 'aria-invalid': true | undefined;
    readonly 'aria-describedby': string | undefined;
  } =>
    props.field === field
      ? { 'aria-invalid': true, 'aria-describedby': WIND_PROBLEM_ID }
      : { 'aria-invalid': undefined, 'aria-describedby': undefined };
  return (
    <div className="oyl-game__wind tw:flex tw:flex-col tw:items-start tw:gap-xs tw:mb-sm">
      <label>
        <input
          type="checkbox"
          checked={props.withWind}
          onChange={(event) => {
            props.onWind(event.target.checked);
          }}
        />
        Ride in a wind
      </label>
      <label className="tw:flex tw:flex-col tw:items-start tw:gap-xs">
        {`Wind speed, ${props.speedUnit}`}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          value={props.speed}
          {...markedFor('speed')}
          onChange={(event) => {
            props.onSpeed(event.target.value);
          }}
        />
      </label>
      <label className="tw:flex tw:flex-col tw:items-start tw:gap-xs">
        Wind direction, degrees it blows from
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAXIMUM_BEARING_DEGREES}
          step={1}
          value={props.fromBearing}
          {...markedFor('fromBearing')}
          onChange={(event) => {
            props.onFromBearing(event.target.value);
          }}
        />
      </label>
      {/*
        Rendered only when there is a problem, which is what keeps every
        `aria-describedby` naming {@link WIND_PROBLEM_ID} — here and on
        *Ride* — from dangling: the attribute and the element it names
        appear and disappear together, under one condition.
      */}
      {props.problem === undefined ? null : (
        <p className="oyl-game__problem tw:m-0" id={WIND_PROBLEM_ID} role="alert">
          {props.problem}
        </p>
      )}
    </div>
  );
}
