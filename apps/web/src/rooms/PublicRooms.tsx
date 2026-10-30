// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The public rooms on a rider's instance** — #788: the listing, read on a
 * press, and a room joined from it.
 *
 * ## For adults
 *
 * Said before anything else (ruling Q5, 2026-09-28): public rooms are for
 * riders who confirmed they are 18 or over, and the instance refuses anybody
 * else making, seeing or joining one. This screen does not decide that — the
 * instance does — but it says it, and says what to do when refused.
 *
 * ## The instance's order, kept
 *
 * The rooms are shown in the order the instance listed them — the start each
 * maker gave, then when it was made (ADR 0028 D-7.1) — and never re-sorted,
 * filtered or highlighted here: nothing on this screen features a room.
 *
 * ## What a listed room says
 *
 * Its kind, its start, its length and its climb, in the rider's units, and
 * whether it drafts. Never its route: the route is fetched, and checked, only
 * once the rider joined (`net/rooms-port.ts` §`joinPublic`).
 */

import { useState, type JSX } from 'react';

import { metres } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type {
  EnteredRoom,
  JoinRoomAnswer,
  ListedRoom,
  PublicRoomsAnswer,
  RoomsPort,
} from '../net/rooms-port';
import { useUnits } from '../units/context';
import { formatDistance, formatSmallDistance, measurementText } from '../units/format';

/**
 * Every sentence about public rooms — ⚠️ draft wording awaiting the owner's
 * approval (#788's orchestrator comments), like every sentence in the room work.
 */
export const PUBLIC_ROOMS_TEXT = {
  heading: 'Public rooms',
  adults:
    'Public rooms are for adults: only riders who have confirmed on their instance that they ' +
    'are 18 or over can make, see or join one.',
  sent:
    'A public room is listed on your instance for any adult rider there to join: its kind, ' +
    'start, length and climb. Its route goes only to the riders who join it, and the listing ' +
    'never names who made it.',
  show: 'Show public rooms',
  again: 'Show them again',
  reading: 'Reading the public rooms…',
  none: 'No public rooms are open on your instance just now.',
  joining: 'Joining…',
  drafting: { on: 'drafting', off: 'no drafting' },
} as const;

/** "Group ride" or "Race", as a listed room is named. */
const KIND = { group: 'Group ride', race: 'Race' } as const;

/** A start, as the rider's own clock reads it: an hour and a minute. */
export function publicRoomStartText(startsAt: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(startsAt * 1000),
  );
}

export interface PublicRoomsProps {
  readonly rooms: RoomsPort;
  readonly onEnter: (room: EnteredRoom) => void;
  /** What a refusal or an unanswered request says: the panel's own sentences. */
  readonly refusalText: (answer: PublicRoomsAnswer | JoinRoomAnswer) => string | undefined;
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'listed'; readonly rooms: readonly ListedRoom[] }
  | { readonly kind: 'refused'; readonly text: string };

export function PublicRooms(props: PublicRoomsProps): JSX.Element {
  const units = useUnits();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [joining, setJoining] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const read = (): void => {
    if (state.kind === 'reading') return;
    setState({ kind: 'reading' });
    setProblem(undefined);
    void props.rooms.listPublic().then((answer) => {
      setState(
        answer.kind === 'listed'
          ? { kind: 'listed', rooms: answer.rooms }
          : { kind: 'refused', text: props.refusalText(answer) ?? '' },
      );
    });
  };

  const join = (room: ListedRoom): void => {
    if (joining !== undefined) return;
    setJoining(room.roomId);
    setProblem(undefined);
    void props.rooms.joinPublic(room).then((answer) => {
      setJoining(undefined);
      if (answer.kind === 'joined') props.onEnter(answer.room);
      else setProblem(props.refusalText(answer));
    });
  };

  return (
    <div className="oyl-rooms__public">
      <h3>{PUBLIC_ROOMS_TEXT.heading}</h3>
      <p data-oyl-kept-visible="">{PUBLIC_ROOMS_TEXT.adults}</p>
      {state.kind === 'refused' || problem !== undefined ? (
        <StatusMessage tone="warning" label="Public rooms" live>
          {problem ?? (state.kind === 'refused' ? state.text : '')}
        </StatusMessage>
      ) : undefined}
      {state.kind === 'listed' ? (
        state.rooms.length === 0 ? (
          <p>{PUBLIC_ROOMS_TEXT.none}</p>
        ) : (
          <ul className="oyl-rooms__listing">
            {state.rooms.map((room) => {
              const start = publicRoomStartText(room.startsAt);
              const described =
                `${KIND[room.kind]}, starts ${start} — ` +
                `${measurementText(formatDistance(metres(room.lengthMetres), units))}, ` +
                `${measurementText(formatSmallDistance(room.climbMetres, units))} of climbing, ` +
                (room.drafting ? PUBLIC_ROOMS_TEXT.drafting.on : PUBLIC_ROOMS_TEXT.drafting.off);
              return (
                <li key={room.roomId}>
                  <span>{described}</span>{' '}
                  <Button
                    variant="secondary"
                    unavailable={joining !== undefined}
                    onClick={() => {
                      join(room);
                    }}
                  >
                    {joining === room.roomId ? PUBLIC_ROOMS_TEXT.joining : 'Join'}
                    <span className="oyl-visually-hidden">
                      {' '}
                      the {KIND[room.kind].toLowerCase()} starting at {start}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : undefined}
      <Button variant="secondary" unavailable={state.kind === 'reading'} onClick={read}>
        {state.kind === 'reading'
          ? PUBLIC_ROOMS_TEXT.reading
          : state.kind === 'idle'
            ? PUBLIC_ROOMS_TEXT.show
            : PUBLIC_ROOMS_TEXT.again}
      </Button>
    </div>
  );
}
