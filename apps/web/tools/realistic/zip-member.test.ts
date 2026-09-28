// SPDX-License-Identifier: AGPL-3.0-or-later

import { crc32, deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { MAXIMUM_MEMBER_BYTES, zipMember } from './zip-member';

/** A ZIP of `files`, each stored or deflated, written by hand to the format's own layout. */
function zipOf(
  files: readonly { name: string; body: Uint8Array; deflate: boolean; crc?: number }[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const body = file.deflate ? new Uint8Array(deflateRawSync(file.body)) : file.body;
    const crc = file.crc ?? crc32(file.body);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, file.deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, file.body.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(10, file.deflate ? 8 : 0, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, body.length, true);
    ev.setUint32(24, file.body.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, body);
    directory.push(entry);
    offset += local.length + body.length;
  }
  const size = directory.reduce((sum, each) => sum + each.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, files.length, true);
  dv.setUint16(10, files.length, true);
  dv.setUint32(12, size, true);
  dv.setUint32(16, offset, true);
  const all = [...parts, ...directory, end];
  const out = new Uint8Array(all.reduce((sum, each) => sum + each.length, 0));
  let at = 0;
  for (const each of all) {
    out.set(each, at);
    at += each.length;
  }
  return out;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('one file out of a ZIP — #623', () => {
  const archive = zipOf([
    { name: 'skins/a/a.png', body: text('stored bytes'), deflate: false },
    { name: 'eyebrows/b/b.obj', body: text('# CC0\n'.repeat(50)), deflate: true },
  ]);

  it('reads a stored member and a deflated one, byte for byte', () => {
    expect(new TextDecoder().decode(zipMember(archive, 'skins/a/a.png'))).toBe('stored bytes');
    expect(new TextDecoder().decode(zipMember(archive, 'eyebrows/b/b.obj'))).toBe(
      '# CC0\n'.repeat(50),
    );
  });

  it('refuses a member it does not hold, and a name that is only a prefix of one', () => {
    expect(() => zipMember(archive, 'skins/a/b.png')).toThrow(/holds no/);
    expect(() => zipMember(archive, 'skins/a')).toThrow(/holds no/);
  });

  it('refuses a member whose bytes do not match its CRC-32', () => {
    const broken = zipOf([{ name: 'x', body: text('bytes'), deflate: false, crc: 1 }]);
    expect(() => zipMember(broken, 'x')).toThrow(/CRC-32/);
  });

  /** `archive` with one little-endian 32-bit field overwritten. */
  const patched = (bytes: Uint8Array, at: number, value: number): Uint8Array => {
    const copy = Uint8Array.from(bytes);
    new DataView(copy.buffer).setUint32(at, value, true);
    return copy;
  };
  const one = zipOf([{ name: 'x', body: text('some bytes'), deflate: false }]);
  // Where its fields are: a 31-byte local header and 10 bytes of body, then
  // the 47-byte directory entry, then the 22-byte end record.
  const entryAt = 31 + 10;
  const endAt = one.length - 22;

  it('refuses a directory that the end record puts past the end of the archive', () => {
    expect(() => zipMember(patched(one, endAt + 16, one.length), 'x')).toThrow(
      /central directory's entry 0 runs past the end/,
    );
  });

  it('refuses an entry whose name runs past the end', () => {
    const copy = Uint8Array.from(one);
    new DataView(copy.buffer).setUint16(entryAt + 28, 0xffff, true);
    expect(() => zipMember(copy, 'x')).toThrow(/name of entry 0 runs past the end/);
  });

  it('refuses a local header, and compressed bytes, that run past the end', () => {
    expect(() => zipMember(patched(one, entryAt + 42, one.length - 4), 'x')).toThrow(
      /x's local header runs past the end/,
    );
    expect(() => zipMember(patched(one, entryAt + 20, one.length), 'x')).toThrow(
      /x's compressed bytes runs past the end/,
    );
  });

  it('refuses a member whose stated size is over the absolute cap, before inflating it', () => {
    expect(() => zipMember(patched(one, entryAt + 24, MAXIMUM_MEMBER_BYTES + 1), 'x')).toThrow(
      /over the 268435456 this reader takes/,
    );
    // At the cap exactly it is not refused for its size — it is refused for
    // not being that size, which is the check after it.
    expect(() => zipMember(patched(one, entryAt + 24, MAXIMUM_MEMBER_BYTES), 'x')).toThrow(
      /the directory says 268435456/,
    );
  });

  it('refuses something that is not a ZIP at all', () => {
    expect(() => zipMember(text('no archive here, not even close to one'), 'x')).toThrow(
      /not a ZIP/,
    );
  });
});
