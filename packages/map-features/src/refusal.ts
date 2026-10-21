// SPDX-License-Identifier: Apache-2.0

import type { DecodeRefusal } from './types';

/**
 * A refusal, in words, for a log line or an error body (#1544).
 *
 * ⚠️ ADR 0004 D, and CLAUDE.md §6: a message about a location names the field
 * and the constraint and **never the value**. A tile's `x` and `y` are a
 * location — together they place the rider's route to within a kilometre — so
 * they are never in a message, and neither is any coordinate of any feature.
 * The refusal itself carries none, and this names only the layer (always one
 * of the four this package reads, never a name the tile supplied) and the
 * limit. The measured count or size is left out too: it is not a location,
 * but the message is safest when the only number in it is one this package
 * chose.
 */
export function describeRefusal(refusal: DecodeRefusal): string {
  switch (refusal.reason) {
    case 'too-large':
      return `Map tile refused: it is larger than the limit of ${String(refusal.limit)} bytes.`;
    case 'too-many-features':
      return `Map tile refused: layer "${refusal.layer}" has more features than the limit of ${String(refusal.limit)}.`;
    case 'too-many-vertices':
      return `Map tile refused: layer "${refusal.layer}" has more vertices than the limit of ${String(refusal.limit)}.`;
    case 'too-many-rings':
      return `Map tile refused: layer "${refusal.layer}" has a polygon with more rings than the limit of ${String(refusal.limit)}.`;
    case 'malformed':
      return refusal.layer === null
        ? 'Map tile refused: it is not a well-formed vector tile.'
        : `Map tile refused: layer "${refusal.layer}" is not well-formed.`;
    case 'wrong-schema':
      return 'Map tile refused: it is not a tile of the Protomaps basemap schema this reads.';
  }
}
