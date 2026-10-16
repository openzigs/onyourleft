// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Phase 2's sealed routes, transcribed from ADR 0047 D-7's "Phase 2, what
 * is left"** (#1210): every route still in plaintext after phase 1 that
 * reaches an athlete. Once these are sealed and device-signed (D-8), a bearer
 * session token alone opens nothing — which is phase 2's claim. It ends the
 * token's usefulness, not its visibility: the token still rides in every
 * `POST /v1/sealed`'s `Authorization` header (D-11).
 *
 * ADR 0047's amendment of 2026-10-16 (#1382) adds four routes merged in
 * plaintext after phase 2: the statements of reasons, their appeal, and the
 * two room routes a rider reports and a host removes by. Its second amendment
 * of 2026-10-16 (#788) adds the public rooms' listing and joining, in the
 * room routes' row.
 *
 * The COMMITTED list, as `phase-one.ts` is, and held to the route table the
 * same way: `sealed/phase-one.test.ts` compares the table with BOTH lists in
 * both directions, and `apps/web/src/instance/sealed-routes.test.ts` scans the
 * client for a plaintext call to any route on either.
 *
 * What is left in plaintext after this is what carries nothing personal:
 * `/health`, `/ready`, `/source`, `/openapi.json`,
 * `/licences/third-party.txt`, `/instance`, `/v1/instance/keys`, `/metrics`
 * (the operator's) and `POST /v1/auth/challenge` — and the room sockets,
 * which the owner ruled are not sealed (D-14 Q5).
 *
 * Two of these have no session: signing in, and a suspended athlete's way
 * out. Both carry an `oyl-auth-v1` statement, and the sealed request is signed
 * by the key it names (D-8; `routes.ts` §`SESSIONLESS_PATHS`).
 */

import type { PhaseOneRoute } from './phase-one.ts';

const only = (method: PhaseOneRoute['method'], path: string, row: string): PhaseOneRoute => ({
  method,
  path,
  mark: 'only',
  row,
});

const ROOMS = 'The room routes’ HTTP side (D-14 Q5: the sockets are not sealed)';
const BLOCKS_AND_REPORTS = 'A rider’s own blocks and reports';
/** The rows ADR 0047's amendment of 2026-10-16 adds to D-7's table (#1382). */
const STATEMENTS = 'The statements of reasons about a rider, and their appeal against one';
const ROOM_MODERATION = 'A report from inside a room, and a host removing a rider from their room';

export const PHASE_TWO_SEALED_ROUTES: readonly PhaseOneRoute[] = [
  // Every sign-in, a key the instance holds included; registering a new key
  // was phase 1's row, and is the same route.
  only(
    'POST',
    '/v1/auth/session',
    'The sign-in answer for a key the instance already holds; registering a new athlete',
  ),
  only('GET', '/v1/auth/account', '`/v1/auth/account`'),
  only('POST', '/v1/auth/display-name', 'The display name'),
  only('POST', '/v1/auth/adult', 'The adult confirmation'),
  only('POST', '/v1/auth/leave-session', 'The suspended athlete’s way-out session'),
  only('GET', '/v1/blocks', BLOCKS_AND_REPORTS),
  only('POST', '/v1/blocks/{athleteId}', BLOCKS_AND_REPORTS),
  only('DELETE', '/v1/blocks/{athleteId}', BLOCKS_AND_REPORTS),
  only('POST', '/v1/reports', BLOCKS_AND_REPORTS),
  only('POST', '/v1/rooms', ROOMS),
  only('POST', '/v1/rooms/join', ROOMS),
  only('GET', '/v1/rooms/{roomId}/route', ROOMS),
  only('GET', '/v1/rooms/{roomId}/results', ROOMS),
  only('POST', '/v1/rooms/{roomId}/ticket', ROOMS),
  only('POST', '/v1/rooms/{roomId}/start', ROOMS),
  only('GET', '/v1/auth/session', 'Who this session is: its answer names the athlete'),
  only('DELETE', '/v1/auth/session', 'Signing out: the token alone ends no session'),
  only('GET', '/v1/athletes/{athleteId}', 'Another rider’s profile: the request names whom'),
  // #1382, ADR 0047's amendment of 2026-10-16: #1376's and #1377's statements
  // and appeal routes, and #1375's two room routes, merged in plaintext by the
  // owner's ruling of 2026-10-15 and sealed here. A suspended athlete reaches
  // the first two sealed with the way-out session (#1210): signed by the device
  // key that session row names, as any sealed request is.
  only('GET', '/v1/statements', STATEMENTS),
  only('POST', '/v1/statements/{statementId}/appeal', STATEMENTS),
  only('POST', '/v1/rooms/{roomId}/reports', ROOM_MODERATION),
  only('POST', '/v1/rooms/{roomId}/remove', ROOM_MODERATION),
  // #788, ADR 0047's second amendment of 2026-10-16: public rooms, sealed
  // from the first, in the room routes' own row.
  only('GET', '/v1/rooms/public', ROOMS),
  only('POST', '/v1/rooms/{roomId}/join', ROOMS),
];
