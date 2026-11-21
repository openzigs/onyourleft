// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The setup wizard's route table** (#2784, ADR 0080 D-1, D-7): every path
 * `setup.ts` answers, the methods it takes and what it is. As the admin
 * route table is (`admin/admin-routes.ts`), it is what the tests are DERIVED
 * from rather than written beside:
 *
 * - `setup-instance.test.ts` sends every route here every method, on the tunnel
 *   listener and on a loopback listener whose setup is done, and holds each
 *   answer to the `not_found` of a path with no route; it also holds each
 *   `POST` to the origin and CSRF refusals, and each page to the locked page
 *   with no session;
 * - `apps/web/src/a11y/setup-pages.a11y.test.ts` fails when a `page` or
 *   `locked` route here is missing from its list of setup pages to audit.
 */

import { SETUP_STEPS, type SetupStep } from '../store/sql-store.ts';

export { SETUP_STEPS, type SetupStep };

/** What a route is. */
export type SetupRouteKind =
  /** `/setup`: the locked page with no session, a redirect to the step with one. */
  | 'locked'
  /** The code's form: no session yet, so no token; held to the `Origin`. */
  | 'sign-in'
  /** A step's page, in a session. */
  | 'page'
  /** A form's target, `POST` only, carrying the session's token. */
  | 'action'
  /** The stylesheet: the admin pages' own, served under `/setup`. */
  | 'stylesheet';

export interface SetupRoute {
  readonly path: string;
  readonly methods: readonly ('GET' | 'POST')[];
  readonly kind: SetupRouteKind;
  /** A `page`'s step. */
  readonly step?: SetupStep;
}

/** A step's page address. */
export const stepPath = (step: SetupStep): string => `/setup/${step}`;

export const SETUP_ROUTES: readonly SetupRoute[] = [
  { path: '/setup', methods: ['GET'], kind: 'locked' },
  { path: '/setup/sign-in', methods: ['POST'], kind: 'sign-in' },
  { path: '/setup/setup.css', methods: ['GET'], kind: 'stylesheet' },
  { path: '/setup/next', methods: ['POST'], kind: 'action' },
  ...SETUP_STEPS.map((step): SetupRoute => ({
    path: stepPath(step),
    methods: ['GET'],
    kind: 'page',
    step,
  })),
  { path: '/setup/claim/code', methods: ['POST'], kind: 'action' },
  { path: '/setup/claim/confirm', methods: ['POST'], kind: 'action' },
  { path: '/setup/claim/discard', methods: ['POST'], kind: 'action' },
  { path: '/setup/secrets/kit', methods: ['POST'], kind: 'action' },
  { path: '/setup/backups/now', methods: ['POST'], kind: 'action' },
  { path: '/setup/registration/mode', methods: ['POST'], kind: 'action' },
  { path: '/setup/invite/code', methods: ['POST'], kind: 'action' },
  { path: '/setup/ai/pull', methods: ['POST'], kind: 'action' },
  { path: '/setup/ai/use', methods: ['POST'], kind: 'action' },
  { path: '/setup/finish/done', methods: ['POST'], kind: 'action' },
];

/** Whether `pathname` is the setup wizard's. */
export function isSetupPath(pathname: string): boolean {
  return pathname === '/setup' || pathname.startsWith('/setup/');
}

/** The stylesheet's address: linked by every setup page. */
export const SETUP_STYLESHEET = '/setup/setup.css';
