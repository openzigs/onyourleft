// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `MapPort` that records instead of rendering.
 *
 * Not a mock of MapLibre — it implements the seam in `port.ts`, so a test using
 * it exercises this client's own decisions: how many times the protocol is
 * registered, which style is built, and **what coordinate array the map is
 * handed**. That last one is #63's sixth criterion, which asks for the
 * assertion to be on the array rather than on what is drawn, so a recording
 * port is not a compromise here — it is the only place the criterion can be
 * checked at all.
 */

import type {
  MapPort,
  MapRenderer,
  MapView,
  MapViewOptions,
  ProtocolRegistrar,
  ProtocolRegistry,
} from './port';
import { createProtocolRegistry } from './protocol';
import type { TrackBounds, TrackFeature } from './track';

/** One map that was created, and everything that happened to it. */
export interface RecordedMap {
  readonly container: HTMLElement;
  readonly options: MapViewOptions;
  /** Every `setTrack`, in order. A map is created empty, so this is the whole history. */
  readonly tracks: (TrackFeature | undefined)[];
  readonly bounds: (TrackBounds | undefined)[];
  destroyed: boolean;
}

export interface StubMapPort extends MapPort {
  readonly created: RecordedMap[];
  /** Every `addProtocol` scheme, in order. Raw, beneath the registry's deduplication. */
  readonly added: string[];
  readonly removed: string[];
}

/**
 * A recording port.
 *
 * The registry inside is the **real** {@link createProtocolRegistry} over a
 * counting registrar, not a second implementation of it: a stub that
 * reimplemented the deduplication would pass #63's second criterion while the
 * shipping guard was missing.
 */
export function stubMapPort(): StubMapPort {
  const created: RecordedMap[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  const registrar: ProtocolRegistrar = {
    addProtocol(scheme: string): void {
      added.push(scheme);
    },
    removeProtocol(scheme: string): void {
      removed.push(scheme);
    },
  };

  const protocol: ProtocolRegistry = createProtocolRegistry(registrar, () => ({ stub: true }));

  const renderer: MapRenderer = {
    create(container: HTMLElement, options: MapViewOptions): MapView {
      const record: RecordedMap = {
        container,
        options,
        tracks: [],
        bounds: [],
        destroyed: false,
      };
      created.push(record);
      return {
        setTrack(track: TrackFeature | undefined, bounds: TrackBounds | undefined): void {
          record.tracks.push(track);
          record.bounds.push(bounds);
        },
        destroy(): void {
          record.destroyed = true;
        },
      };
    },
  };

  return { renderer, protocol, created, added, removed };
}

/**
 * Every coordinate anywhere in a recorded map's history.
 *
 * The *whole* history, which is usually not what a privacy assertion wants: a
 * map that correctly showed the owner their own track and then correctly
 * switched to the trimmed one has both in here, and the untrimmed points are in
 * it legitimately. Use {@link coordinatesNowOn} for "what is on the map now".
 */
export function everyCoordinateHandedTo(map: RecordedMap): readonly (readonly [number, number])[] {
  return map.tracks.flatMap((track) => track?.geometry.coordinates.flat() ?? []);
}

/**
 * The coordinates the map is currently showing — the most recent `setTrack`.
 *
 * This is the array #63's sixth criterion is about when the shared view is
 * open: what a published copy would contain is what the map has *now*, not
 * everything it has ever been given.
 */
export function coordinatesNowOn(map: RecordedMap): readonly (readonly [number, number])[] {
  return map.tracks.at(-1)?.geometry.coordinates.flat() ?? [];
}
