// SPDX-License-Identifier: Apache-2.0

/**
 * The XML reader, and the two attacks it exists to refuse.
 *
 * The hostile **committed fixtures** are asserted in
 * `tools/fixture-corpus/xml-corpus.test.ts`, which is where a test that reads
 * files off disk belongs. This file is the unit-level half: the same defences,
 * against documents written inline so the exact shape being refused is visible
 * next to the assertion.
 */

import { describe, expect, it } from 'vitest';

import { ActivityXmlError } from './errors';
import type { XmlAttribute, XmlName, XmlStartElement } from './parse';
import { MAXIMUM_DEPTH, parseXml, XML_NAMESPACE } from './parse';

type Event =
  | { readonly kind: 'start'; readonly name: string; readonly namespace: string | undefined }
  | { readonly kind: 'end'; readonly name: string }
  | { readonly kind: 'text'; readonly value: string };

function events(text: string): readonly Event[] {
  const collected: Event[] = [];
  parseXml(text, {
    startElement: (element: XmlStartElement) => {
      collected.push({ kind: 'start', name: element.local, namespace: element.namespace });
    },
    endElement: (name: XmlName) => {
      collected.push({ kind: 'end', name: name.local });
    },
    text: (value) => {
      collected.push({ kind: 'text', value });
    },
  });
  return collected;
}

function textOf(document: string): string {
  return events(document)
    .filter((event) => event.kind === 'text')
    .map((event) => event.value)
    .join('');
}

function attributesOf(document: string): readonly XmlAttribute[] {
  let found: readonly XmlAttribute[] = [];
  parseXml(document, {
    startElement: (element) => {
      if (found.length === 0) found = element.attributes;
    },
  });
  return found;
}

function faultCode(document: string): string {
  try {
    parseXml(document, {});
  } catch (cause) {
    if (cause instanceof ActivityXmlError) return cause.code;
    throw cause;
  }
  throw new Error('the document parsed, and it was not supposed to');
}

// ---------------------------------------------------------------------------
// The security half.
// ---------------------------------------------------------------------------

describe('a DOCTYPE', () => {
  it('is refused, whatever it declares', () => {
    expect(faultCode('<!DOCTYPE gpx><gpx/>')).toBe('doctype-forbidden');
    expect(faultCode('<?xml version="1.0"?>\n<!DOCTYPE gpx []>\n<gpx/>')).toBe('doctype-forbidden');
  });

  it('is refused in the XXE shape, before anything inside it is read', () => {
    const document = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE gpx [',
      '  <!ENTITY xxe SYSTEM "file:///etc/passwd">',
      ']>',
      '<gpx><trk><name>&xxe;</name></trk></gpx>',
    ].join('\n');
    expect(faultCode(document)).toBe('doctype-forbidden');
  });

  it('is refused in the billion-laughs shape, before a single character is handled', () => {
    const levels = Array.from({ length: 9 }, (_, index) => {
      const inner = index === 0 ? 'lol' : `lol${String(index)}`;
      return `  <!ENTITY lol${String(index + 1)} "${`&${inner};`.repeat(10)}">`;
    });
    const document = [
      '<!DOCTYPE gpx [',
      '  <!ENTITY lol "lol">',
      ...levels,
      ']>',
      '<gpx><trk><name>&lol9;</name></trk></gpx>',
    ].join('\n');

    // Nine levels of ten is a billion copies of `lol` — three gigabytes if
    // expanded. Counting the handler calls is what makes this an assertion
    // about exhaustion rather than about the error code alone: a parser that
    // expanded anything at all would have emitted text before it failed.
    let handled = 0;
    try {
      parseXml(document, {
        startElement: () => {
          handled += 1;
        },
        text: () => {
          handled += 1;
        },
      });
      throw new Error('the document parsed, and it was not supposed to');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ActivityXmlError);
      expect((cause as ActivityXmlError).code).toBe('doctype-forbidden');
    }
    expect(handled).toBe(0);
  });

  it('is refused case-insensitively, so `<!doctype` is not a way past it', () => {
    expect(faultCode('<!doctype gpx [ <!ENTITY x "y"> ]><gpx/>')).toBe('doctype-forbidden');
  });
});

describe('an entity reference', () => {
  it('resolves the five XML predefines and nothing else', () => {
    expect(textOf('<a>&amp;&lt;&gt;&quot;&apos;</a>')).toBe('&<>"\'');
  });

  it('is an error for any other name, even with no DOCTYPE in sight', () => {
    // The second layer. Deleting the DOCTYPE refusal above leaves this one, and
    // deleting this one leaves that: both are required, which is why both are
    // tested.
    expect(faultCode('<a>&xxe;</a>')).toBe('unknown-entity');
    expect(faultCode('<a>&nbsp;</a>')).toBe('unknown-entity');
    expect(faultCode('<a b="&xxe;"/>')).toBe('unknown-entity');
  });

  it('never passes an unknown reference through as text', () => {
    // A passthrough is the quiet version of this bug: the import succeeds, the
    // activity name is the literal `&xxe;`, and nothing is wrong until that
    // string reaches something that does resolve entities.
    expect(() => parseXml('<a>&xxe;</a>', {})).toThrow(ActivityXmlError);
  });

  it('resolves numeric character references, and refuses ones that are not characters', () => {
    expect(textOf('<a>&#65;&#x42;&#x1F6B2;</a>')).toBe('AB\u{1F6B2}');
    expect(faultCode('<a>&#xD800;</a>')).toBe('bad-character-reference');
    expect(faultCode('<a>&#x110000;</a>')).toBe('bad-character-reference');
    expect(faultCode('<a>&#0;</a>')).toBe('bad-character-reference');
    expect(faultCode('<a>&#xZZ;</a>')).toBe('bad-character-reference');
  });

  it('refuses an unterminated ampersand rather than reading to the end of the document', () => {
    expect(faultCode('<a>a & b</a>')).toBe('unknown-entity');
  });
});

describe('resource exhaustion', () => {
  it('refuses elements nested past the depth limit', () => {
    const deep = '<a>'.repeat(MAXIMUM_DEPTH + 1);
    expect(faultCode(deep)).toBe('depth-limit-exceeded');
  });

  it('accepts nesting up to the limit, so the limit is not the bug', () => {
    const depth = MAXIMUM_DEPTH;
    const document = `${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`;
    expect(events(document).filter((event) => event.kind === 'start')).toHaveLength(depth);
  });
});

// ---------------------------------------------------------------------------
// Well-formedness.
// ---------------------------------------------------------------------------

describe('a malformed document', () => {
  it.each([
    ['an unclosed element', '<a><b></a>', 'mismatched-end-tag'],
    ['an end tag with nothing open', '<a></a></b>', 'mismatched-end-tag'],
    ['a document that ends inside a start tag', '<a b="c"', 'unexpected-end'],
    ['a document that ends inside an attribute value', '<a b="c', 'unexpected-end'],
    ['a document that ends with an element open', '<a><b>text', 'unexpected-end'],
    ['an unclosed comment', '<a><!-- forever', 'unexpected-end'],
    ['an unclosed CDATA section', '<a><![CDATA[ forever', 'unexpected-end'],
    ['an attribute with no value', '<a b/>', 'malformed-markup'],
    ['an unquoted attribute value', '<a b=c/>', 'malformed-markup'],
    ['the same attribute twice', '<a b="1" b="2"/>', 'duplicate-attribute'],
    ['an unbound namespace prefix', '<x:a/>', 'unbound-namespace-prefix'],
    ['no element at all', '<?xml version="1.0"?>', 'malformed-document'],
    ['a second root element', '<a/><b/>', 'malformed-document'],
    ['text outside the root element', '<a/>trailing', 'malformed-document'],
  ])('%s is a structured error', (_what, document, code) => {
    expect(faultCode(document)).toBe(code);
  });

  it('names the character offset the problem is at', () => {
    try {
      parseXml('<a>\n  <b></c>\n</a>', {});
      throw new Error('expected a throw');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ActivityXmlError);
      expect((cause as ActivityXmlError).characterOffset).toBe(9);
    }
  });

  it('never quotes the text that caused it', () => {
    // ADR 0004 decision D. The value in a GPX attribute is very often a
    // coordinate, and an error message is a place coordinates leak.
    try {
      parseXml('<trkpt lat="51.5074" lon="-0.1278">&xxe;</trkpt>', {});
      throw new Error('expected a throw');
    } catch (cause) {
      expect((cause as Error).message).not.toContain('51.5074');
      expect((cause as Error).message).not.toContain('0.1278');
      expect((cause as Error).message).not.toContain('xxe');
    }
  });
});

// ---------------------------------------------------------------------------
// The parts an importer relies on.
// ---------------------------------------------------------------------------

describe('elements', () => {
  it('reports a self-closing element as a start and then an end', () => {
    expect(events('<a><b/></a>')).toEqual([
      { kind: 'start', name: 'a', namespace: undefined },
      { kind: 'start', name: 'b', namespace: undefined },
      { kind: 'end', name: 'b' },
      { kind: 'end', name: 'a' },
    ]);
  });

  it('reads text, CDATA and comments as an importer would want them', () => {
    expect(textOf('<a>one<!-- ignored -->two<![CDATA[<three & four>]]></a>')).toBe(
      'onetwo<three & four>',
    );
  });

  it('skips a processing instruction', () => {
    expect(events('<?xml version="1.0"?><a/>')).toEqual([
      { kind: 'start', name: 'a', namespace: undefined },
      { kind: 'end', name: 'a' },
    ]);
  });
});

describe('namespaces', () => {
  it('resolves a default namespace onto the element that declares it', () => {
    const [first] = events('<gpx xmlns="urn:one"><trk/></gpx>');
    expect(first).toEqual({ kind: 'start', name: 'gpx', namespace: 'urn:one' });
  });

  it('resolves a prefix declared on an ancestor', () => {
    const seen = events('<a xmlns:p="urn:one"><b><p:c/></b></a>');
    expect(seen.filter((event) => event.kind === 'start').at(-1)).toEqual({
      kind: 'start',
      name: 'c',
      namespace: 'urn:one',
    });
  });

  it('lets an inner declaration shadow an outer one, and restores it on close', () => {
    const seen = events('<a xmlns:p="urn:outer"><p:x/><b xmlns:p="urn:inner"><p:y/></b><p:z/></a>');
    const namespaces = seen
      .filter((event) => event.kind === 'start')
      .map((event) => (event.kind === 'start' ? [event.name, event.namespace] : []));
    expect(namespaces).toEqual([
      ['a', undefined],
      ['x', 'urn:outer'],
      ['b', undefined],
      ['y', 'urn:inner'],
      ['z', 'urn:outer'],
    ]);
  });

  it('refuses a prefix once the element that declared it has closed', () => {
    expect(faultCode('<a><b xmlns:p="urn:one"><p:c/></b><p:d/></a>')).toBe(
      'unbound-namespace-prefix',
    );
  });

  it('leaves an unprefixed attribute in no namespace, even under a default one', () => {
    const attributes = attributesOf('<trkpt xmlns="urn:gpx" lat="0.1" lon="0.2"/>');
    expect(attributes).toEqual([
      { namespace: undefined, local: 'lat', value: '0.1' },
      { namespace: undefined, local: 'lon', value: '0.2' },
    ]);
  });

  it('binds the `xml` prefix without a declaration, as the specification requires', () => {
    const attributes = attributesOf('<a xml:lang="en"/>');
    expect(attributes).toEqual([{ namespace: XML_NAMESPACE, local: 'lang', value: 'en' }]);
  });

  it('unescapes attribute values', () => {
    expect(attributesOf('<a b="&lt;&amp;&gt;&#65;"/>')).toEqual([
      { namespace: undefined, local: 'b', value: '<&>A' },
    ]);
  });
});
