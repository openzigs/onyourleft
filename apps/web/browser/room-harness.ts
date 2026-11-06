// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #782's end-to-end room, from one rider's side: this page signs a new rider
 * in to a REAL instance with the production instance port — the real `fetch`
 * in `instance/instance-transport.ts`, cross-origin to the instance's own
 * listener — and joins a room with the production room port, whose socket is
 * that module's one `WebSocket`. It reports a steady power, as a rider on a
 * trainer would, and publishes what the room's frames put the OTHER riders at.
 *
 * Since #784 it also makes a room and joins one by its code, through the
 * production ROOMS port (`net/rooms-port.ts`), and DRAWS the route of the room
 * it is in — the room's GPX, fetched by content hash and checked against it,
 * projected by the HUD's own plan (`game/hud/plan.ts`) into an SVG on this
 * page. `room.browser.spec.ts` compares what two pages drew.
 *
 * `room.browser.spec.ts` opens two of these in two browser contexts — two
 * devices, two athletes — against one instance, and reads each. Its controls
 * are `fanOut: false`, which keeps no frame this page receives
 * (`net/room-session.ts` §`RoomSessionOptions.acceptFrame`) — fan-out switched
 * off where the client meets it, so the spec must then see nobody move — and,
 * for #784, `tamper: true`, which alters the room's route on its way in, so
 * the page must then refuse it and draw nothing.
 *
 * Since #782's last criterion it also reports THIS rider's seat and where the
 * room's newest frame put them, so the spec can read both across an edge
 * restart (`room.browser.spec.ts` §"an edge drops every room socket").
 *
 * Since #1911 it also races in a LAP RACE (`lap()`, `changeLane`, `useItem`,
 * `start`): what the room's newest frame holds for this rider — lane, held
 * item, offset — and the two inputs the game sends, through the same
 * production room port.
 *
 * Since #1912 it also MAKES a private lap race on a loop of its own and rides
 * it on power read from `@onyourleft/sensors`' simulator — a simulated power
 * meter, connected and subscribed through the simulator's own transport, as
 * the app reads a real one — and reads the race's finish order off the room
 * and its published result off the instance.
 *
 * ⚠️ **What it does not prove**: anything about the game's drawing (the game
 * gate's §"#783" is that), a phone's WebView, the screen going off, or a
 * Cloudflare Tunnel in the path — those are #733's.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  seconds,
  unixSeconds,
  watts as wattsOf,
  type SigningKey,
} from '@onyourleft/domain';
import { deviceId } from '@onyourleft/sensors';
import { cpsPowerMeter, createSimulator } from '@onyourleft/sensors/simulator';
import { ensureDeviceSigningKey, openActivityStore } from '@onyourleft/store';

import { planPath, routePlan } from '../src/game/hud/plan';
import type { LoadedFrom } from '../src/instance/instance-pin';
import { createInstancePort, type ConnectOutcome } from '../src/instance/instance-port';
import type { InstanceSend } from '../src/instance/instance-transport';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { createRoomPort, type RoomConnection } from '../src/net/room-port';
import { createRoomsPort, type EnteredRoom } from '../src/net/rooms-port';

export interface RoomSample {
  readonly status: string;
  /** This rider's seat, while joined: the room's `riderId` for them. */
  readonly seat: number | undefined;
  /** Where the room's newest frame put THIS rider, in metres; `undefined` before one. */
  readonly ownDistanceMetres: number | undefined;
  readonly others: readonly { readonly riderId: number; readonly distanceMetres: number }[];
}

/** This rider's lap-race slots in the room's newest frame (#1911); `undefined` before one. */
export interface LapSample {
  readonly lane: number;
  readonly held: string;
  readonly raceOffsetMetres: number;
}

/** What making or joining a room came to, as the spec reads it. */
export type RoomOutcome =
  | { readonly kind: 'made'; readonly roomId: string; readonly code: string }
  | { readonly kind: 'entered'; readonly roomId: string }
  | { readonly kind: 'refused'; readonly reason: string };

export interface RoomHarness {
  /** Sign in to `address` as `name`, then join `roomId` reporting `watts`. */
  join(
    address: string,
    roomId: string,
    name: string,
    watts: number,
    fanOut: boolean,
  ): Promise<ConnectOutcome>;
  /** Sign in to `address` as `name`, and nothing else. */
  signIn(address: string, name: string): Promise<ConnectOutcome>;
  /** Make a group ride on this page's own route (#784): its code, to share. */
  make(): Promise<RoomOutcome>;
  /**
   * Join a room by `code`, fetching its route by hash and checking it — with
   * `tamper`, the route is altered on its way in (the control).
   */
  enter(code: string, tamper: boolean): Promise<RoomOutcome>;
  /** The SVG path data this page drew for the room it is in; empty for none. */
  drawn(): readonly string[];
  /** Ride in the room this page made or entered, reporting `watts`. */
  ride(watts: number): void;
  /** Where the connection is, and the other riders as this page would draw them now. */
  sample(): RoomSample;
  /** #1911: this rider's lane, held item and offset in the room's newest frame. */
  lap(): LapSample | undefined;
  /** #1911: ask the room for a lane; the input's sequence, or `undefined` when nothing went. */
  changeLane(lane: number): number | undefined;
  /** #1911: ask the room to use the held item. */
  useItem(): number | undefined;
  /** Start the race of the room this page joined, as a seated rider (#785). */
  start(): Promise<string>;
  /** #1912: make a private lap race of `laps` laps of this page's own loop, items on. */
  makeLapRace(laps: number): Promise<RoomOutcome>;
  /**
   * #1912: ride the room this page made or entered on power from a simulated
   * power meter set to `watts` — read through the simulator's transport.
   */
  rideSimulated(watts: number): Promise<void>;
  /** #1912: the room's finish order by the names the room gave, once it has sent one. */
  finishNames(): readonly (string | null)[] | undefined;
  /** #1912: the race's published result, read through the instance's result route. */
  resultNames(): Promise<readonly (string | null)[] | string>;
  leave(): void;
}

declare global {
  interface Window {
    __oylRoom?: RoomHarness;
  }
}

let connection: RoomConnection | undefined;
let entered: EnteredRoom | undefined;
/** The room this page joined, for `start`. */
let joinedRoomId: string | undefined;

/**
 * This page's own saved route: three kilometres north-north-east, up and down
 * — a route with no privacy zone near it, as the maker's device would hold it.
 */
function ownRoute() {
  const points = [];
  for (let along = 0; along <= 3_000; along += 20) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.4 + along / 111_194.93),
        degreesLongitude(-0.3 + along / 300_000),
      ),
      elevation: altitudeMetres(20 + (along < 1_500 ? along : 3_000 - along) * 0.03),
    });
  }
  return { id: 'harness-route', profile: routeProfile(points) };
}

/** #1912: a loop of about 113 m round a park, ending where it starts — a lap race’s road. */
function ownLoop() {
  const points = [];
  const radiusMetres = 18;
  for (let step = 0; step <= 60; step += 1) {
    const angle = (step / 60) * 2 * Math.PI;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.45 + (radiusMetres * Math.sin(angle)) / 111_194.93),
        degreesLongitude(-0.31 + (radiusMetres * (1 - Math.cos(angle))) / 69_500),
      ),
      elevation: altitudeMetres(20),
    });
  }
  return { id: 'harness-loop', profile: routeProfile(points, { loop: true }) };
}

/** Draw a room's road with the HUD's own plan projection, as the game would. */
function draw(room: EnteredRoom): void {
  const svg = document.querySelector('#oyl-room-route');
  if (svg === null) throw new Error('room.html has no #oyl-room-route');
  svg.replaceChildren(
    ...routePlan(room.profile).runs.map((run) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', planPath(run));
      return path;
    }),
  );
}

/** The platform's `fetch`, with the room's route altered on the way in — the control. */
const tampering: InstanceSend = async (url, init) => {
  const answer = await fetch(url, init);
  if (!url.endsWith('/route') || answer.status !== 200) return answer;
  const body = (await answer.json()) as { sha256: string; gpx: string };
  return new Response(JSON.stringify({ ...body, gpx: body.gpx.replace('<ele>', '<ele>1') }), {
    status: 200,
  });
};

/**
 * What the room ports need to seal (#1210), for the rider signed in last. The
 * room gate's instance holds no keys and no card is given, so the ports call
 * in plaintext and never ask for the key — but they are handed the real one.
 */
let sealing: { readonly loadedFrom: LoadedFrom; readonly signingKey: () => Promise<SigningKey> };

async function signIn(address: string, name: string): Promise<ConnectOutcome> {
  const store = openActivityStore(`room-gate-${name}`);
  sealing = {
    loadedFrom: { native: false, href: location.href },
    signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
  };
  const instance = createInstancePort({
    storage: localStorage,
    // Served from loopback (ADR 0047 D-11). The room gate's instance holds no
    // keys, so it registers in plaintext and nothing here seals (#1192).
    loadedFrom: { native: false, href: location.href },
    ensureLocalAthlete: () => ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000))),
    signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
  });
  return instance.connect(address, name);
}

function joinRoom(
  roomId: string,
  watts: number,
  fanOut: boolean,
  sampled?: () => number | undefined,
): void {
  joinedRoomId = roomId;
  connection = createRoomPort({
    ...sealing,
    storage: localStorage,
    ...(fanOut ? {} : { acceptFrame: () => false }),
  }).join({
    roomId,
    declaredMassKilograms: 72,
    sample: () => ({ powerWatts: sampled === undefined ? watts : sampled(), cadenceRpm: 90 }),
  });
}

/** This page's rooms port, for the rider signed in last. */
function roomsPort() {
  return createRoomsPort({ ...sealing, storage: localStorage, zones: () => Promise.resolve([]) });
}

window.__oylRoom = {
  join: async (address, roomId, name, watts, fanOut) => {
    const connected = await signIn(address, name);
    if (connected.kind !== 'connected') return connected;
    joinRoom(roomId, watts, fanOut);
    return connected;
  },
  signIn,
  make: async () => {
    const answer = await createRoomsPort({
      ...sealing,
      storage: localStorage,
      zones: () => Promise.resolve([]),
    }).create({ kind: 'group', ridingPosition: 'hoods', drafting: true, route: ownRoute() });
    if (answer.kind !== 'created') {
      return {
        kind: 'refused',
        reason: answer.kind === 'refused' ? answer.reason : 'unreachable',
      };
    }
    entered = answer.room;
    draw(answer.room);
    return { kind: 'made', roomId: answer.room.roomId, code: answer.room.code ?? '' };
  },
  enter: async (code, tamper) => {
    const answer = await createRoomsPort({
      ...sealing,
      storage: localStorage,
      zones: () => Promise.resolve([]),
      ...(tamper ? { send: tampering } : {}),
    }).join(code);
    if (answer.kind !== 'joined') {
      return {
        kind: 'refused',
        reason: answer.kind === 'refused' ? answer.reason : 'unreachable',
      };
    }
    entered = answer.room;
    draw(answer.room);
    return { kind: 'entered', roomId: answer.room.roomId };
  },
  drawn: () =>
    [...document.querySelectorAll('#oyl-room-route path')].map(
      (path) => path.getAttribute('d') ?? '',
    ),
  ride: (watts) => {
    if (entered === undefined) throw new Error('this page is in no room');
    joinRoom(entered.roomId, watts, true);
  },
  sample: () => {
    const status = connection?.status();
    return {
      status: status?.kind ?? 'none',
      seat: status?.kind === 'joined' ? status.riderId : undefined,
      ownDistanceMetres: connection?.own()?.rider.distanceMetres,
      others: (connection?.others(performance.now()) ?? []).map((rider) => ({
        riderId: rider.riderId,
        distanceMetres: rider.distanceMetres,
      })),
    };
  },
  lap: () => {
    const race = connection?.lapRace();
    const own = race?.newest?.riders.get(race.riderId);
    return own === undefined
      ? undefined
      : { lane: own.lane, held: own.held, raceOffsetMetres: own.raceOffsetMetres };
  },
  changeLane: (lane) => connection?.changeLane(lane),
  useItem: () => connection?.useItem(),
  makeLapRace: async (laps) => {
    const answer = await roomsPort().create({
      kind: 'race',
      ridingPosition: 'hoods',
      drafting: true,
      route: ownLoop(),
      lapRace: { laps, items: true },
    });
    if (answer.kind !== 'created') {
      return {
        kind: 'refused',
        reason: answer.kind === 'refused' ? answer.reason : 'unreachable',
      };
    }
    entered = answer.room;
    return { kind: 'made', roomId: answer.room.roomId, code: answer.room.code ?? '' };
  },
  rideSimulated: async (power) => {
    if (entered === undefined) throw new Error('this page is in no room');
    const { transport, bench } = createSimulator({
      devices: [cpsPowerMeter({ id: 'meter', name: 'Harness power meter' })],
      rider: { power: wattsOf(power) },
    });
    const meter = deviceId('meter');
    await transport.connect(meter);
    let latest: number | undefined;
    await transport.subscribe(meter, 'power', (measurement) => {
      latest = measurement.power;
    });
    // The simulator's clock, a second a second: each second, a fresh reading.
    setInterval(() => {
      bench.advance(seconds(1));
    }, 1_000);
    bench.advance(seconds(1));
    joinRoom(entered.roomId, power, true, () => latest);
  },
  finishNames: () => {
    const race = connection?.race();
    if (race?.kind !== 'finished') return undefined;
    const names = new Map(
      (connection?.standings()?.rows ?? []).map((row) => [row.riderId, row.displayName]),
    );
    return race.order.map((riderId) => names.get(riderId) ?? null);
  },
  resultNames: async () => {
    if (joinedRoomId === undefined) throw new Error('this page joined no room');
    const answer = await roomsPort().results(joinedRoomId);
    if (answer.kind !== 'result') return answer.kind;
    return [...answer.rows]
      .filter((row) => row.place !== null)
      .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
      .map((row) => row.displayName);
  },
  start: async () => {
    if (joinedRoomId === undefined) throw new Error('this page joined no room');
    const answer = await createRoomsPort({
      ...sealing,
      storage: localStorage,
      zones: () => Promise.resolve([]),
    }).start(joinedRoomId);
    return answer.kind === 'refused' ? `refused: ${answer.reason}` : answer.kind;
  },
  leave: () => {
    connection?.leave();
  },
};
