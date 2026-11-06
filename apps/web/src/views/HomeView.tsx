// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the app opens — #428.
 *
 * It used to open onto the Ride screen: a heading, a sentence and a column of
 * panels, and nothing that said what the app is, what the rider did last, or
 * what to do next. This is a home built ONLY from what this device already
 * holds — no server, no account, no network (owner decision D6, ADR 0002).
 *
 * ## The empty state was designed first
 *
 * A new rider has no rides, no trainer and no routes, and six empty cards
 * would tell them nothing. So with no rides the screen is one panel that says
 * what to do, in order, and every step is a link; the ride blocks appear once
 * there is a ride to describe.
 *
 * ## Where a ride starts — #939
 *
 * Since #939 Home opens on an illustrated band under its title and three
 * equal ride cards — *Free ride* (the one primary), *Ride a route* and
 * *Workout* — and every fact and link it showed before is still here, the
 * trainer's sentence and its link to Devices (#659) included. The pictures are
 * the illustration kit's (#938), `aria-hidden` and wordless. A reviewer who
 * remembers a "Ride" panel of two buttons in a sentence is reading the old
 * file.
 *
 * ## Next up, this week, and the modes as art — #1010
 *
 * Since #1010 the band under the title is gone and Home leads with ONE large
 * card, *Next up*: the ride this rider is most likely to want, its picture
 * filling the card, and one big **Ride** — the view's one primary (#668), so
 * the three ride cards below are all secondary now. Beside it on a landscape
 * tablet, *This week* sets each figure against the week before, and the
 * Trainer card says what the trainer is doing. The ride cards' pictures are
 * the cards' backgrounds rather than 48 px drawings, with every word on a
 * solid band (`theme.css` §"#1010"). `home/home.ts` §`HomeNextUp` says which
 * ride is offered and why "the last workout used" is not one of them yet.
 *
 * ## A first open — #1429
 *
 * With nothing recorded, Home used to offer three ways to the Ride screen —
 * *Next up*'s **Ride**, the Free ride card and a step in the list — two links
 * to Devices, and three tall picture cards that pushed a route, a workout and
 * an import under a phone's fold. Now a first open has ONE first step, the
 * *Your first ride* card, under one heading and a button that says what it
 * does; then {@link GettingStarted}, the other three ways to start as one
 * line each; then the Trainer card, whose link is the one way to Devices. The
 * ride cards are drawn once there is a ride, and not while the read is still
 * out, so a first open does not draw them and then take them away.
 * `home.browser.spec.ts` §"#1429" measures it at a phone, a tablet and a
 * desktop.
 *
 * ## Next up, compact — #2043
 *
 * Next up's picture is gone: the owner's *"a generic image that takes up a
 * lot of real estate"* — at 1280×800 it was 28 % of the window and pushed its
 * Ride to y = 641. What the card SAYS is unchanged — the ride it offers, one
 * line, one **Ride** — and it is one compact row now, with a small drawing of
 * the route's own climb beside the words where the frame is wide enough and
 * no drawing otherwise. The kit's sky, hills and road stay in
 * `design/illustration/` for the ride cards and other screens.
 *
 * Until both reads have settled the card names no destination — #1020 item 1:
 * it used to say "A free ride" with a Ride to `#/ride` and then change its
 * mind. A screen with no store, or whose read failed, still offers a free ride.
 *
 * ## A dashboard of modules — #2044
 *
 * Home was one column of cards with the last ride under the ride choices. It
 * is a grid of modules now, in ONE reading order on every layout: Next up
 * (the quick-launch), the sensors (#2045, {@link SensorsModule}, which took
 * the Trainer card's slot), the last ride (#2048) — or, on a first open, the other ways to start
 * — and the week (#2049); then the ride choices, fitness and the badges. On a
 * phone that is one column in that order; on a landscape tablet the first
 * four are two rows of two inside the first screen. DOM order is the visual
 * order and the tab order (`home.browser.spec.ts` §"#2044").
 *
 * ## What it reads
 *
 * `home/home.ts` — one bounded store read and no stream decode, on every
 * launch. The sensors, the trainer's state and a ride left unfinished come
 * from the ride controller's snapshot, which is already in memory — #2045
 * added no store read. #939 added no read:
 * `HomeView.reads.test.tsx` counts every store call the screen makes. #1010
 * adds at most ONE record read, `getRoute`, and only when a ride was ridden
 * on a route — `home/home.ts` §`loadNextUp`.
 *
 * ⚠️ **The load metrics' familiar names are registered trademarks** (CLAUDE.md
 * §6). This says "load", "fitness", "fatigue" and "freshness", the same words
 * the Analysis screen uses, and units go through `units/format.ts`.
 */

import { metres, unixSeconds, type Percent, type RouteProfile, type UnixSeconds } from '@onyourleft/domain';
import type { ConnectionState } from '@onyourleft/sensors';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import type { AnalysisPort } from '../analysis/store-port';
import { trendReadings, trendSentence } from '../analysis/trend';
import { ProfileShape, SensorGlyph } from '../design/illustration';
import { ChartSlot } from '../design/ChartSlot';
import type { SensorGlyphKind } from '../design/illustration/SensorGlyph';
import { SectionHeading } from '../design/SectionHelp';
import { Reading } from '../design/Reading';
import { StatusMessage } from '../design/StatusMessage';
import {
  formatDuration,
  formatPowerValue,
  formatStartedAt,
  MOVING_TIME_LABEL,
  POWER_UNIT,
  shownAveragePower,
} from '../format';
import {
  loadHome,
  loadNextUp,
  type HomeData,
  type HomeNextUp,
  type HomePreviousWeek,
} from '../home/home';
import { RIDE_CHOICES, RideChoiceCard } from '../home/ride-choices';
import { WeekChart } from '../home/WeekChart';
import { ProgressPanel } from '../progress/ProgressPanel';
import {
  batteryBadgeWords,
  isLowBattery,
  mayBatteryBeRead,
  useBatteryLevels,
} from '../ride/battery-level';
import type { BatteryLevelPort } from '../ride/battery-port';
import type { PairedSensor, PairingRole, RideController } from '../ride/controller';
import type { RideMetricId } from '../ride/metrics';
import { metricSentence, metricText, presentationFor } from '../ride/MetricGrid';
import type { RoutePort } from '../routes/store-port';
import { useRideSnapshot } from '../ride/useRideController';
import { hrefFor, hrefForActivity, hrefForGameRoute, routeById } from '../shell/routes';
import { useUnits } from '../units/context';
import {
  formatDistance,
  formatSmallDistance,
  measurementText,
  shownDistance,
} from '../units/format';

export interface HomeViewProps {
  readonly analysis: AnalysisPort | undefined;
  readonly controller: RideController | undefined;
  /**
   * Saved routes, for the one record "next up" draws (#1010) — or `undefined`
   * where this browser has no local store, when "next up" offers a free ride.
   */
  readonly routes?: RoutePort | undefined;
  /** The clock "this week" is measured from. A seam for tests. */
  readonly now?: (() => UnixSeconds) | undefined;
  /**
   * Each connected sensor's battery, for the sensors module — #2047. Absent
   * where the platform reads none (the Android shell, today), when no level is
   * shown at all.
   */
  readonly battery?: BatteryLevelPort | undefined;
}

const wallClock = (): UnixSeconds => unixSeconds(Math.floor(Date.now() / 1000));

/** What Next up offers where there is no read to wait for. */
const FREE_RIDE: HomeNextUp = { kind: 'free' };

export function HomeView(props: HomeViewProps): JSX.Element {
  const { analysis } = props;
  const now = props.now ?? wallClock;
  const { routes } = props;
  const [data, setData] = useState<HomeData | undefined>(undefined);
  const [nextUp, setNextUp] = useState<HomeNextUp | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // #947: bumped once *Look at older rides* has written, so Home reads again.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (analysis === undefined) {
      return;
    }
    let live = true;
    loadHome(analysis, now()).then(
      (loaded) => {
        if (!live) return;
        setData(loaded);
        // `loadNextUp` never rejects: a route it cannot read is a free ride.
        void loadNextUp(loaded, routes).then((next) => {
          if (live) setNextUp(next);
        });
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // ⚠️ `analysis` and `routes` only: `now` is a clock, read once per mount.
    // A dependency on it would be a store read per render, which is the thing
    // this screen exists to bound. `reads` is a rider's press (#947), not a render.
  }, [analysis, routes, reads]);

  // #1429: the read came back and there is no ride on this device at all.
  const firstOpen =
    analysis !== undefined && !failed && data !== undefined && data.lastRide === undefined;
  const reading = analysis !== undefined && !failed && data === undefined;
  // #1020 item 1: no destination until both reads settle. With no store, or
  // a read that failed, there is nothing to wait for: a free ride.
  const next = analysis === undefined || failed ? FREE_RIDE : nextUp;
  return (
    <div className="oyl-home-frame tw:@container">
      <div className="oyl-home">
        {props.controller === undefined ? null : <LeftUnfinished controller={props.controller} />}
        {/* #2044: the modules in their reading order — quick-launch, sensors,
            the last ride (or, on a first open, the other ways to start), the
            week — and then the rest. `theme.css` §"#2044" lays them out. */}
        <NextUp next={next} />
        {props.controller === undefined ? null : (
          <SensorsModule controller={props.controller} battery={props.battery} />
        )}
        {firstOpen ? <GettingStarted pair={props.controller === undefined} /> : null}
        {data?.lastRide === undefined ? null : (
          <LastRide last={data.lastRide} profile={lastRideProfile(data.lastRide, nextUp)} />
        )}
        {data?.lastRide === undefined ? null : (
          <ThisWeek week={data.week} previous={data.previousWeek} />
        )}
        {firstOpen || reading ? null : <RideChoices />}

        {analysis === undefined ? (
          <StatusMessage tone="danger">
            No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
            this page cannot reach it — a private window or blocked site data is the usual reason.
          </StatusMessage>
        ) : failed ? (
          <StatusMessage tone="danger">Your rides could not be read on this device.</StatusMessage>
        ) : data === undefined ? (
          <p className="oyl-muted">Reading your rides…</p>
        ) : data.lastRide === undefined ? null : (
          <Rides
            data={data}
            analysis={analysis}
            onRead={() => {
              setReads((count) => count + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The climb the last ride's module draws — #2048: the route Next up read,
 * when it is the route the last ride was ridden on. The newest ride on a
 * route is the newest ride whenever that ride has a route, so this is the
 * same record, read once.
 */
function lastRideProfile(
  last: NonNullable<HomeData['lastRide']>,
  next: HomeNextUp | undefined,
): RouteProfile | undefined {
  return next?.kind === 'route' && last.routeId === next.id ? next.profile : undefined;
}

/**
 * The empty state's other ways to start — #1429. One line each, so all three
 * stand above a phone's fold under the first step; the first step itself, and
 * the way to Devices, are the cards either side of it and are not repeated —
 * unless there is no ride controller, and so no Trainer card, when the way to
 * Devices is here instead.
 */
function GettingStarted({
  pair,
}: {
  /** Whether to link Devices here: only when there is no Trainer card to. */
  readonly pair: boolean;
}): JSX.Element {
  return (
    <section className="oyl-panel oyl-home__empty" aria-labelledby="oyl-home-empty">
      <h2 id="oyl-home-empty">Nothing recorded yet</h2>
      <p>Rides you record are kept on this device. Other ways to start:</p>
      <ul>
        {pair ? (
          <li>
            <a href={hrefFor(routeById('devices'))}>Pair a sensor or a smart trainer</a> on Devices.
          </li>
        ) : null}
        <li>
          <a href={hrefFor(routeById('game'))}>Ride a route</a> in the trainer game.
        </li>
        <li>
          <a href={hrefFor(routeById('workouts'))}>Follow a workout</a> on a smart trainer.
        </li>
        <li>
          <a href={hrefFor(routeById('transfer'))}>Bring rides in</a> from a FIT, GPX or TCX file.
        </li>
      </ul>
    </section>
  );
}

/**
 * *Last ride* — #2048, in the slot #2044 made for it: third in the reading
 * order after Next up and the sensors, a `section` named by its own `h2`, as
 * every module is — `a11y/audit.ts` §"landmarks are distinguishable" (#864)
 * refuses an unnamed `section` beside another.
 *
 * The NEWEST ride (`home/home.ts` reads the summaries newest first, #1107):
 * its name as the link to its own page, when, moving time, distance, average
 * power where it was recorded, and load. On a first open this slot is
 * {@link GettingStarted}'s *Nothing recorded yet*, whose start is Next up's
 * one *Start a ride* (#1429 keeps a first open to one first step).
 *
 * ## The climb, and no map — ⚠️ a location surface
 *
 * The ride's shape is its elevation, drawn with {@link ProfileShape}: never
 * its GPS trace, which on a dashboard is where a rider lives for no gain
 * (CLAUDE.md §6). The profile is the saved route's the ride was ridden on —
 * the one record Next up already read (`loadNextUp`), so this costs no read
 * and decodes no stream — with its climb in words beside it, because the
 * drawing is `aria-hidden`. A ride on no saved route draws no profile.
 * Nothing in this module formats a coordinate; `HomeView.last-ride.test.tsx`
 * holds that no latitude or longitude reaches it.
 */
function LastRide({
  last,
  profile,
}: {
  readonly last: NonNullable<HomeData['lastRide']>;
  /** The route the ride was ridden on, when Next up has read it. */
  readonly profile: RouteProfile | undefined;
}): JSX.Element {
  const units = useUnits();
  const lastDistance = shownDistance(last.distance);
  // #1054: a mean that shows as 0 W is no figure, as on the ride result card.
  const lastPower = shownAveragePower(last.averagePower);
  return (
    <section className="oyl-panel oyl-home__last" aria-labelledby="oyl-home-last">
      <h2 id="oyl-home-last">Last ride</h2>
      <p>
        <a href={hrefForActivity(last.id)}>
          <strong>{last.name}</strong>
        </a>
      </p>
      {profile === undefined ? null : (
        <div className="oyl-home__last-climb">
          {/* The owner's review (2026-11-05): the near hill's dark green was
              faint on the dark card; the accent is a declared 3:1 pair on it. */}
          <ProfileShape className="oyl-home__last-profile" profile={profile} paintAs="mark" />
          <p className="oyl-muted tw:m-0">
            Climb {measurementText(formatSmallDistance(profile.totalAscent, units))}
          </p>
        </div>
      )}
      <dl className="oyl-home__facts">
        <div>
          <dt>When</dt>
          <dd>{formatStartedAt(last.startedAt, last.timeZone)}</dd>
        </div>
        <div>
          <dt>{MOVING_TIME_LABEL}</dt>
          <dd>
            <Reading value={formatDuration(last.movingTime)} />
          </dd>
        </div>
        {/* #1070: a ride recorded with no speed channel stored 0 m, which is
            no distance known — no reading, as the Activities card. */}
        {lastDistance === undefined ? null : (
          <div>
            <dt>Distance</dt>
            <dd>
              <Reading {...formatDistance(lastDistance, units)} />
            </dd>
          </div>
        )}
        {lastPower === undefined ? null : (
          <div>
            <dt>Average power</dt>
            <dd>
              <Reading value={formatPowerValue(lastPower)} unit={POWER_UNIT} />
            </dd>
          </div>
        )}
        <div>
          <dt>Load</dt>
          <dd>
            {/* #1084: "not worked out yet" promises the backfill can; for a
                ride with nothing to work a load out from it cannot. */}
            {last.load === undefined ? (
              last.noLoadToWorkOut ? (
                'none: nothing on this ride to work one out from'
              ) : (
                'not worked out yet'
              )
            ) : (
              <Reading value={String(Math.round(last.load))} />
            )}
          </dd>
        </div>
      </dl>
      <p>
        <a href={hrefFor(routeById('activities'))}>All your rides</a>
      </p>
    </section>
  );
}

/** Fitness and freshness, and the progress badges: the rest, after the modules. */
function Rides({
  data,
  analysis,
  onRead,
}: {
  readonly data: HomeData;
  readonly analysis: AnalysisPort;
  readonly onRead: () => void;
}): JSX.Element {
  const readings = trendReadings(data.fitness);
  return (
    <>
      <section className="oyl-panel" aria-labelledby="oyl-home-form">
        <h2 id="oyl-home-form">Fitness and freshness</h2>
        {readings.length === 0 ? (
          data.loadsToWorkOut === 0 && !data.truncated ? (
            // #1084: every ride here was found to have nothing a load could
            // come from, so there is nothing for Analysis to work out. Not when
            // the history was cut short: `loadsToWorkOut` counts only the rides
            // inside `HISTORY_ACTIVITY_LIMIT`, and one past it may still need
            // working out (#1084's review).
            <p className="oyl-muted">
              No ride here has a load, so there is nothing to smooth: nothing on any of them was
              enough to work one out from.
            </p>
          ) : (
            <p className="oyl-muted">
              No ride here has a load yet, so there is nothing to smooth.{' '}
              <a href={hrefFor(routeById('analysis'))}>Analysis</a> can work them out.
            </p>
          )
        ) : (
          <>
            <ul>
              {readings.map((reading) => (
                <li key={reading.label}>{trendSentence(reading)}</li>
              ))}
            </ul>
            {data.fitness.at(-1)?.warmingUp === true ? (
              <p className="oyl-muted">
                Still warming up: these settle after about six weeks of riding on this device.
              </p>
            ) : null}
            <p>
              <a href={hrefFor(routeById('analysis'))}>The whole history</a>
            </p>
          </>
        )}
      </section>

      {/* #947: from the same rows, with no read of its own. */}
      <ProgressPanel
        progress={data.progress}
        summaries={data.summaries}
        analysis={analysis}
        onRead={onRead}
      />
    </>
  );
}

/** A ride this device is holding that was not saved — the ride controller's snapshot. */
function LeftUnfinished({
  controller,
}: {
  readonly controller: RideController;
}): JSX.Element | null {
  const snapshot = useRideSnapshot(controller);
  return snapshot.recoverable.length === 0 ? null : (
    <StatusMessage tone="warning" label="A ride left unfinished">
      This device is holding a ride that was not saved.{' '}
      <a href={hrefFor(routeById('ride'))}>Go to Ride</a> to save it or let it go.
    </StatusMessage>
  );
}

/**
 * The sensors module — #2045, in the slot #2044 kept for it: the trainer and
 * every BLE sensor the rider paired, each in words, with what it is reading
 * now, and ONE press to Devices (#659), where pairing lives. A `section`
 * named by its own `h2`, second in the reading order.
 *
 * ## One port, and it is the ride controller's
 *
 * Read from {@link useRideSnapshot}, the subscription the Devices screen's
 * `ride/SensorPairing.tsx` renders from — the same `sensors` rows, so a device
 * paired there is listed here with no second connection path. Each row's
 * reading is that DEVICE's own (`ride/controller.ts` §`PairedSensor.readings`),
 * not the Ride screen's merged channel, so a trainer and a power meter both
 * sending power each show their own number.
 *
 * ## Honest states only — docs/agents/web-bluetooth.md
 *
 * A device is *connected* or *not connected*, and nothing else. A browser has
 * no silent reconnect and no background scan, so this never says a device is
 * being searched for or will come back by itself: a lost link is "not
 * connected", and the way back is the Devices screen's chooser.
 * `HomeView.sensors.test.tsx` holds that over the real Web Bluetooth
 * transport in every state it reports.
 *
 * The trainer keeps its row and its sentences from #939 — *No trainer
 * paired*, and whether this app has control — first, because it is the one
 * device here this app can drive. State is words, never colour (SC 1.4.1);
 * the glyph is `aria-hidden` decoration and says nothing.
 *
 * ⚠️ **One link to Devices** (#1429): the trainer's own while no trainer is
 * paired, and the module's otherwise.
 *
 * ## One compact row a device — the owner's screenshot review, 2026-11-05
 *
 * Each device is ONE row: its icon, its name, its own live reading and a
 * connected dot. The kind of device and the reading's label are said to a
 * screen reader in words the row's icon already shows on screen, so the
 * row's text is still *Heart rate strap, HRM-Pro 7C1D, Heart rate: 142 bpm,
 * Connected*. The dot is never the only signal (SC 1.4.1): connected is a
 * filled dot, not connected a ring with the words *Not connected* beside it.
 * The module's own link sits beside its heading, which is as tall as its
 * glyph anyway. With four sensors paired that keeps Last ride and This week
 * above a 1280×800 tablet's fold, which the module's first drawing (each part
 * of a device on a line of its own, ~460 px tall) did not —
 * `home.browser.spec.ts` §"four sensors paired" measures it.
 */
function SensorsModule({
  controller,
  battery,
}: {
  readonly controller: RideController;
  readonly battery: BatteryLevelPort | undefined;
}): JSX.Element {
  const snapshot = useRideSnapshot(controller);
  const presentation = presentationFor(useUnits());
  // #2047: each connected sensor's battery, where it reports one.
  const levels = useBatteryLevels(battery, snapshot.sensors, mayBatteryBeRead(snapshot));
  const { trainer } = snapshot;
  const trainers = snapshot.sensors.filter((sensor) => sensor.role === 'trainer');
  const others = snapshot.sensors.filter((sensor) => sensor.role !== 'trainer');
  const noTrainer = !trainer.paired && trainers.length === 0;
  const devices = hrefFor(routeById('devices'));
  // #939's sentence: whether this app has control of the trainer.
  const control = trainer.paired ? (
    <p className="oyl-home__sensor-note">
      {!trainer.hasControl ? (
        <>
          Paired, and this app has not been given control.{' '}
          <a href={hrefFor(routeById('ride'))}>Ask for it on Ride</a>.
        </>
      ) : (
        'Paired, and this app has control.'
      )}
    </p>
  ) : null;
  return (
    <section className="oyl-panel oyl-home__sensors" aria-labelledby="oyl-home-sensors">
      <div className="oyl-home__sensors-head">
        <h2 id="oyl-home-sensors" className="tw:flex tw:items-center tw:gap-sm">
          <SensorGlyph kind="trainer" className="oyl-home__glyph" />
          Sensors
        </h2>
        {noTrainer ? null : <a href={devices}>Pair or forget devices on Devices</a>}
      </div>
      <ul className="oyl-home__sensor-list">
        {noTrainer ? (
          <li>
            <p className="tw:m-0">
              No trainer paired. <a href={devices}>Pair one on Devices</a>.
            </p>
          </li>
        ) : trainers.length === 0 ? (
          <li>{control}</li>
        ) : (
          trainers.map((sensor, index) => (
            <SensorRow
              key={sensor.id}
              sensor={sensor}
              presentation={presentation}
              battery={levels.get(sensor.id)}
            >
              {index === 0 ? control : null}
            </SensorRow>
          ))
        )}
        {others.map((sensor) => (
          <SensorRow
            key={sensor.id}
            sensor={sensor}
            presentation={presentation}
            battery={levels.get(sensor.id)}
          />
        ))}
      </ul>
      {others.length === 0 ? (
        <p className="oyl-muted tw:mb-0">No heart rate, power or cadence sensor paired.</p>
      ) : null}
    </section>
  );
}

/** What each kind of device is called in a row — the Devices screen's own words. */
const SENSOR_KIND: Readonly<Record<PairingRole, string>> = {
  trainer: 'Smart trainer',
  'heart-rate': 'Heart rate strap',
  'power-meter': 'Power meter',
  'speed-cadence': 'Speed or cadence sensor',
};

/** Each kind's icon — the Devices screen's (`ride/SensorPairing.tsx`). */
const SENSOR_ICON: Readonly<Record<PairingRole, SensorGlyphKind>> = {
  trainer: 'trainer',
  'heart-rate': 'heart-rate',
  'power-meter': 'power',
  'speed-cadence': 'cadence',
};

/**
 * Which reading a row shows: the first of these the device supplies — a
 * trainer's power before its cadence, a speed or cadence sensor's cadence
 * before its speed.
 */
const ROW_READING: Readonly<Record<PairingRole, readonly RideMetricId[]>> = {
  trainer: ['power', 'cadence', 'speed'],
  'heart-rate': ['heartRate'],
  'power-meter': ['power'],
  'speed-cadence': ['cadence', 'speed'],
};

/**
 * Connected, or not — the two states Home says (§"Honest states only" above).
 * The Devices screen says WHY one is not, and what to do about it.
 */
function connectedWords(state: ConnectionState): string {
  return state === 'connected' ? 'Connected' : 'Not connected';
}

/**
 * One device, one row: its icon, its name, its own live reading, its
 * battery badge (#2047, while it is connected and reports a level — a device
 * that reports none shows no badge at all, never `0%`) and its connected
 * dot. Every word the screen leaves to the icon or the dot is
 * still in the row for a screen reader (`oyl-visually-hidden`), so the row
 * reads as one sentence. `children` is a line under the row, the whole of its
 * width — the trainer's control sentence.
 */
function SensorRow({
  sensor,
  presentation,
  battery,
  children,
}: {
  readonly sensor: PairedSensor;
  readonly presentation: ReturnType<typeof presentationFor>;
  readonly battery?: Percent | undefined;
  readonly children?: ReactNode;
}): JSX.Element {
  const connected = sensor.state === 'connected';
  const reading = ROW_READING[sensor.role]
    .map((id) => sensor.readings?.find((each) => each.id === id))
    .find((each) => each !== undefined);
  const label = reading === undefined ? '' : presentation[reading.id].label;
  return (
    <li className="oyl-home__sensor-row">
      <SensorGlyph kind={SENSOR_ICON[sensor.role]} className="oyl-home__sensor-icon" />
      <span className="oyl-home__sensor-name">
        <span className="oyl-visually-hidden">{SENSOR_KIND[sensor.role]}, </span>
        {sensor.name}
      </span>
      {connected && reading !== undefined ? (
        <span className="oyl-home__sensor-reading">
          <span className="oyl-visually-hidden">, {label}: </span>
          {metricSentence(label, metricText(reading.state, presentation[reading.id])).slice(
            label.length + 2,
          )}
        </span>
      ) : null}
      {connected && battery !== undefined ? <BatteryBadge level={battery} /> : null}
      <span className="oyl-home__sensor-state">
        <span
          aria-hidden="true"
          className={`oyl-home__sensor-dot${connected ? ' oyl-home__sensor-dot--on' : ''}`}
        />
        <span className="oyl-visually-hidden">, </span>
        <span className={connected ? 'oyl-visually-hidden' : undefined}>
          {connectedWords(sensor.state)}
        </span>
      </span>
      {children}
    </li>
  );
}

/**
 * A sensor's battery as a badge — #2047, compact since the owner's review of
 * #2045: the glyph filled to the level and the number on screen, and `low`
 * beside it at or under the threshold, in words before the warning pair (SC
 * 1.4.1). The rest of `batteryBadgeWords` is said to a screen reader only, so
 * the badge's text is still *Battery 20%, low — charge it or change it soon*.
 */
function BatteryBadge({ level }: { readonly level: Percent }): JSX.Element {
  const words = batteryBadgeWords(level);
  return (
    <>
      <span className="oyl-visually-hidden">, </span>
      <span className={`oyl-home__battery${isLowBattery(level) ? ' oyl-home__battery--low' : ''}`}>
        <BatteryGlyph level={level} />
        <span className="oyl-visually-hidden">{words.before}</span>
        {words.shown}
        {words.after === '' ? null : <span className="oyl-visually-hidden">{words.after}</span>}
      </span>
    </>
  );
}

/**
 * A battery, filled to its level — #2047. `aria-hidden` and wordless: the
 * words beside it carry the number and, when it is low, say so.
 */
function BatteryGlyph({ level }: { readonly level: Percent }): JSX.Element {
  const share = Math.max(0, Math.min(1, level / 100));
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="oyl-home__battery-glyph"
      viewBox="0 0 24 12"
    >
      <rect x="0.5" y="0.5" width="20" height="11" rx="2" fill="none" stroke="currentColor" />
      <rect x="21" y="3.5" width="2.5" height="5" rx="1" fill="currentColor" />
      {share === 0 ? null : (
        <rect x="2" y="2" width={17 * share} height="8" rx="1" fill="currentColor" />
      )}
    </svg>
  );
}

/**
 * Where a ride starts — #939: three equal cards, `home/ride-choices.tsx`. All
 * three links are secondary: the view's one primary is *Next up*'s Ride.
 */
function RideChoices(): JSX.Element {
  return (
    <section className="oyl-home__start" aria-labelledby="oyl-home-start">
      <h2 id="oyl-home-start">Ride</h2>
      <ul className="oyl-home__rides">
        {RIDE_CHOICES.map((choice) => (
          <RideChoiceCard key={choice.id} choice={choice} idPrefix="oyl-home-ride" />
        ))}
      </ul>
    </section>
  );
}

/** What "next up" says for each kind — `home/home.ts` §`HomeNextUp`. */
function nextUpWords(
  next: HomeNextUp,
  units: ReturnType<typeof useUnits>,
): {
  readonly name: string;
  readonly line: string;
  readonly href: string;
  /** The button's words: a bare *Ride* under a name, or what a first ride does. */
  readonly action: string;
} {
  switch (next.kind) {
    case 'route':
      return {
        name: next.name,
        // The climb in words beside the shape that draws it (#935 principle 1):
        // `ProfileShape` scales the height, so the metres are only here.
        line:
          `The route you rode last: ${measurementText(formatDistance(next.profile.totalDistance, units))}, ` +
          `climb ${measurementText(formatSmallDistance(next.profile.totalAscent, units))}.`,
        href: hrefForGameRoute(next.id),
        action: 'Ride',
      };
    case 'free':
      return {
        name: 'A free ride',
        line: 'Record a ride from your paired sensors.',
        href: hrefFor(routeById('ride')),
        action: 'Ride',
      };
    case 'first':
      return {
        name: 'Your first ride',
        line: 'Pair a sensor on Devices, then record a ride from it.',
        href: hrefFor(routeById('ride')),
        action: 'Start a ride',
      };
  }
}

/**
 * *Next up* — #1010, compact since #2043. The first control on the screen and
 * the view's one primary: the ride's name and one line, one big **Ride**
 * beside them, and — on a route, where the frame is wide enough — the route's
 * own climb as a small drawing, `aria-hidden` and wordless, because the line
 * says the climb in words. `undefined` is a read still out: the heading and
 * no destination (#1020 item 1).
 */
function NextUp({ next }: { readonly next: HomeNextUp | undefined }): JSX.Element {
  const units = useUnits();
  const words = next === undefined ? undefined : nextUpWords(next, units);
  return (
    <section
      className="oyl-next-up tw:rounded-card tw:bg-surface-raised"
      aria-labelledby="oyl-next-up-heading"
    >
      {next?.kind === 'route' ? (
        <ProfileShape className="oyl-next-up__profile" profile={next.profile} />
      ) : null}
      <div className="oyl-next-up__words">
        {/* #1429: a first ride is not "next" after anything — one heading, its name. */}
        {next?.kind === 'first' ? (
          <h2 id="oyl-next-up-heading" className="oyl-next-up__name tw:m-0">
            <span id="oyl-next-up-name">{words?.name}</span>
          </h2>
        ) : (
          <h2 id="oyl-next-up-heading" className="tw:m-0">
            Next up
          </h2>
        )}
        {words === undefined || next?.kind === 'first' ? null : (
          <p id="oyl-next-up-name" className="oyl-next-up__name tw:m-0">
            {words.name}
          </p>
        )}
        {words === undefined ? null : <p className="oyl-muted tw:m-0">{words.line}</p>}
      </div>
      {words === undefined ? null : (
        <a
          className="oyl-button oyl-next-up__ride"
          href={words.href}
          aria-describedby="oyl-next-up-name"
        >
          {words.action}
        </a>
      )}
    </section>
  );
}

/** The week table's caption — #2049. */
const WEEK_TABLE_CAPTION = 'Day by day';

/** A day of the week table: *Today*, or its weekday and date. */
function dayName(day: string, today: boolean): string {
  return today
    ? 'Today'
    : new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${day}T12:00:00Z`));
}

/** The week before's figure, as the words under a reading — its own `dd`. */
function weekBefore(value: string): string {
  return `Week before: ${value}`;
}

/**
 * *This week* — #1010: rides, moving time and load in big tabular numerals
 * (`Reading`), each set against the seven days before, and since #2049 the
 * week's distance. Numbers only — no streak and no target (#935 D-6). Every
 * figure is `home/home.ts`'s arithmetic over the one read. Fourth in the
 * reading order since #2044, a `section` named by its own `h2`.
 *
 * ## The days, drawn — #2049
 *
 * Beside the sentence that says how many days were ridden, a bar per day of
 * moving time (`home/WeekChart.tsx`), in the place #939's ring of the days
 * ridden had: the bars draw the same fact — a bar on each day ridden — and
 * how long each was, at the ring's medium size, which is what lets the four
 * modules still stand inside a landscape tablet's first screen
 * (`home.browser.spec.ts` §"#2044"). The chart is `aria-hidden`; its table,
 * *Day by day*, is one press away under it, and stands alone if the chart
 * throws (`design/ChartSlot.tsx`, `a11y/degradation.a11y.test.tsx`).
 */
function ThisWeek({
  week,
  previous,
}: {
  readonly week: HomeData['week'];
  readonly previous: HomePreviousWeek;
}): JSX.Element {
  const units = useUnits();
  const weekDistance = shownDistance(metres(week.distance));
  return (
    <section className="oyl-panel oyl-home__week" aria-labelledby="oyl-home-week">
      {/* #1013: which seven days these are is the section's help. */}
      <SectionHeading
        level={2}
        id="oyl-home-week"
        help={<p>Today and the six days before it, against the seven before those.</p>}
      >
        This week
      </SectionHeading>
      {week.rides === 0 ? (
        <p>No rides in the last seven days.</p>
      ) : (
        <div className="oyl-home__days">
          <p>You rode on {String(week.daysRidden)} of the last seven days.</p>
          {/* #2049: moving time per day, drawn where #939's ring was, with
              the same figures as a table one press away — and the table
              alone if the chart throws (`design/ChartSlot.tsx`). */}
          <ChartSlot
            caption={WEEK_TABLE_CAPTION}
            columns={['Day', 'Rides', MOVING_TIME_LABEL]}
            rows={week.days.map((day, index) => [
              dayName(day.day, index === week.days.length - 1),
              String(day.rides),
              formatDuration(day.movingTime),
            ])}
            emptyMessage="No rides in the last seven days."
            chart={<WeekChart days={week.days} />}
            tablePosition="disclosed"
          />
        </div>
      )}
      <dl className="oyl-home__facts">
        <div>
          <dt>Rides</dt>
          <dd>
            <Reading value={String(week.rides)} />
          </dd>
          <dd className="oyl-home__before">{weekBefore(String(previous.rides))}</dd>
        </div>
        <div>
          <dt>{MOVING_TIME_LABEL}</dt>
          <dd>
            <Reading value={formatDuration(week.movingTime)} />
          </dd>
          <dd className="oyl-home__before">{weekBefore(formatDuration(previous.movingTime))}</dd>
        </div>
        {/* #2049: the week's distance beside its rides and time. #1070: a
            week whose rides stored no distance shows none, not 0 km. */}
        {weekDistance === undefined ? null : (
          <div>
            <dt>Distance</dt>
            <dd>
              <Reading {...formatDistance(weekDistance, units)} />
            </dd>
          </div>
        )}
        <div>
          <dt>Load</dt>
          <dd>
            <Reading value={String(Math.round(week.load))} />
            {week.ridesWithLoad < week.rides
              ? ` (from ${String(week.ridesWithLoad)} of ${String(week.rides)} rides)`
              : ''}
          </dd>
          <dd className="oyl-home__before">
            {weekBefore(String(Math.round(previous.load)))}
            {previous.ridesWithLoad < previous.rides
              ? ` (from ${String(previous.ridesWithLoad)} of ${String(previous.rides)} rides)`
              : ''}
          </dd>
        </div>
      </dl>
    </section>
  );
}
