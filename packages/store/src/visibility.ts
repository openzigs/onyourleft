// SPDX-License-Identifier: Apache-2.0

/**
 * Activity visibility — ADR 0004 decision A.
 *
 * Three values, exactly, and **`private` is the default**. The ADR phrases this
 * as `visibility NOT NULL DEFAULT 'private'`, which is SQL for a store that is
 * not SQL. The intent translates cleanly and is what this file implements:
 *
 * - the field is **always present** on a stored activity, never `undefined`;
 * - an activity created without one is `private`;
 * - a value outside these three is rejected rather than coerced.
 *
 * That third point is why `parseVisibility` throws instead of falling back.
 * Silently coercing an unrecognised value to `private` would be safe for this
 * record and would hide the corruption for every other field on it.
 *
 * The field exists in schema version 1 even though Phase 1 has nothing that
 * reads it (there is no server, no feed and no sharing until Phase 3). ADR 0004
 * gives the reason: a column added later is a migration over every row an
 * athlete already owns, and — worse — a **default chosen later is a default
 * chosen for data that already exists**.
 */

import { StoreValidationError } from './errors';

/**
 * | Value | Meaning |
 * |---|---|
 * | `private` | The owning athlete only. **The default.** |
 * | `followers` | Athletes the owner has approved. Inert until #79. |
 * | `public` | Anyone, including logged-out readers and other instances. |
 */
export type Visibility = 'private' | 'followers' | 'public';

/** Every permitted value, in the order ADR 0004 tabulates them. */
export const VISIBILITIES: readonly Visibility[] = ['private', 'followers', 'public'];

/**
 * The default for an activity created without an explicit choice.
 *
 * ADR 0004 decision A, chosen by the repository owner: "We choose the empty
 * feed." The two failures are not equally reversible — an empty feed is one
 * athlete action away from fixed, a published ride from a front door has
 * already been fetched, cached and indexed.
 */
export const DEFAULT_VISIBILITY: Visibility = 'private';

/** @throws {StoreValidationError} if `value` is not one of the three. */
export function parseVisibility(value: unknown): Visibility {
  if (typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value)) {
    return value as Visibility;
  }
  throw new StoreValidationError(
    `visibility must be one of ${VISIBILITIES.join(', ')}, received ${describe(value)}`,
  );
}

/**
 * Describes a rejected value without echoing an unbounded one.
 *
 * The value came off disk and is therefore whatever is on disk. Interpolating
 * it whole puts an arbitrary stored payload into an error string that reaches a
 * console, a crash report and a bug tracker — which is the narrow leak ADR 0004
 * decision D is about. Forty characters is enough to recognise a typo in an
 * enum and not enough to carry a track.
 */
function describe(value: unknown): string {
  const rendered = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return rendered.length <= 40 ? rendered : `${rendered.slice(0, 40)}… (truncated)`;
}
