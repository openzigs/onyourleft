// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The boundaries where data leaves the athlete's control, and the one property
 * every one of them has to have.
 *
 * [#34](https://github.com/openzigs/onyourleft/issues/34)'s revision block is
 * what this file exists for:
 *
 * > **Owner decision D6 changes where obfuscation happens.** This issue
 * > requires coordinate truncation in the API response body. Correct for an
 * > instance — but per #21 the rule is broader: **obfuscation applies at every
 * > boundary where data leaves the athlete's control**, which also includes a
 * > shared route, a segment effort, a leaderboard row and a file export.
 * > Naming only the API response misses four of them.
 *
 * There is no API response here (owner decision D6), so the boundaries that
 * exist are the local ones — and they are the ones that ship today, which makes
 * them the ones worth checking.
 *
 * ## Two directions, and the second is the one an audit gets wrong
 *
 * A sweep that trimmed coordinates everywhere would be a *worse* product and a
 * failed acceptance criterion. #35 states the other half:
 *
 * > Export returns the athlete's **true, unobfuscated** track data for their
 * > own activities — privacy zones protect the user from others, not from
 * > themselves.
 *
 * So a boundary is one of two kinds, and this file requires each to be
 * declared:
 *
 * - **`departing`** — the payload is for somebody else. No coordinate anywhere
 *   in it may lie inside a privacy zone.
 * - **`retained`** — the payload is the athlete's own data coming back to them.
 *   The true coordinates **must** still be there; a trim here is the bug.
 *
 * Getting the kind wrong is caught either way round: a `departing` boundary
 * that stops trimming fails, and a `retained` one that starts trimming fails.
 *
 * ## Why the check walks the payload instead of reading its fields
 *
 * `detail/privacy.ts` already trims the track it emits, and `privacy.test.ts`
 * already asserts that. What neither can assert is that **no other field**
 * carries a coordinate — a bounding box added for a map fit, a `startsAt`
 * position added for a preview pin, a centroid added for a thumbnail. Each of
 * those is a plausible, useful field, and each would hand over the location the
 * trim exists to withhold while every existing assertion stayed green.
 *
 * So {@link coordinatesIn} walks the whole structure and collects **every**
 * position it can find, wherever it sits. A field added tomorrow is covered
 * without anybody remembering this file exists.
 */

import { distanceBetween, type GeographicPosition } from '@onyourleft/domain';
import type { PrivacyZoneRecord } from '@onyourleft/store';

import { trimRadius } from '../detail/privacy';

/**
 * Every geographic position anywhere inside `value`, with the path it was found
 * at so a failure names the field rather than the count.
 *
 * A position is any object carrying finite numeric `latitude` and `longitude`.
 * That is the shape `@onyourleft/domain` uses everywhere, and matching on the
 * shape rather than on a declared type is the point: a payload that grows a new
 * field of that shape is caught without this file being edited.
 *
 * ⚠️ **A bare `[longitude, latitude]` pair is not recognised**, and cannot be:
 * a two-number array is indistinguishable from a duration pair, a bounding
 * index range or a size. If a boundary ever emits GeoJSON-shaped coordinates
 * this function needs a case for it, and the test that says so is the one
 * asserting a known-inside point is found at all.
 */
export function coordinatesIn(value: unknown, path = '$'): readonly CoordinateAt[] {
  const found: CoordinateAt[] = [];
  // ⚠️ **The ancestors on the current path, not everything already visited.**
  // A `WeakSet` of every node seen would stop a cycle *and* silently skip the
  // second appearance of a shared object — and a payload that carries the same
  // position instance in two fields is normal, not pathological. Deduping it
  // would report one path and hide the other, which for an audit whose output
  // is "where is the leak" is the wrong answer. This guard blocks only a node
  // that is its own ancestor, which is exactly a cycle.
  const ancestors = new Set<object>();

  const walk = (node: unknown, at: string): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (ancestors.has(node)) {
      return;
    }
    ancestors.add(node);
    try {
      visit(node, at);
    } finally {
      ancestors.delete(node);
    }
  };

  const visit = (node: object, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, `${at}[${String(index)}]`);
      });
      return;
    }

    const record = node as Record<string, unknown>;
    const { latitude, longitude } = record;
    if (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      found.push({ path: at, position: node as unknown as GeographicPosition });
      // Deliberately no `return`: a position may carry nested structure, and a
      // walker that stopped here would miss a coordinate hanging off one.
    }

    for (const [key, child] of Object.entries(record)) {
      walk(child, `${at}.${key}`);
    }
  };

  walk(value, path);
  return found;
}

/** One position found in a payload, and where in it. */
export interface CoordinateAt {
  readonly path: string;
  readonly position: GeographicPosition;
}

/**
 * Positions inside `zone`'s **jittered** trim radius for `id`.
 *
 * The nominal radius is the wrong bound and using it would make this check
 * disagree with the code it audits. `trimRadius` draws deterministically from
 * ±{@link TRIM_JITTER_FRACTION}, so a point between `0.875·r` and `r` may
 * legitimately survive — see ADR 0004 decision B and `detail/privacy.ts`.
 */
export function insideZone(
  positions: readonly CoordinateAt[],
  zone: PrivacyZoneRecord,
  id: string,
): readonly CoordinateAt[] {
  const radius = trimRadius(zone.radius, id, zone.id);
  return positions.filter((each) => distanceBetween(each.position, zone.centre) < radius);
}
