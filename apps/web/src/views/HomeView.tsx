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
 * ## What it reads
 *
 * `home/home.ts` — one bounded store read and no stream decode, on every
 * launch. The trainer's state and a ride left unfinished come from the ride
 * controller's snapshot, which is already in memory.
 *
 * ⚠️ **The load metrics' familiar names are registered trademarks** (CLAUDE.md
 * §6). This says "load", "fitness", "fatigue" and "freshness", the same words
 * the Analysis screen uses, and units go through `units/format.ts`.
 */

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import { useEffect, useState, type JSX } from 'react';

import type { AnalysisPort } from '../analysis/store-port';
import { trendReadings, trendSentence } from '../analysis/trend';
import { StatusMessage } from '../design/StatusMessage';
import { formatDuration, formatStartedAt } from '../format';
import { loadHome, type HomeData } from '../home/home';
import type { RideController } from '../ride/controller';
import { useRideSnapshot } from '../ride/useRideController';
import { hrefFor, routeById } from '../shell/routes';
import { useUnits } from '../units/context';
import { formatDistance, measurementText } from '../units/format';

export interface HomeViewProps {
  readonly analysis: AnalysisPort | undefined;
  readonly controller: RideController | undefined;
  /** The clock "this week" is measured from. A seam for tests. */
  readonly now?: (() => UnixSeconds) | undefined;
}

const wallClock = (): UnixSeconds => unixSeconds(Math.floor(Date.now() / 1000));

export function HomeView(props: HomeViewProps): JSX.Element {
  const { analysis } = props;
  const now = props.now ?? wallClock;
  const [data, setData] = useState<HomeData | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (analysis === undefined) {
      return;
    }
    let live = true;
    loadHome(analysis, now()).then(
      (loaded) => {
        if (live) setData(loaded);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // ⚠️ `analysis` only: `now` is a clock, read once per mount. A dependency
    // on it would be a store read per render, which is the thing this screen
    // exists to bound.
  }, [analysis]);

  return (
    <div className="oyl-home">
      {props.controller === undefined ? null : <FromTheRide controller={props.controller} />}

      <section className="oyl-panel oyl-home__start" aria-labelledby="oyl-home-start">
        <h2 id="oyl-home-start">Ride</h2>
        <p className="oyl-home__actions">
          <a className="oyl-button" href={hrefFor(routeById('ride'))}>
            Start a ride
          </a>
          <a className="oyl-button oyl-button--secondary" href={hrefFor(routeById('game'))}>
            Ride a route
          </a>
        </p>
      </section>

      {analysis === undefined ? (
        <StatusMessage tone="danger">
          No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
          this page cannot reach it — a private window or blocked site data is the usual reason.
        </StatusMessage>
      ) : failed ? (
        <StatusMessage tone="danger">Your rides could not be read on this device.</StatusMessage>
      ) : data === undefined ? (
        <p className="oyl-muted">Reading your rides…</p>
      ) : data.lastRide === undefined ? (
        <GettingStarted />
      ) : (
        <Rides data={data} />
      )}
    </div>
  );
}

/** The empty state — the first thing a new rider sees. */
function GettingStarted(): JSX.Element {
  return (
    <section className="oyl-panel oyl-home__empty" aria-labelledby="oyl-home-empty">
      <h2 id="oyl-home-empty">Nothing recorded yet</h2>
      <p>Everything here stays on this device. To get going:</p>
      <ol>
        <li>
          <a href={hrefFor(routeById('devices'))}>Pair a sensor or a smart trainer</a> over
          Bluetooth.
        </li>
        <li>
          <a href={hrefFor(routeById('ride'))}>Record a ride</a>, or ride a saved route in the{' '}
          <a href={hrefFor(routeById('game'))}>trainer game</a>.
        </li>
        <li>
          Or <a href={hrefFor(routeById('transfer'))}>bring rides in</a> from a FIT, GPX or TCX
          file.
        </li>
      </ol>
    </section>
  );
}

function Rides({ data }: { readonly data: HomeData }): JSX.Element {
  const units = useUnits();
  const last = data.lastRide;
  const readings = trendReadings(data.fitness);
  return (
    <>
      {last === undefined ? null : (
        <section className="oyl-panel" aria-labelledby="oyl-home-last">
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
              <dt>Moving time</dt>
              <dd>{formatDuration(last.movingTime)}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{measurementText(formatDistance(last.distance, units))}</dd>
            </div>
            <div>
              <dt>Load</dt>
              <dd>
                {last.load === undefined ? 'not worked out yet' : String(Math.round(last.load))}
              </dd>
            </div>
          </dl>
          <p>
            <a href={hrefFor(routeById('activities'))}>All your rides</a>
          </p>
        </section>
      )}

      <section className="oyl-panel" aria-labelledby="oyl-home-week">
        <h2 id="oyl-home-week">The last seven days</h2>
        {data.week.rides === 0 ? (
          <p>No rides in the last seven days.</p>
        ) : (
          <dl className="oyl-home__facts">
            <div>
              <dt>Rides</dt>
              <dd>{String(data.week.rides)}</dd>
            </div>
            <div>
              <dt>Moving time</dt>
              <dd>{formatDuration(data.week.movingTime)}</dd>
            </div>
            <div>
              <dt>Load</dt>
              <dd>
                {String(Math.round(data.week.load))}
                {data.week.ridesWithLoad < data.week.rides
                  ? ` (from ${String(data.week.ridesWithLoad)} of ${String(data.week.rides)} rides)`
                  : ''}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="oyl-panel" aria-labelledby="oyl-home-form">
        <h2 id="oyl-home-form">Fitness and freshness</h2>
        {readings.length === 0 ? (
          <p className="oyl-muted">
            No ride here has a load yet, so there is nothing to smooth.{' '}
            <a href={hrefFor(routeById('analysis'))}>Analysis</a> can work them out.
          </p>
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
    </>
  );
}

/** What the ride controller already knows: the trainer, and a ride left unsaved. */
function FromTheRide({ controller }: { readonly controller: RideController }): JSX.Element {
  const snapshot = useRideSnapshot(controller);
  const trainer = snapshot.trainer;
  return (
    <>
      {snapshot.recoverable.length === 0 ? null : (
        <StatusMessage tone="warning" label="A ride left unfinished">
          This device is holding a ride that was not saved.{' '}
          <a href={hrefFor(routeById('ride'))}>Go to Ride</a> to save it or let it go.
        </StatusMessage>
      )}
      <section className="oyl-panel" aria-labelledby="oyl-home-trainer">
        <h2 id="oyl-home-trainer">Trainer</h2>
        <p>
          {!trainer.paired ? (
            <>
              No trainer paired. <a href={hrefFor(routeById('devices'))}>Pair one on Devices</a>.
            </>
          ) : !trainer.hasControl ? (
            <>
              Paired, and this app has not been given control.{' '}
              <a href={hrefFor(routeById('ride'))}>Ask for it on Ride</a>.
            </>
          ) : (
            'Paired, and this app has control.'
          )}
        </p>
      </section>
    </>
  );
}
