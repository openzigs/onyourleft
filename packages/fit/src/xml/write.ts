// SPDX-License-Identifier: Apache-2.0

/**
 * Writing XML: escaping, number formatting, and an element builder.
 *
 * ## Escaping is not optional and is not conditional
 *
 * Everything that reaches a text node or an attribute value goes through
 * {@link escapeXmlText} or {@link escapeXmlAttribute}. An activity name is
 * whatever the rider typed, and a name containing `<` that is written verbatim
 * produces a document that does not parse — or, worse, one that parses as
 * something else. The exporter has no "this string is known safe" path,
 * because that is the path that gets reused.
 *
 * ## Numbers are formatted at a fixed width
 *
 * `String(0.1 + 0.2)` is `0.30000000000000004`, and a coordinate written that
 * way is seventeen digits of noise that changes with an unrelated refactor.
 * {@link decimal} fixes the digit count, and — like the fixture generator's
 * writer, which learned this in #29 — it normalises a negative zero away:
 * `(-1e-9).toFixed(7)` is `-0.0000000`, a signed zero written into a
 * coordinate.
 */

/**
 * Escape the three characters that cannot appear literally in a text node, and
 * drop the ones XML cannot carry at all.
 *
 * Escaping and dropping are two different problems and only the first has a
 * spelling: `<` becomes `&lt;`, but a `0x01` has **no** representation in an
 * XML 1.0 document — not raw and not as `&#1;`, both of which a conformant
 * parser refuses. So it is removed, and the alternative of failing the export
 * is worse: a stray control character in a name a rider typed would cost them
 * the whole ride file.
 *
 * ⚠️ Paired with the `Char` check in `parse.ts`, and neither half is enough on
 * its own. This package's own parser once accepted `&#1;` on import and this
 * writer emitted the character it produced verbatim, so a control character
 * survived a round trip through a codec that agreed with itself and produced a
 * document expat rejects. That is the shape a round-trip test cannot see: both
 * ends were lenient in the same direction.
 */
export function escapeXmlText(value: string): string {
  return value
    .replaceAll(NON_XML_CHARACTERS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Everything XML 1.0's `Char` production forbids: the C0 controls other than
 * tab, line feed and carriage return, unpaired surrogates, and the two
 * noncharacters at the end of the BMP.
 *
 * ⚠️ The `u` flag is load-bearing rather than decorative. In unicode mode the
 * engine matches **code points**, so a well-formed surrogate pair is one
 * character outside this class and survives intact; without the flag the
 * class would match each half of every emoji and tear it in two.
 *
 * Spelled with escapes rather than the characters themselves, because a file
 * holding a literal `0x01` is one every tool downstream treats as binary.
 * `write.test.ts` pins this class to `parse.ts`'s `isXmlCharacter`, so the two
 * ends of the codec cannot drift back into agreeing with each other.
 */
const NON_XML_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- the point of the class is the control characters
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/** Escape a value for a double-quoted attribute. */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** A number at a fixed number of decimal places, so the bytes cannot drift. */
export function decimal(value: number, places: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`cannot format ${String(value)} as a fixed-point decimal`);
  }
  const rendered = value.toFixed(places);
  return /^-0(\.0*)?$/.test(rendered) ? rendered.slice(1) : rendered;
}

/** Decimal degrees at the 1e-7 resolution both formats are read at in practice. */
export function degrees(value: number): string {
  return decimal(value, 7);
}

/** An integer, for a field that has no fractional part. */
export function integer(value: number): string {
  return String(Math.round(value));
}

/**
 * A tiny indentation-aware line accumulator.
 *
 * A line list rather than a document tree, so an export of a 14 400-point ride
 * retains its output and nothing else — the same reason `parse.ts` is an event
 * reader. `finish()` is the only place the whole document exists as one string.
 */
export class XmlWriter {
  readonly #lines: string[] = [];
  #depth = 0;

  /** The XML declaration. Always UTF-8, because the output always is. */
  declaration(): this {
    this.#lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    return this;
  }

  /** Open an element, with attributes already escaped by this call. */
  open(name: string, attributes: readonly (readonly [string, string])[] = []): this {
    this.#lines.push(`${this.#indent()}<${name}${renderAttributes(attributes)}>`);
    this.#depth += 1;
    return this;
  }

  close(name: string): this {
    this.#depth = Math.max(0, this.#depth - 1);
    this.#lines.push(`${this.#indent()}</${name}>`);
    return this;
  }

  /** An element with text content, on one line. */
  leaf(name: string, value: string, attributes: readonly (readonly [string, string])[] = []): this {
    this.#lines.push(
      `${this.#indent()}<${name}${renderAttributes(attributes)}>${escapeXmlText(value)}</${name}>`,
    );
    return this;
  }

  #indent(): string {
    return '  '.repeat(this.#depth);
  }

  /** The document: lines joined with `\n`, ending in one. */
  finish(): string {
    return `${this.#lines.join('\n')}\n`;
  }
}

function renderAttributes(attributes: readonly (readonly [string, string])[]): string {
  return attributes.map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`).join('');
}
