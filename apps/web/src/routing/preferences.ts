// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider chose, and how an engine would hear it —
 * [#70](https://github.com/openzigs/onyourleft/issues/70).
 *
 * #70's fourth criterion: *"bicycle costing parameters are exposed as named
 * product options, not raw engine numbers, and the mapping is documented.
 * `use_hills: 0.25` is meaningless in a UI."*
 *
 * ⚠️ **The mapping is a table here rather than code in an adapter, because
 * there is no adapter yet and this table is the thing that would be wrong
 * if there were.** ADR 0010 D-4 chose Valhalla and read its API reference on
 * 2026-09-03; the numbers below are that read, and nothing in this repository
 * has ever sent one to a running engine. They are recorded so the adapter
 * #53 unblocks starts from a decision rather than from a guess:
 *
 * | This program | Valhalla `costing_options.bicycle` | Source |
 * |---|---|---|
 * | `bicycle` | `bicycle_type` — the same five words | ADR 0010 D-4 |
 * | `hills: 'avoid'` | `use_hills: 0.0` | ADR 0010 D-4 (`use_hills` 0–1, default 0.25) |
 * | `hills: 'neutral'` | `use_hills: 0.25` — the engine's own default | ADR 0010 D-4 |
 * | `hills: 'seek'` | `use_hills: 1.0` | ADR 0010 D-4 |
 * | `surface: 'any'` | `avoid_bad_surfaces: 0.0` | ADR 0010 D-4 (0–1, default 0.25) |
 * | `surface: 'prefer-paved'` | `avoid_bad_surfaces: 0.25` | ADR 0010 D-4 |
 * | `surface: 'paved-only'` | `avoid_bad_surfaces: 1.0` — **strands unpaved endpoints** | ADR 0010 D-4 |
 *
 * ⚠️ **That last row is the one with a defect attached to it.** At `1.0` the
 * engine disallows bad surfaces *including at the endpoints*, so a rider whose
 * own driveway is gravel gets no route and no reason. #70 requires the client
 * to refuse the setting or fall back visibly — *"a silent no-route is the
 * failure being prevented"* — which is why {@link RoutingErrorCode}
 * `'unpaved-endpoint'` exists as its own code and {@link strandingRisk} is
 * asked before the setting is offered rather than after it fails.
 */

import type { RidingPreferences, SurfaceTolerance } from '@onyourleft/domain';

/**
 * What a rider gets before they choose anything.
 *
 * `'prefer-paved'` rather than `'paved-only'`, and that is a safety default in
 * the ordinary sense: the strict setting is the one that can strand somebody at
 * their own front door, so it is a thing a rider turns on knowingly.
 */
export const RIDING_DEFAULTS: RidingPreferences = {
  bicycle: 'road',
  hills: 'neutral',
  surface: 'prefer-paved',
};

/** How each option reads on screen. Words, because the numbers above are not for a rider. */
export const SURFACE_LABELS: Readonly<Record<SurfaceTolerance, string>> = {
  'paved-only': 'Paved roads only',
  'prefer-paved': 'Prefer paved roads',
  any: 'Any surface',
};

/**
 * What to warn about before a rider picks `'paved-only'`.
 *
 * `undefined` when there is nothing to say. The words name the failure rather
 * than the setting, because "avoid bad surfaces is set to 1.0" is the sentence
 * #70 exists to prevent.
 */
export function strandingRisk(surface: SurfaceTolerance): string | undefined {
  return surface === 'paved-only'
    ? 'Paved-only routing refuses a route that starts or ends on an unpaved surface — including your own driveway or track. If no route comes back, this is the first setting to relax.'
    : undefined;
}
