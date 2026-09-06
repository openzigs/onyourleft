// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two things this screen does that only a browser can do: fingerprint a
 * file, and hand one back to be saved.
 *
 * Both are behind {@link TransferPort} so that everything above them is
 * testable without a DOM and without Web Crypto. This file is where the real
 * ones live, and `main.tsx` is its only caller.
 */

import type { DownloadableFile } from './store-port';

/**
 * SHA-256 of a file's bytes, lowercase hex — the fingerprint import
 * deduplicates on.
 *
 * ⚠️ **`crypto.subtle` exists only in a secure context.** `https://`,
 * `http://localhost` and a packaged app have it; a bundle opened from the disk
 * as `file://` does not, and neither does plain `http://` on a LAN address.
 * `main.tsx` therefore builds no {@link TransferPort} at all in those cases and
 * the screen says so, rather than offering an import that would throw on the
 * first file.
 *
 * SHA-256 over the file's whole bytes, not over a summary of its contents: two
 * files that decode to the same ride but differ by one byte are two different
 * files, and that is the right answer for an import screen. A rider who edits a
 * GPX and re-imports it is importing something new.
 */
export async function webCryptoDigest(bytes: Uint8Array): Promise<string> {
  // Copied into a plain `ArrayBuffer` rather than passed through. `BufferSource`
  // excludes a view onto a `SharedArrayBuffer`, and the bytes arriving here came
  // from a caller whose buffer type is not pinned — so the copy is what makes
  // this callable with any `Uint8Array` instead of only some of them. One file's
  // worth of transient memory, and the batch holds one file at a time.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * How long a blob URL outlives the click that started its download.
 *
 * ⚠️ **Not zero, and this is the point of the constant.** Clicking a `download`
 * anchor *queues* a navigation; the browser fetches the blob URL afterwards, on
 * its own schedule. Revoking in the same turn as the click therefore races the
 * fetch, and the loser is the rider: outside Chromium the download silently
 * does not happen, with no error anywhere for the page to report. A whole task
 * (`setTimeout(…, 0)`) is not obviously enough either, because nothing in the
 * specification ties the fetch to the next macrotask.
 *
 * A minute is long enough that no fetch this page started is still waiting for
 * it, and it is a bound rather than a leak: the blob is released without the
 * document being closed, so the megabytes a four-hour ride's FIT export costs
 * come back. A `setTimeout` rather than an `unload` handler because a tab left
 * open all day is exactly the case that matters.
 */
const OBJECT_URL_LIFETIME_MS = 60_000;

/**
 * Save a file, through the only mechanism a page has: an anchor with a
 * `download` attribute, clicked.
 *
 * `showSaveFilePicker` would be nicer and is Chromium-only, which for a feature
 * whose entire purpose is getting a rider's data *out* would be the wrong place
 * to depend on a browser. The anchor works everywhere.
 *
 * @see OBJECT_URL_LIFETIME_MS for why the revoke is not on the next line.
 */
export function saveWithAnchor(file: DownloadableFile): void {
  // A fresh `ArrayBuffer` copy, because `bytes` may be a view onto a larger
  // buffer and `Blob` would otherwise be handed the whole of it.
  const blob = new Blob([file.bytes.slice().buffer], { type: file.mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_LIFETIME_MS);
}
