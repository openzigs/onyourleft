// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where each HUD panel's collapse tab is drawn while its panel is open —
 * #2600, the owner's *"should we give people a way to collapse side panels
 * if desired during a ride or any panel"*.
 *
 * ## Why the tab is not inside its panel
 *
 * Every panel's size is measured against the stage at every overlay viewport
 * (`browser/ride-stage.ts` §`layoutFaults`, the standings' room to the actions
 * panel, #2599), and a 48 px control inside each one would change every one
 * of those sizes. The readings panels are `<dl>`s, which may not hold a button
 * at all. So an OPEN panel's tab stands just OUTSIDE it, on a layer of its own
 * over the stage, and the panel's box is the box it always was. A COLLAPSED
 * panel is the tab and nothing else, in the panel's own place in the grid
 * (`HudCore.tsx` §`CollapsedPanel`), so no geometry is needed for it.
 *
 * ## Where outside — {@link placeTab}
 *
 * Toward the road, never toward the screen's edge: beside the panel on the
 * side that faces the middle of the stage, level with the edge it is handed
 * (the trainer's line, inside its panel) and then with the panel's own edge by
 * the screen's; failing that, under (or over) the panel at its inner end, then
 * at its outer end. The first place that is on the stage and clear of every
 * other panel, notice and tab — and of the rider, leaning as far as
 * one is drawn (`camera.ts` §`riderFrameBox`) — is taken; and after those,
 * the nearest clear place along the column beside the panel or the row past
 * it. With nowhere clear, no tab is drawn: a tab over a reading would cover
 * what the rider reads, which is worse than a tab a resize away.
 *
 * The tabs are a ride control (`controls-reveal.ts`): drawn when the rider has
 * just touched the screen, and faded with *Pause* and *End ride* otherwise, so
 * a tab over the road is there only while the rider is reaching for one.
 *
 * ## Tablets only
 *
 * {@link PANEL_TABS_MEDIA}: a tablet held either way — the media a race's
 * standings are drawn at (`theme.css` §"A RACE'S STANDINGS"). A phone's corners are
 * already given over — its standings are visually hidden, its notices take
 * the route panel's cell (#437) — and there was no room measured for a tab.
 * On a phone there are no tabs and every panel is drawn open, whatever the
 * device has stored.
 */

import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

import { riderFrameBox } from '../camera';
import { MAXIMUM_LEAN_RADIANS } from '../racing-line';

/** The viewports the tabs are drawn at: a tablet in landscape or upright. */
export const PANEL_TABS_MEDIA = '(min-width: 46rem) and (min-height: 47rem)';

/** The clear space between a tab and its panel, and between a tab and anything else. */
export const TAB_GAP_PIXELS = 8;

/** A box on the page, in CSS pixels. */
export interface TabBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A tab's place, against the stage's top-left corner. */
export interface TabPlace {
  readonly left: number;
  readonly top: number;
}

function overlaps(a: TabBox, b: TabBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function onStage(box: TabBox, stage: TabBox): boolean {
  return (
    box.left >= stage.left &&
    box.top >= stage.top &&
    box.right <= stage.right &&
    box.bottom <= stage.bottom
  );
}

/**
 * Where an open panel's tab goes. `panel` is the panel's box; `edge` is the
 * box whose top or bottom the tab lines up with — the panel's own, or for the
 * trainer's line the line's, inside the actions panel. Every box is a page
 * box; the answer is against `stage`'s corner. @see the module note
 */
export function placeTab(input: {
  readonly panel: TabBox;
  readonly edge: TabBox;
  readonly stage: TabBox;
  readonly width: number;
  readonly height: number;
  readonly others: readonly TabBox[];
}): TabPlace | undefined {
  const { panel, edge, stage, width, height, others } = input;
  const startSide = (panel.left + panel.right) / 2 < (stage.left + stage.right) / 2;
  const topSide = (edge.top + edge.bottom) / 2 < (stage.top + stage.bottom) / 2;
  const beside = startSide ? panel.right + TAB_GAP_PIXELS : panel.left - TAB_GAP_PIXELS - width;
  const level = topSide ? edge.top : edge.bottom - height;
  // Level with the panel's own edge by the screen's: its top for a top panel.
  const far = topSide ? panel.top : panel.bottom - height;
  const past = topSide ? panel.bottom + TAB_GAP_PIXELS : panel.top - TAB_GAP_PIXELS - height;
  const inner = startSide ? panel.right - width : panel.left;
  const outer = startSide ? panel.left : panel.right - width;
  // The places named first, in order; then every place along the column
  // beside the panel and the row past it, nearest the first place first.
  const named: readonly (readonly [number, number])[] = [
    [beside, level],
    [beside, far],
    [inner, past],
    [outer, past],
  ];
  const along: (readonly [number, number])[] = [];
  for (let top = stage.top; top + height <= stage.bottom; top += TAB_GAP_PIXELS) {
    along.push([beside, top]);
  }
  for (let left = stage.left; left + width <= stage.right; left += TAB_GAP_PIXELS) {
    along.push([left, past]);
  }
  const distance = ([left, top]: readonly [number, number]): number =>
    Math.abs(left - beside) + Math.abs(top - level);
  along.sort((a, b) => distance(a) - distance(b));
  const clear = ([left, top]: readonly [number, number]): boolean => {
    const candidate: TabBox = { left, top, right: left + width, bottom: top + height };
    const padded: TabBox = {
      left: left - TAB_GAP_PIXELS / 2,
      top: top - TAB_GAP_PIXELS / 2,
      right: candidate.right + TAB_GAP_PIXELS / 2,
      bottom: candidate.bottom + TAB_GAP_PIXELS / 2,
    };
    return onStage(candidate, stage) && !others.some((other) => overlaps(padded, other));
  };
  const chosen = [...named, ...along].find(clear);
  return chosen === undefined
    ? undefined
    : { left: chosen[0] - stage.left, top: chosen[1] - stage.top };
}

/** The attribute an open panel's tab wears, naming its panel. */
export const TAB_FOR_ATTRIBUTE = 'data-oyl-tab-for';

/**
 * Each collapsible panel as the stage draws it open: its own classes, so no
 * panel's markup changes for a tab. `trainer` is the line, whose panel is the
 * actions panel around it.
 */
const PANEL_SELECTORS: Readonly<Record<string, string>> = {
  primary: '.oyl-hud__fields--primary, .oyl-hud__focus',
  secondary: '.oyl-hud__fields--secondary',
  route: '.oyl-hud__route',
  standings: '.oyl-hud__standings, .oyl-hud__laps',
  trainer: '.oyl-hud__trainer',
};

function pageBox(element: Element): TabBox {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** What stands on the stage that a tab must keep clear of: every panel, the notices and the map's credit. */
const OBSTACLES = '.oyl-hud__panel, .oyl-hud__notices, .oyl-hud__attribution';

/**
 * Place every open panel's tab, by writing its `left` and `top` and marking it
 * placed (`theme.css` draws an unplaced tab hidden). Written straight onto the
 * element, not through React state: an observer's callback runs after layout
 * and before paint, so the frame that moved a panel is the frame its tab
 * moves in — measured, a tab placed a render later covered a Delivery
 * round's *Score* for a frame at 800×1280.
 */
function placeAll(hud: HTMLElement, layer: HTMLElement): void {
  const stage = pageBox(hud);
  const placed: TabBox[] = [];
  const panels = [...hud.querySelectorAll(OBSTACLES)]
    .filter((each) => !layer.contains(each))
    .map((each) => ({ element: each, box: pageBox(each) }))
    .filter(({ box }) => box.right - box.left > 1 && box.bottom - box.top > 1);
  // The rider at the lean cap, as `ride-stage.ts` §`riderBox` holds every
  // panel clear of it: the world is drawn full-bleed under the HUD.
  const across = stage.right - stage.left;
  const down = stage.bottom - stage.top;
  const frame = down > 0 ? riderFrameBox(across / down, MAXIMUM_LEAN_RADIANS) : undefined;
  const rider: TabBox[] =
    frame === undefined
      ? []
      : [
          {
            left: stage.left + frame.left * across,
            top: stage.top + frame.top * down,
            right: stage.left + frame.right * across,
            bottom: stage.top + frame.bottom * down,
          },
        ];
  for (const tab of layer.querySelectorAll<HTMLElement>(`[${TAB_FOR_ATTRIBUTE}]`)) {
    const place = placeOne(tab, hud, layer, stage, [
      ...panels,
      ...[...rider, ...placed].map((box) => ({ element: undefined, box })),
    ]);
    if (place === undefined) {
      // Nowhere clear, or no panel drawn to stand beside: no tab drawn this
      // time. It stays in the document, unseen and unfocusable, until a
      // measurement finds it room.
      tab.removeAttribute(TAB_PLACED_ATTRIBUTE);
      continue;
    }
    tab.style.left = `${String(place.left)}px`;
    tab.style.top = `${String(place.top)}px`;
    tab.setAttribute(TAB_PLACED_ATTRIBUTE, '');
    placed.push({
      left: stage.left + place.left,
      top: stage.top + place.top,
      right: stage.left + place.left + tab.offsetWidth,
      bottom: stage.top + place.top + tab.offsetHeight,
    });
  }
}

function placeOne(
  tab: HTMLElement,
  hud: HTMLElement,
  layer: HTMLElement,
  stage: TabBox,
  obstacles: readonly { readonly element: Element | undefined; readonly box: TabBox }[],
): TabPlace | undefined {
  const selector = PANEL_SELECTORS[tab.getAttribute(TAB_FOR_ATTRIBUTE) ?? ''];
  const own = selector === undefined ? null : hud.querySelector(selector);
  if (own === null || layer.contains(own)) return undefined;
  const panelElement = own.closest('.oyl-hud__panel') ?? own;
  const ownBox = pageBox(own);
  // A panel the layout draws visually hidden has no tab to draw.
  if (ownBox.right - ownBox.left <= 1 || ownBox.bottom - ownBox.top <= 1) return undefined;
  return placeTab({
    panel: pageBox(panelElement),
    edge: ownBox,
    stage,
    width: tab.offsetWidth,
    height: tab.offsetHeight,
    others: obstacles.filter(({ element }) => element !== panelElement).map(({ box }) => box),
  });
}

/** The attribute a placed tab wears; an open tab without it is drawn hidden. */
export const TAB_PLACED_ATTRIBUTE = 'data-oyl-placed';

/**
 * Place every open panel's tab before paint, and again whenever a panel is
 * resized, added or moved — the way `standings-room.ts` measures the
 * standings' room. `names` is the open panels with a tab, so a panel opened or
 * closed places them again.
 */
export function useTabPlacement(
  hud: RefObject<HTMLElement | null>,
  layer: RefObject<HTMLElement | null>,
  names: string,
): void {
  useLayoutEffect(() => {
    const section = hud.current;
    const tabs = layer.current;
    if (section === null || tabs === null) return undefined;
    const measure = (): void => {
      placeAll(section, tabs);
    };
    measure();
    // A window resized — a tablet turned — places them in the resize's own
    // task, before the frame's observers would.
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', measure);
      };
    }
    const sizes = new ResizeObserver(measure);
    sizes.observe(section);
    for (const child of section.children) sizes.observe(child);
    const attributes = { attributes: true, attributeFilter: ['class', 'style'] };
    const changes = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added instanceof Element && added.parentElement === section) {
            sizes.observe(added);
            changes.observe(added, attributes);
          }
        }
      }
      measure();
    });
    changes.observe(section, { childList: true });
    for (const child of section.children) {
      if (child !== tabs) changes.observe(child, attributes);
    }
    return () => {
      window.removeEventListener('resize', measure);
      sizes.disconnect();
      changes.disconnect();
    };
  }, [hud, layer, names]);
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
