// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's own pages** (#907): a page a person reads in a browser,
 * with or without an account and with or without the app.
 *
 * Every other answer the instance gives is JSON for the app. A notice of
 * illegal content must be possible for *"any individual or entity"* (DSA
 * Art. 16(1)), who may never have installed the app, so the notice page is
 * HTML: a plain form that works with no script at all, which is also what
 * makes it work with a keyboard and a screen reader (ICU D2.4).
 *
 * ⚠️ **Everything put into a page goes through {@link escapeHtml}**, the
 * instance's name included: a page echoes back what a notifier typed when it
 * has to ask them to correct it, and an operator's name is configuration, not
 * markup. And every page is sent with {@link PAGE_HEADERS}: a policy that
 * runs no script, loads nothing from anywhere, posts a form only to this
 * instance and may not be framed.
 */

/** Text, made safe to put between tags or inside a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The headers of every page: no script, no third party, a form posted only
 * here, never framed, and no referrer sent when a link is followed.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
};

/** The page's look: legible type, visible focus, nothing fetched. */
const STYLE = `
body { font: 1.0625rem/1.5 system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #fff; }
main { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.6rem; line-height: 1.25; }
label, legend { font-weight: 600; display: block; margin-top: 1.25rem; }
fieldset { border: 1px solid #767676; margin: 1.25rem 0 0; padding: 0 1rem 1rem; }
fieldset label { font-weight: 400; display: inline; margin: 0; }
.choice { margin-top: 0.75rem; }
.hint { color: #4a4a4a; margin: 0.25rem 0; }
.problem { color: #b00020; font-weight: 600; margin: 0.25rem 0; }
input[type=text], input[type=email], textarea { font: inherit; width: 100%; box-sizing: border-box; padding: 0.5rem; border: 2px solid #4a4a4a; }
textarea { min-height: 6rem; }
input[type=checkbox], input[type=radio] { width: 1.25rem; height: 1.25rem; vertical-align: middle; margin-right: 0.5rem; }
button { font: inherit; font-weight: 600; margin-top: 1.5rem; padding: 0.75rem 1.25rem; min-height: 48px; color: #fff; background: #1a4fa0; border: 0; border-radius: 4px; }
:focus-visible { outline: 3px solid #b35900; outline-offset: 2px; }
.summary { border: 3px solid #b00020; padding: 0 1rem 1rem; margin: 1rem 0; }
@media (prefers-color-scheme: dark) {
  body { color: #f0f0f0; background: #121212; }
  .hint { color: #c8c8c8; }
  .problem { color: #ff8a80; }
  .summary { border-color: #ff8a80; }
  input[type=text], input[type=email], textarea { color: #f0f0f0; background: #1e1e1e; border-color: #b0b0b0; }
  a { color: #8ab4ff; }
}
`;

/** A whole page: `title` is text and is escaped here; `body` is markup the caller escaped. */
export function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/** A page as a response, with {@link PAGE_HEADERS}. */
export function pageResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: PAGE_HEADERS });
}
