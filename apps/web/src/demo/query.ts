// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `demo/index.html?…` may ask for — #1647.
 *
 * | Parameter | What | Values |
 * |---|---|---|
 * | `preset` | which preset is ridden (`presets.ts`) | `climb`, `sprint`, `group`; default `climb` |
 *
 * ⚠️ **Unknown parameters and values are REFUSED**, with a sentence the page
 * shows, as `browser/realistic/config.ts` refuses them: an embedding site that
 * wrote `?preset=sprnt` would otherwise get the climb and never know its link
 * was wrong.
 */

import { DEMO_PRESETS } from './presets';
import type { DemoPreset } from './script';

/** The parameters the page understands. */
const KNOWN = new Set(['preset']);

/** What a query asks for, or why it is refused. */
export type DemoQuery =
  | { readonly ok: true; readonly preset: DemoPreset }
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
  return { ok: true, preset };
}
