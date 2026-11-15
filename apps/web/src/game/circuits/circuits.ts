// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The built-in lap-race circuits, as the game rides them** — #2293,
 * ADR 0064.
 *
 * Each file under `data/` becomes a ridable route whose id is in the
 * `circuit:` namespace (`@onyourleft/store` §`circuitRouteId`), which no saved
 * route's id may carry. So a circuit is never a `RouteRecord`: it is not
 * saved, synced, exported or shared, and it is never a room's course (D-8.1,
 * D-8.2). The files are in the app bundle, each its own chunk loaded on first
 * use, so a race on one needs no instance and no network (D-8.3).
 *
 * `main.tsx` hands {@link loadBuiltInCircuits} to the game as
 * `GamePort.listCircuits`; a test hands a synthetic fixture circuit instead,
 * so no drawn test is a Produced Work of a real one (D-6.4).
 */

import { routeProfile, type AltitudeMetres, type GeographicPosition } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';

import type { RidableRoute } from '../StageChooser';
import { parseCircuitFile, type CircuitFile } from './circuit-file';

/** One loader per file under `data/`, by its path. */
export type CircuitLoaders = Readonly<Record<string, () => Promise<unknown>>>;

/**
 * The shipped files. Vite turns each into a chunk of its own, loaded only when
 * the game asks for the circuits; `import.meta.glob` is resolved at build time,
 * so nothing here is a request.
 */
const SHIPPED: CircuitLoaders = import.meta.glob('./data/*.json', { import: 'default' });

/** A checked file, as a ridable route: a loop, with no attempts, keyed `circuit:<id>`. */
export function circuitRoute(file: CircuitFile): RidableRoute {
  return {
    id: circuitRouteId(file.id),
    name: file.name,
    profile: routeProfile(
      file.points.map(([latitude, longitude, height]) => ({
        position: { latitude, longitude } as GeographicPosition,
        elevation: height as AltitudeMetres,
      })),
      { loop: true },
    ),
    attempts: 0,
  };
}

/** `./data/kestrel.json` → `kestrel`. */
function idOfPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

/**
 * Every circuit, shortest first. A file that does not read as a circuit is
 * left out and the rest are offered: `circuits.test.ts` holds every shipped
 * file to the format, so one can only fail here if the bundle is damaged, and
 * a rider then loses that circuit and not the others.
 */
export async function loadBuiltInCircuits(
  loaders: CircuitLoaders = SHIPPED,
): Promise<readonly RidableRoute[]> {
  const read = await Promise.all(
    Object.entries(loaders).map(async ([path, load]): Promise<RidableRoute | undefined> => {
      try {
        return circuitRoute(parseCircuitFile(await load(), idOfPath(path)));
      } catch {
        return undefined;
      }
    }),
  );
  return read
    .filter((route) => route !== undefined)
    .sort((a, b) => a.profile.totalDistance - b.profile.totalDistance);
}
