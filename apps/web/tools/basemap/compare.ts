// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Compares this project's archive with another, tile by tile (#1557).
 *
 * Two uses, one walk:
 *
 * - **Against upstream's unmodified profile on the same extract** (`build.sh
 *   --compare`). Every layer must then be identical, feature for feature and
 *   byte for byte of geometry, once the building fields are taken off the z15
 *   `buildings` features. Any `differingTiles` is a defect.
 * - **Against a Protomaps daily build** of a different day. The OSM data
 *   differs, so features will; what must match is the schema — the same
 *   layers, and in each, the same keys apart from the building fields.
 *
 * It also reads every z15 tile of both through the client's own decoder
 * (`decodeTile`, the call `src/game/world-data/corridor.ts` makes), and checks
 * each building field's value against `building-fields.ts`'s rules.
 *
 * The summary is counts and key names. It never holds a tag's value or a
 * coordinate, so it can be pasted into an issue (ADR 0004 D).
 */

import { decodeTile } from '@onyourleft/map-features';
import { admits, buildingFieldRules } from './building-fields';
import { readTile, type MvtFeature, type MvtLayer } from './mvt';

export interface TileId {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface LayerTally {
  /** Tiles where this layer is present on at least one side. */
  tiles: number;
  featuresOurs: number;
  featuresTheirs: number;
  /** Tiles where this layer differs once the building fields are removed. */
  differingTiles: number;
  keysOurs: Set<string>;
  keysTheirs: Set<string>;
}

export interface Summary {
  tiles: number;
  tilesOnlyOurs: number;
  tilesOnlyTheirs: number;
  malformedOurs: number;
  malformedTheirs: number;
  layers: Map<string, LayerTally>;
  /** z15 `buildings` polygons in our archive. */
  z15Buildings: number;
  /** Of those, how many carry each field. */
  fieldFill: Map<string, number>;
  /** A field's value its rule refuses, or a field below z15 or outside `buildings`. */
  fieldViolations: number;
  /** Uncompressed tile bytes, all zooms. */
  rawBytesOurs: number;
  rawBytesTheirs: number;
  /** Uncompressed z15 tile bytes. */
  z15RawBytesOurs: number;
  z15RawBytesTheirs: number;
  decoder: {
    tiles: number;
    refusedOurs: number;
    refusedTheirs: number;
    buildingsOurs: number;
    buildingsTheirs: number;
    /** z15 tiles whose decoded buildings differ in count or height between the two. */
    disagreeingTiles: number;
  };
}

export function emptySummary(): Summary {
  return {
    tiles: 0,
    tilesOnlyOurs: 0,
    tilesOnlyTheirs: 0,
    malformedOurs: 0,
    malformedTheirs: 0,
    layers: new Map(),
    z15Buildings: 0,
    fieldFill: new Map(),
    fieldViolations: 0,
    rawBytesOurs: 0,
    rawBytesTheirs: 0,
    z15RawBytesOurs: 0,
    z15RawBytesTheirs: 0,
    decoder: {
      tiles: 0,
      refusedOurs: 0,
      refusedTheirs: 0,
      buildingsOurs: 0,
      buildingsTheirs: 0,
      disagreeingTiles: 0,
    },
  };
}

const BUILDINGS = 'buildings';
const POLYGON = 3;

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** A feature as one comparable string, with the named keys left out. Held in memory only. */
function canonical(feature: MvtFeature, without: ReadonlySet<string>): string {
  const tags = [...feature.tags]
    .filter(([key]) => !without.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${typeof value}:${String(value)}`);
  return `${feature.id ?? ''}|${feature.type}|${hex(feature.geometry)}|${tags.join('\u0000')}`;
}

function sameLayer(
  ours: MvtLayer | undefined,
  theirs: MvtLayer | undefined,
  without: ReadonlySet<string>,
): boolean {
  if (!ours || !theirs) return false;
  if (ours.extent !== theirs.extent || ours.features.length !== theirs.features.length)
    return false;
  return ours.features.every(
    (feature, i) => canonical(feature, without) === canonical(theirs.features[i]!, without),
  );
}

function tally(summary: Summary, name: string): LayerTally {
  let layer = summary.layers.get(name);
  if (!layer) {
    layer = {
      tiles: 0,
      featuresOurs: 0,
      featuresTheirs: 0,
      differingTiles: 0,
      keysOurs: new Set(),
      keysTheirs: new Set(),
    };
    summary.layers.set(name, layer);
  }
  return layer;
}

function parse(bytes: Uint8Array): MvtLayer[] | null {
  try {
    return readTile(bytes);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) return null;
    throw error;
  }
}

function tileCentre(tile: TileId): { latitude: number; longitude: number } {
  const n = 2 ** tile.z;
  const longitude = ((tile.x + 0.5) / n) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 0.5)) / n))) * 180) / Math.PI;
  return { latitude, longitude };
}

/**
 * Adds one tile's comparison to the summary. `null` is a tile the archive does
 * not have. `buildYear` bounds `start_year`.
 */
export function compareTile(
  summary: Summary,
  tile: TileId,
  ours: Uint8Array | null,
  theirs: Uint8Array | null,
  buildYear: number,
): void {
  if (!ours && !theirs) return;
  summary.tiles++;
  if (!theirs) summary.tilesOnlyOurs++;
  if (!ours) summary.tilesOnlyTheirs++;
  summary.rawBytesOurs += ours?.length ?? 0;
  summary.rawBytesTheirs += theirs?.length ?? 0;
  if (tile.z === 15) {
    summary.z15RawBytesOurs += ours?.length ?? 0;
    summary.z15RawBytesTheirs += theirs?.length ?? 0;
  }

  const rules = buildingFieldRules(buildYear);
  const fieldKeys = new Set(rules.keys());
  const oursLayers = ours ? parse(ours) : [];
  const theirsLayers = theirs ? parse(theirs) : [];
  if (oursLayers === null) summary.malformedOurs++;
  if (theirsLayers === null) summary.malformedTheirs++;
  if (oursLayers === null || theirsLayers === null) return;

  const oursByName = new Map(oursLayers.map((layer) => [layer.name, layer]));
  const theirsByName = new Map(theirsLayers.map((layer) => [layer.name, layer]));
  for (const name of new Set([...oursByName.keys(), ...theirsByName.keys()])) {
    const layer = tally(summary, name);
    const a = oursByName.get(name);
    const b = theirsByName.get(name);
    layer.tiles++;
    layer.featuresOurs += a?.features.length ?? 0;
    layer.featuresTheirs += b?.features.length ?? 0;
    for (const feature of a?.features ?? [])
      for (const key of feature.tags.keys()) layer.keysOurs.add(key);
    for (const feature of b?.features ?? [])
      for (const key of feature.tags.keys()) layer.keysTheirs.add(key);
    // Only z15 buildings may carry the fields, so only there are they set aside.
    const without = name === BUILDINGS && tile.z === 15 ? fieldKeys : new Set<string>();
    if (!sameLayer(a, b, without)) layer.differingTiles++;
  }

  for (const layer of oursLayers) {
    for (const feature of layer.features) {
      const isZ15Building = layer.name === BUILDINGS && tile.z === 15 && feature.type === POLYGON;
      if (isZ15Building) summary.z15Buildings++;
      for (const [key, value] of feature.tags) {
        const rule = rules.get(key);
        if (!rule) continue;
        if (!isZ15Building || !admits(rule, value)) {
          summary.fieldViolations++;
          continue;
        }
        summary.fieldFill.set(key, (summary.fieldFill.get(key) ?? 0) + 1);
      }
    }
  }

  if (tile.z === 15) decodeBoth(summary, { z: 15, x: tile.x, y: tile.y }, ours, theirs);
}

function decodeBoth(
  summary: Summary,
  tile: TileId & { readonly z: 15 },
  ours: Uint8Array | null,
  theirs: Uint8Array | null,
): void {
  const frame = tileCentre(tile);
  const a = ours ? decodeTile(ours, tile, frame) : null;
  const b = theirs ? decodeTile(theirs, tile, frame) : null;
  summary.decoder.tiles++;
  const aBuildings = a && 'buildings' in a ? a.buildings : null;
  const bBuildings = b && 'buildings' in b ? b.buildings : null;
  if (a && !aBuildings) summary.decoder.refusedOurs++;
  if (b && !bBuildings) summary.decoder.refusedTheirs++;
  summary.decoder.buildingsOurs += aBuildings?.length ?? 0;
  summary.decoder.buildingsTheirs += bBuildings?.length ?? 0;
  const heights = (list: typeof aBuildings): string =>
    (list ?? [])
      .map((building) => `${building.kind}:${building.heightMetres}:${building.minHeightMetres}`)
      .join(',');
  if (heights(aBuildings) !== heights(bBuildings)) summary.decoder.disagreeingTiles++;
}

/**
 * Whether a strict pair passed: identical once the fields are removed, every
 * field admitted, and the client's decoder refusing as many tiles of one as of
 * the other. A tile refused on one side only, where the other decodes no
 * buildings, compares as no disagreement, so the refusal counts are checked too.
 */
export function strictPasses(summary: Summary): boolean {
  return (
    summary.tilesOnlyOurs === 0 &&
    summary.tilesOnlyTheirs === 0 &&
    summary.malformedOurs === 0 &&
    summary.malformedTheirs === 0 &&
    summary.fieldViolations === 0 &&
    summary.decoder.disagreeingTiles === 0 &&
    summary.decoder.refusedOurs === summary.decoder.refusedTheirs &&
    [...summary.layers.values()].every((layer) => layer.differingTiles === 0)
  );
}

/** The part of a PMTiles header that says how much of the world an archive covers. */
export interface CoverageHeader {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
  readonly numAddressedTiles: number;
}

export interface Coverage {
  readonly bounds: readonly [number, number, number, number];
  readonly addressedTiles: number;
}

/**
 * What each archive claims to cover, side by side (#1557's review): the first
 * US build addressed 368 848 915 tiles against the old file's 21 635 078 and
 * bounds of the whole northern hemisphere's land and ocean, and nothing in the
 * report said so until the tiles outside the US turned up bare on the tablet.
 * `ratio` is ours over theirs; a build clipped to the same outline is near 1.
 */
export function describeCoverage(
  ours: CoverageHeader,
  theirs: CoverageHeader,
): { ours: Coverage; theirs: Coverage; addressedTilesRatio: number | null } {
  const of = (h: CoverageHeader): Coverage => ({
    bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
    addressedTiles: h.numAddressedTiles,
  });
  return {
    ours: of(ours),
    theirs: of(theirs),
    addressedTilesRatio:
      theirs.numAddressedTiles > 0 ? ours.numAddressedTiles / theirs.numAddressedTiles : null,
  };
}
