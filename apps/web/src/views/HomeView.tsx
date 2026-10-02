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
 * ## What it reads
 *
 * `home/home.ts` — one bounded store read and no stream decode, on every
 * launch. The trainer's state and a ride left unfinished come from the ride
 * controller's snapshot, which is already in memory. #939 added no read:
 * `HomeView.reads.test.tsx` counts every store call the screen makes.
 *
 * ⚠️ **The load metrics' familiar names are registered trademarks** (CLAUDE.md
 * §6). This says "load", "fitness", "fatigue" and "freshness", the same words
 * the Analysis screen uses, and units go through `units/format.ts`.
 */

import {
  expandWorkout,
  seconds,
  thresholdShare,
  unixSeconds,
  type UnixSeconds,
} from '@onyourleft/domain';
import { useEffect, useState, type JSX } from 'react';

import type { AnalysisPort } from '../analysis/store-port';
import { trendReadings, trendSentence } from '../analysis/trend';
import {
  Hills,
  RiderSilhouette,
  RoadRibbon,
  SensorGlyph,
  Sky,
  WorkoutShape,
} from '../design/illustration';
import { Reading } from '../design/Reading';
import { StatusMessage } from '../design/StatusMessage';
import { formatDuration, formatStartedAt } from '../format';
import { loadHome, type HomeData } from '../home/home';
import type { RideController } from '../ride/controller';
import { useRideSnapshot } from '../ride/useRideController';
import { hrefFor, routeById } from '../shell/routes';
import { useUnits } from '../units/context';
import { formatDistance } from '../units/format';

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
    <>
      <HomeHero />
      <div className="oyl-home">
        {props.controller === undefined ? null : <LeftUnfinished controller={props.controller} />}
        <RideChoices />
        {props.controller === undefined ? null : <TrainerCard controller={props.controller} />}

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
    </>
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
              <dd>
                <Reading value={formatDuration(last.movingTime)} />
              </dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>
                <Reading {...formatDistance(last.distance, units)} />
              </dd>
            </div>
            <div>
              <dt>Load</dt>
              <dd>
                {last.load === undefined ? (
                  'not worked out yet'
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
      )}

      <section className="oyl-panel" aria-labelledby="oyl-home-week">
        <h2 id="oyl-home-week">The last seven days</h2>
        {data.week.rides === 0 ? (
          <p>No rides in the last seven days.</p>
        ) : (
          <>
            <div className="oyl-home__days">
              <DaysRing days={data.week.daysRidden} />
              <p>You rode on {String(data.week.daysRidden)} of the last seven days.</p>
            </div>
            <dl className="oyl-home__facts">
              <div>
                <dt>Rides</dt>
                <dd>
                  <Reading value={String(data.week.rides)} />
                </dd>
              </div>
              <div>
                <dt>Moving time</dt>
                <dd>
                  <Reading value={formatDuration(data.week.movingTime)} />
                </dd>
              </div>
              <div>
                <dt>Load</dt>
                <dd>
                  <Reading value={String(Math.round(data.week.load))} />
                  {data.week.ridesWithLoad < data.week.rides
                    ? ` (from ${String(data.week.ridesWithLoad)} of ${String(data.week.rides)} rides)`
                    : ''}
                </dd>
              </div>
            </dl>
          </>
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
 * The trainer, from what the ride controller already knows. Its words and its
 * link to Devices (#659) are unchanged by #939: a rider with no trainer is
 * told so in a sentence, never by a picture alone.
 */
function TrainerCard({ controller }: { readonly controller: RideController }): JSX.Element {
  const trainer = useRideSnapshot(controller).trainer;
  return (
    <section className="oyl-panel" aria-labelledby="oyl-home-trainer">
      <h2 id="oyl-home-trainer" className="tw:flex tw:items-center tw:gap-sm">
        <SensorGlyph kind="trainer" className="oyl-home__glyph" />
        Trainer
      </h2>
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
  );
}

/**
 * The band under the title — #939. Decoration only: `aria-hidden`, drawn from
 * the illustration kit (#938) and holding no word, so the `h1` and the route's
 * summary the shell renders above it stay real text. `theme.css` §"Home"
 * lays the band BEHIND those two, over its sky, and frames its picture at the
 * band's top right with the words kept clear of it, so the only pairs it puts
 * text on are the declared ones: `ink` and `inkMuted` on `illoSky`. The
 * picture is a medium drawing — 48 px tall on a phone, never a strip across
 * the band (the owner's ruling of 2026-10-01 on #935).
 *
 * ⚠️ **It is short on purpose**: a band, not a screen. `home.browser.spec.ts`
 * publishes its height, and its control (`home.html?hero=tall`, the band at
 * 90 vh) must push the first ride card's control under a phone's fold.
 */
function HomeHero(): JSX.Element {
  return (
    <div className="oyl-home-hero tw:bg-illo-sky" aria-hidden="true">
      <div className="oyl-home-hero__ground">
        <Sky className="oyl-home__layer" clouds={false} />
        <Hills className="oyl-home__layer" seed={HERO_SEED} />
        <RoadRibbon className="oyl-home__layer" />
      </div>
    </div>
  );
}

/** Any whole number draws one set of hills; this one is the hero's. */
const HERO_SEED = 11;

/**
 * A workout's outline for the Workout card's picture: a warm-up, three hard
 * efforts and a cool-down. A drawing, not a workout anybody rides — no number
 * from it is shown, and the card's words say what the screen behind it is.
 */
const CARD_WORKOUT = expandWorkout({
  name: 'Home card',
  blocks: [
    { kind: 'ramp', seconds: seconds(300), from: thresholdShare(0.5), to: thresholdShare(0.75) },
    {
      kind: 'intervals',
      repeats: 3,
      hardSeconds: seconds(180),
      hardTarget: thresholdShare(1.1),
      easySeconds: seconds(120),
      easyTarget: thresholdShare(0.55),
    },
    { kind: 'steady', seconds: seconds(240), target: thresholdShare(0.6) },
  ],
});

interface RideChoice {
  readonly id: string;
  readonly title: string;
  readonly line: string;
  readonly action: string;
  readonly to: 'ride' | 'game' | 'workouts';
  /** #668: one primary per view, and it is Free ride. */
  readonly primary: boolean;
  readonly art: JSX.Element;
}

const RIDE_CHOICES: readonly RideChoice[] = [
  {
    id: 'free',
    title: 'Free ride',
    line: 'Record a ride from your paired sensors.',
    action: 'Start a ride',
    to: 'ride',
    primary: true,
    art: (
      <>
        <Sky className="oyl-home__layer" clouds={false} />
        <Hills className="oyl-home__layer" seed={3} />
        <RiderSilhouette className="oyl-home__layer oyl-ride-card__rider" />
      </>
    ),
  },
  {
    id: 'route',
    title: 'Ride a route',
    line: 'Ride a saved route in the trainer game.',
    action: 'Choose a route',
    to: 'game',
    primary: false,
    art: (
      <>
        <Sky className="oyl-home__layer" />
        <Hills className="oyl-home__layer" seed={5} />
        <RoadRibbon className="oyl-home__layer" />
      </>
    ),
  },
  {
    id: 'workout',
    title: 'Workout',
    line: 'Follow a structured workout on a smart trainer.',
    action: 'Choose a workout',
    to: 'workouts',
    primary: false,
    art: (
      <>
        <Sky className="oyl-home__layer" sun={false} />
        <WorkoutShape className="oyl-home__layer oyl-ride-card__workout" workout={CARD_WORKOUT} />
      </>
    ),
  },
];

/**
 * Where a ride starts — #939: three equal cards, the next thing to do the
 * largest thing on the screen. Each card is a list item with a picture (a
 * medium drawing, 48 px tall, framed beside the heading — the owner's ruling
 * of 2026-10-01 on #935), a real heading, one line and ONE link; the link's `::after` stretches over the card
 * (`theme.css` §`.oyl-ride-card__link`), so the whole card is the target and
 * still holds a single interactive element.
 */
function RideChoices(): JSX.Element {
  return (
    <section className="oyl-home__start" aria-labelledby="oyl-home-start">
      <h2 id="oyl-home-start">Ride</h2>
      <ul className="oyl-home__rides">
        {RIDE_CHOICES.map((choice) => (
          <li
            key={choice.id}
            className="oyl-ride-card tw:relative tw:flex tw:flex-col tw:overflow-hidden tw:rounded-card tw:bg-surface-raised"
          >
            <div className="oyl-ride-card__art">{choice.art}</div>
            <div className="oyl-ride-card__body tw:flex tw:grow tw:flex-col tw:gap-sm tw:p-lg">
              <h3 id={`oyl-home-ride-${choice.id}`} className="tw:m-0">
                {choice.title}
              </h3>
              <p className="oyl-muted tw:m-0">{choice.line}</p>
              <a
                className={`oyl-button oyl-ride-card__link tw:mt-auto tw:self-start${choice.primary ? '' : ' oyl-button--secondary'}`}
                href={hrefFor(routeById(choice.to))}
                aria-describedby={`oyl-home-ride-${choice.id}`}
              >
                {choice.action}
              </a>
            </div>
          </li>
        ))}
      </ul>
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
