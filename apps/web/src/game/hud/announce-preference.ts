// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider has asked to hear, and where that is kept — #397, deciding
 * per #395.
 *
 * ## Off by default
 *
 * Nothing speaks until a rider turns it on: an unasked-for live region
 * interrupts (`design/StatusMessage.tsx`), and WCAG 2.2 SC 2.2.2 (Level A)
 * requires the rider to control auto-updating information — which is also why
 * every row has **never**, and a frequency the rider picks.
 *
 * ## On the DEVICE, not the athlete row — #395's decision
 *
 * Assistive technology is a property of the machine a rider is sitting at: a
 * rider may use TalkBack on the tablet on the bars and nothing on a laptop. So
 * this is `localStorage`, the `routing/draft-storage.ts` precedent, and
 * **no schema change** — `packages/store` is untouched. ⚠️ The cost, stated:
 * it does not travel with the account export (#35). If that turns out to
 * matter, an OPTIONAL field on `AthleteRecord` needs no migration
 * (`packages/store/README.md` §"An optional field is not a migration").
 *
 * ⚠️ **Every access is wrapped.** A private window, blocked site data or a
 * full store must render the DEFAULTS rather than take the ride screen down —
 * and a stored value this build does not recognise is a default too, one field
 * at a time, rather than a thrown `JSON.parse`.
 */

import { METRES_PER_FOOT, METRES_PER_MILE } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { distanceUnit, formatSmallDistance, measurementText } from '../../units/format';

/** A choice that also admits "never" — WCAG 2.2 SC 2.2.2's off switch, per row. */
export type Every = number | 'never';

export interface AnnouncementPreference {
  /** The master switch. `false` until the rider turns it on. */
  readonly enabled: boolean;
  /** How often power is said, in seconds. */
  readonly powerEverySeconds: Every;
  /** How often the distance to go is said, in the rider's own distance unit. */
  readonly distanceEvery: Every;
  /** How long before a workout's block changes it is said, in seconds (#398). */
  readonly intervalLeadSeconds: Every;
  /**
   * How far ahead of a climb or a descent it is said, in METRES along the road
   * (#399). Metres rather than the rider's unit because the choices are road
   * lengths a rider judges by eye, and `SettingsView` labels each one in their
   * own unit through `units/format.ts`.
   */
  readonly climbLeadMetres: Every;
}

/** #395's table: every row's default, and the whole feature off. */
export const DEFAULT_ANNOUNCEMENTS: AnnouncementPreference = {
  enabled: false,
  powerEverySeconds: 60,
  distanceEvery: 1,
  intervalLeadSeconds: 10,
  climbLeadMetres: 250,
};

/** #395: 15 s to 5 min. */
export const POWER_EVERY_CHOICES: readonly number[] = [15, 30, 60, 120, 300];
/** #395: 0.5 to 10, in the rider's own unit. */
export const DISTANCE_EVERY_CHOICES: readonly number[] = [0.5, 1, 2, 5, 10];
/** #395 / #398: 5 to 30 s ahead. */
export const INTERVAL_LEAD_CHOICES: readonly number[] = [5, 10, 15, 30];

/** #399: a street's length to a kilometre ahead. The metric steps, in metres. */
export const CLIMB_LEAD_CHOICES: readonly number[] = [100, 250, 500, 1000];

/**
 * #1440: the imperial steps — 500 ft, 1000 ft, a quarter and a half mile — in
 * metres, because that is what the preference stores and the game reads.
 * Until #1440 an imperial rider was offered the metric steps converted digit
 * for digit: 328, 820, 1640 and 3281 ft.
 */
export const CLIMB_LEAD_CHOICES_IMPERIAL: readonly number[] = [
  500 * METRES_PER_FOOT,
  1000 * METRES_PER_FOOT,
  0.25 * METRES_PER_MILE,
  0.5 * METRES_PER_MILE,
];

/** The climb-ahead steps a rider in `units` is offered, in metres — #1440. */
export function climbLeadChoices(units: UnitSystem): readonly number[] {
  return units === 'imperial' ? CLIMB_LEAD_CHOICES_IMPERIAL : CLIMB_LEAD_CHOICES;
}

/**
 * The stored climb lead as a step of `units` — #1440: a choice saved in one
 * system is the nearest step in the other (250 m is 1000 ft; 0.5 mi is 1000 m),
 * so Settings shows a step it offers and the game announces at that step.
 */
export function climbLeadIn(stored: Every, units: UnitSystem): Every {
  if (stored === 'never') return 'never';
  const choices = climbLeadChoices(units);
  return choices.reduce((nearest, step) =>
    Math.abs(step - stored) < Math.abs(nearest - stored) ? step : nearest,
  );
}

/**
 * A climb-ahead step as a rider reads it — #1440: `100 m`, `500 ft`, `0.25 mi`.
 * The quarter and half mile are said in miles, which is how they are judged.
 */
export function climbLeadText(metres: number, units: UnitSystem): string {
  if (units === 'imperial' && metres >= 0.25 * METRES_PER_MILE) {
    return `${String(Math.round((metres / METRES_PER_MILE) * 100) / 100)} ${distanceUnit(units)}`;
  }
  return measurementText(formatSmallDistance(metres, units));
}

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const ANNOUNCEMENTS_STORAGE_KEY = 'oyl.announcements.v1';

/** The two things this module asks of a `Storage`, so a test can hand it a double. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The device's own storage, or `undefined` where reaching for it throws —
 * which a sandboxed or privacy-hardened browser does on the property access
 * itself, not only on a read.
 */
export function deviceStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function chosen(value: unknown, choices: readonly number[], fallback: Every): Every {
  if (value === 'never') return 'never';
  return typeof value === 'number' && choices.includes(value) ? value : fallback;
}

/** What this device has stored, or the defaults — field by field. Never throws. */
export function readAnnouncementPreference(
  storage: PreferenceStorage | undefined,
): AnnouncementPreference {
  let raw: unknown;
  try {
    const text = storage?.getItem(ANNOUNCEMENTS_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_ANNOUNCEMENTS;
  }
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_ANNOUNCEMENTS;
  }
  const row = raw as Record<string, unknown>;
  return {
    enabled: row['enabled'] === true,
    powerEverySeconds: chosen(
      row['powerEverySeconds'],
      POWER_EVERY_CHOICES,
      DEFAULT_ANNOUNCEMENTS.powerEverySeconds,
    ),
    distanceEvery: chosen(
      row['distanceEvery'],
      DISTANCE_EVERY_CHOICES,
      DEFAULT_ANNOUNCEMENTS.distanceEvery,
    ),
    intervalLeadSeconds: chosen(
      row['intervalLeadSeconds'],
      INTERVAL_LEAD_CHOICES,
      DEFAULT_ANNOUNCEMENTS.intervalLeadSeconds,
    ),
    // A row stored before #399 has no such key and reads as the default, one
    // field at a time — no version bump, because nothing already stored changes
    // meaning.
    // #1440: a step of either system is a choice; `climbLeadIn` maps it to
    // the rider's own where it is shown and used.
    climbLeadMetres: chosen(
      row['climbLeadMetres'],
      [...CLIMB_LEAD_CHOICES, ...CLIMB_LEAD_CHOICES_IMPERIAL],
      DEFAULT_ANNOUNCEMENTS.climbLeadMetres,
    ),
  };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeAnnouncementPreference(
  storage: PreferenceStorage | undefined,
  preference: AnnouncementPreference,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(ANNOUNCEMENTS_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}
