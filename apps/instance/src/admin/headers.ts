// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The headers of every `/admin` response, in one place** (#2641, ADR 0069
 * D-4): pages, redirects, errors and the stylesheet alike.
 *
 * - A policy with **no `'unsafe-inline'` of any kind**: a script or a style
 *   is loaded only from this instance, so the admin frame links
 *   `/admin/admin.css` rather than carrying `html.ts`'s inline `<style>`.
 * - Never framed, never cached, never sniffed, and isolated from other
 *   origins' windows and loads.
 * - **`Referrer-Policy: same-origin`, not `no-referrer`** (ADR 0069 D-4,
 *   which corrects the issue's `no-referrer`): under `no-referrer` a browser
 *   may send a form `POST` with `Origin: null`, which the origin check
 *   refuses, so the scriptless sign-in would fail; `same-origin` sends no
 *   referrer to anybody else.
 * - ⚠️ **No `Access-Control-Allow-Origin`, and no other CORS header.** The
 *   handler gives every other response `*` (`handler.ts`, #777); an `/admin`
 *   response never passes through that, because the admin session is a
 *   cookie — the first ambient credential this server accepts.
 *
 * `/legal`, `/terms` and `/report` keep `html.ts` §`PAGE_HEADERS`.
 */

export const ADMIN_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** Every header an `/admin` response carries, besides its own type and any `location` or cookie. */
export const ADMIN_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': ADMIN_CONTENT_SECURITY_POLICY,
  'x-frame-options': 'DENY',
  'cache-control': 'no-store',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

/** A response with {@link ADMIN_HEADERS} and the headers `extra` adds. */
export function adminResponse(
  body: string | null,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): Response {
  const headers = new Headers(ADMIN_HEADERS);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(body, { status, headers });
}
