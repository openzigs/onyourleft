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
 * panel's, less the owner's {@link STANDINGS_CLEARANCE_PIXELS}, and the list
 * is at most as tall as the whole lines that room holds. ⚠️ **What gives
 * way, recorded as #419 asks**: no line. Where the room is short the list
 * scrolls under a finger (the owner's ruling on PR #2621, 2026-11-14: "just
 * put a few on there and let the user scroll with their finger"), opening on
 * the rider's own line and easing back to it after the rider lets go
 * (`standings-follow.ts`). Every line stays in the document, so a screen
 * reader reads the whole list (ADR 0051 D-7), and the summary — "You are 4 of
 * 8." — is never in the scroll. Where the room holds every line the list
 * does not scroll: #2328's whole field on a 1280×800 tablet is unchanged.
 *
 * **And the room the ride controls leave when they hide is the list's** —
 * #2837, the owner's tablet race of 2026-11-18: *"the position menu should
 * get bigger when the other one reduces … Can only see 3 people."* Hidden
 * (#2600), the actions panel is its trainer's line and nothing else, and in a
 * race that line is drawn at the stage's bottom edge (`theme.css` §"#2837"),
 * so the room is measured to it there: the list grows by the lines the hidden
 * controls stood on, and gives them back when a touch returns the controls.
 * The room is the actions panel's box as it
 * is DRAWN — a box read off the page carries the move — so nothing here
 * knows how the panel hides; it only measures again when it has (below).
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
 * How much more room than a line's height the list needs before it grows by
 * a line again (PR #2621's review). Without it, a trainer line near its wrap
 * point — `-1.5 %` to `-12.5 %` — grows and shrinks the actions panel by a
 * line, and the list's height jumps by a line each time.
 */
export const STANDINGS_HYSTERESIS_PIXELS = 4;

/**
 * The HUD's attribute that says whether the ride controls are faded out
 * (`HudCore.tsx`, #2600): `hidden` or `shown`, and absent where they never
 * hide. Named here and not imported: the room is read off the page, and this
 * is the one thing about the controls it has to hear change (#2837).
 */
export const CONTROLS_ATTRIBUTE = 'data-oyl-controls';

/** The events that say a motion of the actions panel's has run to its end. @see useStandingsRoom */
const MOTION_ENDS = ['animationend', 'transitionend'] as const;

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
 * list, in whole lines, never fewer than none. With `drawn`, the lines the
 * list holds now, the room must hold a line and
 * {@link STANDINGS_HYSTERESIS_PIXELS} more before the list grows by one; it
 * shrinks as soon as the room no longer holds a line, so the hysteresis
 * never makes the list too tall.
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

/**
 * The most the standings' list may be tall, in pixels — whole lines — or
 * `undefined` where the room holds all of them, or the panel is not drawn at
 * all (a phone, where it is clipped to nothing), or is not over the actions
 * panel in the layout.
 *
 * Measured before the first paint, so no frame draws the lines over the
 * actions panel (PR #2621's review); then again when the HUD or any of its
 * panels changes size (a rotation, the text size, *Use item* or the touch
 * lock's note in the actions panel, a reading in the secondary panel
 * above), when a panel is added to the HUD or its class or style changes —
 * which can move a panel without resizing one — and when the number of
 * lines changes.
 *
 * #2837: and when the ride controls hide or return
 * ({@link CONTROLS_ATTRIBUTE}), and when an animation or a transition of the
 * actions panel's own ends — hidden, the panel closes to its line over a
 * moment, and the end of that changes no attribute and resizes nothing. A
 * transition too, because for a rider who asked for less motion the
 * stylesheet runs every change as one, 0.01 ms long (`theme.css`
 * §"Motion is opt-in"): the panel is not yet at its line when the attribute
 * is heard. ⚠️ **Never on a frame**:
 * every one of these is an event of the layout's, and a ride that changes
 * nothing measures nothing (`browser/ride-chrome.browser.spec.ts` §"#2837"
 * counts it over a moving ride).
 */
export function useStandingsRoom(
  panel: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  lines: number,
): number | undefined {
  const [room, setRoom] = useState<number | undefined>(undefined);
  // The last line height measured.
  const lineHeight = useRef(0);
  // The lines the list holds now, for the hysteresis; `undefined` is all of them.
  const drawn = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const section = panel.current;
    const ol = list.current;
    const hud = section?.closest('.oyl-hud');
    if (section === null || ol === null || hud === null || hud === undefined) return undefined;
    const measure = (): void => {
      const next = roomFor(section, ol, hud, lineHeight, lines, drawn.current ?? lines);
      drawn.current = next;
      setRoom(next === undefined ? undefined : next * lineHeight.current);
    };
    // Before paint: a state update from a layout effect renders again
    // synchronously, so the first frame drawn already has the list's height.
    measure();
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const sizes = new ResizeObserver(measure);
    sizes.observe(hud);
    for (const child of hud.children) sizes.observe(child);
    const attributes = { attributes: true, attributeFilter: ['class', 'style'] };
    // #2837: the HUD's own attributes, and whether its controls are hidden.
    const ofTheHud = { attributes: true, attributeFilter: ['class', 'style', CONTROLS_ATTRIBUTE] };
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
    changes.observe(hud, { ...ofTheHud, childList: true });
    for (const child of hud.children) changes.observe(child, attributes);
    // #2837: the actions panel's closing, run to its end. Any other
    // animation in the HUD — a reading's, a notice's — moves no panel.
    const closed = (event: Event): void => {
      if (event.target instanceof Element && event.target.matches('.oyl-hud__actions')) measure();
    };
    for (const ended of MOTION_ENDS) hud.addEventListener(ended, closed);
    return () => {
      sizes.disconnect();
      changes.disconnect();
      for (const ended of MOTION_ENDS) hud.removeEventListener(ended, closed);
    };
  }, [panel, list, lines]);
  return room;
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
  for (const line of ol.querySelectorAll('li')) {
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
