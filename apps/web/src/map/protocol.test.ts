// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #63's second acceptance criterion, at the unit that owns it.
 *
 * *"`addProtocol` is registered exactly once for the application lifetime; a
 * test mounts and unmounts the map view three times and asserts the
 * registration count is one and that `removeProtocol` ran on teardown. The
 * failure prevented: duplicate protocol handlers leaking on every navigation."*
 *
 * The mount-three-times half is in `MapPanel.test.tsx`, where there is a
 * component to mount. What is here is the property that makes it true: the
 * registry deduplicates, so the guarantee holds wherever `ensure()` is called
 * from rather than depending on nobody moving the call.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ProtocolRegistrar } from './port';
import { createProtocolRegistry, PMTILES_SCHEME } from './protocol';

function countingRegistrar(): ProtocolRegistrar & {
  readonly added: string[];
  readonly removed: string[];
} {
  const added: string[] = [];
  const removed: string[] = [];
  return {
    added,
    removed,
    addProtocol: (scheme) => added.push(scheme),
    removeProtocol: (scheme) => removed.push(scheme),
  };
}

describe('createProtocolRegistry — once per application lifetime', () => {
  it('registers on the first ensure and never again', () => {
    const registrar = countingRegistrar();
    const registry = createProtocolRegistry(registrar, () => 'handler');
    registry.ensure();
    registry.ensure();
    registry.ensure();
    expect(registry.registrations).toBe(1);
    expect(registrar.added).toEqual([PMTILES_SCHEME]);
  });

  it('registers the pmtiles scheme, which is what the style URLs select', () => {
    const registrar = countingRegistrar();
    createProtocolRegistry(registrar, () => 'handler').ensure();
    expect(registrar.added).toEqual(['pmtiles']);
  });

  it('builds the handler lazily, and only once', () => {
    // A thunk because constructing the PMTiles `Protocol` allocates a tile
    // cache. A build that never shows a map should never pay for one.
    const build = vi.fn(() => 'handler');
    const registry = createProtocolRegistry(countingRegistrar(), build);
    expect(build).not.toHaveBeenCalled();
    registry.ensure();
    registry.ensure();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('removes on release, and only when something was registered', () => {
    const registrar = countingRegistrar();
    const registry = createProtocolRegistry(registrar, () => 'handler');
    registry.release();
    expect(registry.removals).toBe(0);
    expect(registrar.removed).toEqual([]);

    registry.ensure();
    registry.release();
    registry.release();
    expect(registry.removals).toBe(1);
    expect(registrar.removed).toEqual([PMTILES_SCHEME]);
  });

  it('registers again after a release, because the handler really is gone', () => {
    // Not a counter that latches. After teardown the scheme is unregistered, so
    // a later `ensure` has to put it back — a registry that refused would leave
    // a second application lifetime with no handler and a blank map.
    const registrar = countingRegistrar();
    const registry = createProtocolRegistry(registrar, () => 'handler');
    registry.ensure();
    registry.release();
    registry.ensure();
    expect(registry.registrations).toBe(2);
    expect(registrar.added).toEqual([PMTILES_SCHEME, PMTILES_SCHEME]);
  });

  it('counts calls rather than keeping a flag, which is what makes the criterion assertable', () => {
    // With a boolean, "registered once" and "registered five times and four
    // were no-ops" are the same observable state. The criterion asks for a
    // count; this is the test that would fail if it became a flag again.
    const registry = createProtocolRegistry(countingRegistrar(), () => 'handler');
    expect(registry.registrations).toBe(0);
    registry.ensure();
    expect(registry.registrations).toBe(1);
  });
});
