// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #63's first, second and fourth acceptance criteria, at the component.
 *
 * - **Criterion 1** — a ride with no GPS renders no map and no broken tile grid.
 * - **Criterion 2** — the mount-three-times half: the registration count is one
 *   across three mounts, and `removeProtocol` runs on application teardown.
 * - **Criterion 4** — the OpenStreetMap attribution is in the DOM, legible,
 *   beside the map, and visible without interaction.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { OSM_ATTRIBUTION, type BasemapConfig } from './basemap';
import { MapPanel } from './MapPanel';
import { stubMapPort, type StubMapPort } from './testing';
import { trackGeometry, type TrackGeometry } from './track';
import type { TrackSegment } from '../detail/privacy';

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';

const BASEMAP: BasemapConfig = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function segment(...points: readonly (readonly [number, number])[]): TrackSegment {
  return {
    points: points.map(([latitude, longitude], index) => ({
      index,
      position: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
    })),
  };
}

function aTrack(): TrackGeometry {
  return trackGeometry([segment([51.5, -0.1], [51.51, -0.1])]) as TrackGeometry;
}

describe('criterion 1 — no GPS means no map, not an empty one', () => {
  it('renders nothing at all when there is no track', async () => {
    const port = stubMapPort();
    mounted = await mount(<MapPanel port={port} basemap={BASEMAP} track={undefined} />);
    await settle();
    expect(mounted.container.innerHTML).toBe('');
    // And no map was created, so nothing would have fetched a tile either.
    expect(port.created).toHaveLength(0);
  });

  it('does not even register the protocol for a ride with no track', async () => {
    const port = stubMapPort();
    mounted = await mount(<MapPanel port={port} basemap={BASEMAP} track={undefined} />);
    await settle();
    expect(port.protocol.registrations).toBe(0);
  });
});

describe('the states where there is a track but no map', () => {
  it('says so when the browser has no renderer, rather than leaving a hole', async () => {
    mounted = await mount(<MapPanel port={undefined} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    expect(document.body.textContent).toContain('cannot draw a map');
    expect(queryAll(document, '.oyl-map')).toHaveLength(0);
  });

  it('says so when no basemap is configured, which is every build until #53 lands', async () => {
    const port = stubMapPort();
    mounted = await mount(<MapPanel port={port} basemap={undefined} track={aTrack()} />);
    await settle();
    expect(document.body.textContent).toContain('No basemap is configured');
    expect(port.created).toHaveLength(0);
  });

  it('tells the rider their track is stored either way, so the message is not alarming', async () => {
    mounted = await mount(<MapPanel port={stubMapPort()} basemap={undefined} track={aTrack()} />);
    await settle();
    expect(document.body.textContent).toContain('stored on this device');
  });
});

describe('criterion 4 — the OpenStreetMap attribution is a licence obligation', () => {
  it('renders the credit as ordinary text beside the map', async () => {
    const port = stubMapPort();
    mounted = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    const credit = document.querySelector('.oyl-map__attribution');
    expect(credit?.textContent).toBe('© OpenStreetMap contributors');
  });

  it('is visible without interaction — not inside a details, a dialog or a button', async () => {
    mounted = await mount(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    const credit = document.querySelector('.oyl-map__attribution');
    expect(credit).not.toBeNull();
    for (let node = credit?.parentElement ?? null; node !== null; node = node.parentElement) {
      expect(['DETAILS', 'DIALOG', 'BUTTON', 'SUMMARY']).not.toContain(node.tagName);
      expect(node.getAttribute('aria-hidden')).not.toBe('true');
      expect(node.hasAttribute('hidden')).toBe(false);
    }
  });

  it('sits in the vicinity of the map, immediately after it', async () => {
    mounted = await mount(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    const map = document.querySelector('.oyl-map');
    expect(map?.nextElementSibling?.className).toBe('oyl-map__attribution');
  });

  it('appears whenever a map does, in the same render', async () => {
    // The failure this guards: a map that renders while the credit is behind a
    // condition that happens to be false. They are one branch or the obligation
    // is conditional.
    mounted = await mount(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    expect(queryAll(document, '.oyl-map')).toHaveLength(1);
    expect(queryAll(document, '.oyl-map__attribution')).toHaveLength(1);
  });
});

describe('criterion 2 — registered once for the application lifetime', () => {
  it('registers once across three mounts and unmounts of the map view', async () => {
    // The criterion verbatim. The failure prevented is duplicate protocol
    // handlers leaking on every navigation.
    const port: StubMapPort = stubMapPort();
    for (let round = 0; round < 3; round += 1) {
      const view = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
      await settle();
      view.unmount();
    }
    expect(port.protocol.registrations).toBe(1);
    expect(port.added).toEqual(['pmtiles']);
  });

  it('does not remove the handler on a route change, only on teardown', async () => {
    // A component that released on unmount would rebuild the PMTiles client on
    // every navigation back to a ride, discarding the archive header and root
    // directory it had already fetched — a range request per navigation against
    // a store ADR 0010 already warns is high-latency.
    const port = stubMapPort();
    const view = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    view.unmount();
    expect(port.removed).toEqual([]);

    // Application teardown is what releases it.
    port.protocol.release();
    expect(port.removed).toEqual(['pmtiles']);
    expect(port.protocol.removals).toBe(1);
  });

  it('destroys the map it created when the view goes away', async () => {
    const port = stubMapPort();
    const view = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    expect(port.created[0]?.destroyed).toBe(false);
    view.unmount();
    expect(port.created[0]?.destroyed).toBe(true);
  });
});

describe('what the map is handed', () => {
  it('gets the style built from the configured archive, and nothing else', async () => {
    const port = stubMapPort();
    mounted = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    const source = port.created[0]?.options.style.sources.basemap;
    expect(source?.url).toBe('pmtiles://https://tiles.example.org/basemap.pmtiles');
  });

  it('gets the track as a Feature and a bounding box fitted to it', async () => {
    // Through `setTrack`, not through `create`: a map is created empty and the
    // line is set, so there is one code path geometry reaches a map by.
    const port = stubMapPort();
    mounted = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
    await settle();
    expect(port.created[0]?.tracks.at(-1)?.geometry.coordinates).toHaveLength(1);
    expect(port.created[0]?.bounds.at(-1)).toEqual({
      west: -0.1,
      south: 51.5,
      east: -0.1,
      north: 51.51,
    });
  });

  it('swaps the line without rebuilding the map, which would refetch every tile', async () => {
    // The shared-view toggle changes the geometry. Rebuilding the map to do it
    // would blank the basemap and refetch its tiles from an archive ADR 0010
    // warns is high-latency — a visible stall on a button press.
    const port = stubMapPort();
    const view = await mount(<MapPanel port={port} basemap={BASEMAP} track={aTrack()} />);
    mounted = view;
    await settle();
    expect(port.created).toHaveLength(1);

    const other = trackGeometry([segment([52.5, -1.9], [52.51, -1.9])]) as TrackGeometry;
    await view.rerender(<MapPanel port={port} basemap={BASEMAP} track={other} />);
    await settle();

    expect(port.created).toHaveLength(1);
    expect(port.created[0]?.destroyed).toBe(false);
    expect(port.created[0]?.tracks.at(-1)?.geometry.coordinates[0]?.[0]).toEqual([-1.9, 52.5]);
  });

  it('is named for assistive technology without naming a place — ADR 0004 decision D', async () => {
    const port = stubMapPort();
    const twoParts = trackGeometry([
      segment([51.5, -0.1], [51.51, -0.1]),
      segment([51.6, -0.1], [51.61, -0.1]),
    ]) as TrackGeometry;
    mounted = await mount(<MapPanel port={port} basemap={BASEMAP} track={twoParts} />);
    await settle();
    const label = document.querySelector('.oyl-map')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('2 separate parts');
    // No coordinate, and no place name. The label says how the track is shaped,
    // never where it is.
    expect(label).not.toMatch(/\d+\.\d{3}/);
  });
});
