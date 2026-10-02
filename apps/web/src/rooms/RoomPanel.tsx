// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Ride with others** — #784's private group ride and #785's private race,
 * on the game's route picker: make a room on one of your own routes and share
 * its code, or join one by the code a friend shared.
 *
 * ## What it asks for first
 *
 * - **An instance.** A room is on the instance this device is connected to;
 *   with none, this says where to connect and offers nothing else (ADR 0036
 *   D-3: a rider with no instance loses nothing — the picker above is
 *   unchanged).
 * - **A declared weight** (#782's review, N5; #784's comment): a room rides
 *   you at the weight you declare and never at a default, so with none this
 *   asks for one BEFORE a room is made or joined, rather than refusing the
 *   ride once it has started.
 *
 * ## No leader — ADR 0028 D-7.2
 *
 * Nothing here directs another rider's ride: making a room gives its maker a
 * code to share, and — the owner's ruling of 2026-09-30 — the start of its
 * race, and nothing else. There is no "follow me", no pace, no pause and no
 * move for anybody but yourself once it runs (`apps/instance` §`room-host.ts`
 * `start`; it reverses #785's first rule, any rider on the line).
 *
 * ## The code
 *
 * Shown to the rider who made the room, once, to share; kept in this screen's
 * memory and nowhere else — not in the address bar, not in storage, not in the
 * console. Anyone with it can join, and the screen says so.
 */

import { useState, type JSX } from 'react';

import type { RouteProfile } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type {
  CreateRoomAnswer,
  EnteredRoom,
  JoinRoomAnswer,
  RoomRidingPosition,
  RoomsPort,
  RoomsRefusal,
} from '../net/rooms-port';
import { hrefFor, routeById } from '../shell/routes';
import { ROOM_ROUTE_REFUSAL_TEXT, type RoomRouteRefusal } from './share';

/** One of the rider's own routes, as the panel offers it for a room. */
export interface RoomRouteChoice {
  readonly id: string;
  readonly name: string;
  readonly profile: RouteProfile;
}

/** What a room's kind is called on this screen. */
export const ROOM_KIND_LABEL = { group: 'Group ride', race: 'Race' } as const;

/**
 * Every sentence the panel says about a refusal — ⚠️ draft wording awaiting
 * the owner's approval, like every sentence in the room work.
 */
export const ROOMS_REFUSAL_TEXT: Readonly<Record<RoomsRefusal, string>> = {
  'not-signed-in':
    'This device is not signed in to an instance. Connect to one on the Settings screen.',
  'no-such-room':
    'No open room has that code. Check it with whoever shared it — a room that is over has closed.',
  'rate-limited': 'Too many codes tried. Wait a quarter of an hour and try again.',
  'not-the-rooms-route':
    'The room’s route did not arrive as the room made it, so it was not used. Try joining again.',
  'instance-refused': 'The instance would not do that. Try again later.',
};

/** What the rider is told when nothing answered. */
export const ROOMS_UNREACHABLE_TEXT =
  'The instance did not answer. Check this device’s connection and try again.';

/** What leaves the device when a room is made or joined — kept visible, never tucked away. */
export const ROOMS_WHAT_IS_SENT =
  'Making a room sends the route you choose — its roads and heights, not its name — to your ' +
  'instance, for the riders you share its code with. Anyone with the code can join. In the ' +
  'room, your power and cadence go to the instance twice a second while you ride, and your ' +
  'weight once as you join; the other riders see your name and where you are on the road, ' +
  'and after a race its result: your name, place, time, watts per kilogram and any flag the ' +
  'room raised for a figure past its limit. The route is deleted from the instance when the ' +
  'room is over — within about a day of being made, unless somebody is riding in it then.';

export interface RoomPanelProps {
  /** `undefined` where this device has no instance to hold a room. */
  readonly rooms: RoomsPort | undefined;
  /** The rider's own routes, to make a room on. */
  readonly routes: readonly RoomRouteChoice[];
  /** Whether the rider has declared a weight: a room needs one. */
  readonly weightDeclared: boolean;
  /** Where the rider's hands will be — the room's, for everybody in it. */
  readonly position: RoomRidingPosition;
  /** The room this device is in, if any. */
  readonly entered: EnteredRoom | undefined;
  readonly onEnter: (room: EnteredRoom | undefined) => void;
  /** Start riding in the room this device is in. */
  readonly onRide: (room: EnteredRoom) => void;
}

type Busy = 'making' | 'joining' | undefined;

function refusalText(answer: CreateRoomAnswer | JoinRoomAnswer): string | undefined {
  if (answer.kind === 'unreachable') return ROOMS_UNREACHABLE_TEXT;
  if (answer.kind !== 'refused') return undefined;
  const reason = answer.reason;
  return reason in ROOMS_REFUSAL_TEXT
    ? ROOMS_REFUSAL_TEXT[reason as RoomsRefusal]
    : ROOM_ROUTE_REFUSAL_TEXT[reason as RoomRouteRefusal];
}

export function RoomPanel(props: RoomPanelProps): JSX.Element {
  const [routeId, setRouteId] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<'group' | 'race'>('group');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Busy>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const settings = hrefFor(routeById('settings'));
  // #1013: what a room is held on is the section's help; each state keeps its
  // one line of what to do.
  const heading = (
    <SectionHeading
      level={2}
      id="oyl-rooms-heading"
      help={<p>A private group ride or race is held on an instance.</p>}
    >
      Ride with others
    </SectionHeading>
  );

  if (props.rooms === undefined) {
    return (
      <section className="oyl-rooms" aria-labelledby="oyl-rooms-heading">
        {heading}
        <p>
          <a href={settings}>Connect this device to one in Settings</a> to make a room or join one
          by its code.
        </p>
      </section>
    );
  }
  if (!props.weightDeclared) {
    return (
      <section className="oyl-rooms" aria-labelledby="oyl-rooms-heading">
        {heading}
        <p>
          A room rides you at the weight you declare, and never at a guess.{' '}
          <a href={settings}>Set your weight in Settings</a> to make a room or join one.
        </p>
      </section>
    );
  }

  const entered = props.entered;
  if (entered !== undefined) {
    return (
      <section className="oyl-rooms" aria-labelledby="oyl-rooms-heading">
        {heading}
        <StatusMessage tone="info" label={ROOM_KIND_LABEL[entered.kind]} live>
          You are in a {entered.kind === 'race' ? 'race' : 'group ride'} on the room’s route.
          {entered.kind === 'race'
            ? entered.code === undefined
              ? ' The race starts when the rider who made the room starts it.'
              : ' You start the race, from the ride, when your riders are on the line.'
            : ' Ride whenever you like; there is no leader and no result.'}
        </StatusMessage>
        {entered.code === undefined ? undefined : (
          <p>
            Its code is <strong className="oyl-rooms__code">{entered.code}</strong>. Share it with
            the riders you are inviting: anyone who has it can join.
          </p>
        )}
        <div className="oyl-rooms__actions">
          <Button
            variant="secondary"
            onClick={() => {
              props.onRide(entered);
            }}
          >
            Ride in the room
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              props.onEnter(undefined);
            }}
          >
            Leave the room
          </Button>
        </div>
      </section>
    );
  }

  const rooms = props.rooms;
  const chosen = props.routes.find((route) => route.id === routeId) ?? props.routes[0];
  return (
    <section className="oyl-rooms" aria-labelledby="oyl-rooms-heading">
      {heading}
      <p data-oyl-kept-visible="">{ROOMS_WHAT_IS_SENT}</p>
      {problem === undefined ? undefined : (
        <StatusMessage tone="warning" label="Room" live>
          {problem}
        </StatusMessage>
      )}
      <form
        className="oyl-rooms__join"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy !== undefined) return;
          setBusy('joining');
          setProblem(undefined);
          void rooms.join(code).then((answer) => {
            setBusy(undefined);
            if (answer.kind === 'joined') {
              setCode('');
              props.onEnter(answer.room);
            } else {
              setProblem(refusalText(answer));
            }
          });
        }}
      >
        <h3>Join a room</h3>
        <label>
          Room code
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
        </label>
        <Button type="submit" variant="secondary" unavailable={busy !== undefined}>
          {busy === 'joining' ? 'Joining…' : 'Join the room'}
        </Button>
      </form>
      <div className="oyl-rooms__make">
        <h3>Make a room</h3>
        {chosen === undefined ? (
          <p>Save a route first: a room is ridden on one of your own.</p>
        ) : (
          <>
            <label>
              Route
              <select
                value={chosen.id}
                onChange={(event) => {
                  setRouteId(event.target.value);
                }}
              >
                {props.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Kind of room</legend>
              {(['group', 'race'] as const).map((each) => (
                <label key={each}>
                  <input
                    type="radio"
                    name="oyl-room-kind"
                    checked={kind === each}
                    onChange={() => {
                      setKind(each);
                    }}
                  />
                  {ROOM_KIND_LABEL[each]}
                  {each === 'group'
                    ? ' — ride together, with no leader and no result'
                    : ' — a countdown, then a finish order with each rider’s watts per kilogram'}
                </label>
              ))}
            </fieldset>
            <Button
              variant="secondary"
              unavailable={busy !== undefined}
              onClick={() => {
                if (busy !== undefined) return;
                setBusy('making');
                setProblem(undefined);
                void rooms
                  .create({ kind, ridingPosition: props.position, route: chosen })
                  .then((answer) => {
                    setBusy(undefined);
                    if (answer.kind === 'created') props.onEnter(answer.room);
                    else setProblem(refusalText(answer));
                  });
              }}
            >
              {busy === 'making' ? 'Making the room…' : 'Make a room'}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
