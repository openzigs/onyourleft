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

import { unixSeconds, type Percent, type UnixSeconds } from '@onyourleft/domain';
import type { ConnectionState } from '@onyourleft/sensors';
import { useEffect, useState, type JSX } from 'react';

import type { AnalysisPort } from '../analysis/store-port';
import { trendReadings, trendSentence } from '../analysis/trend';
import { ProfileShape, SensorGlyph } from '../design/illustration';
import { SectionHeading } from '../design/SectionHelp';
import { Reading } from '../design/Reading';
import { StatusMessage } from '../design/StatusMessage';
import { formatDuration, formatStartedAt, MOVING_TIME_LABEL } from '../format';
import {
  loadHome,
  loadNextUp,
  type HomeData,
  type HomeNextUp,
  type HomePreviousWeek,
} from '../home/home';
import { RIDE_CHOICES, RideChoiceCard } from '../home/ride-choices';
import { ProgressPanel } from '../progress/ProgressPanel';
import {
  batteryWords,
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
import { hrefFor, hrefForGameRoute, routeById } from '../shell/routes';
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
        {data?.lastRide === undefined ? null : <LastRide last={data.lastRide} />}
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
 * *Last ride* — the module slot #2048 fills. Since #2044 it is its own
 * module, third in the reading order after Next up and the sensors, rather
 * than the first of the cards under the ride choices: a `section` named by
 * its own `h2`, as every module is — `a11y/audit.ts` §"landmarks are
 * distinguishable" (#864) refuses an unnamed `section` beside another.
 */
function LastRide({ last }: { readonly last: NonNullable<HomeData['lastRide']> }): JSX.Element {
  const units = useUnits();
  const lastDistance = shownDistance(last.distance);
  return (
    <section className="oyl-panel oyl-home__last" aria-labelledby="oyl-home-last">
      <h2 id="oyl-home-last">Last ride</h2>
      <p>
        <strong>{last.name}</strong>
      </p>
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
  return (
    <section className="oyl-panel oyl-home__sensors" aria-labelledby="oyl-home-sensors">
      <h2 id="oyl-home-sensors" className="tw:flex tw:items-center tw:gap-sm">
        <SensorGlyph kind="trainer" className="oyl-home__glyph" />
        Sensors
      </h2>
      <ul className="oyl-home__sensor-list">
        <li>
          {noTrainer ? (
            <p className="tw:m-0">
              No trainer paired. <a href={devices}>Pair one on Devices</a>.
            </p>
          ) : (
            <>
              {trainers.map((sensor) => (
                <SensorLine
                  key={sensor.id}
                  sensor={sensor}
                  presentation={presentation}
                  battery={levels.get(sensor.id)}
                />
              ))}
              {trainer.paired ? (
                <p className="tw:m-0">
                  {!trainer.hasControl ? (
                    <>
                      Paired, and this app has not been given control.{' '}
                      <a href={hrefFor(routeById('ride'))}>Ask for it on Ride</a>.
                    </>
                  ) : (
                    'Paired, and this app has control.'
                  )}
                </p>
              ) : null}
            </>
          )}
        </li>
        {others.map((sensor) => (
          <li key={sensor.id}>
            <SensorLine
              sensor={sensor}
              presentation={presentation}
              battery={levels.get(sensor.id)}
            />
          </li>
        ))}
      </ul>
      {others.length === 0 ? (
        <p className="oyl-muted">No heart rate, power or cadence sensor paired.</p>
      ) : null}
      {noTrainer ? null : (
        <p>
          <a href={devices}>Pair or forget devices on Devices</a>
        </p>
      )}
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
 * One device: what it is, its name and state, its own live reading, and —
 * since #2047, while it is connected and reports one — its battery
 * (`ride/battery-level.ts`). A device that reports no level shows no battery
 * line at all, never `0%`.
 */
function SensorLine({
  sensor,
  presentation,
  battery,
}: {
  readonly sensor: PairedSensor;
  readonly presentation: ReturnType<typeof presentationFor>;
  readonly battery: Percent | undefined;
}): JSX.Element {
  const reading = ROW_READING[sensor.role]
    .map((id) => sensor.readings?.find((each) => each.id === id))
    .find((each) => each !== undefined);
  return (
    <>
      <p className="oyl-home__sensor-state tw:m-0">
        {SENSOR_KIND[sensor.role]}, {sensor.name}: {connectedWords(sensor.state)}
      </p>
      {sensor.state === 'connected' && reading !== undefined ? (
        <p className="oyl-home__sensor-reading tw:m-0">
          {metricSentence(
            presentation[reading.id].label,
            metricText(reading.state, presentation[reading.id]),
          )}
        </p>
      ) : null}
      {sensor.state === 'connected' && battery !== undefined ? (
        <p
          className={`oyl-home__battery tw:m-0${isLowBattery(battery) ? ' oyl-home__battery--low' : ''}`}
        >
          <BatteryGlyph level={battery} />
          {batteryWords(battery)}
        </p>
      ) : null}
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

/** The week before's figure, as the words under a reading — its own `dd`. */
function weekBefore(value: string): string {
  return `Week before: ${value}`;
}

/**
 * *This week* — #1010: rides, moving time and load in big tabular numerals
 * (`Reading`), each set against the seven days before, and the days ridden as
 * a ring beside the sentence that says the same. Numbers only — no streak
 * and no target (#935 D-6). Every figure is `home/home.ts`'s arithmetic over
 * the one read. Since #2044 the week module's slot (#2049 fills it), fourth
 * in the reading order, a `section` named by its own `h2`.
 */
function ThisWeek({
  week,
  previous,
}: {
  readonly week: HomeData['week'];
  readonly previous: HomePreviousWeek;
}): JSX.Element {
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
          <DaysRing days={week.daysRidden} />
          <p>You rode on {String(week.daysRidden)} of the last seven days.</p>
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

/**
 * The days ridden in the last seven, as a ring beside the sentence that says
 * the same thing — #939's progress. Built from `home/home.ts`'s one read; no
 * streak and no badge (#935 D-6 is its own issue). The ring is decoration:
 * the sentence carries the number.
 */
function DaysRing({ days }: { readonly days: number }): JSX.Element {
  const share = Math.max(0, Math.min(1, days / 7));
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="oyl-home__ring"
      viewBox={`0 0 ${String(RING_BOX)} ${String(RING_BOX)}`}
    >
      <circle
        className="oyl-home__ring-track"
        cx={RING_BOX / 2}
        cy={RING_BOX / 2}
        r={RING_RADIUS}
      />
      {share === 0 ? null : (
        <circle
          className="oyl-home__ring-fill"
          cx={RING_BOX / 2}
          cy={RING_BOX / 2}
          r={RING_RADIUS}
          strokeDasharray={`${String(share * RING_CIRCUMFERENCE)} ${String(RING_CIRCUMFERENCE)}`}
          transform={`rotate(-90 ${String(RING_BOX / 2)} ${String(RING_BOX / 2)})`}
        />
      )}
    </svg>
  );
}

const RING_BOX = 48;
const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
