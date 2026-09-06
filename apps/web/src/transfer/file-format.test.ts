// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * That the **bytes** decide the format, and the name only breaks a tie.
 *
 * ⚠️ This file exists because of a mutation that survived. `detectActivityFileFormat`
 * was rewritten to trust the extension outright — `extensionOf(fileName) === 'fit'`
 * in place of the signature check — and the entire transfer suite stayed green,
 * because every fixture in it happens to be named after what it actually is.
 * A detector documented as sniffing and tested only on honestly-named files is
 * a detector with no evidence either way, and a bulk export from another
 * platform is precisely where the names stop being reliable.
 */

import { describe, expect, it } from 'vitest';

import { corpusBytes } from './corpus';
import { detectActivityFileFormat, extensionOf, hasFitSignature, SNIFF_BYTES } from './file-format';
import { syntheticGpx } from './testing';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('detectActivityFileFormat', () => {
  it('reads a FIT file correctly however it is named', () => {
    const bytes = corpusBytes('nominal-outdoor-ride.fit');

    expect(detectActivityFileFormat('ride.fit', bytes)).toBe('fit');
    // The name is wrong and the bytes are not. A `.gpx` that is really FIT
    // turns up whenever an exporter or an operating system renames a file, and
    // sending it to the XML parser produces a nonsense diagnostic about a
    // document that was never XML.
    expect(detectActivityFileFormat('ride.gpx', bytes)).toBe('fit');
    expect(detectActivityFileFormat('no-extension-at-all', bytes)).toBe('fit');
  });

  it('reads an XML document correctly however it is named', () => {
    const gpx = utf8(syntheticGpx(1));
    const tcx = corpusBytes('nominal-ride.tcx');

    expect(detectActivityFileFormat('ride.gpx', gpx)).toBe('gpx');
    expect(detectActivityFileFormat('ride.dat', gpx)).toBe('gpx');
    expect(detectActivityFileFormat('ride.gpx', tcx)).toBe('tcx');
  });

  it('accepts a namespace prefix on the root element, which is rare and real', () => {
    const prefixed = utf8(
      '<?xml version="1.0"?>\n<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"></g:gpx>',
    );

    expect(detectActivityFileFormat('ride.dat', prefixed)).toBe('gpx');
  });

  it('falls back to the extension only when the bytes say nothing', () => {
    // A zero-length `.fit` has no signature to find. Sent to the FIT decoder it
    // produces "too short for a header", which is the sentence a rider can act
    // on; reported as an unsupported format it produces a wrong one.
    expect(detectActivityFileFormat('empty.fit', corpusBytes('zero-length.fit'))).toBe('fit');
    // An XML document whose root element is past the sniff window, which is
    // what a long comment or a large `<metadata>` block produces.
    const buried = utf8(`<?xml version="1.0"?>\n<!--${'x'.repeat(SNIFF_BYTES)}-->\n<gpx></gpx>`);
    expect(detectActivityFileFormat('ride.gpx', buried)).toBe('gpx');
    expect(detectActivityFileFormat('ride.dat', buried)).toBeUndefined();
  });

  it('refuses the rest of what a bulk export archive contains', () => {
    expect(detectActivityFileFormat('activities.csv', utf8('name,date\n'))).toBeUndefined();
    // A gzip magic number: `.fit.gz` is what a real platform export ships, and
    // this client reads the three formats uncompressed.
    expect(
      detectActivityFileFormat('ride.fit.gz', new Uint8Array([0x1f, 0x8b, 0x08, 0x00])),
    ).toBeUndefined();
    expect(detectActivityFileFormat('README.md', utf8('# rides\n'))).toBeUndefined();
    expect(detectActivityFileFormat('cover.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      undefined,
    );
  });
});

describe('hasFitSignature', () => {
  it('finds the signature at offset 8 and nowhere else', () => {
    expect(hasFitSignature(corpusBytes('nominal-outdoor-ride.fit'))).toBe(true);
    // The same four bytes at offset 0 is not a FIT file, and a checker that
    // searched rather than indexed would say it was.
    expect(hasFitSignature(utf8('.FIT and then some other bytes entirely'))).toBe(false);
    expect(hasFitSignature(new Uint8Array(0))).toBe(false);
  });
});

describe('extensionOf', () => {
  it.each([
    ['ride.FIT', 'fit'],
    ['activities/2024-06-15.gpx', 'gpx'],
    ['ride.fit.gz', 'gz'],
    ['no-extension', ''],
    // A dotfile has no extension: the leading dot is the whole name.
    ['.gitignore', ''],
  ])('reads %s as %s', (fileName, expected) => {
    expect(extensionOf(fileName)).toBe(expected);
  });
});
