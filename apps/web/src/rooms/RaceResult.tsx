// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A race's result, on the game's picker once the ride has ended** — #785.
 *
 * It is here, and ONLY once the room has said the race is over
 * (`net/room-session.ts` §`RoomRace` `finished`): no component orders riders
 * while a race runs (ADR 0028 D-7.7, ruling Q8), and `GameView` mounts this
 * only for a race that finished. The order is the room's; every line is
 * `race-result.ts`'s — W/kg beside everybody, the rider's own watts beside
 * their own line alone, and every flag to everyone.
 *
 * ## Why it may need to ask more than once
 *
 * A rider's result is written when they cross the line (#807's amendment),
 * by the instance after its room worker hands it over — so the last finisher's
 * row can still be on its way when the room says "finished". This asks again,
 * a few times, until it holds as many finishers as the room's own order.
 *
 * ## A rider who left before the race was over — #785's review (N5)
 *
 * Their result is stored for them all the same (they crossed the line, or
 * the room gave them up), and the instance publishes it once the race is over
 * and not before (`apps/instance` §`rooms.ts` `results`). This device cannot
 * know when that is, so it asks only when the rider presses for it, once a
 * press, and says plainly when the race is still being ridden — or, for a
 * race that is over with no result (a restart interrupted it, #948 N-d), that
 * there is none and never will be, rather than "ask again later" for ever.
 */

import { useEffect, useState, type JSX } from 'react';

import { formatModerationItem } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { RaceResultRow, RoomsPort } from '../net/rooms-port';
import { raceResultLines } from './race-result';
import { ROOMS_REFUSAL_TEXT, ROOMS_UNREACHABLE_TEXT } from './RoomPanel';

/** How many times a result that is still arriving is asked for, a second apart. */
export const RESULT_ASKS = 5;

/** What a rider who left a race before it was over is told, before they ask. */
export const RACE_LEFT_EARLY_TEXT =
  'You left this race before it was over. Its result is kept for you, and shown once every ' +
  'rider is across the line or out of the race.';

/** What they are told when they ask and the race is still being ridden. */
export const RACE_NOT_OVER_TEXT =
  'The race is still being ridden, so there is no result yet. Ask again later.';

/** What they are told when the race is over and was never decided: there is no result to ask for. */
export const RACE_NO_RESULT_TEXT =
  'This race ended without a result: it was interrupted before it was decided, so there is ' +
  'no finish order to show.';

/**
 * What the references below the result are for (#907): each is an
 * identifier the instance's notice page takes, so a rider can report one row
 * of a result, or the race's route, and not the whole race.
 */
export const RACE_REFERENCES_SUMMARY = 'References, to report something in this race';
export const RACE_REFERENCES_TEXT =
  'To tell the instance’s moderator about one row of this result, or about the race’s route, ' +
  'copy its reference into the instance’s notice page. About links to it.';

/** The one control that asks. */
export const ASK_FOR_RESULT_LABEL = 'Show the race’s result';

export interface RaceResultProps {
  readonly rooms: RoomsPort;
  readonly roomId: string;
  /**
   * How many crossed the line, from the room's own finish order — or
   * `undefined` for a race the rider left before the room said it was over:
   * then nothing is asked until the rider presses {@link ASK_FOR_RESULT_LABEL}.
   */
  readonly finishers: number | undefined;
  /** The rider's own mean power over the race, measured here: shown on their line only. */
  readonly ownWatts: number | undefined;
  /** Waits between asks. `setTimeout` unless a test's. */
  readonly wait?: (ms: number) => Promise<void>;
}

type Shown =
  | { readonly kind: 'asking' }
  | { readonly kind: 'waiting'; readonly notOver: boolean }
  | { readonly kind: 'shown'; readonly rows: readonly RaceResultRow[] }
  | { readonly kind: 'problem'; readonly text: string };

export function RaceResult(props: RaceResultProps): JSX.Element {
  const { rooms, roomId, finishers } = props;
  const [shown, setShown] = useState<Shown>(
    finishers === undefined ? { kind: 'waiting', notOver: false } : { kind: 'asking' },
  );
  const wait = props.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  /** One ask, on the rider's press, for a race they left before it was over. */
  const askOnce = (): void => {
    setShown({ kind: 'asking' });
    void rooms.results(roomId).then((answer) => {
      if (answer.kind === 'result') setShown({ kind: 'shown', rows: answer.rows });
      else if (answer.kind === 'no-result')
        setShown({ kind: 'problem', text: RACE_NO_RESULT_TEXT });
      else if (answer.kind === 'refused' && answer.reason === 'no-such-room') {
        setShown({ kind: 'waiting', notOver: true });
      } else {
        setShown({
          kind: 'problem',
          text:
            answer.kind === 'refused' ? ROOMS_REFUSAL_TEXT[answer.reason] : ROOMS_UNREACHABLE_TEXT,
        });
      }
    });
  };

  useEffect(() => {
    if (finishers === undefined) return;
    let cancelled = false;
    void (async () => {
      for (let ask = 1; ask <= RESULT_ASKS; ask += 1) {
        const answer = await rooms.results(roomId);
        if (cancelled) return;
        if (answer.kind === 'result') {
          const placed = answer.rows.filter((row) => row.place !== null).length;
          if (placed >= finishers || ask === RESULT_ASKS) {
            setShown({ kind: 'shown', rows: answer.rows });
            return;
          }
        } else if (answer.kind === 'no-result') {
          setShown({ kind: 'problem', text: RACE_NO_RESULT_TEXT });
          return;
        } else if (answer.kind === 'refused' && answer.reason !== 'no-such-room') {
          setShown({ kind: 'problem', text: ROOMS_REFUSAL_TEXT[answer.reason] });
          return;
        } else if (ask === RESULT_ASKS) {
          setShown({ kind: 'problem', text: ROOMS_UNREACHABLE_TEXT });
          return;
        }
        await wait(1000);
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
    // `wait` is a test's seam and fixed for a component's life.
  }, [rooms, roomId, finishers]);

  return (
    <section className="oyl-race-result" aria-labelledby="oyl-race-result-heading">
      <h2 id="oyl-race-result-heading">Race result</h2>
      {shown.kind === 'asking' ? (
        <p>Fetching the race’s result…</p>
      ) : shown.kind === 'waiting' ? (
        <>
          <p>{shown.notOver ? RACE_NOT_OVER_TEXT : RACE_LEFT_EARLY_TEXT}</p>
          <Button variant="secondary" onClick={askOnce}>
            {ASK_FOR_RESULT_LABEL}
          </Button>
        </>
      ) : shown.kind === 'problem' ? (
        <StatusMessage tone="warning" label="Race result" live>
          {shown.text}
        </StatusMessage>
      ) : (
        <>
          <p>
            The room’s own finish order. Beside every rider, watts per kilogram of the weight they
            declared; a flag means a figure went over what the room checks for, and is shown to
            everyone who rode.
          </p>
          <ol className="oyl-race-result__rows">
            {raceResultLines(shown.rows, props.ownWatts).map((line, index) => (
              <li key={index} {...(line.you ? { 'aria-current': 'true' } : {})}>
                <span className="oyl-race-result__place">{line.place}</span>{' '}
                <span className="oyl-race-result__who">{line.who}</span>
                {line.time === undefined ? undefined : <> — {line.time}</>}
                {line.figure === undefined ? undefined : <>, {line.figure}</>}
                {line.flags.map((flag) => (
                  <span key={flag} className="oyl-race-result__flag">
                    {' '}
                    {flag}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          <details className="oyl-race-result__references">
            <summary>{RACE_REFERENCES_SUMMARY}</summary>
            <p>{RACE_REFERENCES_TEXT}</p>
            <ul>
              <li>
                The room: <code>{formatModerationItem({ kind: 'room', roomId })}</code>
              </li>
              <li>
                The route: <code>{formatModerationItem({ kind: 'route', roomId })}</code>
              </li>
              {shown.rows.map((_, index) => (
                <li key={index}>
                  Row {index + 1}:{' '}
                  <code>{formatModerationItem({ kind: 'result', roomId, row: index + 1 })}</code>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
