// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `demo/index.html?…` may ask for — #1647.
 *
 * | Parameter | What | Values |
 * |---|---|---|
 * | `preset` | which preset is ridden (`presets.ts`) | `climb`, `sprint`, `group`; default `climb` |
 * | `route` | a baked route's map data and road, read from `routes/` (#1652, `baked-route.ts`) | a route id `demo:bake` wrote; absent rides the synthetic road |
 * | `showcase` | the feature-showcase timeline (#1653, `showcase.ts`), ridden by the `group` preset | present, with no value; `preset`, if given, must be `group` |
 * | `render` | the video render's stepped clock (#1655, `tools/demo/render-video.ts`): the page moves only when the render steps it | present, with no value |
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
const KNOWN = new Set(['preset', 'route', 'showcase', 'render']);

/** The preset the showcase is ridden by: its last moment is a group (#1653). */
export const SHOWCASE_PRESET_ID = 'group';

/** What a query asks for, or why it is refused. */
export type DemoQuery =
  | {
      readonly ok: true;
      readonly preset: DemoPreset;
      /** The baked route asked for, if any: an id in `bake-route.ts`' shape, not yet known to exist. */
      readonly route?: string;
      /** #1653: whether the showcase timeline runs. */
      readonly showcase?: true;
      /** #1655: the video render drives the page's clock (`render-clock.ts`). */
      readonly render?: true;
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
  const render = params.get('render');
  if (render !== null && render !== '') {
    return { ok: false, message: `This demo’s “render” setting takes no value, not “${render}”.` };
  }
  const showcase = params.get('showcase');
  if (showcase !== null && showcase !== '') {
    return {
      ok: false,
      message: `This demo’s “showcase” setting takes no value, not “${showcase}”.`,
    };
  }
  if (showcase !== null && (params.get('preset') ?? SHOWCASE_PRESET_ID) !== SHOWCASE_PRESET_ID) {
    return {
      ok: false,
      message: `This demo’s showcase is ridden by the ${SHOWCASE_PRESET_ID} preset.`,
    };
  }
  const asked = params.get('preset') ?? (showcase === null ? 'climb' : SHOWCASE_PRESET_ID);
  const preset = DEMO_PRESETS.find((each) => each.id === asked);
  if (preset === undefined) {
    const names = DEMO_PRESETS.map((each) => each.id).join(', ');
    return { ok: false, message: `This demo’s preset is one of ${names}, not “${asked}”.` };
  }
  const route = params.get('route');
  if (route !== null && !ROUTE_ID.test(route)) {
    return { ok: false, message: `This demo has no route called “${route}”.` };
  }
  return {
    ok: true,
    preset,
    ...(route === null ? {} : { route }),
    ...(showcase === null ? {} : { showcase: true as const }),
    ...(render === null ? {} : { render: true as const }),
  };
}
