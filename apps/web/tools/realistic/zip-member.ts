// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One file out of a ZIP archive — #623.
 *
 * MakeHuman publishes its CC0 system assets as one archive, and the rider
 * reads six of its files. This reads them out of the archive's bytes, which
 * `fetch-assets.ts` has already checked against the lock, with Node's own
 * `zlib` and nothing else: no `unzip` on the `PATH`, whose version nothing
 * pins, and no dependency.
 *
 * Only what a ZIP written by an ordinary archiver needs: the end of central
 * directory record, the central directory, a member stored or deflated, and
 * each member's CRC-32 checked. Anything else — ZIP64, encryption, a spanned
 * archive, another compression method — is REFUSED rather than read wrongly,
 * and so is a member whose name is not the exact path asked for.
 */

import { crc32, inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * The most a member may be, whatever its directory entry claims: 256 MiB. The
 * largest the rider reads is a skin image of a few MiB; a directory's 32-bit
 * size alone would let one member ask for 4 GiB before its CRC is checked.
 */
export const MAXIMUM_MEMBER_BYTES = 256 * 1024 * 1024;

/** The bytes of the member at `path`, decompressed and checked. Throws when it cannot. */
export function zipMember(archive: Uint8Array, path: string): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  // Every offset the archive states is checked against its length before it
  // is read, so a broken one is a sentence rather than a bare RangeError, and
  // never a silently clamped `subarray`.
  const within = (from: number, length: number, what: string): void => {
    if (from < 0 || length < 0 || from + length > archive.length) {
      throw new Error(
        `${what} runs past the end of the archive (${String(from)} + ${String(length)} of ${String(archive.length)} bytes)`,
      );
    }
  };
  // The end record is the last 22 bytes, unless the archive carries a comment.
  let end = -1;
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a ZIP archive: no end of central directory record');
  const entries = view.getUint16(end + 10, true);
  const directory = view.getUint32(end + 16, true);
  if (entries === 0xffff || directory === 0xffffffff) {
    throw new Error('a ZIP64 archive, which this reader refuses');
  }
  let at = directory;
  for (let entry = 0; entry < entries; entry += 1) {
    within(at, 46, `the central directory's entry ${String(entry)}`);
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`the central directory is broken at entry ${String(entry)}`);
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    within(at + 46, nameLength, `the name of entry ${String(entry)}`);
    const name = new TextDecoder().decode(archive.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== path) continue;
    if ((flags & 1) !== 0) throw new Error(`${path} is encrypted`);
    if (size > MAXIMUM_MEMBER_BYTES) {
      throw new Error(
        `${path}: the directory says ${String(size)} bytes, over the ${String(MAXIMUM_MEMBER_BYTES)} this reader takes`,
      );
    }
    within(local, 30, `${path}'s local header`);
    if (view.getUint32(local, true) !== LOCAL_FILE_HEADER) {
      throw new Error(`${path}: no local header where the directory says`);
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    within(start, compressed, `${path}'s compressed bytes`);
    const body = archive.subarray(start, start + compressed);
    let bytes: Uint8Array;
    if (method === 0) bytes = Uint8Array.from(body);
    else if (method === 8) {
      // Bounded by the size the directory states, so a member cannot inflate
      // past what it claims before that claim is checked — and that claim is
      // itself under MAXIMUM_MEMBER_BYTES, so the bound is absolute.
      bytes = new Uint8Array(inflateRawSync(body, { maxOutputLength: Math.max(1, size) }));
    } else
      throw new Error(
        `${path} is compressed by method ${String(method)}, which this reader refuses`,
      );
    if (bytes.length !== size) {
      throw new Error(
        `${path} is ${String(bytes.length)} bytes; the directory says ${String(size)}`,
      );
    }
    if (crc32(bytes) !== crc) throw new Error(`${path} does not match its CRC-32`);
    return bytes;
  }
  throw new Error(`the archive holds no ${path}`);
}
