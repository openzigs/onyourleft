// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The admin route table** (#2645): every path the admin layer answers, the
 * methods it takes, and what it is. `admin.ts` answers from it, the shell's
 * section links are drawn from it, and two tests are DERIVED from it rather
 * than written beside it:
 *
 * - `pages.test.ts` sends every route here every request a browser could, and
 *   holds each answer to `headers.ts` §`ADMIN_HEADERS`, each signed-in page
 *   to the sign-in redirect with no session, and each `POST` to the CSRF
 *   refusals — so a later page cannot opt out by forgetting;
 * - `apps/web/src/a11y/admin-pages.a11y.test.ts` fails when a `page` or
 *   `sign-in` route here is missing from its list of pages to audit.
 *
 * A later page sub-issue (#2646 onwards) adds its row here, and its section
 * to {@link ADMIN_SECTIONS} if it is not there.
 */

/** What a route is. */
export type AdminRouteKind =
  /** HTML the signed-in owner reads, in the shell, under a section link. */
  | 'page'
  /** The sign-in page and its form: the one page with no session. */
  | 'sign-in'
  /**
   * A passkey sign-in ceremony's `POST` (#2642): no session, so no token to
   * carry; held to the `Origin` as the sign-in form is.
   */
  | 'sign-in-action'
  /** A `GET` answered only with a redirect. */
  | 'redirect'
  /** The stylesheet. */
  | 'stylesheet'
  /** The one script, `/admin/passkey.js` (#2642), linked on the pages with a passkey ceremony. */
  | 'script'
  /** A signed-in form's or ceremony's target, `POST` only, carrying the session's token. */
  | 'action';

export interface AdminRoute {
  /** The path; `{id}` stands for a passkey's id, as `admin.ts` matches it. */
  readonly path: string;
  readonly methods: readonly ('GET' | 'POST')[];
  readonly kind: AdminRouteKind;
  /** A `page`'s link in the shell: one of {@link ADMIN_SECTIONS}. */
  readonly section?: AdminSection;
}

/**
 * The admin sections, in the order the shell links them (ADR 0069, the
 * epic #2639). A section whose page is not in {@link ADMIN_ROUTES} yet is not
 * linked.
 */
export const ADMIN_SECTIONS = [
  'Status',
  'Accounts',
  'Backups',
  'AI backend',
  'Rooms',
  'Keys',
  'Log',
  'Passkeys',
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { path: '/admin', methods: ['GET'], kind: 'redirect' },
  { path: '/admin/sign-in', methods: ['GET', 'POST'], kind: 'sign-in' },
  { path: '/admin/sign-in/passkey-options', methods: ['POST'], kind: 'sign-in-action' },
  { path: '/admin/sign-in/passkey', methods: ['POST'], kind: 'sign-in-action' },
  { path: '/admin/sign-out', methods: ['POST'], kind: 'action' },
  { path: '/admin/admin.css', methods: ['GET'], kind: 'stylesheet' },
  { path: '/admin/passkey.js', methods: ['GET'], kind: 'script' },
  { path: '/admin/status', methods: ['GET'], kind: 'page', section: 'Status' },
  { path: '/admin/log', methods: ['GET'], kind: 'page', section: 'Log' },
  { path: '/admin/passkeys', methods: ['GET'], kind: 'page', section: 'Passkeys' },
  { path: '/admin/passkeys/options', methods: ['POST'], kind: 'action' },
  { path: '/admin/passkeys/add', methods: ['POST'], kind: 'action' },
  { path: '/admin/passkeys/{id}/revoke', methods: ['POST'], kind: 'action' },
  { path: '/admin/step-up', methods: ['POST'], kind: 'action' },
];

/** The page a sign-in lands on, and `/admin` sends a signed-in browser to. */
export const ADMIN_LANDING = '/admin/status';

/** The shell's section links: each built section's page, in {@link ADMIN_SECTIONS}' order. */
export function sectionLinks(): readonly {
  readonly section: AdminSection;
  readonly path: string;
}[] {
  return ADMIN_SECTIONS.flatMap((section) => {
    const route = ADMIN_ROUTES.find((each) => each.kind === 'page' && each.section === section);
    return route === undefined ? [] : [{ section, path: route.path }];
  });
}
