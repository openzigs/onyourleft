// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the instance's own keys (#1189). Never shipped.
 *
 * {@link privateSpellings} unwraps a key row the way the instance does, but
 * into BYTES — which nothing shipped ever does — so that a test can look for
 * the private half where it must not be: a log line, an error body,
 * `/metrics`, the account export, a backup.
 */

import { instanceKeyWrapAad, toHex } from '@onyourleft/domain';

import type { InstanceKeyRow } from '../store/sql-store.ts';
import { wrappingKeys } from './wrap.ts';

/** 32 bytes, every one `fill`: an operator secret for a test. */
export function secretBytes(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Every spelling of a row's private half worth searching for: the PKCS #8
 * document and the 32-byte private scalar at its end, each as lowercase and
 * upper-case hex, base64 and unpadded base64url.
 */
export async function privateSpellings(
  row: InstanceKeyRow,
  secret: Uint8Array,
  instanceOrigin: string,
): Promise<readonly string[]> {
  const wrapping = await wrappingKeys(secret);
  const pkcs8 = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(row.iv),
        additionalData: new Uint8Array(
          instanceKeyWrapAad({ role: row.role, keyId: row.keyId, instanceOrigin }),
        ),
      },
      wrapping[row.role],
      new Uint8Array(row.wrapped),
    ),
  );
  const scalar = pkcs8.slice(pkcs8.length - 32);
  return [pkcs8, scalar].flatMap((bytes) => {
    const b64 = base64(bytes);
    return [
      toHex(bytes),
      toHex(bytes).toUpperCase(),
      b64,
      b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ];
  });
}
