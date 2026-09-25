// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The frame every view renders inside: skip link, header, navigation, main,
 * footer — and the focus management that makes navigating between them usable
 * without a mouse.
 *
 * ## Focus on navigation, and why it is not automatic
 *
 * In a document, following a link loads a new page and the browser resets focus
 * to the top of it. In a single-page app nothing loads, so focus stays wherever
 * it was — on a navigation link that is now describing a page the athlete has
 * already left. A screen reader announces nothing, and the next Tab continues
 * from the header as though nothing happened. #48's fifth criterion is that a
 * test proves this does not happen.
 *
 * So on a route change focus moves to `<main>`, which carries `tabindex="-1"`
 * to be focusable without joining the tab order, and is labelled by the view's
 * `h1` so that landing on it announces the page you have arrived at.
 *
 * **Not on first render.** Moving focus during the initial mount takes it from
 * wherever the browser put it, which on a reload is often a control the athlete
 * had deliberately focused, and it makes the skip link unreachable by the very
 * first Tab press — the one press it exists for.
 *
 * ## The skip link cannot be an ordinary fragment link
 *
 * ⚠️ This shell routes on `location.hash` (`routes.ts`), so an `href="#main"`
 * that navigated normally would set the hash to `#main`, which matches no
 * route, and "skip to content" would land the athlete on the not-found page.
 * The link therefore prevents its own default and moves focus itself. It stays
 * an `<a>` rather than becoming a `<button>` so that it keeps the link role and
 * the affordance a screen-reader user expects at the top of a page.
 *
 * `AppShell.test.tsx` asserts both halves of that: focus lands on `main`, and
 * the route does **not** change.
 */

import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react';

import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '@onyourleft/store';
import type { Kilograms } from '@onyourleft/domain';

import { GameView } from '../game/GameView';
import { AboutView } from '../views/AboutView';
import { CameraView } from '../views/CameraView';
import { SideCameraView } from '../views/SideCameraView';
import { HomeView } from '../views/HomeView';
import { ActivitiesView } from '../views/ActivitiesView';
import { ActivityDetailView } from '../views/ActivityDetailView';
import { AnalysisView } from '../views/AnalysisView';
import { CreditsView } from '../views/CreditsView';
import { DevicesView } from '../views/DevicesView';
import { NotFoundView } from '../views/NotFoundView';
import { RideView } from '../views/RideView';
import { SegmentDetailView } from '../views/SegmentDetailView';
import type { RoutingProvider } from '@onyourleft/domain';

import { RouteBuilderView } from '../views/RouteBuilderView';
import { RoutesView } from '../views/RoutesView';
import { WorkoutsView } from '../views/WorkoutsView';
import { SegmentsView } from '../views/SegmentsView';
import { RideSession } from '../ride/RideSession';
import { SettingsView } from '../views/SettingsView';
import { UnitsProvider } from '../units/context';
import type { UnitsPort } from '../units/store-port';
import type { AthleteMassPort } from '../athlete/store-port';
import type { RideController } from '../ride/controller';
import type { CapabilityProbe } from '../support/bluetooth-support';
import type { ShellSupportPort } from '../support/shell-support-port';
import { TransferView } from '../transfer/TransferView';
import type { AnalysisPort } from '../analysis/store-port';
import type { DetailPort } from '../detail/store-port';
import type { BasemapConfig } from '../map/basemap';
import type { MapPort } from '../map/port';
import type { LibraryPort } from '../library/store-port';
import type { TransferPort } from '../transfer/store-port';
import type { EffortPort } from '../efforts/store-port';
import type { MatchPort } from '../segments/match-port';
import type { SegmentPort } from '../segments/store-port';
import type { RoutePort } from '../routes/store-port';
import type { WorkoutPort } from '../workouts/store-port';

import { CameraIndicator } from '../camera/indicator';
import type { CameraController } from '../camera/session';
import type { SideCameraLinkPort } from '../camera/side-camera-link-port';
import type { ThermalPort } from '../game/thermal-port';

import { UpdateOffer } from '../offline/UpdateOffer';
import type { UpdateWatcher } from '../offline/update';

import { NavIcon } from './NavIcon';
import {
  groupDestination,
  hrefFor,
  NAV_GROUPS,
  routesInGroup,
  type RouteDefinition,
  type RouteMatch,
} from './routes';
import { useRoute } from './useRoute';

/** The id `main` carries, and the only place it is written. */
const MAIN_ID = 'oyl-main';

/** The id of the `h1`, which names the `main` landmark through `aria-labelledby`. */
const VIEW_TITLE_ID = 'oyl-view-title';

export interface AppShellProps {
  /**
   * The browser capabilities, probed once at start-up.
   *
   * Passed in rather than read from globals inside the tree, so that every
   * support state — including the ones no test machine can produce, like a
   * partial Linux implementation — is reachable from a test. `main.tsx` is the
   * one caller that reads the real browser.
   */
  readonly capabilities: CapabilityProbe;
  /**
   * The Android shell's own Bluetooth availability (#284).
   *
   * `undefined` in every browser, and present only inside the Capacitor shell,
   * where `capabilities` above describes a stack the app does not use. Built by
   * `main.tsx` behind the same `isNativeShell` check that chooses the
   * transport, so the two cannot disagree about which platform this is. Passed
   * in for the reason `capabilities` is: the Devices screen's shell branch is
   * rendered by the accessibility suite on a machine that is not a phone.
   */
  readonly shell?: ShellSupportPort | undefined;
  /**
   * The camera, its consent and whether it is running (#382).
   *
   * Optional like every other port here, and `undefined` is an ordinary state:
   * a browser with no `navigator.mediaDevices`, a page opened from the disk
   * where there is no secure context, and the accessibility suite's default.
   * `CameraView` then renders an explanation and no control at all, which is
   * the rule `views/DevicesView.tsx` states.
   *
   * ⚠️ **It is held by the shell rather than by the route**, and that is the
   * whole reason the controller is not React state inside `CameraView`: ADR
   * 0029 D-5 requires the live indicator to be showing *"visible from where a
   * person would enter"*, which means on whatever screen the device happens to
   * be on — including the ride stage, where every other piece of chrome is
   * deliberately absent. A camera owned by a route would go out the moment the
   * rider navigated away from it, and the indicator with it.
   */
  readonly camera?: CameraController | undefined;
  /**
   * The tripod phone's link to the tablet — #528, ADR 0033.
   *
   * ⚠️ **`main.tsx` supplies none, and that is the state of the product, not
   * an omission.** The link is [#529](https://github.com/openzigs/onyourleft/issues/529),
   * which ADR 0033 D-0 holds until [#532](https://github.com/openzigs/onyourleft/issues/532)
   * has measured a transport; until then the side-camera screen says in words
   * that this phone cannot be paired. The prop exists so that the browser
   * gate can drive the real shell into the filming state and measure it, and
   * so #529's pairing has one place to arrive.
   */
  readonly sideCameraLink?: SideCameraLinkPort | undefined;
  /**
   * Android's thermal forecast, for the game's quality ladder (#247). Absent
   * in a browser. @see game/thermal-port.ts
   */
  readonly thermal?: ThermalPort | undefined;
  /**
   * A new version of the app waiting to take over (#407).
   *
   * `undefined` in every browser with no service worker, inside the Android
   * shell (ADR 0024 D-4), and in the accessibility suite — which renders
   * `UpdateOffer` directly instead, because a component that built its own
   * watcher would need a `ServiceWorkerRegistration` to be audited.
   */
  readonly update?: UpdateWatcher | undefined;
  /**
   * `navigator.storage`, for the Settings panel that says whether this browser
   * may evict a rider's history (#409).
   *
   * `undefined` where the Storage API is absent, and in the accessibility
   * suite — which is also how that branch of `PersistenceNotice` is reached
   * from a test at all.
   */
  readonly storage?: import('../support/persistent-storage').StorageManagerLike | undefined;
  /**
   * The live ride screen's state machine (#49), built by `main.tsx` from the
   * transport and the store.
   *
   * Passed in rather than built here for the same reason `capabilities` is: the
   * shell is rendered by the accessibility suite on a machine with no Bluetooth
   * adapter and no IndexedDB worth the name, and a component that constructed
   * its own transport could not be. `undefined` renders the honest
   * cannot-pair-here screen, which is also what Safari and Firefox get.
   */
  readonly rideController?: RideController | undefined;
  /**
   * The trainer game's store reads and sensor sampling (#85).
   *
   * Passed in for exactly the reason the two above are, plus one more: the
   * renderer needs WebGL, which jsdom does not implement at all, so the
   * accessibility suite renders this route with `gameRenderer` absent and gets
   * the route picker. `game/port.ts` records that a view with no context is an
   * ordinary state rather than an error.
   */
  readonly game?: import('../game/GameView').GamePort | undefined;
  /**
   * The trainer the game sends the road to (#362).
   *
   * A second port beside {@link game} rather than a method on it, for the
   * reason every narrow store port in `main.tsx` is separate: this is the one
   * seam in the client through which a *game* can apply physical resistance to
   * somebody, and it carries the `-port.ts` suffix so `check:wiring`'s
   * `WIRE003` watches it (CLAUDE.md §4j). `undefined` in every browser with no
   * ride controller, and in the accessibility suite.
   */
  readonly gameTrainer?: import('../game/trainer-port').GameTrainerPort | undefined;
  readonly gameRenderer?: (() => Promise<import('../game/port').GameRenderer>) | undefined;
  readonly screenLock?: import('../game/hud/wake-lock').ScreenLockSource | undefined;
  /**
   * The import and export screen's store, clock and file handling (#51).
   *
   * Passed in for the same reason as the two above, and with one extra: this
   * one performs a **download**, and a component that reached for
   * `URL.createObjectURL` itself could not be rendered by the accessibility
   * suite. `undefined` renders the honest explanation — which is also what a
   * page opened from the disk gets, because fingerprinting a file needs
   * `crypto.subtle` and that needs a secure context.
   */
  readonly transfer?: TransferPort | undefined;
  /**
   * The local activity library's store (#62).
   *
   * Passed in for the reason the three above are: `ActivitiesView` is rendered
   * by the accessibility suite, which has no IndexedDB worth the name, and a
   * view that opened a database itself could not be audited. `undefined`
   * renders the honest no-local-store screen rather than an empty list, which
   * would tell the rider they have no rides.
   */
  readonly library?: LibraryPort | undefined;
  /**
   * The activity detail view's store (#50).
   *
   * Passed in for the reason the others are. It is a **separate** port from
   * {@link AppShellProps.library} rather than a widening of it: the library's
   * two methods are all a list row may reach for, and a shared port would let a
   * later edit call `getStreamChannel` from a list — the read #62's budget and
   * #50's fourth criterion both forbid. `main.tsx` builds both from the one
   * database connection.
   */
  readonly detail?: DetailPort | undefined;
  /**
   * The analysis screen's store (#78).
   *
   * A fifth port over the same connection, and the only one that may read the
   * athlete record — the thresholds every zone boundary is derived from live
   * there, and #78's first criterion is that there is a *single* threshold
   * setting. It is also the only port that reads a channel across many rides,
   * which is why `analysis/load.ts` states a bound and `load.test.ts` counts
   * the decodes.
   */
  readonly analysis?: AnalysisPort | undefined;
  /**
   * How to get a map engine (#63), or `undefined` where there is none.
   *
   * A loader rather than a port: `maplibre-gl` is the largest dependency in
   * this client and is fetched only when a ride with GPS is opened. The
   * accessibility suite passes a resolved stub, or nothing at all.
   */
  readonly map?: (() => Promise<MapPort>) | undefined;
  /** Where the basemap archive is, or `undefined` for a build configured with none (#534). */
  readonly basemap?: BasemapConfig | undefined;
  /** Segments (#64), or `undefined` where this browser has no local store. */
  readonly segments?: SegmentPort | undefined;
  /**
   * The segment matcher's sweep (#66, wired by #282).
   *
   * A separate port from {@link segments} over the same connection: creating a
   * segment and matching the library against one are different budgets and
   * different writes, and `ActivityStore` satisfies both structurally. Optional
   * like every other port here — the accessibility suite renders this route
   * with none of them, and the screen offers no control rather than one that
   * could not work.
   */
  readonly match?: MatchPort | undefined;
  /** Saved routes (#73), or `undefined` where this browser has no local store. */
  readonly routes?: RoutePort | undefined;
  /**
   * The routing engine the drawing canvas asks for roads (#70, #71).
   *
   * ⚠️ `undefined` everywhere today, and not by oversight: ADR 0010 D-4 chose
   * Valhalla and #53 has not stood one up, so there is nothing to pass. The
   * builder screen places and moves waypoints without it and says why the roads
   * between them are missing — see `views/RouteBuilderView.tsx`.
   */
  readonly routing?: RoutingProvider | undefined;
  /** Saved workouts (#14), or `undefined` where this browser has no local store. */
  readonly workouts?: WorkoutPort | undefined;
  /**
   * The effort-history screen's reads (#67).
   *
   * Optional like every other port here: the accessibility suite renders every
   * route with none of them, and a view handed `undefined` says so in a
   * sentence rather than crashing the audit.
   */
  readonly efforts?: EffortPort | undefined;
  /**
   * The settings screen's one write (#238).
   *
   * Optional like every other port here, and `undefined` renders an
   * explanation rather than a control that would forget what it was told —
   * `views/SettingsView.tsx` §`UNITS_NO_STORE`.
   */
  readonly settings?: UnitsPort | undefined;
  /**
   * The settings screen's other write: what the rider weighs (#325).
   *
   * A separate port from {@link settings} for the reason `athlete/store-port.ts`
   * gives — a display preference and an input to the physics are not the same
   * kind of thing — and optional like every other port here, so the
   * accessibility suite reaches the screen with or without it.
   */
  readonly athleteMass?: AthleteMassPort | undefined;
  /**
   * What the rider weighs, read from the athlete row at start-up (#325).
   *
   * ⚠️ **The initial value only**, exactly like {@link units}: the shell owns
   * the live value from here on, because the settings screen has to change what
   * the game rides at and a value that lived in `main.tsx` would need a reload
   * to take effect. `undefined` is the honest state for a rider who has never
   * entered one; `athlete/mass.ts` substitutes the default in the one place
   * that substitutes it, and it is not here.
   */
  readonly riderMass?: Kilograms | undefined;
  /**
   * Which units this client starts in, read from the athlete row at start-up.
   *
   * ⚠️ **The initial value only.** The shell owns the live value from here on,
   * because the settings screen has to change what every other screen renders
   * and a value that lived in `main.tsx` would need a reload to take effect —
   * which is a preference that appears not to work. `main.tsx` reads the row
   * once, before anything renders, so the first paint is already in the
   * rider's units rather than flickering from metric.
   */
  readonly units?: UnitSystem | undefined;
}

/**
 * The view a match selects.
 *
 * One object parameter rather than a growing positional list: #50 made this the
 * sixth thing the shell has to hand down, and six positional arguments of which
 * four are `X | undefined` is a signature where a transposition typechecks.
 *
 * No `default` case, deliberately. The switch is exhaustive over `RouteId` and
 * TypeScript proves it: a route added to the table with no case here fails the
 * build with "function lacks ending return statement", which is how this
 * function stays in step with `routes.ts` without anyone remembering.
 */
function viewFor(
  match: RouteMatch,
  props: AppShellProps,
  units: UnitSystem,
  onUnitsChange: (units: UnitSystem) => void,
  riderMass: Kilograms | undefined,
  onMassChange: (mass: Kilograms | undefined) => void,
  onImmersive: (immersive: boolean) => void,
): JSX.Element {
  switch (match.route.id) {
    case 'home':
      return <HomeView analysis={props.analysis} controller={props.rideController} />;
    case 'ride':
      return (
        <RideView
          controller={props.rideController}
          workouts={props.workouts}
          analysis={props.analysis}
        />
      );
    case 'activities':
      return <ActivitiesView library={props.library} />;
    case 'activity-detail':
      return (
        <ActivityDetailView
          port={props.detail}
          activityId={match.parameter}
          map={props.map}
          basemap={props.basemap}
        />
      );
    case 'analysis':
      return <AnalysisView port={props.analysis} />;
    case 'segments':
      return <SegmentsView port={props.segments} match={props.match} />;
    case 'routes':
      return <RoutesView port={props.routes} save={props.transfer?.save} />;
    case 'route-builder':
      return <RouteBuilderView provider={props.routing} />;
    case 'workouts':
      return <WorkoutsView port={props.workouts} save={props.transfer?.save} />;
    case 'game':
      return (
        <GameView
          port={props.game}
          {...(props.gameTrainer === undefined ? {} : { trainer: props.gameTrainer })}
          renderer={props.gameRenderer}
          screenLock={props.screenLock}
          // ⚠️ The **live** value rather than `props.riderMass`, so a rider who
          // sets their weight and then opens the game is ridden at it without a
          // reload. `GameViewProps.riderMass` says why this is threaded rather
          // than read from the store.
          riderMass={riderMass}
          // #423. A ride takes the screen over; this is how the shell hears.
          onImmersive={onImmersive}
          // #382. The quality ladder's fifth figure reaches the camera through
          // here and nowhere else — `game/quality.ts` §`QualitySettings.capture`.
          {...(props.camera === undefined ? {} : { camera: props.camera })}
          // #247. The forecast half of the ladder; only the shell supplies one.
          {...(props.thermal === undefined ? {} : { thermal: props.thermal })}
        />
      );
    case 'segment-detail':
      return <SegmentDetailView port={props.efforts} segment={match.parameter} />;
    case 'camera':
      return <CameraView {...(props.camera === undefined ? {} : { controller: props.camera })} />;
    case 'side-camera':
      // #528. `main.tsx` hands over no link: pairing is #529, which ADR 0033
      // D-0 holds until #532 has measured a transport. The screen says so.
      return (
        <SideCameraView
          {...(props.camera === undefined ? {} : { controller: props.camera })}
          {...(props.sideCameraLink === undefined ? {} : { link: props.sideCameraLink })}
          // #423's mechanism: while the phone films, the sign has the screen.
          onImmersive={onImmersive}
        />
      );
    case 'devices':
      return (
        <DevicesView
          capabilities={props.capabilities}
          {...(props.shell === undefined ? {} : { shell: props.shell })}
        />
      );
    case 'transfer':
      return (
        <TransferView
          port={props.transfer}
          // ⚠️ An erase takes the unit preference with everything else — it is
          // athlete data (ADR 0020 D-2). Without this the shell goes on
          // rendering miles over a row that no longer says so, until a reload.
          // `DEFAULT_UNIT_SYSTEM` is substituted here because this is the one
          // place in the client that substitutes it.
          onUnitsReset={(next) => {
            onUnitsChange(next ?? DEFAULT_UNIT_SYSTEM);
          }}
          // ⚠️ #325, and the same argument one field along: an erase takes the
          // recorded mass with everything else, and the recreated row carries
          // none. Without this the game would go on riding at the old weight
          // over a row that no longer says so, until a reload.
          //
          // Handed straight through rather than wrapped, unlike its neighbour:
          // there is **no default to substitute** here. `undefined` is what the
          // row says, and `athlete/mass.ts` is the one place in this client that
          // answers what to ride instead.
          onMassReset={onMassChange}
        />
      );
    case 'settings':
      return (
        <SettingsView
          port={props.settings}
          units={units}
          onUnitsChange={onUnitsChange}
          mass={props.athleteMass}
          riderMass={riderMass}
          onRiderMassChange={onMassChange}
          {...(props.storage === undefined ? {} : { storage: props.storage })}
          basemap={props.basemap}
        />
      );
    case 'about':
      return <AboutView />;
    case 'credits':
      // No props: the manifest is built into the bundle, so this is the one
      // view in the shell that needs nothing passed down. `CreditsView.tsx`
      // says why it is a build-time import rather than a port.
      return <CreditsView />;
    case 'not-found':
      return <NotFoundView />;
  }
}

export function AppShell(props: AppShellProps): JSX.Element {
  const match = useRoute();
  const route = match.route;
  // ⚠️ Seeded from the prop and then owned here. See `AppShellProps.units`.
  const [units, setUnits] = useState<UnitSystem>(props.units ?? DEFAULT_UNIT_SYSTEM);
  // ⚠️ Seeded from the prop and then owned here, like `units` — and **not**
  // defaulted here, unlike `units`. `DEFAULT_UNIT_SYSTEM` is substituted at this
  // line because the shell is the one place that substitutes it; the mass
  // default belongs to `athlete/mass.ts`, so what the shell holds is the honest
  // `undefined`. See `AppShellProps.riderMass`.
  const [riderMass, setRiderMass] = useState<Kilograms | undefined>(props.riderMass);
  /**
   * Whether a ride has the screen — #423.
   *
   * While it does, the world is full-bleed and everything that frames a *page*
   * is **not rendered**: the skip link, the update offer, the header and its
   * navigation, the route's summary, the footer. `GameViewProps.onImmersive`
   * records why they are absent rather than hidden, and how a rider leaves.
   *
   * ⚠️ **Three things are deliberately still here**, and each is a way this
   * could have been got wrong:
   *
   * - **`RideSession`.** It is above the router so that a recording and a
   *   workout outlive whichever page is on screen, and "no page chrome" is the
   *   most page-shaped state there is. Its clock and its unload guard run on.
   * - **`main` and its `h1`.** `main` is labelled by the `h1`, and a landmark
   *   whose label has gone is a landmark a screen reader announces as nothing.
   *   The heading stays in the document and leaves the *screen* — the same
   *   `oyl-visually-hidden` the rest of this client uses, which removes no
   *   control from the tab order because a heading was never in it.
   * - **The route.** The hash does not change, so a reload mid-ride lands on
   *   the game's picker rather than on a stage with no ride behind it.
   *
   * ⚠️ **State here rather than a class the stylesheet reads with `:has()`.**
   * That would be less code, and it would hide the header with CSS — which is
   * the one thing CLAUDE.md §4e says makes the accessibility suite wrong rather
   * than the control safe.
   */
  const [immersive, setImmersive] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousRouteId = useRef<string | null>(null);

  useEffect(() => {
    if (previousRouteId.current !== null && previousRouteId.current !== route.id) {
      mainRef.current?.focus();
    }
    previousRouteId.current = route.id;
  }, [route.id]);

  useEffect(() => {
    // The document title is the first thing a screen reader announces after a
    // page change and the only thing a tab strip shows, so it moves with the
    // route rather than staying on whatever index.html said.
    document.title = `${route.title} — On Your Left`;
  }, [route.title]);

  function skipToContent(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <UnitsProvider units={units}>
      <div className="oyl-shell">
        {/*
        Outside `main`, and deliberately: a recording belongs to the app and not
        to whichever page is on screen. Mounted inside `viewFor` — as it was
        until #49's review — a route change unmounts the ride's clock and its
        unload guard, which stops the recorder checkpointing and lets the tab
        close without asking. It renders nothing. See `ride/RideSession.tsx`.
      */}
        {props.rideController === undefined ? null : (
          <RideSession controller={props.rideController} />
        )}

        {/*
          ⚠️ **Rendered whatever else is on screen, including mid-ride** — it is
          NOT behind the `immersive` check every other piece of chrome is behind
          (#423), and that is ADR 0029 D-5 rather than an oversight: the
          indicator is *"the one thing in the room that tells somebody walking
          in that a camera is running"*, and a ride is exactly when one is. It
          renders `null` unless a camera is actually live, so it costs an absent
          element the rest of the time. `camera/indicator.tsx` records what
          "cannot be hidden by a scrolled page or an overlay" means and where it
          is measured.
        */}
        <CameraIndicator {...(props.camera === undefined ? {} : { controller: props.camera })} />

        {/* #423: nothing to skip past while a ride has the screen. @see immersive */}
        {immersive ? null : (
          <a className="oyl-skip-link" href={`#${MAIN_ID}`} onClick={skipToContent}>
            Skip to main content
          </a>
        )}

        {/*
          Between the skip link and the header, so that a rider who skips to
          content is not sent past it — and outside `main`, because an update
          belongs to the app rather than to whichever page is on screen, the
          same reasoning `RideSession` above carries. It renders `null` unless
          something is actually waiting.
        */}
        {/*
          ⚠️ #423: not offered mid-ride, and not lost either. Applying an update
          reloads the page, which ends the ride — and the offer is state the
          *watcher* holds rather than state this component does, so it is back
          the moment the ride is over.
        */}
        {props.update === undefined || immersive ? null : <UpdateOffer watcher={props.update} />}

        {immersive ? null : (
          <header className="oyl-header">
            <p className="oyl-wordmark">On Your Left</p>
            <PrimaryNav route={route} />
          </header>
        )}

        {immersive ? null : <SectionNav route={route} />}

        <main
          id={MAIN_ID}
          // `oyl-main--<layout>` is #422: which routes are prose and which are
          // instruments. `routes.ts` §`RouteLayout` is where that is decided.
          className={`oyl-main oyl-main--${route.layout}`}
          ref={mainRef}
          tabIndex={-1}
          aria-labelledby={VIEW_TITLE_ID}
        >
          <h1 id={VIEW_TITLE_ID} className={immersive ? 'oyl-visually-hidden' : undefined}>
            {route.title}
          </h1>
          {immersive ? null : <p className="oyl-muted">{route.summary}</p>}
          {viewFor(match, props, units, setUnits, riderMass, setRiderMass, setImmersive)}
        </main>

        {immersive ? null : (
          <footer className="oyl-footer">
            <p>
              On Your Left — free and open source. No account, no server: everything here stays on
              this device.
            </p>
          </footer>
        )}
      </div>
    </UnitsProvider>
  );
}

/**
 * The primary destinations — #427. A bar on a compact width and a rail on a
 * wider one, which is `theme.css` §"NAVIGATION"'s decision, not this one's:
 * the markup is the same list either way, so a screen reader meets the same
 * five links in the same order whatever the window.
 *
 * ⚠️ **`aria-current` has two values here and the difference is load-bearing.**
 * `page` says "this link is the page you are on", and exactly one link on a
 * page may say it — `routes.a11y.test.tsx` counts them. A group's link is
 * the page only when the group IS one page (Routes); otherwise its page link
 * is in {@link SectionNav}, and the group's link says `true`: "the current
 * item of this set". Both are drawn with a visible shape as well as a colour.
 */
function PrimaryNav({ route }: { readonly route: RouteDefinition }): JSX.Element {
  return (
    <nav aria-label="Primary" className="oyl-nav">
      <ul className="oyl-nav-list">
        {NAV_GROUPS.map((group) => {
          const destination = groupDestination(group.id);
          const pages = routesInGroup(group.id);
          const here = route.group === group.id;
          const current = !here
            ? undefined
            : pages.length === 1 && route.id === destination.id
              ? 'page'
              : 'true';
          return (
            <li key={group.id}>
              <a className="oyl-nav-link" href={hrefFor(destination)} aria-current={current}>
                <NavIcon name={group.icon} />
                <span className="oyl-nav-label">{group.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The current group's pages, when it has more than one — #427's secondary
 * layer. Outside `main` and before it, so the skip link passes it and the `h1`
 * is still the first thing in the landmark; named for its group, so a landmark
 * list tells it apart from the primary one (`audit.ts`'s
 * `landmarks-are-distinguishable`).
 */
function SectionNav({ route }: { readonly route: RouteDefinition }): JSX.Element | null {
  if (route.group === undefined) {
    return null;
  }
  const group = NAV_GROUPS.find((each) => each.id === route.group);
  const pages = routesInGroup(route.group);
  if (group === undefined || pages.length < 2) {
    return null;
  }
  return (
    <nav aria-label={`${group.label} pages`} className="oyl-subnav">
      <ul className="oyl-subnav-list">
        {pages.map((page) => (
          <li key={page.id}>
            <a
              className="oyl-subnav-link"
              href={hrefFor(page)}
              aria-current={page.id === route.id ? 'page' : undefined}
            >
              {page.navLabel}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
