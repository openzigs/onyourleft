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
 * ## What it reads
 *
 * `home/home.ts` — one bounded store read and no stream decode, on every
 * launch. The trainer's state and a ride left unfinished come from the ride
 * controller's snapshot, which is already in memory. #939 added no read:
 * `HomeView.reads.test.tsx` counts every store call the screen makes. #1010
 * adds at most ONE record read, `getRoute`, and only when a ride was ridden
 * on a route — `home/home.ts` §`loadNextUp`.
 *
 * ⚠️ **The load metrics' familiar names are registered trademarks** (CLAUDE.md
 * §6). This says "load", "fitness", "fatigue" and "freshness", the same words
 * the Analysis screen uses, and units go through `units/format.ts`.
 */

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import { useEffect, useState, type JSX } from 'react';

import type { AnalysisPort } from '../analysis/store-port';
import { trendReadings, trendSentence } from '../analysis/trend';
import { Hills, ProfileShape, RoadRibbon, SensorGlyph, Sky } from '../design/illustration';
import { SectionHeading } from '../design/SectionHelp';
import { Reading } from '../design/Reading';
import { StatusMessage } from '../design/StatusMessage';
import { formatDuration, formatStartedAt } from '../format';
import {
  loadHome,
  loadNextUp,
  type HomeData,
  type HomeNextUp,
  type HomePreviousWeek,
} from '../home/home';
import { RIDE_CHOICES, RideChoiceCard } from '../home/ride-choices';
import { ProgressPanel } from '../progress/ProgressPanel';
import type { RideController } from '../ride/controller';
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
}

const wallClock = (): UnixSeconds => unixSeconds(Math.floor(Date.now() / 1000));

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

  return (
    <div className="oyl-home-frame tw:@container">
      <div className="oyl-home">
        {props.controller === undefined ? null : <LeftUnfinished controller={props.controller} />}
        <NextUp next={nextUp ?? { kind: 'free' }} />
        {data?.lastRide === undefined ? null : (
          <ThisWeek week={data.week} previous={data.previousWeek} />
        )}
        {props.controller === undefined ? null : <TrainerCard controller={props.controller} />}
        <RideChoices />

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

function Rides({
  data,
  analysis,
  onRead,
}: {
  readonly data: HomeData;
  readonly analysis: AnalysisPort;
  readonly onRead: () => void;
}): JSX.Element {
  const units = useUnits();
  const last = data.lastRide;
  const lastDistance = last === undefined ? undefined : shownDistance(last.distance);
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
      )}

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
 * The trainer, from what the ride controller already knows. Its words and its
 * link to Devices (#659) are unchanged by #939: a rider with no trainer is
 * told so in a sentence, never by a picture alone.
 */
function TrainerCard({ controller }: { readonly controller: RideController }): JSX.Element {
  const trainer = useRideSnapshot(controller).trainer;
  return (
    <section className="oyl-panel oyl-home__trainer" aria-labelledby="oyl-home-trainer">
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
): { readonly name: string; readonly line: string; readonly href: string } {
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
      };
    case 'free':
      return {
        name: 'A free ride',
        line: 'Record a ride from your paired sensors.',
        href: hrefFor(routeById('ride')),
      };
    case 'first':
      return {
        name: 'Your first ride',
        line: 'Pair a sensor on Devices, then record a ride from it.',
        href: hrefFor(routeById('ride')),
      };
  }
}

/**
 * *Next up* — #1010. The largest thing on the screen and the first control in
 * it: one card whose picture fills it (the route's own shape, or the kit's
 * sky, hills and road), the ride's name and one line on a solid band, and one
 * big **Ride**. The picture is `aria-hidden` and wordless; the band says
 * everything it shows, the climb included.
 */
function NextUp({ next }: { readonly next: HomeNextUp }): JSX.Element {
  const units = useUnits();
  const words = nextUpWords(next, units);
  return (
    <section
      className="oyl-next-up tw:relative tw:flex tw:flex-col tw:overflow-hidden tw:rounded-card tw:bg-surface-raised"
      aria-labelledby="oyl-next-up-heading"
    >
      <div className="oyl-next-up__art" aria-hidden="true">
        {next.kind === 'route' ? (
          <>
            <Sky className="oyl-home__layer" clouds={false} />
            <ProfileShape className="oyl-home__layer oyl-next-up__profile" profile={next.profile} />
          </>
        ) : (
          <>
            <Sky className="oyl-home__layer" />
            <Hills className="oyl-home__layer" seed={NEXT_UP_SEED} />
            <RoadRibbon className="oyl-home__layer" />
          </>
        )}
      </div>
      <div className="oyl-next-up__band tw:flex tw:flex-col tw:gap-sm tw:bg-surface-raised">
        <h2 id="oyl-next-up-heading" className="tw:m-0">
          Next up
        </h2>
        <p id="oyl-next-up-name" className="oyl-next-up__name tw:m-0">
          {words.name}
        </p>
        <p className="oyl-muted tw:m-0">{words.line}</p>
        <a
          className="oyl-button oyl-next-up__ride"
          href={words.href}
          aria-describedby="oyl-next-up-name"
        >
          Ride
        </a>
      </div>
    </section>
  );
}

/** Any whole number draws one set of hills; this one is "next up"'s. */
const NEXT_UP_SEED = 11;

/** The week before's figure, as the words under a reading — its own `dd`. */
function weekBefore(value: string): string {
  return `Week before: ${value}`;
}

/**
 * *This week* — #1010: rides, moving time and load in big tabular numerals
 * (`Reading`), each set against the seven days before, and the days ridden as
 * a ring beside the sentence that says the same. Numbers only — no streak
 * and no target (#935 D-6). Every figure is `home/home.ts`'s arithmetic over
 * the one read.
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
          <dt>Moving time</dt>
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
