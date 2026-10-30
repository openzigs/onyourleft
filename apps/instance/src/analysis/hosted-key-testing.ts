// SPDX-License-Identifier: AGPL-3.0-or-later

/** Test support for the hosted model key (#1097). Never shipped. */

import { SECRET_KEY_BYTES } from './hosted-key.ts';

/** 32 bytes of base64 — a secret as `openssl rand -base64 32` writes one — all `fill`. */
export function secretText(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(SECRET_KEY_BYTES).fill(fill)));
}

/**
 * A planted key. Every test that looks for the key where it must not be — a
 * log line, `/metrics`, an error, `status`, a database or a snapshot — looks
 * for {@link MARKER}, which appears in nothing else.
 */
export const MARKER = 'HOSTEDKEYMARKER7Q4Z';
export const MARKER_KEY = `sk-${MARKER}-0123456789abcdef`;
