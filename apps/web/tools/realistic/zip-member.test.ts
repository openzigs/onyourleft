// SPDX-License-Identifier: AGPL-3.0-or-later

import { crc32, deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { zipMember } from './zip-member';

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

  it('refuses something that is not a ZIP at all', () => {
    expect(() => zipMember(text('no archive here, not even close to one'), 'x')).toThrow(
      /not a ZIP/,
    );
  });
});
