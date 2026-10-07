// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Whether a document holds a `data:` URL** — the way Markdown embeds a
 * picture — found by a scan in time linear in the text (#933).
 *
 * ⚠️ **A copy of `apps/instance/src/history/passages.ts` §`holdsDataUrl`,
 * and it must stay one.** The client may not import the instance (ADR 0036
 * D-3.a, `boundaries/dependencies`), so the scan is written twice, and
 * `data-url.test.ts` reads both files and fails when their code differs. A
 * document the client admits is one the instance indexes, and the two must
 * agree on which text is a picture.
 *
 * ⚠️ **Not a regular expression.** #920's pattern,
 * `/\bdata:[a-z0-9.+-]*\/[^,\s]*,/iu`, was retried from every place a `data:`
 * starts and ran to the end of the text each time: on `data:a/` repeated to
 * the 100 000 characters a document may hold it took **0.86 s** on the main
 * thread (Node 24, measured for #933), and the instance measured the same
 * shape at 4.4 s over 230 000. It also missed `data:;base64,…`, which RFC 2397
 * allows (the media type may be left out). This matches exactly what
 * `/\bdata:[^,\s]*,/iu` matches — `data:`, anything but a comma or a space,
 * a comma — and every character is looked at a bounded number of times.
 */

/** Where a `data:` URL may start: its scheme, at a word boundary. */
const DATA_SCHEME = /\bdata:/giu;

/** What ends a `data:` URL's header: its comma, or a space of any kind. */
const HEADER_END = /[,\s]/u;

/**
 * Whether `text` holds a `data:` URL. The header each `data:` starts is
 * walked to its end once, and every later `data:` before that end shares the
 * answer, so the scan is linear.
 */
export function holdsDataUrl(text: string): boolean {
  let end = -1;
  for (const match of text.matchAll(DATA_SCHEME)) {
    const from = match.index + match[0].length;
    if (end < from) {
      end = from;
      while (end < text.length && !HEADER_END.test(text.charAt(end))) end += 1;
    }
    if (text.charAt(end) === ',') return true;
  }
  return false;
}
