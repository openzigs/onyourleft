// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The room a race's standings have on the stage** — #2599.
 *
 * On a tablet the standings are a panel of their own at the end edge, under
 * the secondary readings, and the actions panel — the trainer's line, *Pause*,
 * *End ride*, *Use item* — is under them in the same column (`theme.css`
 * §"A RACE'S STANDINGS"). The grid row the standings sit in is `minmax(0, 1fr)`,
 * so nothing in the grid stops a list taller than that row from running down
 * over the actions panel: on the 4:3 tablet in a lap race of eight, with
 * *Use item* in the actions panel and the swap to the lap splits on the
 * standings' first row, it did, and covered all of the trainer's line but
 * "Tra" (the owner's tablet check, 2026-11-14).
 *
 * So the standings measure the room between their own top and the actions
 * panel's, less the owner's {@link STANDINGS_CLEARANCE_PIXELS}, and draw as
 * many lines as that holds. ⚠️ **What gives way, recorded as #419 asks**: the
 * lines furthest from the rider, by {@link giveWayRanks} — the rider's own
 * line is the last to go, then the leader's, then the racers nearest the
 * rider, the one ahead before the one behind. A line that gives way is
 * hidden by clip (`.oyl-hud__standings-line--gives-way`), so a screen reader
 * still reads the whole list (ADR 0051 D-7), and the summary — "You are 4 of
 * 8." — is never hidden. Where the room holds every line, every line is
 * drawn: #2328's whole field on a 1280×800 tablet is unchanged.
 *
 * Display only: nothing here reaches the race, the room or the trainer.
 * `browser/lap-race-hud.browser.spec.ts` §"#2599" measures it.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * The least space between the standings and the actions panel under them:
 * the owner's 16 px on a landscape tablet (2026-11-06, #2034), which
 * `ride-laps.browser.spec.ts` §`MARGIN_PIXELS` holds for a room's race.
 */
export const STANDINGS_CLEARANCE_PIXELS = 16;

/**
 * How much more room than a line's height a line that gave way needs before
 * it is drawn again (PR #2621's review). Without it, a trainer line near its
 * wrap point — `-1.5 %` to `-12.5 %` — grows and shrinks the actions panel
 * by a line, and the furthest line blinks in and out each time.
 */
export const STANDINGS_HYSTERESIS_PIXELS = 4;

/**
 * Each line's place in the order the lines give way: `0` is kept the
 * longest. The rider's own line first, then the list's first line (a lap
 * race's leader, #1967), then outward from the rider, the line ahead before
 * the line behind at the same distance. With no line of the rider's own, the
 * list's order.
 */
export function giveWayRanks(lines: readonly { readonly you: boolean }[]): readonly number[] {
  const own = lines.findIndex((line) => line.you);
  const order: number[] = [];
  if (own === -1) {
    lines.forEach((_, index) => order.push(index));
  } else {
    order.push(own);
    if (own !== 0) order.push(0);
    for (let distance = 1; order.length < lines.length; distance += 1) {
      for (const index of [own - distance, own + distance]) {
        if (index > 0 && index < lines.length) order.push(index);
      }
    }
  }
  const ranks = new Array<number>(lines.length).fill(0);
  order.forEach((index, rank) => {
    ranks[index] = rank;
  });
  return ranks;
}

/** Where the standings' list and the actions panel are, in one frame of reference. */
export interface StandingsRoom {
  /** The list's top edge. */
  readonly listTop: number;
  /** The list's bottom edge. */
  readonly listBottom: number;
  /** The standings panel's bottom edge: below the list by the panel's padding and border. */
  readonly panelBottom: number;
  /** The actions panel's top edge. */
  readonly actionsTop: number;
  /** One line's height. */
  readonly lineHeight: number;
}

/**
 * How many lines the room holds: the space from the list's top to the
 * actions panel's, less the clearance and what the panel draws below its
 * list, in whole lines, never fewer than none. With `drawn`, the lines drawn
 * now, the room must hold a line and {@link STANDINGS_HYSTERESIS_PIXELS}
 * more before a line that gave way comes back; a line goes as soon as the
 * room no longer holds it, so the hysteresis never draws one too many.
 */
export function linesThatFit(room: StandingsRoom, drawn?: number): number {
  if (!(room.lineHeight > 0)) return 0;
  const below = room.panelBottom - room.listBottom;
  const space = room.actionsTop - STANDINGS_CLEARANCE_PIXELS - below - room.listTop;
  const whole = (pixels: number): number =>
    // A thousandth of a pixel, so a room that is exactly n lines tall in
    // sub-pixel layout is not read as one short of them.
    Math.max(0, Math.floor(pixels / room.lineHeight + 0.001));
  const fit = whole(space);
  if (drawn === undefined || fit <= drawn) return fit;
  return Math.max(drawn, whole(space - STANDINGS_HYSTERESIS_PIXELS));
}

/** Whether the line at `rank` gives way when the room holds `fit` lines. */
export function givesWay(rank: number, fit: number | undefined): boolean {
  return fit !== undefined && rank >= fit;
}

/**
 * The lines the standings have room for, or `undefined` where they have room
 * for all of them — or are not drawn at all (a phone, where the panel is
 * clipped to nothing), or are not over the actions panel in the layout.
 *
 * Measured before the first paint, so no frame draws the lines over the
 * actions panel (PR #2621's review); then again when the HUD or any of its
 * panels changes size (a rotation, the text size, *Use item* or the touch
 * lock's note in the actions panel, a reading in the secondary panel
 * above), when a panel is added to the HUD or its class or style changes —
 * which can move a panel without resizing one — and when the number of
 * lines changes.
 */
export function useStandingsRoom(
  panel: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  lines: number,
): number | undefined {
  const [fit, setFit] = useState<number | undefined>(undefined);
  // The last line height measured: when every line has given way there is
  // no line left to read it from.
  const lineHeight = useRef(0);
  // The lines drawn now, for the hysteresis; `undefined` is all of them.
  const drawn = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const section = panel.current;
    const ol = list.current;
    const hud = section?.closest('.oyl-hud');
    if (section === null || ol === null || hud === null || hud === undefined) return undefined;
    const measure = (): void => {
      const next = roomFor(section, ol, hud, lineHeight, lines, drawn.current ?? lines);
      drawn.current = next;
      setFit(next);
    };
    // Before paint: a state update from a layout effect renders again
    // synchronously, so the first frame drawn already has the lines that fit.
    measure();
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const sizes = new ResizeObserver(measure);
    sizes.observe(hud);
    for (const child of hud.children) sizes.observe(child);
    const attributes = { attributes: true, attributeFilter: ['class', 'style'] };
    const changes = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added instanceof Element && added.parentElement === hud) {
            sizes.observe(added);
            changes.observe(added, attributes);
          }
        }
      }
      measure();
    });
    changes.observe(hud, { ...attributes, childList: true });
    for (const child of hud.children) changes.observe(child, attributes);
    return () => {
      sizes.disconnect();
      changes.disconnect();
    };
  }, [panel, list, lines]);
  return fit;
}

function roomFor(
  section: Element,
  ol: Element,
  hud: Element,
  lineHeight: { current: number },
  lines: number,
  drawn: number,
): number | undefined {
  const panelBox = section.getBoundingClientRect();
  if (panelBox.width <= 1 || panelBox.height <= 1) return undefined;
  const actions = hud.querySelector('.oyl-hud__actions');
  if (actions === null) return undefined;
  const actionsBox = actions.getBoundingClientRect();
  const beside = actionsBox.right <= panelBox.left || actionsBox.left >= panelBox.right;
  if (beside || actionsBox.bottom <= panelBox.top) return undefined;
  for (const line of ol.children) {
    const height = line.getBoundingClientRect().height;
    if (height > 1) {
      lineHeight.current = height;
      break;
    }
  }
  const listBox = ol.getBoundingClientRect();
  const fit = linesThatFit(
    {
      listTop: listBox.top,
      listBottom: listBox.bottom,
      panelBottom: panelBox.bottom,
      actionsTop: actionsBox.top,
      lineHeight: lineHeight.current,
    },
    drawn,
  );
  return fit >= lines ? undefined : fit;
}
