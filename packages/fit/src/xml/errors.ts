// SPDX-License-Identifier: Apache-2.0

/**
 * The one error type the GPX and TCX half of this package produces.
 *
 * Same split as `decode/errors.ts`, and it carries a **character offset** where
 * the FIT error carries a byte offset — for the same reason. A rider whose
 * export was rejected, and the contributor reading their bug report, both want
 * to know *where*.
 *
 * - **Thrown** when the document cannot be believed at all: it is not
 *   well-formed, it carries a DOCTYPE, it ends in the middle of something, or
 *   its root element is not the one the format requires. There is no partial
 *   answer, and — for `doctype-forbidden` — offering one is the vulnerability.
 * - **Collected** when one value inside an otherwise readable document is
 *   wrong: a latitude that is not a number, a timestamp that is not an instant,
 *   a heart rate `@onyourleft/domain` rejects. The point is dropped and the
 *   ride survives.
 *
 * **A message never carries the value that caused it.** ADR 0004 decision D.
 * That matters more here than in the FIT decoder: an XML parse error naturally
 * wants to quote the offending text, and the offending text in a GPX file is
 * very often a coordinate.
 */

/** What was wrong with a GPX or TCX document, as a value rather than as prose. */
export type ActivityXmlFaultCode =
  // --- Structural. Thrown. --------------------------------------------------
  /**
   * The document carries a `<!DOCTYPE ...>`.
   *
   * Refused outright, before anything inside it is looked at. A DTD is the only
   * way an XML document can declare an entity, so refusing the declaration is
   * what makes external entity resolution and entity expansion impossible
   * rather than merely disabled. `SECURITY.md` puts XXE in GPX and TCX
   * specifically in scope, and "the parser is configured safely" is a claim
   * about a setting; this is a claim about the grammar.
   */
  | 'doctype-forbidden'
  /** The document ends in the middle of a tag, an attribute or a comment. */
  | 'unexpected-end'
  /** An end tag names an element other than the one that is open. */
  | 'mismatched-end-tag'
  /** A character that cannot appear where it appears. */
  | 'malformed-markup'
  /** An entity reference other than the five XML predefines. */
  | 'unknown-entity'
  /** A numeric character reference that is not a character. */
  | 'bad-character-reference'
  /** Elements nested deeper than the parser will go. */
  | 'depth-limit-exceeded'
  /** An element carries the same attribute name twice. */
  | 'duplicate-attribute'
  /** A namespace prefix nothing in scope has bound. */
  | 'unbound-namespace-prefix'
  /** No root element, or a second one after the first has closed. */
  | 'malformed-document'
  /** The root element is not the one this format requires. */
  | 'wrong-root-element'

  // --- Values. Collected. ---------------------------------------------------
  /** A number that is not a number, or one the domain rejects. */
  | 'invalid-value'
  /** A timestamp that is not an ISO 8601 instant. */
  | 'invalid-timestamp';

/** A GPX or TCX fault, with the character offset it was found at. */
export class ActivityXmlError extends Error {
  override readonly name = 'ActivityXmlError';

  /** What was wrong. */
  readonly code: ActivityXmlFaultCode;

  /**
   * Where in the document, counted in UTF-16 code units from character zero.
   *
   * Characters rather than bytes, because the caller holds the text: an offset
   * into the decoded string is one a caller can slice with, and a byte offset
   * into a UTF-8 encoding it may no longer have is not.
   */
  readonly characterOffset: number;

  constructor(code: ActivityXmlFaultCode, characterOffset: number, message: string) {
    super(`${message} (at character ${String(characterOffset)})`);
    this.code = code;
    this.characterOffset = characterOffset;
  }
}
