// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of the ride HUD's panels a rider shows, and how large its numbers are
 * — #2079. Kept on this device, under its own key, and read as a ride starts
 * (`GameView.tsx`), so a choice made in Settings is the next ride's.
 *
 * ## What may be hidden, and what may not
 *
 * Four panels, by name ({@link HUD_PANELS}): the **secondary readings**, the
 * **route panel** (the elevation strip and the plan), the **recent graph**
 * (#2078) and a race's **standings**. ⚠️ **Never the primary readings, the
 * ride controls or the notices**, and there is no key here that could name
 * them: the notices cell is where the HUD's safety sentences stand (an eased
 * workout target, a recording that may stop with the screen off —
 * `a11y/kept-visible.a11y.test.tsx` §`GAME_RIDING_KEPT_VISIBLE`), and a
 * rider who has hidden everything they may still sees every one of them.
 *
 * ## The text size
 *
 * Normal, large and extra large ({@link HUD_TEXT_SIZES}): a factor on the
 * HUD's VALUES — the numbers a rider reads — and not on its labels or its
 * controls, which `theme.css` §"THE HUD'S TEXT SIZE" applies where the layout
 * has room for it.
 *
 * ## The arrangement — #2383
 *
 * Full or focus ({@link HUD_ARRANGEMENTS}). **Full** is every reading in its
 * two tiers, as it always was, and is the default. **Focus** is one compact
 * readout at the top: power, cadence and heart rate large, and the speed, the
 * average power, the distance and the ride's time (#2382) smaller under them
 * (`focus-readout.ts`). The route panel, the controls and the notices are the
 * same in both. A ride with a mode of its own — a room, a Delivery round or a
 * lap race — keeps the full arrangement whatever is chosen, because its
 * layout is fitted around the two tiers (`HudCore` `isModeReading`).
 *
 * ## The route panel — #2385
 *
 * Full or compact ({@link HUD_ROUTE_VIEWS}). **Full** is the elevation strip,
 * the road ahead and the map, as it always was, and is the default.
 * **Compact** is the map alone, as a small tile in the same corner, with the
 * current gradient printed on it (`HudCore.tsx` §`RouteTile`). It changes how
 * the route panel is drawn, never whether: a rider who turned the route off
 * ({@link HUD_PANELS}' `route`) sees no route panel in either. While a
 * workout runs its strip holds the panel, and the panel is drawn full.
 *
 * Never throws: a store that cannot be read is the defaults, and a write that
 * is refused says so, as every preference here does.
 */

import type { PreferenceStorage } from './announce-preference';

/** The panels a rider may hide. @see the module note on what may not be. */
export const HUD_PANELS = ['readings', 'route', 'graph', 'standings'] as const;

/** One of {@link HUD_PANELS}. */
export type HudPanelId = (typeof HUD_PANELS)[number];

/** The text sizes, smallest first. */
export const HUD_TEXT_SIZES = ['normal', 'large', 'extra-large'] as const;

/** One of {@link HUD_TEXT_SIZES}. */
export type HudTextSize = (typeof HUD_TEXT_SIZES)[number];

/** The arrangements, the default first — #2383. */
export const HUD_ARRANGEMENTS = ['full', 'focus'] as const;

/** One of {@link HUD_ARRANGEMENTS}. */
export type HudArrangement = (typeof HUD_ARRANGEMENTS)[number];

/** How the route panel is drawn, the default first — #2385. */
export const HUD_ROUTE_VIEWS = ['full', 'compact'] as const;

/** One of {@link HUD_ROUTE_VIEWS}. */
export type HudRouteView = (typeof HUD_ROUTE_VIEWS)[number];

/** What the rider chose. */
export interface HudLayoutPreference {
  /** The panels turned off. Empty by default: every panel is shown. */
  readonly hidden: readonly HudPanelId[];
  readonly textSize: HudTextSize;
  /**
   * Full or focus — #2383. Absent is `full`, so a preference kept before
   * #2383 (which has no such field) reads as the HUD it always drew.
   */
  readonly arrangement?: HudArrangement;
  /**
   * Full or compact — #2385. Absent is `full`, so a preference kept before
   * #2385 reads as the route panel it always drew.
   */
  readonly route?: HudRouteView;
}

export const DEFAULT_HUD_LAYOUT: HudLayoutPreference = {
  hidden: [],
  textSize: 'normal',
  arrangement: 'full',
  route: 'full',
};

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const HUD_LAYOUT_STORAGE_KEY = 'oyl.hudLayout.v1';

function isPanel(value: unknown): value is HudPanelId {
  return typeof value === 'string' && (HUD_PANELS as readonly string[]).includes(value);
}

function isTextSize(value: unknown): value is HudTextSize {
  return typeof value === 'string' && (HUD_TEXT_SIZES as readonly string[]).includes(value);
}

function isArrangement(value: unknown): value is HudArrangement {
  return typeof value === 'string' && (HUD_ARRANGEMENTS as readonly string[]).includes(value);
}

function isRouteView(value: unknown): value is HudRouteView {
  return typeof value === 'string' && (HUD_ROUTE_VIEWS as readonly string[]).includes(value);
}

/**
 * What this device has stored, or the defaults — field by field. Never throws.
 * A name it does not know is left out rather than kept: a stored `notices`
 * hides nothing, because nothing here can hide the notices.
 */
export function readHudLayout(storage: PreferenceStorage | undefined): HudLayoutPreference {
  let raw: unknown;
  try {
    const text = storage?.getItem(HUD_LAYOUT_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_HUD_LAYOUT;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_HUD_LAYOUT;
  const row = raw as Record<string, unknown>;
  const hidden = Array.isArray(row['hidden']) ? [...new Set(row['hidden'].filter(isPanel))] : [];
  return {
    hidden,
    textSize: isTextSize(row['textSize']) ? row['textSize'] : DEFAULT_HUD_LAYOUT.textSize,
    arrangement: isArrangement(row['arrangement']) ? row['arrangement'] : 'full',
    route: isRouteView(row['route']) ? row['route'] : 'full',
  };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeHudLayout(
  storage: PreferenceStorage | undefined,
  preference: HudLayoutPreference,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

/** Whether a panel is shown under this preference. */
export function panelShown(preference: HudLayoutPreference, panel: HudPanelId): boolean {
  return !preference.hidden.includes(panel);
}

/** Whether the HUD draws #2383's focus readout under this preference. */
export function focusArrangement(preference: HudLayoutPreference): boolean {
  return preference.arrangement === 'focus';
}

/**
 * Whether the route panel is #2385's compact tile under this preference. Says
 * nothing of whether it is shown: {@link panelShown} with `route` does.
 */
export function compactRoute(preference: HudLayoutPreference): boolean {
  return preference.route === 'compact';
}
