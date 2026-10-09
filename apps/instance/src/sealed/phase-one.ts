// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Phase 1's sealed routes, transcribed from ADR 0047 D-7's table** (#1192).
 *
 * This is the COMMITTED list, written by hand from the ADR, and
 * `sealed/phase-one.test.ts` holds the route table to it in both directions:
 * a route on this list that the table does not mark, or a route the table
 * marks that is not on this list, is a red build. So unmarking a route (or
 * marking one nobody decided) needs an edit here as well, where a reviewer
 * reads it beside the ADR.
 *
 * `apps/web/src/instance/sealed-routes.test.ts` reads this same list (by a
 * computed `import()`, test code only) and fails if any client module calls
 * one of these paths through the plaintext transport.
 *
 * ## What D-7 names and is not here yet
 *
 * Routes D-7 puts in phase 1 that do not exist in the table yet are born
 * sealed by the issue that adds them, and that issue adds them HERE:
 *
 * - the hosted-model key routes and the hosted-consent routes (#1199 — #1097
 *   built the operator command and no app route, so there was no plaintext
 *   key route to remove and no home-network check to lift);
 * - masking push and pull (#1101) and every analysis job route (#1095);
 * - `POST /v1/auth/recovery-email/clear`, `POST /v1/auth/recovery/reset`,
 *   `GET /v1/auth/account-changes` and
 *   `POST /v1/auth/account-changes/acknowledge` (#1193, #1194).
 *
 * ## The families
 *
 * Two of D-7's rows are "every route" of a module: every route
 * `moderation/routes.ts` declares with `reaches: 'moderation'`, and every
 * route `sync/routes.ts` declares. They are listed one by one below as well,
 * so the list is a list; {@link SEALED_FAMILIES} is what makes a NEW route in
 * either module red until it is marked and added.
 */

import { SYNC_ROUTES } from '../sync/routes.ts';

/** How a phase-1 route is sealed: `only`, or — `POST /v1/auth/session` alone — for a new key. */
export type PhaseOneMark = 'only' | 'new-key';

export interface PhaseOneRoute {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly mark: PhaseOneMark;
  /** The D-7 row it is transcribed from. */
  readonly row: string;
}

const only = (method: PhaseOneRoute['method'], path: string, row: string): PhaseOneRoute => ({
  method,
  path,
  mark: 'only',
  row,
});

export const PHASE_ONE_SEALED_ROUTES: readonly PhaseOneRoute[] = [
  // Accounts and keys (#772, #773).
  only('GET', '/v1/account/export', 'The account export'),
  only('DELETE', '/v1/account', 'Deleting the account'),
  only('POST', '/v1/auth/link-codes', 'Minting a link code'),
  only('POST', '/v1/auth/link', 'Linking a device'),
  only('POST', '/v1/auth/recover', 'Recovering'),
  only('POST', '/v1/auth/recover/email', 'Asking for a mailed token'),
  {
    method: 'POST',
    path: '/v1/auth/session',
    mark: 'new-key',
    row: 'Registering a new athlete',
  },
  only('POST', '/v1/auth/recovery-email', 'Giving a recovery address'),
  only('POST', '/v1/auth/recovery-email/confirm', 'Confirming a recovery address'),
  only('POST', '/v1/auth/devices/{publicKey}/revoke', 'Revoking a device key'),
  only('GET', '/v1/auth/devices', 'The device list'),
  // Moderators (#83, #775): every route, reads included.
  only('POST', '/v1/moderation/invites', 'Minting an invite'),
  only('POST', '/v1/moderation/athletes/{athleteId}/suspend', 'Every other moderator action'),
  only('POST', '/v1/moderation/athletes/{athleteId}/unsuspend', 'Every other moderator action'),
  only(
    'POST',
    '/v1/moderation/athletes/{athleteId}/hide-display-name',
    'Every other moderator action',
  ),
  only('POST', '/v1/moderation/registrations/{athleteId}/approve', 'Every other moderator action'),
  only('POST', '/v1/moderation/registrations/{athleteId}/refuse', 'Every other moderator action'),
  only('POST', '/v1/moderation/reports/{reportId}/dismiss', 'Every other moderator action'),
  only('GET', '/v1/moderation/reports', 'Every moderator read'),
  only('GET', '/v1/moderation/registrations', 'Every moderator read'),
  only('GET', '/v1/moderation/suspended', 'Every moderator read'),
  only('GET', '/v1/moderation/log', 'Every moderator read'),
  // The synced history (#37, #38, #776): every route `sync/routes.ts` declares.
  only('GET', '/v1/sync/manifest', 'The synced history'),
  only('GET', '/v1/sync/records/{content}', 'The synced history'),
  only('POST', '/v1/sync/records/{content}/race-consent', 'The synced history'),
  only('GET', '/v1/sync/items/{kind}/{key}', 'The synced history'),
  only('POST', '/v1/sync/items/{kind}/{key}', 'The synced history'),
  only('DELETE', '/v1/sync/items/{kind}/{key}', 'The synced history'),
  only('POST', '/v1/sync/records', 'The synced history'),
  only('GET', '/v1/sync/files/{content}', 'The synced history'),
  only('GET', '/v1/activities', 'The synced history'),
  only('GET', '/v1/activities/{content}', 'The synced history'),
  only('GET', '/v1/activities/{content}/streams', 'The synced history'),
  // History search (ADR 0040).
  only('POST', '/v1/history/search', 'History search'),
];

/**
 * The module-wide rows of D-7, as a rule over the table: a route here must be
 * marked `only`, whatever this list says.
 *
 * "The synced history" is MEMBERSHIP of `sync/routes.ts` §`SYNC_ROUTES`, not a
 * path prefix: D-7 says "every route `sync/routes.ts` declares", and that
 * module declares routes outside `/v1/sync/` and `/v1/activities` — the
 * account export and deletion under `/v1/account` — which a prefix rule let
 * escape.
 */
export const SEALED_FAMILIES: readonly {
  readonly row: string;
  readonly covers: (route: {
    readonly method: string;
    readonly path: string;
    readonly reaches: unknown;
  }) => boolean;
}[] = [
  { row: 'Every moderator route', covers: (route) => route.reaches === 'moderation' },
  {
    row: 'The synced history',
    covers: (route) =>
      SYNC_ROUTES.some(
        (declared) => declared.method === route.method && declared.path === route.path,
      ),
  },
];
