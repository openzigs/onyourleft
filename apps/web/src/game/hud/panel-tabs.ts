// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tap a HUD panel to tuck it away, and tap its tab to bring it back — #2600,
 * the owner's *"should we give people a way to collapse side panels if desired
 * during a ride or any panel"*, and his ruling of 2026-11-16 on PR #2670:
 * *"I am not a big fan of the +- boxes for moving them..can't we just do a tap
 * out tap in"*.
 *
 * ## Tap out
 *
 * A tap on an open panel tucks it away ({@link panelTapped} says which panel a
 * tap landed on). A tap on a control INSIDE a panel — a race's swap, a
 * standings line's report — is that control's and tucks nothing, and so is a
 * tap that only brought the hidden ride controls back
 * (`controls-reveal.ts` §`revealingTap`): a rider touching the screen to find
 * *Pause* must not lose a panel to it. No box is drawn on an open panel to
 * press, so no panel's size changes: every one is measured against the stage
 * at every overlay viewport (`browser/ride-stage.ts` §`layoutFaults`, the
 * standings' room to the actions panel, #2599).
 *
 * ## Tap in
 *
 * A tucked panel is its tab and nothing else, in the panel's own place in the
 * grid (`HudCore.tsx` §`CollapsedPanel`): a 48 px button with the panel's
 * word on it. One tap brings the panel back.
 *
 * ## A keyboard and a screen reader
 *
 * Each panel is one focusable control whose name says which way it stands —
 * "Power panel, shown" or "Power panel, hidden" (the owner's ruling). Tucked,
 * that is the tab. Open, it is a button on a layer of its own over the stage,
 * drawn only while the keyboard is on it (`theme.css` §`.oyl-hud__tuck`), at
 * the panel's own top corner ({@link placeTuck}) — over the panel for as long
 * as focus is there, never beside it on the road. The readings panels are
 * `<dl>`s, which may not hold a button at all, so it is not inside its panel.
 *
 * ## Tablets only
 *
 * {@link PANEL_TABS_MEDIA}: a tablet held either way — the media a race's
 * standings are drawn at (`theme.css` §"A RACE'S STANDINGS"). A phone's corners are
 * already given over — its standings are visually hidden, its notices take
 * the route panel's cell (#437) — and there was no room measured for a tab.
 * On a phone nothing tucks and every panel is drawn open, whatever the
 * device has stored.
 */

import { useSyncExternalStore } from 'react';

import type { CollapsiblePanel } from './ride-chrome-preference';

/** The viewports panels tuck at: a tablet in landscape or upright. */
export const PANEL_TABS_MEDIA = '(min-width: 46rem) and (min-height: 47rem)';

/**
 * Each collapsible panel as the stage draws it open: its own classes, so no
 * panel's markup changes for a tap. `trainer` is the line, whose panel is the
 * actions panel around it.
 */
export const PANEL_SELECTORS: Readonly<Record<CollapsiblePanel, string>> = {
  primary: '.oyl-hud__fields--primary, .oyl-hud__focus',
  secondary: '.oyl-hud__fields--secondary',
  route: '.oyl-hud__route',
  standings: '.oyl-hud__standings, .oyl-hud__laps',
  trainer: '.oyl-hud__trainer',
};

/**
 * What a tap on a control lands on, rather than on its panel. `[tabindex]`
 * catches a control drawn without a native element, `-1` excepted: that is a
 * place focus is handed to, not a control. A standings list that scrolls is
 * focusable for the keyboard (#2599) and is no control: a tap on a line in it
 * still tucks the panel.
 */
const CONTROL =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"]):not([data-oyl-scrolls])';

/**
 * The open panel a tap on `target` tucks away, or `undefined` — a tap on a
 * control inside `hud`, on no panel, or on a panel not in `open`.
 */
export function panelTapped(
  target: EventTarget | null,
  hud: Element,
  open: readonly CollapsiblePanel[],
): CollapsiblePanel | undefined {
  if (!(target instanceof Element) || !hud.contains(target)) return undefined;
  const control = target.closest(CONTROL);
  if (control !== null && hud.contains(control)) return undefined;
  return open.find((panel) => {
    const own = target.closest(PANEL_SELECTORS[panel]);
    return own !== null && hud.contains(own);
  });
}

/** A box on the page, in CSS pixels. */
export interface TabBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where an open panel's keyboard control is drawn while focused, against the
 * layer's top-left corner: on the panel's top-start corner, moved in from the
 * layer's far edge where the control is wider than the room to it.
 */
export function tuckPlace(input: {
  readonly panel: TabBox;
  readonly layer: TabBox;
  readonly width: number;
}): { readonly left: number; readonly top: number } {
  const { panel, layer, width } = input;
  const left = Math.max(0, Math.min(panel.left - layer.left, layer.right - layer.left - width));
  return { left, top: Math.max(0, panel.top - layer.top) };
}

/** Draw `control`, an open panel's keyboard control, where {@link tuckPlace} says. */
export function placeTuck(
  control: HTMLElement,
  hud: Element,
  layer: Element,
  panel: CollapsiblePanel,
): void {
  const own = hud.querySelector(PANEL_SELECTORS[panel]);
  if (own === null) return;
  const place = tuckPlace({
    panel: own.getBoundingClientRect(),
    layer: layer.getBoundingClientRect(),
    width: control.offsetWidth,
  });
  control.style.left = `${String(place.left)}px`;
  control.style.top = `${String(place.top)}px`;
}

function subscribeTo(query: string): (onChange: () => void) => () => void {
  return (onChange) => {
    if (typeof window.matchMedia !== 'function') return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  };
}

const subscribeTablet = subscribeTo(PANEL_TABS_MEDIA);

let tablet: { readonly from: unknown; readonly list: MediaQueryList } | undefined;

/**
 * One list for every read — the page keeps it live, so `.matches` is current —
 * made again only if the page's `matchMedia` is a different function.
 */
function tabletQuery(): MediaQueryList {
  const from: unknown = Reflect.get(window, 'matchMedia');
  const cached = tablet;
  if (cached !== undefined && cached.from === from) return cached.list;
  const list = window.matchMedia(PANEL_TABS_MEDIA);
  tablet = { from, list };
  return list;
}

/**
 * Whether the stage is a tablet's, {@link PANEL_TABS_MEDIA}. Where the page
 * cannot say (no `matchMedia`, as in jsdom), it is.
 */
export function useTabletStage(): boolean {
  return useSyncExternalStore(subscribeTablet, () =>
    typeof window.matchMedia === 'function' ? tabletQuery().matches : true,
  );
}
