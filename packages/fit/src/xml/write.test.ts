// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { isXmlCharacter, parseXml } from './parse';
import { decimal, degrees, escapeXmlAttribute, escapeXmlText, integer, XmlWriter } from './write';

describe('escaping', () => {
  it('escapes the three characters a text node cannot hold', () => {
    expect(escapeXmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('escapes both quote characters as well, for an attribute', () => {
    expect(escapeXmlAttribute(`a "b" 'c' & <d>`)).toBe(
      'a &quot;b&quot; &apos;c&apos; &amp; &lt;d&gt;',
    );
  });

  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    // `&lt;` produced by escaping `<` must not then have its own `&` escaped.
    expect(escapeXmlText('<')).toBe('&lt;');
    expect(escapeXmlText('&lt;')).toBe('&amp;lt;');
  });

  it('produces a document a parser reads back as the original text', () => {
    const hostile = `Ride & <script>alert("x")</script> 'end'`;
    const document = new XmlWriter().leaf('name', hostile).finish();
    let read = '';
    parseXml(document, {
      text: (value) => {
        read += value;
      },
    });
    expect(read).toBe(hostile);
  });
});

/**
 * ⚠️ A leniency shared by both ends of a codec is invisible to a round trip.
 *
 * The importer used to accept `&#1;` and the exporter used to write the
 * character it produced out raw, so a control character went in, came back out,
 * compared equal — and left a document XML 1.0 does not allow, which every
 * conformant reader refuses and this one accepted. Closing one end alone would
 * have left the other able to reopen it.
 */
describe('characters XML cannot carry', () => {
  it('drops a C0 control from a text node rather than writing it out raw', () => {
    expect(escapeXmlText('Morning\u0001 ride')).toBe('Morning ride');
    expect(escapeXmlAttribute('Morning\u0001 ride')).toBe('Morning ride');
  });

  it('keeps the three whitespace controls XML does allow', () => {
    expect(escapeXmlText('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('keeps a character outside the BMP whole', () => {
    // The `u` flag: a surrogate pair is one code point and not in the class.
    // Without it each half matches on its own and the emoji is deleted.
    expect(escapeXmlText('Ride \u{1F6B4} home')).toBe('Ride \u{1F6B4} home');
  });

  it('drops an unpaired surrogate, which no encoder can represent', () => {
    expect(escapeXmlText('Ride \uD800 home')).toBe('Ride  home');
  });

  it('refuses a numeric character reference to one, rather than expanding it', () => {
    // The other end. `&#1;` is as ill-formed as a literal 0x01 byte.
    for (const reference of ['&#1;', '&#x1;', '&#xFFFE;', '&#xD800;']) {
      expect(() => {
        parseXml(`<name>${reference}</name>`, {});
      }).toThrowError(/bad-character-reference|character XML can carry/);
    }
  });

  it('agrees with the parser about which characters those are', () => {
    // The two ends are one rule spelled twice — a predicate and a character
    // class — so this pins them to each other across the whole BMP rather than
    // trusting a comment to keep them in step.
    for (let codePoint = 0; codePoint <= 0xffff; codePoint += 1) {
      const character = String.fromCharCode(codePoint);
      if (character === '&' || character === '<' || character === '>') continue;
      expect([codePoint, escapeXmlText(character) !== '']).toEqual([
        codePoint,
        isXmlCharacter(codePoint),
      ]);
    }
  });

  it('writes a document a conformant reader can read, from a hostile name', () => {
    const document = new XmlWriter().leaf('name', 'Ride\u0001 & \u0000home').finish();
    expect(document).not.toContain('\u0001');
    let read = '';
    parseXml(document, {
      text: (value) => {
        read += value;
      },
    });
    expect(read).toBe('Ride & home');
  });
});

describe('number formatting', () => {
  it('fixes the digit count so the bytes cannot drift', () => {
    expect(decimal(0.1 + 0.2, 3)).toBe('0.300');
    expect(degrees(-0.018)).toBe('-0.0180000');
    expect(integer(87.6)).toBe('88');
  });

  it('normalises a negative zero away', () => {
    // `(-1e-9).toFixed(7)` is "-0.0000000": a signed zero written into a
    // coordinate, and pure noise in a diff.
    expect(decimal(-1e-9, 7)).toBe('0.0000000');
    expect(decimal(-0, 7)).toBe('0.0000000');
    expect(decimal(-0.00000004, 7)).toBe('0.0000000');
    // A real negative is untouched.
    expect(decimal(-0.0001, 7)).toBe('-0.0001000');
  });

  it('refuses a value that is not finite rather than writing "NaN" into a file', () => {
    expect(() => decimal(Number.NaN, 3)).toThrow(RangeError);
    expect(() => decimal(Number.POSITIVE_INFINITY, 3)).toThrow(RangeError);
  });
});

describe('the writer', () => {
  it('indents by depth and ends with a newline', () => {
    const document = new XmlWriter()
      .declaration()
      .open('gpx', [['version', '1.1']])
      .open('trk')
      .leaf('name', 'ride')
      .close('trk')
      .close('gpx')
      .finish();
    expect(document).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1">',
        '  <trk>',
        '    <name>ride</name>',
        '  </trk>',
        '</gpx>',
        '',
      ].join('\n'),
    );
  });

  it('does not indent past zero when closed more often than opened', () => {
    // Not a shape any caller produces; asserted because a negative depth would
    // make `repeat` throw, which turns a writer bug into a crash.
    const writer = new XmlWriter();
    expect(() => writer.close('a').close('b')).not.toThrow();
  });
});
