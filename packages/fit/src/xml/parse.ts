// SPDX-License-Identifier: Apache-2.0

/**
 * A deliberately small, deliberately hostile-input-first XML reader.
 *
 * ## Why this package writes its own instead of taking a dependency
 *
 * Three reasons, in the order they were decided:
 *
 * 1. **`packages/fit/src` has no platform surface.** `tsconfig.platform-free.json`
 *    compiles it with `lib: ["ES2024"]` and `types: []`, so `DOMParser` is a
 *    compile error here, not a choice. Whatever reads GPX has to be
 *    ECMAScript and nothing else, which is what lets #15 run it on a phone.
 * 2. **A parser dependency in `packages/` is a licence question first.**
 *    CLAUDE.md §3: a GPL or AGPL dependency under `packages/` fails CI with no
 *    exemption, and MPL/EPL/BlueOak are not ruled on until #24. #32's revision
 *    block asks for *"no dependency at all if the subset needed is small — the
 *    FIT decoder took nothing"*. The subset needed is elements, attributes,
 *    text, CDATA, comments and namespaces. It is small.
 * 3. **The security property is a property of the grammar, not a setting.**
 *    See below.
 *
 * ## XXE and billion laughs are refused by construction
 *
 * `SECURITY.md`: *"XXE in GPX and TCX is specifically in scope."* The standard
 * mitigation is to configure a parser to disable external entity resolution and
 * DTD processing. This parser has no such setting because it has no such
 * feature: **a `<!DOCTYPE` is a fatal error before its contents are read.**
 *
 * That single rule closes both attacks at once, and it closes them for the same
 * reason:
 *
 * - **XXE** needs `<!ENTITY xxe SYSTEM "file:///etc/passwd">`, which can only
 *   appear in a DTD.
 * - **Billion laughs** needs nested `<!ENTITY>` declarations, which can only
 *   appear in a DTD.
 *
 * There is a second, independent layer behind it, because one control is a
 * single edit away from being none: **the only entity references this parser
 * resolves are the five XML predefines and numeric character references.**
 * `&xxe;` in a document with no DOCTYPE at all is `unknown-entity`, not a
 * silent empty string and not a passthrough. Deleting either layer makes
 * `parse.test.ts` red, which is the point of having two.
 *
 * Nothing here reads a file, opens a socket or resolves a URI. It cannot: see
 * reason 1.
 *
 * ## It is an event reader, not a document tree
 *
 * [#127](https://github.com/openzigs/onyourleft/issues/127) is the FIT decoder
 * retaining ~354 MiB from a 4.39 MiB file, and #32's revision block asks that
 * this work not repeat the shape. A GPX file from a 4-hour ride is 14 400
 * `<trkpt>` elements; a DOM of it retains every one of them plus a node object
 * per child. So {@link parseXml} calls a handler as it goes and keeps only the
 * element stack — depth, not length — and the importers in `gpx.ts` and
 * `tcx.ts` build the activity directly from the events.
 */

import type { ActivityXmlFaultCode } from './errors';
import { ActivityXmlError } from './errors';

/** The XML namespace URI a `xml:` prefix is always bound to. */
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

/**
 * How deep elements may nest.
 *
 * A limit rather than the call stack's, because the parser is iterative and
 * would otherwise happily build a 10-million-deep stack out of ten megabytes of
 * `<a>`. GPX nests six deep and TCX eight; 256 is two orders of margin and
 * still bounded.
 */
export const MAXIMUM_DEPTH = 256;

/** An expanded name: the namespace URI a prefix resolved to, and the local name. */
export interface XmlName {
  /** `undefined` when the element or attribute is in no namespace. */
  readonly namespace: string | undefined;
  readonly local: string;
}

/** One attribute of a start tag, with its value already unescaped. */
export interface XmlAttribute extends XmlName {
  readonly value: string;
}

/** A start tag. A self-closing tag reports this and then immediately an end. */
export interface XmlStartElement extends XmlName {
  readonly attributes: readonly XmlAttribute[];
  /** Where the `<` is, in UTF-16 code units from the start of the document. */
  readonly characterOffset: number;
}

/**
 * What {@link parseXml} calls as it reads.
 *
 * Every method is optional, so an importer that only wants text inside two
 * elements does not have to say so three times.
 */
export interface XmlHandler {
  startElement?: (element: XmlStartElement) => void;
  endElement?: (name: XmlName) => void;
  /**
   * Character data. Called once per contiguous run, so a text node split by a
   * comment or a CDATA boundary arrives as more than one call — an importer
   * that cares must accumulate rather than assume.
   */
  text?: (value: string) => void;
}

/** The five entities XML predefines, and the only named ones this parser knows. */
const PREDEFINED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

const WHITESPACE = new Set([' ', '\t', '\r', '\n']);

const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;
const MAX_CODE_POINT = 0x10ffff;

interface Scope {
  readonly prefix: string | undefined;
  readonly local: string;
  readonly namespace: string | undefined;
  /** Prefix → URI bindings this element introduced, to be undone when it closes. */
  readonly declared: ReadonlyMap<string, string | undefined>;
}

class Parser {
  readonly #text: string;
  readonly #handler: XmlHandler;
  readonly #stack: Scope[] = [];
  /** Prefix → URI. `''` is the default namespace. Innermost binding wins. */
  readonly #namespaces = new Map<string, string[]>([['xml', [XML_NAMESPACE]]]);
  #offset = 0;
  #rootSeen = false;

  constructor(text: string, handler: XmlHandler) {
    this.#text = text;
    this.#handler = handler;
  }

  #fail(code: ActivityXmlFaultCode, message: string): never {
    throw new ActivityXmlError(code, this.#offset, message);
  }

  #at(offset = this.#offset): string {
    return this.#text.charAt(offset);
  }

  #startsWith(prefix: string): boolean {
    return this.#text.startsWith(prefix, this.#offset);
  }

  run(): void {
    while (this.#offset < this.#text.length) {
      if (this.#at() === '<') {
        this.#readMarkup();
        continue;
      }
      this.#readText();
    }
    if (this.#stack.length > 0) {
      this.#fail(
        'unexpected-end',
        `the document ends with ${String(this.#stack.length)} element(s) still open`,
      );
    }
    if (!this.#rootSeen) {
      this.#fail('malformed-document', 'the document contains no element at all');
    }
  }

  #readText(): void {
    const start = this.#offset;
    while (this.#offset < this.#text.length && this.#at() !== '<') this.#offset += 1;
    const raw = this.#text.slice(start, this.#offset);
    // Text outside the root element is whitespace only, in a well-formed
    // document. Anything else is content with nowhere to belong.
    if (this.#stack.length === 0) {
      if (raw.trim() !== '') {
        this.#offset = start;
        this.#fail('malformed-document', 'character data appears outside the root element');
      }
      return;
    }
    const value = this.#unescape(raw, start);
    if (value !== '') this.#handler.text?.(value);
  }

  #readMarkup(): void {
    if (this.#startsWith('<!--')) {
      this.#skipTo('-->', 'a comment');
      return;
    }
    if (this.#startsWith('<![CDATA[')) {
      const start = this.#offset + '<![CDATA['.length;
      const end = this.#text.indexOf(']]>', start);
      if (end === -1) this.#fail('unexpected-end', 'a CDATA section is never closed');
      const value = this.#text.slice(start, end);
      this.#offset = end + ']]>'.length;
      if (this.#stack.length === 0) {
        this.#fail('malformed-document', 'a CDATA section appears outside the root element');
      }
      if (value !== '') this.#handler.text?.(value);
      return;
    }
    if (this.#startsWith('<?')) {
      this.#skipTo('?>', 'a processing instruction');
      return;
    }
    if (this.#startsWith('<!DOCTYPE') || this.#startsWith('<!doctype')) {
      // The whole security posture of this file, in one branch. Nothing inside
      // the declaration is read — not to skip it, not to validate it, not to
      // report what it said. See the module comment.
      this.#fail(
        'doctype-forbidden',
        'the document declares a DOCTYPE. A DTD is the only place an XML document can declare ' +
          'an entity, and an entity is how a document makes a parser read a local file or reach ' +
          'the network on the sender’s behalf, so the declaration is refused rather than ' +
          'processed',
      );
    }
    if (this.#startsWith('<!')) {
      this.#fail('malformed-markup', 'a declaration this parser does not implement');
    }
    if (this.#startsWith('</')) {
      this.#readEndTag();
      return;
    }
    this.#readStartTag();
  }

  #skipTo(terminator: string, what: string): void {
    const end = this.#text.indexOf(terminator, this.#offset);
    if (end === -1) this.#fail('unexpected-end', `${what} is never closed`);
    this.#offset = end + terminator.length;
  }

  #readName(): string {
    const start = this.#offset;
    while (this.#offset < this.#text.length && isNameCharacter(this.#at())) this.#offset += 1;
    if (this.#offset === start) {
      this.#fail('malformed-markup', 'a tag or attribute name is missing');
    }
    return this.#text.slice(start, this.#offset);
  }

  #skipWhitespace(): void {
    while (this.#offset < this.#text.length && WHITESPACE.has(this.#at())) this.#offset += 1;
  }

  #readStartTag(): void {
    const tagOffset = this.#offset;
    if (this.#rootSeen && this.#stack.length === 0) {
      this.#fail('malformed-document', 'a second root element follows the first');
    }
    this.#offset += 1; // '<'
    const qualified = this.#readName();

    const rawAttributes: { name: string; value: string; offset: number }[] = [];
    let selfClosing = false;
    for (;;) {
      this.#skipWhitespace();
      if (this.#offset >= this.#text.length) {
        this.#fail('unexpected-end', 'a start tag is never closed');
      }
      if (this.#startsWith('/>')) {
        selfClosing = true;
        this.#offset += 2;
        break;
      }
      if (this.#at() === '>') {
        this.#offset += 1;
        break;
      }
      const attributeOffset = this.#offset;
      const name = this.#readName();
      this.#skipWhitespace();
      if (this.#at() !== '=') {
        this.#fail('malformed-markup', 'an attribute has no value');
      }
      this.#offset += 1;
      this.#skipWhitespace();
      const quote = this.#at();
      if (quote !== '"' && quote !== "'") {
        this.#fail('malformed-markup', 'an attribute value is not quoted');
      }
      this.#offset += 1;
      const valueStart = this.#offset;
      const end = this.#text.indexOf(quote, valueStart);
      if (end === -1) this.#fail('unexpected-end', 'an attribute value is never closed');
      const raw = this.#text.slice(valueStart, end);
      if (raw.includes('<')) {
        this.#fail('malformed-markup', 'an attribute value contains a raw "<"');
      }
      this.#offset = end + 1;
      rawAttributes.push({
        name,
        value: this.#unescape(raw, valueStart),
        offset: attributeOffset,
      });
    }

    if (this.#stack.length >= MAXIMUM_DEPTH) {
      this.#offset = tagOffset;
      this.#fail(
        'depth-limit-exceeded',
        `elements are nested more than ${String(MAXIMUM_DEPTH)} deep, which no activity file ` +
          'shape requires and a document built to exhaust a parser does',
      );
    }

    const seen = new Set<string>();
    for (const attribute of rawAttributes) {
      if (seen.has(attribute.name)) {
        this.#offset = attribute.offset;
        this.#fail('duplicate-attribute', 'an element carries the same attribute name twice');
      }
      seen.add(attribute.name);
    }

    // Namespace declarations bind before the element's own name is resolved, so
    // `<gpx xmlns="...">` is in the namespace it declares.
    const declared = new Map<string, string | undefined>();
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns') {
        declared.set('', attribute.value === '' ? undefined : attribute.value);
      } else if (attribute.name.startsWith('xmlns:')) {
        declared.set(attribute.name.slice('xmlns:'.length), attribute.value);
      }
    }
    for (const [prefix, uri] of declared) this.#push(prefix, uri);

    const { prefix, local } = split(qualified);
    const namespace = this.#resolve(prefix, tagOffset, true);

    const attributes: XmlAttribute[] = [];
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      const parts = split(attribute.name);
      attributes.push({
        // An unprefixed attribute is in no namespace, never the default one.
        namespace:
          parts.prefix === undefined
            ? undefined
            : this.#resolve(parts.prefix, attribute.offset, false),
        local: parts.local,
        value: attribute.value,
      });
    }

    this.#rootSeen = true;
    this.#stack.push({ prefix, local, namespace, declared });
    this.#handler.startElement?.({
      namespace,
      local,
      attributes,
      characterOffset: tagOffset,
    });
    if (selfClosing) this.#closeTop();
  }

  #readEndTag(): void {
    const tagOffset = this.#offset;
    this.#offset += 2; // '</'
    const qualified = this.#readName();
    this.#skipWhitespace();
    if (this.#at() !== '>') this.#fail('unexpected-end', 'an end tag is never closed');
    this.#offset += 1;

    const open = this.#stack.at(-1);
    const { prefix, local } = split(qualified);
    if (!open || open.local !== local || open.prefix !== prefix) {
      this.#offset = tagOffset;
      this.#fail(
        'mismatched-end-tag',
        open
          ? 'an end tag names an element other than the one that is open'
          : 'an end tag appears with no element open',
      );
    }
    this.#closeTop();
  }

  #closeTop(): void {
    const scope = this.#stack.pop();
    if (!scope) return;
    for (const prefix of scope.declared.keys()) this.#pop(prefix);
    this.#handler.endElement?.({ namespace: scope.namespace, local: scope.local });
  }

  #push(prefix: string, uri: string | undefined): void {
    const bindings = this.#namespaces.get(prefix);
    if (bindings) bindings.push(uri ?? '');
    else this.#namespaces.set(prefix, [uri ?? '']);
  }

  #pop(prefix: string): void {
    this.#namespaces.get(prefix)?.pop();
  }

  #resolve(prefix: string | undefined, offset: number, isElement: boolean): string | undefined {
    if (prefix === undefined) {
      if (!isElement) return undefined;
      const bound = this.#namespaces.get('')?.at(-1);
      return bound === undefined || bound === '' ? undefined : bound;
    }
    const bound = this.#namespaces.get(prefix)?.at(-1);
    if (bound === undefined || bound === '') {
      this.#offset = offset;
      this.#fail(
        'unbound-namespace-prefix',
        'a namespace prefix is used that nothing in scope has bound',
      );
    }
    return bound;
  }

  /**
   * Replace entity and character references in a run of text.
   *
   * The second layer of the entity defence. Everything that is not one of the
   * five predefines or a numeric character reference is an error — never a
   * passthrough, never an empty string. A passthrough would put `&xxe;`
   * verbatim into an activity name, which is harmless here and is exactly the
   * shape of the bug that becomes an injection two layers up.
   */
  #unescape(raw: string, rawOffset: number): string {
    if (!raw.includes('&')) return raw;
    let output = '';
    let index = 0;
    while (index < raw.length) {
      const ampersand = raw.indexOf('&', index);
      if (ampersand === -1) {
        output += raw.slice(index);
        break;
      }
      output += raw.slice(index, ampersand);
      const semicolon = raw.indexOf(';', ampersand);
      if (semicolon === -1) {
        this.#offset = rawOffset + ampersand;
        this.#fail('unknown-entity', 'an unterminated "&" appears in character data');
      }
      const name = raw.slice(ampersand + 1, semicolon);
      output += this.#expand(name, rawOffset + ampersand);
      index = semicolon + 1;
    }
    return output;
  }

  #expand(name: string, offset: number): string {
    const predefined = PREDEFINED_ENTITIES.get(name);
    if (predefined !== undefined) return predefined;

    if (name.startsWith('#')) {
      const hexadecimal = name.startsWith('#x') || name.startsWith('#X');
      const digits = name.slice(hexadecimal ? 2 : 1);
      const valid = hexadecimal ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits);
      const codePoint = valid ? Number.parseInt(digits, hexadecimal ? 16 : 10) : Number.NaN;
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 1 ||
        codePoint > MAX_CODE_POINT ||
        (codePoint >= SURROGATE_FIRST && codePoint <= SURROGATE_LAST)
      ) {
        this.#offset = offset;
        this.#fail(
          'bad-character-reference',
          'a numeric character reference does not denote a character',
        );
      }
      return String.fromCodePoint(codePoint);
    }

    this.#offset = offset;
    this.#fail(
      'unknown-entity',
      'the document references an entity that is not one of the five XML predefines. This ' +
        'parser resolves no others, because an entity a document defines for itself is how a ' +
        'file reads another file',
    );
  }
}

function split(qualified: string): { prefix: string | undefined; local: string } {
  const colon = qualified.indexOf(':');
  if (colon === -1) return { prefix: undefined, local: qualified };
  return { prefix: qualified.slice(0, colon), local: qualified.slice(colon + 1) };
}

/**
 * Whether a character may appear in a name.
 *
 * Deliberately permissive above U+007F rather than implementing XML's
 * `NameStartChar` production in full: this parser's job is to refuse dangerous
 * documents, not to be a validating one, and rejecting an unusual but legal
 * element name would turn a rider's export into a support ticket. The
 * characters that *matter* — the ones that would let a name run into the
 * markup around it — are all below U+007F and are all excluded.
 */
function isNameCharacter(character: string): boolean {
  if (character === '') return false;
  const code = character.charCodeAt(0);
  if (code > 0x7f) return true;
  return /[-A-Za-z0-9_.:]/.test(character);
}

/**
 * Read an XML document, calling `handler` as it goes.
 *
 * @throws {ActivityXmlError} for anything that makes the document not
 * well-formed, and — before anything else — for a DOCTYPE.
 */
export function parseXml(text: string, handler: XmlHandler): void {
  new Parser(text, handler).run();
}
