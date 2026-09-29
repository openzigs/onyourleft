// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one public projection of an athlete** (#774): every representation of
 * an athlete that leaves this instance for ANOTHER rider is built here, and
 * nowhere else.
 *
 * ADR 0028 D-6.5: *"A display name is rider-chosen, unverified, and shown.
 * Nothing else about a rider is — not their mass (D-3), not their location,
 * not their other rides."* So the projection is the display name and the id
 * that names the athlete to the routes, and nothing else. A room's live frames
 * carry neither mass nor watts (`@onyourleft/protocol`), and a race publishes
 * power-to-weight over a window and never power beside it (ADR 0028's
 * 2026-09-22 amendment, Q4/Q5) — that publication is #785's, and has no field
 * to put a mass in here.
 *
 * ## A new column is private until somebody says otherwise
 *
 * {@link ATHLETE_COLUMNS} classifies every column of the `athlete` table, and
 * `public-athlete.test.ts` reads the columns from the MIGRATED database and
 * fails when one is missing from this record. So a later migration that adds
 * a mass, an email or a birth year to `athlete` fails the build until it is
 * classified — it cannot reach another rider by default, because the
 * projection below names its fields rather than spreading the row.
 */

import type { Athlete } from '../store/sql-store.ts';

/** What other riders see in place of a name a moderator hid (#83): `identity.ts`'s default. */
export const HIDDEN_DISPLAY_NAME = 'Rider';

export type ColumnClass = 'public' | 'private';

/** Every column of the `athlete` table, and whether another rider may see it. */
export const ATHLETE_COLUMNS: Readonly<Record<string, ColumnClass>> = {
  id: 'public',
  display_name: 'public',
  created_at: 'private',
  registration_state: 'private',
  // Moderation (#83): other riders see the EFFECT of a hidden name, never the flag.
  suspended_at: 'private',
  display_name_hidden_at: 'private',
  // #775: a confirmation's date, never a birth date, and nobody else's business.
  adult_confirmed_at: 'private',
};

/** What another rider may see of an athlete. */
export interface PublicAthlete {
  readonly athleteId: string;
  readonly displayName: string;
}

/**
 * The projection. Named fields only: a row is never spread into a response. A
 * name a moderator hid (#83) is shown as {@link HIDDEN_DISPLAY_NAME}.
 */
export function publicAthlete(
  athlete: Athlete & { readonly displayNameHiddenAt?: number | null },
): PublicAthlete {
  const hidden = athlete.displayNameHiddenAt !== undefined && athlete.displayNameHiddenAt !== null;
  return {
    athleteId: athlete.id,
    displayName: hidden ? HIDDEN_DISPLAY_NAME : athlete.displayName,
  };
}
