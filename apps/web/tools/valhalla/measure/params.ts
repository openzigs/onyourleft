// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement page's query string (#2320).
 *
 * ```text
 * ?manifest=https://…/<release>/manifest.json
 * &pair=5:LAT,LON,LAT,LON&pair=40:LAT,LON,LAT,LON&pair=150:LAT,LON,LAT,LON
 * [&runs=1] [&budgetMiB=128] [&timeoutS=120] [&dragM=250]
 * ```
 *
 * Each `pair` is a length class in kilometres and two end points the
 * maintainer picked on roads: the page has no coordinate of its own, and
 * nothing here is a fixture of one.
 *
 * ⚠️ **An error names the parameter and the constraint, never the value**
 * (ADR 0004 decision D): a coordinate typed wrong must not come back in a
 * message the maintainer may paste into an issue.
 */

/** A latitude and longitude in degrees, the SDK's `Coordinates`. */
export interface Point {
  readonly lat: number;
  readonly lon: number;
}

/** One end-point pair and the length class it stands for. */
export interface Pair {
  readonly targetKm: number;
  readonly origin: Point;
  readonly destination: Point;
}

/** Everything a measurement run needs. */
export interface MeasureConfig {
  readonly manifestUrl: string;
  readonly pairs: readonly Pair[];
  readonly runs: number;
  readonly budgetBytes: number;
  readonly timeoutMs: number;
  readonly dragMetres: number;
}

/** A query-string problem. Its message names the parameter only. */
export class MeasureParamError extends Error {
  override readonly name = 'MeasureParamError';
}

const MIB = 1024 * 1024;

/** The SDK's decoded-tile budget is 1 KiB to 128 MiB; 128 MiB is spike 0035's figure for a 150 km route. */
export const DEFAULT_BUDGET_MIB = 128;
export const DEFAULT_TIMEOUT_S = 120;
export const DEFAULT_DRAG_M = 250;

function integerIn(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value) || value < min || value > max) {
    throw new MeasureParamError(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function degrees(raw: string | undefined, what: string, limit: number): number {
  const value = Number(raw);
  if (
    raw === undefined ||
    raw.trim() === '' ||
    !Number.isFinite(value) ||
    Math.abs(value) > limit
  ) {
    throw new MeasureParamError(`${what} must be a number from -${limit} to ${limit}`);
  }
  return value;
}

function parsePair(raw: string, position: number): Pair {
  const where = `pair ${position}`;
  const colon = raw.indexOf(':');
  if (colon === -1) throw new MeasureParamError(`${where} must be KM:LAT,LON,LAT,LON`);
  const targetKm = Number(raw.slice(0, colon));
  if (!Number.isFinite(targetKm) || targetKm <= 0 || targetKm > 1000) {
    throw new MeasureParamError(
      `${where}: its length class must be a number of kilometres from 0 to 1000`,
    );
  }
  const parts = raw.slice(colon + 1).split(',');
  if (parts.length !== 4) throw new MeasureParamError(`${where} must be KM:LAT,LON,LAT,LON`);
  return {
    targetKm,
    origin: {
      lat: degrees(parts[0], `${where}: the origin's latitude`, 90),
      lon: degrees(parts[1], `${where}: the origin's longitude`, 180),
    },
    destination: {
      lat: degrees(parts[2], `${where}: the destination's latitude`, 90),
      lon: degrees(parts[3], `${where}: the destination's longitude`, 180),
    },
  };
}

/** Reads `search` (a `location.search`), resolving a relative manifest URL against `base`. */
export function parseMeasureParams(search: string, base: string): MeasureConfig {
  const params = new URLSearchParams(search);
  const manifest = params.get('manifest');
  if (manifest === null || manifest.trim() === '')
    throw new MeasureParamError('manifest is required');
  let url: URL;
  try {
    url = new URL(manifest, base);
  } catch {
    throw new MeasureParamError('manifest must be a URL');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !url.pathname.endsWith('/manifest.json')
  ) {
    throw new MeasureParamError(
      'manifest must be an http(s) URL ending in /<release>/manifest.json',
    );
  }
  const pairs = params.getAll('pair').map((raw, at) => parsePair(raw, at + 1));
  if (pairs.length === 0) throw new MeasureParamError('at least one pair is required');
  if (pairs.length > 12) throw new MeasureParamError('at most 12 pairs are measured at once');
  return {
    manifestUrl: url.href,
    pairs,
    runs: integerIn(params, 'runs', 1, 1, 10),
    budgetBytes: integerIn(params, 'budgetMiB', DEFAULT_BUDGET_MIB, 1, 128) * MIB,
    timeoutMs: integerIn(params, 'timeoutS', DEFAULT_TIMEOUT_S, 1, 600) * 1000,
    dragMetres: integerIn(params, 'dragM', DEFAULT_DRAG_M, 10, 5000),
  };
}
