// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's baked route file: its format, and its reader — #1651, ADR 0056.
 *
 * ## The format (ADR 0056 D-2.3: "a documented binary with its decoder published beside it")
 *
 * A `<id>.<digest>.bin` is **gzip (RFC 1952) over UTF-8 JSON**, one object,
 * {@link RouteBundle}:
 *
 * - `format` and `version`: {@link ROUTE_BUNDLE_FORMAT}, {@link ROUTE_BUNDLE_VERSION};
 * - the licence, in the file itself (D-3.2, ODbL §4.2 b): `licence`
 *   (`ODbL-1.0`), `licenceUrl`, `notice` (ODbL §4.3 a's example sentence),
 *   and `source` — OpenStreetMap contributors, their copyright page, and the
 *   archive the records were read from, by URL and identity;
 * - `readerVersion`: `game/world-data/corridor.ts` §`CORRIDOR_READER_VERSION`,
 *   so a reader change is a visible re-bake;
 * - `route`: the GPX's points as `[latitude, longitude, elevation]` in degrees
 *   and metres, `elevation` `null` where the GPX had no `<ele>` (D-7.1), and
 *   the GPX's own licence, `CC0-1.0` (D-7.5). Nothing else of the GPX;
 * - `tiles`: how many z15 tiles the read planned, and the plan index and state
 *   of each one that is NOT covered. **No tile coordinate** (D-2.1): the plan
 *   is `corridor.ts` §`planCorridor` of the route's line, so a reader recomputes
 *   it;
 * - `features`: `corridor.ts` §`packedCorridorFeatures` — the very value the
 *   rider's store gzips (`v: 3` since #1632 added the place points; every
 *   coordinate an integer number of centimetres in the corridor frame, whose
 *   origin is the route's first
 *   point, `x` metres WEST and `z` metres north). No OSM id, no name, no
 *   address: the decoder never keeps them (ADR 0054 D-2.2).
 *
 * The gzip header is the store's (`corridor.ts` §`gzipBytes`): no time and an
 * "unknown" OS byte, so the file is the same bytes on any machine.
 *
 * ⚠️ **No timestamp, anywhere** (D-7.2): {@link timestampFields} reads the
 * written value back and the bake refuses a file it finds one in. The check is
 * on the output, not assumed from the code that builds it.
 *
 * This module names no network primitive and imports nothing that does, so
 * the demo's loader (#1652) may use {@link readRouteBundle} as it is.
 */

import {
  corridorFeaturesOfPacked,
  gunzipBytes,
  gzipBytes,
  type CorridorFeatures,
  type PackedCorridorFeatures,
} from '../../src/game/world-data/corridor';
import { ODBL_LICENCE_URL, ODBL_NOTICE } from '../../src/map/basemap';

/** What the file says it is. */
export const ROUTE_BUNDLE_FORMAT = 'onyourleft-demo-route';

/** Bumped when the shape of {@link RouteBundle} changes. */
export const ROUTE_BUNDLE_VERSION = 1;

/**
 * A route id: it becomes a file name, so nothing that could leave the
 * directory. Here rather than in `bake-route.ts`, which re-exports it, so the
 * demo's loader (#1652) refuses the same ids the bake does.
 */
export const ROUTE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** OpenStreetMap's copyright and licence page: the source credited with the data (ADR 0056 D-3.2). */
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/** The GPX's own licence (ADR 0056 D-7.5, accepted as D-10 Q2). */
export const ROUTE_LINE_LICENCE = 'CC0-1.0';

/** One point of the route's line: degrees, degrees, metres or `null`. */
export type RoutePointTuple = readonly [number, number, number | null];

/** A tile of the plan that holds no map data, and why, by its index in the plan. */
export interface UncoveredTile {
  readonly index: number;
  readonly state: 'privacy-zone' | 'over-cap' | 'outside-archive' | 'refused';
}

/** The whole file, decompressed. */
export interface RouteBundle {
  readonly format: typeof ROUTE_BUNDLE_FORMAT;
  readonly version: typeof ROUTE_BUNDLE_VERSION;
  readonly licence: 'ODbL-1.0';
  readonly licenceUrl: string;
  readonly notice: string;
  readonly source: {
    readonly name: 'OpenStreetMap contributors';
    readonly url: string;
    readonly archiveUrl: string;
    readonly archiveIdentity: string;
  };
  readonly readerVersion: number;
  readonly route: {
    readonly licence: typeof ROUTE_LINE_LICENCE;
    readonly points: readonly RoutePointTuple[];
  };
  readonly tiles: { readonly planned: number; readonly uncovered: readonly UncoveredTile[] };
  readonly features: PackedCorridorFeatures;
}

/** The licence fields every bundle carries. */
export function bundleLicence(): Pick<RouteBundle, 'licence' | 'licenceUrl' | 'notice'> {
  return { licence: 'ODbL-1.0', licenceUrl: ODBL_LICENCE_URL, notice: ODBL_NOTICE };
}

const TIMESTAMP_KEY = /time|date|stamp|^when$/i;
/** An ISO 8601 date or date-time, the shape a GPX's `<time>` has. */
const TIMESTAMP_TEXT = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/;

/**
 * Every place in `value` that looks like a timestamp: a key named for a time
 * or a date, or a string in ISO 8601's shape. Each is named by its path of
 * keys and indexes, and **never by its value** (ADR 0004 D): a value next to
 * a coordinate could be one.
 */
export function timestampFields(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') return TIMESTAMP_TEXT.test(value) ? [path] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) =>
      timestampFields(item, `${path}[${String(index)}]`),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(TIMESTAMP_KEY.test(key) ? [`${path}.${key}`] : []),
      ...timestampFields(item, `${path}.${key}`),
    ]);
  }
  return [];
}

/** Every route point that is not `[latitude, longitude, elevation]`, by its path. */
export function pointsWithMore(points: readonly unknown[]): string[] {
  return points.flatMap((point, index) => {
    const ok =
      Array.isArray(point) &&
      point.length === 3 &&
      typeof point[0] === 'number' &&
      typeof point[1] === 'number' &&
      (typeof point[2] === 'number' || point[2] === null);
    return ok ? [] : [`$.route.points[${String(index)}]`];
  });
}

/**
 * The file's bytes. Throws, naming the field, if a timestamp is found in what
 * would be written — read back from the JSON text, as a reader would see it.
 */
export async function encodeRouteBundle(bundle: RouteBundle): Promise<Uint8Array<ArrayBuffer>> {
  const text = JSON.stringify(bundle);
  const written = JSON.parse(text) as RouteBundle;
  // A time as a number — a GPX's instant in Unix seconds — has no shape to
  // find, so a point is held to its three numbers as well.
  const found = [...timestampFields(written), ...pointsWithMore(written.route.points)];
  if (found.length > 0) {
    throw new Error(
      `demo:bake: a timestamp would be published in the route file, at ${found.join(', ')}. ` +
        'Only latitude, longitude and elevation may leave the GPX (ADR 0056 D-7.2).',
    );
  }
  return gzipBytes(new TextEncoder().encode(text));
}

/** The JSON text inside a file. */
export async function routeBundleText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new TextDecoder().decode(await gunzipBytes(bytes));
}

/** A file read back: its value, and the features as the renderer takes them. */
export async function readRouteBundle(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ readonly bundle: RouteBundle; readonly features: CorridorFeatures }> {
  const bundle = JSON.parse(await routeBundleText(bytes)) as RouteBundle;
  if (bundle.format !== ROUTE_BUNDLE_FORMAT || bundle.version !== ROUTE_BUNDLE_VERSION) {
    throw new Error('demo route file: not a format or version this reads');
  }
  return { bundle, features: corridorFeaturesOfPacked(bundle.features) };
}

/** The notice file's text: ODbL §4.2 b and d, §4.3 a, and §4.6 a's offer. */
export function odblNoticeText(): string {
  return [
    'On Your Left demo: map data for the preset routes',
    '',
    `${ODBL_NOTICE}`,
    '',
    `  OpenStreetMap:          ${OSM_COPYRIGHT_URL}`,
    `  Open Database License:  ${ODBL_LICENCE_URL}`,
    '',
    '© OpenStreetMap contributors.',
    '',
    'Each *.bin file in this directory is a database derived from OpenStreetMap, made',
    'available under the Open Database License 1.0 (ODbL-1.0). The file is the entire',
    'derived database (ODbL section 4.6 a); you may copy it from here.',
    '',
    'Format: gzip over UTF-8 JSON. Its fields are documented in',
    'apps/web/tools/demo/route-bundle.ts in the On Your Left source, which also reads it.',
    `The route's line and elevations in each file are published under ${ROUTE_LINE_LICENCE}.`,
    '',
    'The program that shows them is AGPL-3.0-or-later; the ODbL governs the data only.',
    '',
  ].join('\n');
}
