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
 * ## The totals strip — #2387
 *
 * On or off ({@link HudLayoutPreference.totalsStrip}), off by default: a thin
 * strip along the bottom of the road with the whole ride's totals — the lap,
 * the route's length, the distance to go, the average speed, the energy and
 * the climb (`totals-strip.ts`). It pairs with either arrangement; with focus
 * it is where the totals the readout leaves out are read. A ride with a mode
 * of its own does not draw it, for the reason it keeps the full arrangement.
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
 * ## Power — #2420
 *
 * A 3-second average or instant ({@link HUD_POWER_VIEWS}). **The average** is
 * the default, as on a head unit (`power-average.ts` says why), and **instant**
 * is the reading as it arrives, as the HUD drew it before #2420. It changes
 * what the HUD SHOWS — the power field, the W/kg and the zone beside it, and
 * the focus readout's power, which is the same reading — and nothing else: the
 * simulation, the trainer, the recording, the totals, the zone time and the
 * recent graph read the raw readings in both.
 *
 * ## A Delivery round — #2514
 *
 * The game strip or everything ({@link HUD_DELIVERY_VIEWS}). **The game
 * strip** is the default: on a ride running a Delivery round the HUD draws
 * only what the round needs — power, speed and the round's own fields — and
 * no route panel and no lap table, so the roadsides where the houses stand are
 * clear (`HudCore.tsx` §`deliveryGame`). **Everything** is the HUD the round
 * drew before #2514. It changes only a ride with a round; the notices and the
 * controls are drawn in both.
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

/** How the HUD shows power, the default first — #2420. */
export const HUD_POWER_VIEWS = ['average', 'instant'] as const;

/** One of {@link HUD_POWER_VIEWS}. */
export type HudPowerView = (typeof HUD_POWER_VIEWS)[number];

/** How the HUD is drawn while a Delivery round runs, the default first — #2514. */
export const HUD_DELIVERY_VIEWS = ['game', 'everything'] as const;

/** One of {@link HUD_DELIVERY_VIEWS}. */
export type HudDeliveryView = (typeof HUD_DELIVERY_VIEWS)[number];

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
   * Whether the totals strip is drawn — #2387. Absent is off, so a preference
   * kept before #2387 reads as the HUD it always drew.
   */
  readonly totalsStrip?: boolean;
  /**
   * Full or compact — #2385. Absent is `full`, so a preference kept before
   * #2385 reads as the route panel it always drew.
   */
  readonly route?: HudRouteView;
  /**
   * A 3 s average or instant — #2420. Absent is `average`, so a preference
   * kept before #2420 reads as the new default.
   */
  readonly power?: HudPowerView;
  /**
   * The game strip or everything, on a ride running a Delivery round —
   * #2514. Absent is `game`, the new default.
   */
  readonly delivery?: HudDeliveryView;
}

export const DEFAULT_HUD_LAYOUT: HudLayoutPreference = {
  hidden: [],
  textSize: 'normal',
  arrangement: 'full',
  totalsStrip: false,
  route: 'full',
  power: 'average',
  delivery: 'game',
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

function isPowerView(value: unknown): value is HudPowerView {
  return typeof value === 'string' && (HUD_POWER_VIEWS as readonly string[]).includes(value);
}

function isDeliveryView(value: unknown): value is HudDeliveryView {
  return typeof value === 'string' && (HUD_DELIVERY_VIEWS as readonly string[]).includes(value);
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
    // Only a stored `true` turns it on: anything else is the default, off.
    totalsStrip: row['totalsStrip'] === true,
    route: isRouteView(row['route']) ? row['route'] : 'full',
    power: isPowerView(row['power']) ? row['power'] : 'average',
    delivery: isDeliveryView(row['delivery']) ? row['delivery'] : 'game',
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

/** Whether the rider chose #2387's totals strip under this preference. */
export function totalsStripChosen(preference: HudLayoutPreference): boolean {
  return preference.totalsStrip === true;
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

/** How the HUD shows power under this preference — #2420. Absent or unknown is the average. */
export function powerView(preference: HudLayoutPreference): HudPowerView {
  return preference.power === 'instant' ? 'instant' : 'average';
}

/** Whether a ride running a Delivery round draws everything rather than the game strip — #2514. */
export function deliveryEverything(preference: HudLayoutPreference): boolean {
  return preference.delivery === 'everything';
}

/**
 * Whether a ride's HUD is a Delivery round's game strip — #2514, the owner's
 * report from the tablet: the houses and their markers stand at the road's
 * edges, where the route panel, the lap table and the wide reading panels
 * were. On a ride running a round (`delivery` handed to the HUD), unless the
 * rider chose *Everything*: only the strip's readings (`HudCore.tsx`
 * §`DELIVERY_STRIP_KEYS`), no route panel and no lap table (`HudPanel.tsx`).
 * The notices and the ride controls are drawn as on any ride.
 */
export function deliveryGame(
  preference: HudLayoutPreference,
  delivery: object | undefined,
): boolean {
  return delivery !== undefined && !deliveryEverything(preference);
}
