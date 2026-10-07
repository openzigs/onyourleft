// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A room, wired through the shell the way `main.tsx` wires it** — #782,
 * from #919's review (N1).
 *
 * `check:wiring` sees that `createRoomPort` has a production caller and that
 * `RoomPort.join` is called, and nothing more: the shell hands `GameView` the
 * port and the room id as OPTIONAL props, and deleting that hand-over
 * (`AppShell.tsx`, the `room` and `roomId` spreads) left every gate green —
 * `room-wiring.test.tsx` mounts `GameView` itself, and the browser gate drives
 * `createRoomPort` directly. docs/agents/wiring-gate.md §4j §Limits names the shape.
 *
 * So this renders the real `AppShell` at the real game route, handed a port
 * built by `createRoomPort` over `localStorage` as `main.tsx`
 * §`buildRoomPort` builds it — with the instance's half of the wire scripted,
 * since `main.tsx` passes none — presses the picker's own Ride, and reads what
 * reached the instance: a ticket for THIS room, carrying the weight the shell
 * was handed.
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
} from '@onyourleft/domain';

import type { GamePort, RidableRoute } from '../game/GameView';
import type { GameRenderer } from '../game/port';
import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import type { InstanceSend, OpenInstanceSocket } from '../instance/instance-transport';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';
import { createRoomPort } from './room-port';
import { flush } from './testing';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const ORIGIN = 'https://ride.example';
/** A weight nothing else here could be by accident. */
const DECLARED_MASS = 68.25;

const route: RidableRoute = {
  id: 'route-1',
  name: 'Flat',
  profile: routeProfile(
    [0, 1, 2].map((index) => ({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 500) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(0),
    })),
  ),
  attempts: 0,
};

const game: GamePort = {
  listRoutes: () => Promise.resolve([route]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 85, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const renderer: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('not chosen')),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('a room reaches the game through the shell — #782 review (N1)', () => {
  it('asks the instance for a ticket to the shell’s room, at the weight the shell was handed', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    localStorage.setItem(
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ origin: ORIGIN, instanceAthleteId: 'ath-1' }),
    );
    localStorage.setItem(
      INSTANCE_SESSION_STORAGE_KEY,
      JSON.stringify({ origin: ORIGIN, token: 'session-token' }),
    );
    const send = vi.fn<InstanceSend>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ticket: 'the-ticket', expiresAt: 1 }), { status: 200 }),
      ),
    );
    const sockets: string[] = [];
    const openSocket: OpenInstanceSocket = (url) => {
      sockets.push(url);
      return { send: () => undefined, close: () => undefined };
    };
    // As `main.tsx` §`buildRoomPort` builds it: over this device's
    // `localStorage`, with only the network scripted.
    const room = createRoomPort({ storage: localStorage, send, openSocket });

    globalThis.location.hash = '#/game';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        game={game}
        gameRenderer={() => Promise.resolve(renderer)}
        riderMass={kilograms(DECLARED_MASS)}
        room={room}
        roomId="room-7"
      />,
    );
    await settle();
    const ride = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    expect(ride).toBeDefined();
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();
    await flush();

    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/v1/rooms/room-7/ticket`);
    expect(JSON.parse(init?.body as string)).toEqual({ declaredMassKilograms: DECLARED_MASS });
    expect(sockets).toEqual(['wss://ride.example/v1/rooms/room-7/socket']);
  });
});
