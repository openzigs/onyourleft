// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `demo/index.html?…` may ask for — #1647.
 *
 * | Parameter | What | Values |
 * |---|---|---|
 * | `preset` | which preset is ridden (`presets.ts`) | `climb`, `sprint`, `group`; default `climb` |
 * | `route` | a baked route's map data and road, read from `routes/` (#1652, `baked-route.ts`) | a route id `demo:bake` wrote; absent rides the synthetic road |
 *
 * ⚠️ **Unknown parameters and values are REFUSED**, with a sentence the page
 * shows, as `browser/realistic/config.ts` refuses them: an embedding site that
 * wrote `?preset=sprnt` would otherwise get the climb and never know its link
 * was wrong.
 */

import { ROUTE_ID } from '../../tools/demo/route-bundle';
import { DEMO_PRESETS } from './presets';
import type { DemoPreset } from './script';

/** The parameters the page understands. */
const KNOWN = new Set(['preset', 'route']);

/** What a query asks for, or why it is refused. */
export type DemoQuery =
  | {
      readonly ok: true;
      readonly preset: DemoPreset;
      /** The baked route asked for, if any: an id in `bake-route.ts`' shape, not yet known to exist. */
      readonly route?: string;
    }
  | { readonly ok: false; readonly message: string };

/** Read `search` — `location.search`, with or without its `?`. */
export function parseDemoQuery(search: string): DemoQuery {
  const params = new URLSearchParams(search);
  for (const key of new Set(params.keys())) {
    if (!KNOWN.has(key)) {
      return { ok: false, message: `This demo has no setting called “${key}”.` };
    }
    if (params.getAll(key).length > 1) {
      return { ok: false, message: `This demo’s “${key}” setting is given more than once.` };
    }
  }
  const asked = params.get('preset') ?? 'climb';
  const preset = DEMO_PRESETS.find((each) => each.id === asked);
  if (preset === undefined) {
    const names = DEMO_PRESETS.map((each) => each.id).join(', ');
    return { ok: false, message: `This demo’s preset is one of ${names}, not “${asked}”.` };
  }
  const route = params.get('route');
  if (route === null) return { ok: true, preset };
  if (!ROUTE_ID.test(route)) {
    return { ok: false, message: `This demo has no route called “${route}”.` };
  }
  return { ok: true, preset, route };
}
