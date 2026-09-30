// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #782's end-to-end room, from one rider's side: this page signs a new rider
 * in to a REAL instance with the production instance port — the real `fetch`
 * in `instance/instance-transport.ts`, cross-origin to the instance's own
 * listener — and joins a room with the production room port, whose socket is
 * that module's one `WebSocket`. It reports a steady power, as a rider on a
 * trainer would, and publishes what the room's frames put the OTHER riders at.
 *
 * `room.browser.spec.ts` opens two of these in two browser contexts — two
 * devices, two athletes — against one instance, and reads each. Its control is
 * `fanOut: false`, which keeps no frame this page receives
 * (`net/room-session.ts` §`RoomSessionOptions.acceptFrame`): fan-out switched
 * off where the client meets it, so the spec must then see nobody move.
 *
 * ⚠️ **What it does not prove**: anything about the game's drawing (the game
 * gate's §"#783" is that), a phone's WebView, the screen going off, or a
 * Cloudflare Tunnel in the path — those are #733's.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey, openActivityStore } from '@onyourleft/store';

import { createInstancePort, type ConnectOutcome } from '../src/instance/instance-port';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { createRoomPort, type RoomConnection } from '../src/net/room-port';

export interface RoomSample {
  readonly status: string;
  readonly others: readonly { readonly riderId: number; readonly distanceMetres: number }[];
}

export interface RoomHarness {
  /** Sign in to `address` as `name`, then join `roomId` reporting `watts`. */
  join(
    address: string,
    roomId: string,
    name: string,
    watts: number,
    fanOut: boolean,
  ): Promise<ConnectOutcome>;
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

window.__oylRoom = {
  join: async (address, roomId, name, watts, fanOut) => {
    const store = openActivityStore(`room-gate-${name}`);
    const instance = createInstancePort({
      storage: localStorage,
      ensureLocalAthlete: () =>
        ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000))),
      signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
    });
    const connected = await instance.connect(address, name);
    if (connected.kind !== 'connected') return connected;
    connection = createRoomPort({
      storage: localStorage,
      ...(fanOut ? {} : { acceptFrame: () => false }),
    }).join({
      roomId,
      declaredMassKilograms: 72,
      sample: () => ({ powerWatts: watts, cadenceRpm: 90 }),
    });
    return connected;
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
