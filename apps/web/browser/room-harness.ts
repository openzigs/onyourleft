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
  unixSeconds,
} from '@onyourleft/domain';
import { ensureDeviceSigningKey, openActivityStore } from '@onyourleft/store';

import { planPath, routePlan } from '../src/game/hud/plan';
import { createInstancePort, type ConnectOutcome } from '../src/instance/instance-port';
import type { InstanceSend } from '../src/instance/instance-transport';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { createRoomPort, type RoomConnection } from '../src/net/room-port';
import { createRoomsPort, type EnteredRoom } from '../src/net/rooms-port';

export interface RoomSample {
  readonly status: string;
  readonly others: readonly { readonly riderId: number; readonly distanceMetres: number }[];
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
  leave(): void;
}

declare global {
  interface Window {
    __oylRoom?: RoomHarness;
  }
}

let connection: RoomConnection | undefined;
let entered: EnteredRoom | undefined;

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

async function signIn(address: string, name: string): Promise<ConnectOutcome> {
  const store = openActivityStore(`room-gate-${name}`);
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

function joinRoom(roomId: string, watts: number, fanOut: boolean): void {
  connection = createRoomPort({
    storage: localStorage,
    ...(fanOut ? {} : { acceptFrame: () => false }),
  }).join({
    roomId,
    declaredMassKilograms: 72,
    sample: () => ({ powerWatts: watts, cadenceRpm: 90 }),
  });
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
      storage: localStorage,
      zones: () => Promise.resolve([]),
    }).create({ kind: 'group', ridingPosition: 'hoods', route: ownRoute() });
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
  sample: () => ({
    status: connection?.status().kind ?? 'none',
    others: (connection?.others(performance.now()) ?? []).map((rider) => ({
      riderId: rider.riderId,
      distanceMetres: rider.distanceMetres,
    })),
  }),
  leave: () => {
    connection?.leave();
  },
};
