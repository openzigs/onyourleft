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
 * Save a file, through the only mechanism a page has: an anchor with a
 * `download` attribute, clicked.
 *
 * The object URL is revoked immediately afterwards. It has already been read by
 * then — the click starts the download synchronously — and leaving it alive
 * pins the whole file in memory for the life of the document, which on a
 * four-hour ride's FIT export is megabytes per download.
 *
 * `showSaveFilePicker` would be nicer and is Chromium-only, which for a feature
 * whose entire purpose is getting a rider's data *out* would be the wrong place
 * to depend on a browser. The anchor works everywhere.
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
  URL.revokeObjectURL(url);
}
