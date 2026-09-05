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

/** Escape the three characters that cannot appear literally in a text node. */
export function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

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
