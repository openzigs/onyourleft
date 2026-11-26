// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GRID_LINES, ISLAND_ORIGIN, syntheticGridPbf, syntheticNetwork } from './synthetic-grid';

/**
 * The SHA-256 of the `.osm.pbf` the committed graph in `browser/valhalla-grid/`
 * was built from, as ASSETS.toml records it for both tiles (`inputsha256`).
 */
const BUILT_FROM = 'ea1c2dfa5581aa59640953258c1673f10bfd95ba2263eed8f09d3f6d917545ce';

describe('the synthetic road grid off Null Island (#2734)', () => {
  it('writes the bytes the committed graph was built from', () => {
    expect(createHash('sha256').update(syntheticGridPbf()).digest('hex')).toBe(BUILT_FROM);
  });

  it('is a grid of streets and an unconnected square, all in open sea beside Null Island', () => {
    const { nodes, ways } = syntheticNetwork();
    expect(nodes).toHaveLength(GRID_LINES * GRID_LINES + 9);
    expect(ways).toHaveLength(GRID_LINES * 2 + 6);
    for (const node of nodes) {
      expect(Math.abs(node.latitude)).toBeLessThan(0.25);
      expect(Math.abs(node.longitude)).toBeLessThan(0.25);
    }
    // No street of the square shares a node with the grid: a leg between them has no road.
    const grid = new Set(ways.filter((way) => way.id < 100_000).flatMap((way) => way.refs));
    const island = ways.filter((way) => way.id >= 100_000).flatMap((way) => way.refs);
    expect(island.some((node) => grid.has(node))).toBe(false);
    expect(ISLAND_ORIGIN.longitude).toBeGreaterThan(0.05 + (GRID_LINES - 1) * 0.005);
  });

  it('opens as a PBF file does: a length, then an OSMHeader blob', () => {
    const bytes = syntheticGridPbf();
    const headerLength = bytes.readUInt32BE(0);
    expect(bytes.subarray(4, 4 + headerLength).toString('latin1')).toContain('OSMHeader');
  });
});
