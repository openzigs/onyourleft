// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `demo/index.html?…` may ask for — #1647.
 *
 * | Parameter | What | Values |
 * |---|---|---|
 * | `preset` | which preset is ridden (`presets.ts`) | `climb`, `sprint`, `group`; default `climb` |
 * | `route` | a baked route's map data and road, read from `routes/` (#1652, `baked-route.ts`) | a route id `demo:bake` wrote; absent rides the synthetic road |
 * | `showcase` | the feature-showcase timeline (#1653, `showcase.ts`), ridden by the `group` preset | present, with no value; `preset`, if given, must be `group` |
 * | `autoplay` | whether the demo starts moving on load (#1654) | `1` (default) or `0`: a still frame and a *Play* button, as reduced motion gives |
 * | `controls` | whether the HUD's *Play* and *Stop* are shown (#1654) | `1` (default) or `0`; shown anyway while the demo starts still |
 * | `units` | the HUD's units (#1654) | `metric` (default) or `imperial` |
 *
 * Each of the last three is in the query only when it is not the default, as
 * `showcase` is only when present, so a link that names a default reads the
 * same as one that leaves it out.
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
const KNOWN = new Set(['preset', 'route', 'showcase', 'autoplay', 'controls', 'units']);

/** A switch's two values — #1654. */
const SWITCH = ['0', '1'] as const;

/**
 * The units the HUD can show — #1654; `metric` is the default. Written out
 * rather than imported: `@onyourleft/store`'s `UnitSystem` is the same two, and
 * the demo imports nothing from the store (`no-recorded-data.test.ts`).
 */
const UNITS = ['metric', 'imperial'] as const;

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
      /** #1654: `?autoplay=0`, the demo starts on a still frame. */
      readonly autoplay?: false;
      /** #1654: `?controls=0`, the HUD's *Play* and *Stop* are hidden while it moves. */
      readonly controls?: false;
      /** #1654: `?units=imperial`. */
      readonly units?: 'imperial';
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
  for (const key of ['autoplay', 'controls'] as const) {
    const value = params.get(key);
    if (value !== null && !SWITCH.includes(value as (typeof SWITCH)[number])) {
      return { ok: false, message: `This demo’s “${key}” setting is 0 or 1, not “${value}”.` };
    }
  }
  const units = params.get('units');
  if (units !== null && !UNITS.includes(units as (typeof UNITS)[number])) {
    return {
      ok: false,
      message: `This demo’s units are one of ${UNITS.join(', ')}, not “${units}”.`,
    };
  }
  return {
    ok: true,
    preset,
    ...(route === null ? {} : { route }),
    ...(showcase === null ? {} : { showcase: true as const }),
    ...(params.get('autoplay') === '0' ? { autoplay: false as const } : {}),
    ...(params.get('controls') === '0' ? { controls: false as const } : {}),
    ...(units === 'imperial' ? { units: 'imperial' as const } : {}),
  };
}
