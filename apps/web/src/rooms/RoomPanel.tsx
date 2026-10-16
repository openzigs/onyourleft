// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Ride with others** — #784's private group ride and #785's private race,
 * on the game's route picker: make a room on one of your own routes and share
 * its code, or join one by the code a friend shared — and #788's public
 * rooms: list one you make for any adult rider on your instance, or join one
 * from the listing (`PublicRooms.tsx`).
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

import { formatModerationItem, type RouteProfile } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type {
  CreateRoomAnswer,
  EnteredRoom,
  JoinRoomAnswer,
  PublicRoomsAnswer,
  RoomRidingPosition,
  RoomsPort,
  RoomsRefusal,
} from '../net/rooms-port';
import { hrefFor, routeById } from '../shell/routes';
import { PUBLIC_ROOMS_TEXT, PublicRooms, publicRoomStartText } from './PublicRooms';
import { ROOM_ROUTE_REFUSAL_TEXT, type RoomRouteRefusal } from './share';

/** One of the rider's own routes, as the panel offers it for a room. */
export interface RoomRouteChoice {
  readonly id: string;
  readonly name: string;
  readonly profile: RouteProfile;
}

/**
 * What the references under an entered room are for (#913): each is an
 * identifier the instance's notice page takes, so a rider can report the room
 * or its route alone. ⚠️ Draft wording awaiting the owner's approval.
 */
export const ROOM_REFERENCES_SUMMARY = 'References, to report something in this room';
export const ROOM_REFERENCES_TEXT =
  'To tell the instance’s moderator about this room or its route, copy its reference into the ' +
  'instance’s notice page. About links to it.';

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
  // #788.
  'not-eligible':
    'Your account cannot use public rooms yet: they are for adults whose account is ready for ' +
    'them. The Instance screen says what is missing — confirming you are 18 or over, for one.',
  'no-public-rooms':
    'Your instance does not offer public rooms. Whether it does is its operator’s choice.',
  // #1210 (ADR 0047 D-14 Q6).
  'cannot-seal':
    'Rooms on your instance are reached only encrypted, and this device cannot do that right ' +
    'now. The Instance screen says why.',
};

/**
 * A room's drafting, in words — #787, the owner's ruling of 2026-09-30: said
 * to every rider in the room before the start, and offered to the rider
 * making one. ⚠️ Draft wording awaiting the owner's approval.
 */
export const ROOM_DRAFTING_TEXT = {
  choice: 'Drafting',
  choiceDetail: ' — riding close behind another rider takes less effort, as on the road',
  on: 'Drafting is on: riding close behind another rider takes less effort.',
  off: 'Drafting is off: every rider pushes the same air, whoever is in front.',
} as const;

/**
 * #788: listing a room the rider makes — ⚠️ draft wording awaiting the
 * owner's approval. A start no further ahead than the instance takes (twelve
 * hours, `apps/instance` §`PUBLIC_ROOM_START_AHEAD_MS`).
 */
export const LIST_ROOM_TEXT = {
  choice: 'List it as a public room',
  choiceDetail: ' — for any adult rider on your instance to find and join; it has no code',
  startsIn: 'Starts in',
  tooMany:
    'You have reached a limit on making rooms: three public rooms a day, ten rooms an hour, or five open at once. Wait, or close one, and try again.',
  listed: (start: string): string =>
    `It is listed on your instance as a public room, starting at ${start}. Any adult rider ` +
    'there can join it.',
} as const;

/** When a listed room starts, from the moment it is made: minutes, and how each is said. */
export const LIST_ROOM_STARTS: readonly { readonly minutes: number; readonly label: string }[] = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: 'an hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
];

/** What the rider is told when nothing answered. */
export const ROOMS_UNREACHABLE_TEXT =
  'The instance did not answer. Check this device’s connection and try again.';

/**
 * The race's weight disclosure — the owner's ruling of 2026-10-15 on #1354
 * (ADR 0051 D-1): live W/kg stays, and a rider is told, before they make a
 * race or ride one they joined, that the others can estimate their weight from
 * it. Shown for a race only; a group ride sends no W/kg to anybody. ⚠️ Draft
 * wording awaiting the owner's approval.
 */
export const RACE_WEIGHT_DISCLOSURE =
  'In a race, everyone in it sees your watts per kilogram live, so they can work out roughly ' +
  'what you weigh.';

/** What leaves the device when a room is made or joined — kept visible, never tucked away. */
export const ROOMS_WHAT_IS_SENT =
  'Making a room sends the route you choose — its roads and heights, not its name — to your ' +
  'instance, for the riders you share its code with. Anyone with the code can join. In the ' +
  'room, your power and cadence go to the instance twice a second while you ride, and your ' +
  'weight once as you join; the other riders see where you are on the road; in a race they ' +
  'also see your name and, every second, your watts per kilogram — which, with your speed, ' +
  'lets them work out roughly what you weigh — and how many seconds ahead ' +
  'or behind them you are, and after it its result: your name, place, time, watts per ' +
  'kilogram and any flag the room raised for a figure past its limit. The route is deleted ' +
  'from the instance when the ' +
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

function refusalText(
  answer: CreateRoomAnswer | JoinRoomAnswer | PublicRoomsAnswer,
): string | undefined {
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
  // #787: on by default, the maker's to turn off, and fixed for the room.
  const [drafting, setDrafting] = useState(true);
  // #788: private unless the maker lists it, and then from when it starts.
  const [listed, setListed] = useState(false);
  const [startsIn, setStartsIn] = useState(30);
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
            ? entered.code === undefined && entered.listed?.madeHere !== true
              ? ' The race starts when the rider who made the room starts it.'
              : ' You start the race, from the ride, when your riders are on the line.'
            : ' Ride whenever you like; there is no leader and no result.'}{' '}
          {entered.drafting ? ROOM_DRAFTING_TEXT.on : ROOM_DRAFTING_TEXT.off}
        </StatusMessage>
        {entered.kind === 'race' ? (
          <p data-oyl-kept-visible="">{RACE_WEIGHT_DISCLOSURE}</p>
        ) : undefined}
        {entered.listed === undefined ? undefined : (
          <p>{LIST_ROOM_TEXT.listed(publicRoomStartText(entered.listed.startsAt))}</p>
        )}
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
        {/* #913: the room and its route, by the identifiers the instance's
            notice page takes, so either can be reported alone. */}
        <details className="oyl-rooms__references">
          <summary>{ROOM_REFERENCES_SUMMARY}</summary>
          <p>{ROOM_REFERENCES_TEXT}</p>
          <ul>
            <li>
              This room:{' '}
              <code>{formatModerationItem({ kind: 'room', roomId: entered.roomId })}</code>
            </li>
            <li>
              Its route:{' '}
              <code>{formatModerationItem({ kind: 'route', roomId: entered.roomId })}</code>
            </li>
          </ul>
        </details>
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
      <PublicRooms rooms={rooms} onEnter={props.onEnter} refusalText={refusalText} />
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
            <label>
              <input
                type="checkbox"
                checked={drafting}
                onChange={(event) => {
                  setDrafting(event.target.checked);
                }}
              />
              {ROOM_DRAFTING_TEXT.choice}
              {ROOM_DRAFTING_TEXT.choiceDetail}
            </label>
            <label>
              <input
                type="checkbox"
                checked={listed}
                onChange={(event) => {
                  setListed(event.target.checked);
                }}
              />
              {LIST_ROOM_TEXT.choice}
              {LIST_ROOM_TEXT.choiceDetail}
            </label>
            {listed ? <p data-oyl-kept-visible="">{PUBLIC_ROOMS_TEXT.sent}</p> : undefined}
            {listed ? (
              <label>
                {LIST_ROOM_TEXT.startsIn}
                <select
                  value={startsIn}
                  onChange={(event) => {
                    setStartsIn(Number(event.target.value));
                  }}
                >
                  {LIST_ROOM_STARTS.map((each) => (
                    <option key={each.minutes} value={each.minutes}>
                      {each.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined}
            {kind === 'race' ? <p data-oyl-kept-visible="">{RACE_WEIGHT_DISCLOSURE}</p> : undefined}
            <Button
              variant="secondary"
              unavailable={busy !== undefined}
              onClick={() => {
                if (busy !== undefined) return;
                setBusy('making');
                setProblem(undefined);
                const startsAt = listed ? Math.floor(Date.now() / 1000) + startsIn * 60 : undefined;
                void rooms
                  .create({
                    kind,
                    ridingPosition: props.position,
                    drafting,
                    route: chosen,
                    startsAt,
                  })
                  .then((answer) => {
                    setBusy(undefined);
                    if (answer.kind === 'created') props.onEnter(answer.room);
                    else if (
                      startsAt !== undefined &&
                      answer.kind === 'refused' &&
                      answer.reason === 'rate-limited'
                    ) {
                      // #788: the server's limits on a create are three public a day, ten an hour
                      // and five open, and it answers all three alike — so say all three.
                      setProblem(LIST_ROOM_TEXT.tooMany);
                    } else setProblem(refusalText(answer));
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
