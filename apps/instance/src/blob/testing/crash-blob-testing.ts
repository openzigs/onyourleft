// SPDX-License-Identifier: AGPL-3.0-or-later

/** The blob the crash test writes: 64 KiB of a repeating pattern. Test support. */
export function crashBlob(): Uint8Array {
  return Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251);
}
