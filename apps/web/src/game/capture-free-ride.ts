// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Free ride in capture mode — #3154, epic #3151.
 *
 * ## The start
 *
 * A rider's free ride starts where the picker's pin, route or ride put it
 * (`open-world/entry.ts`). A capture's starts where the capture command says,
 * `--start <lat>,<lon>`, which the capture tool writes into the game's address
 * as `start=` beside `capture=` ({@link captureOpenWorldStart}). Read only for
 * a scene that rides the open world, and only in the capture tool's build
 * (`capture-scene.ts` §`captureSceneFromHash`), so a link carrying it opens
 * nothing anywhere else. No start is kept in this repository: the command
 * names one, and the tests name the open world's invented fixture block.
 *
 * ## No real street or place names on screen — the owner's rule of 2026-11-24
 *
 * The open world paints each street's name on its road and names each way in
 * the junction prompt, both from the basemap (#3052). On a capture each is
 * shown by a placeholder from {@link CAPTURE_STREET_NAMES} in its place
 * ({@link captureStreetName}), through the session's one source of names
 * (`open-world/session.ts` §`renamedStreets`), so neither the video nor the
 * page carries the map's. The minimap draws lines and no names. A placeholder
 * is chosen from the street's own name, so a street keeps one placeholder
 * however often it is read; two streets may share one, which a viewer cannot
 * tell from two streets of one name.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';

import { captureSceneFromHash } from './capture-scene';
import { openWorldStart, type OpenWorldStart } from './open-world/start';

/**
 * The names a capture shows streets by: invented, and none of them the
 * street it stands for. Words of trees and birds, which read as street names
 * and say nothing of where the street is.
 */
export const CAPTURE_STREET_NAMES: readonly string[] = [
  'Alder Way',
  'Birch Lane',
  'Rowan Road',
  'Heron Street',
  'Willow Row',
  'Linnet Close',
  'Hazel Avenue',
  'Kestrel Drive',
  'Juniper Way',
  'Wren Lane',
  'Larch Road',
  'Plover Street',
];

/**
 * The name `name` is shown by on a capture: one of {@link CAPTURE_STREET_NAMES},
 * the same one every time for the same name.
 */
export function captureStreetName(name: string): string {
  let hash = 0;
  for (const unit of name) hash = (hash * 31 + (unit.codePointAt(0) ?? 0)) >>> 0;
  return CAPTURE_STREET_NAMES[hash % CAPTURE_STREET_NAMES.length] as string;
}

/** The query of a `#/…?…` fragment, or `undefined` with none. */
function queryOf(hash: string): URLSearchParams | undefined {
  const query = /^[^?]*\?([^#]*)/.exec(hash)?.[1];
  return query === undefined ? undefined : new URLSearchParams(query);
}

/**
 * The free ride's start the capture command named, as the picker makes one
 * from a pin; `undefined` unless the fragment names a scene that rides the
 * open world and a `start=<lat>,<lon>` the map covers.
 */
export function captureOpenWorldStart(hash: string): OpenWorldStart | undefined {
  if (captureSceneFromHash(hash)?.openWorld !== true) return undefined;
  const text = queryOf(hash)?.get('start');
  const parts = text?.split(',');
  if (parts?.length !== 2) return undefined;
  const [latitude, longitude] = parts.map(Number) as [number, number];
  let position;
  try {
    position = geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
  } catch {
    return undefined;
  }
  const outcome = openWorldStart(position, 'pin');
  return outcome.kind === 'start' ? outcome.start : undefined;
}
