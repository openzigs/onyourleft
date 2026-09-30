// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the rooms tests share (#784, #785): a room's body as a rider's app
 * sends it, and a room made through the real route. Test support, never
 * shipped.
 */

import type { IdentityInstance } from '../auth/identity-testing.ts';

/**
 * A route's GPX, as a rider's app would send it — three points, no name, no
 * times. The instance never parses it: it is relayed by content hash.
 */
export const ROOM_GPX =
  '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="On Your Left" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
  '<trkpt lat="51.500000" lon="-0.120000"><ele>10.0</ele></trkpt>' +
  '<trkpt lat="51.501000" lon="-0.120000"><ele>12.0</ele></trkpt>' +
  '<trkpt lat="51.502000" lon="-0.120000"><ele>11.0</ele></trkpt>' +
  '</trkseg></trk></gpx>';

/** A new room's body, valid in every field. */
export function roomBody(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: 'race',
    ridingPosition: 'hoods',
    loop: false,
    lengthMetres: 222.4,
    grades: [
      [0, 2],
      [110, -1],
    ],
    gpx: ROOM_GPX,
    ...overrides,
  };
}

/** A rider signed in on a new device: their session and their athlete id. */
export async function riderIn(
  world: IdentityInstance,
  device: Parameters<IdentityInstance['signIn']>[0],
): Promise<{ readonly token: string; readonly athleteId: string }> {
  const session = await world.signIn(device);
  return {
    token: session.body.sessionToken as string,
    athleteId: session.body.athleteId as string,
  };
}

/** A room made through `POST /v1/rooms`, as `token`'s athlete. */
export async function madeRoom(
  world: IdentityInstance,
  token: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly roomId: string; readonly code: string; readonly routeSha256: string }> {
  const answer = await world.call('POST', '/v1/rooms', { token, body: roomBody(overrides) });
  if (answer.status !== 200) throw new Error(`no room: ${JSON.stringify(answer)}`);
  return answer.body as { roomId: string; code: string; routeSha256: string };
}
