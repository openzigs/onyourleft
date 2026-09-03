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

/** Reject `NaN` and both infinities. Every guard below starts here. */
export function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new UnitError(`${what} must be a finite number, received ${show(value)}`);
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
    throw new UnitError(`${what} must not be negative, received ${show(value)}`);
  }
}

/** Reject a value outside an inclusive range, for bounds that are definitional. */
export function assertInRange(value: number, min: number, max: number, what: string): void {
  assertFinite(value, what);
  if (value < min || value > max) {
    throw new UnitError(
      `${what} must be between ${show(min)} and ${show(max)}, received ${show(value)}`,
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
    throw new UnitError(`${what} must be a whole number, received ${show(value)}`);
  }
  assertInRange(value, min, max, what);
}
