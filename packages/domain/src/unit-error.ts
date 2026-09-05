// SPDX-License-Identifier: Apache-2.0

/**
 * The one error this package raises, and the guards that raise it.
 *
 * Validation happens **at construction**, once, at the boundary where an
 * untrusted number becomes a typed quantity — a decoded GATT payload, a field
 * read out of a FIT file, a value typed into a form. Past that point the type
 * is the evidence, so the conversions in this package do not re-check their
 * arguments. CLAUDE.md section 6: sensor data is untrusted input, and a
 * conversion that quietly propagates `NaN` or a negative magnitude produces a
 * ride summary that is wrong rather than an error that is visible.
 */

/**
 * Raised when a value offered to this package is not a quantity it can accept.
 *
 * One error class rather than one per unit: a caller decoding a sensor packet
 * wants to know that the packet was bad, and the message says which field and
 * why. Discriminating on the unit would push protocol knowledge into a package
 * that must not have any.
 */
export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

/**
 * `String(value)` for a message, without the `@typescript-eslint` complaint
 * about interpolating a non-string, and without `toString` on a value that may
 * not have one.
 */
function show(value: number): string {
  return String(value);
}

/**
 * Does this field label name a coordinate, in the sense of ADR 0004 decision D?
 *
 * **Derived from the label rather than declared at each call site**, so that a
 * coordinate quantity added later inherits the rule instead of depending on its
 * author having read this file. The alternative — an explicit list of the four
 * labels that exist today — is one a new quantity joins only if someone
 * remembers, and the failure mode of forgetting is a silent leak rather than a
 * red test.
 *
 * The cost is that the labels are load-bearing: a coordinate whose label says
 * neither "latitude" nor "longitude" is not covered by this. That is recorded
 * in `README.md` beside the validation table, which is where an author adding a
 * quantity is looking.
 *
 * Word-bounded, so a label that merely contains one of the words as a fragment
 * cannot match by accident.
 */
const COORDINATE_LABEL = /\b(?:latitude|longitude)\b/;

/**
 * The `, received X` clause of a message — **empty for a coordinate**.
 *
 * ADR 0004 decision D: when the quantity is a coordinate, a message may name
 * the field and the constraint and must not name the value. Every other
 * quantity keeps its value, because for a malformed GATT payload, a doubly
 * scaled FIT field or an out-of-epoch timestamp the offending number is most of
 * the diagnostic.
 *
 * The value is not secret from the caller — the caller passed it in. What this
 * prevents is the value continuing past the `throw` into a log line, a toast, a
 * crash report or a Phase 3 error body, none of which the throw site controls.
 * `614507218.4` semicircles is 51.5074°N to sub-centimetre precision, and the
 * range message leaks an *in-range, valid* coordinate whenever a transposed
 * field pair puts a longitude outside ±90° into the latitude guard.
 *
 * Applied on every branch of every guard rather than only on the two paths
 * #104 names, because a guard that redacts on one branch and echoes on the
 * others is one edit away from echoing on all of them. The bounds of the
 * constraint are not the caller's value and may still appear.
 */
function received(value: number, what: string): string {
  return COORDINATE_LABEL.test(what) ? '' : `, received ${show(value)}`;
}

/** Reject `NaN` and both infinities. Every guard below starts here. */
export function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new UnitError(`${what} must be a finite number${received(value, what)}`);
  }
}

/**
 * Reject a negative value for a quantity that is a magnitude.
 *
 * Not every quantity is one. Altitude is signed — the Dead Sea shore is about
 * -430 m — and a guard applied to it would reject real rides, which is why the
 * constructors choose this one individually rather than inheriting it.
 */
export function assertNotNegative(value: number, what: string): void {
  assertFinite(value, what);
  if (value < 0) {
    throw new UnitError(`${what} must not be negative${received(value, what)}`);
  }
}

/** Reject a value outside an inclusive range, for bounds that are definitional. */
export function assertInRange(value: number, min: number, max: number, what: string): void {
  assertFinite(value, what);
  if (value < min || value > max) {
    throw new UnitError(
      `${what} must be between ${show(min)} and ${show(max)}${received(value, what)}`,
    );
  }
}

/**
 * Reject anything that is not an integer in `[min, max]`.
 *
 * Used for the raw fields of a wire format — a `sint32` of semicircles, a
 * `uint16` of altitude, a `uint32` FIT timestamp. A non-integer there means the
 * caller has already scaled or averaged the field, and the conversion it is
 * about to apply would scale it twice.
 */
export function assertIntegerInRange(value: number, min: number, max: number, what: string): void {
  assertFinite(value, what);
  if (!Number.isInteger(value)) {
    throw new UnitError(`${what} must be a whole number${received(value, what)}`);
  }
  assertInRange(value, min, max, what);
}
