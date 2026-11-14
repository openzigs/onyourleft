// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The rider's own line in view, in a race's standings that scroll** — #2599.
 *
 * Where the room above the actions panel is short of every line
 * (`standings-room.ts`), the list scrolls under a finger: the owner's ruling
 * on PR #2621, 2026-11-14. The maintainer's defaults, open to the owner
 * changing them:
 *
 * - it opens with the rider's own line in the middle of the list;
 * - while the rider is not touching it, it keeps that line in the middle as
 *   places change — and scrolls only then, never on a tick where the line
 *   has not moved;
 * - once the rider scrolls it (a finger, a wheel, a key), it is theirs until
 *   {@link STANDINGS_RETURN_MS} after the last of it, and then it eases back
 *   to the own line — or jumps there, for a rider who asks for reduced motion.
 *
 * And it says there is more to scroll by fading the edge the list is clipped
 * at (`data-oyl-more`, `theme.css` §"#2599").
 *
 * Display only: nothing here reaches the race, the room or the trainer.
 * `standings-follow.test.ts` holds the arithmetic and `RaceStandings.tsx`
 * wires it; `browser/lap-race-hud.browser.spec.ts` §"#2599" scrolls it.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** How long after the rider's last touch or scroll the list eases back to their own line. */
export const STANDINGS_RETURN_MS = 5_000;

/** The `scrollTop` that puts a row in the middle of the list, held to what the list can scroll to. */
export function centredScrollTop(
  row: { readonly top: number; readonly height: number },
  list: { readonly height: number; readonly scrollHeight: number },
): number {
  const most = Math.max(0, list.scrollHeight - list.height);
  const centred = row.top + row.height / 2 - list.height / 2;
  return Math.min(most, Math.max(0, centred));
}

/** Whether the list must scroll to reach `target`: not for under a pixel, so a settled list is left alone. */
export function needsScroll(scrollTop: number, target: number): boolean {
  return Math.abs(scrollTop - target) >= 1;
}

/** The rider's hold on the list after a touch or scroll at `now`: until this instant. */
export function heldUntil(now: number): number {
  return now + STANDINGS_RETURN_MS;
}

/** Whether the list follows the rider's own line at `now`, given the rider's hold, if any. */
export function following(hold: number | undefined, now: number): boolean {
  return hold === undefined || now >= hold;
}

/** Which of the list's edges have more beyond them: the `data-oyl-more` the fade reads. */
export function moreBeyond(list: {
  readonly scrollTop: number;
  readonly height: number;
  readonly scrollHeight: number;
}): string {
  const above = list.scrollTop >= 1;
  const below = list.scrollTop + list.height <= list.scrollHeight - 1;
  return [above ? 'above' : '', below ? 'below' : ''].filter((edge) => edge !== '').join(' ');
}

const RIDER_SCROLLS = ['touchstart', 'touchmove', 'pointerdown', 'wheel', 'keydown'] as const;

/**
 * Keep the list's own line in view: `own` is its index in the list, and
 * `room` the list's height when it scrolls (`undefined` when it does not).
 */
export function useOwnLineInView(
  list: RefObject<HTMLElement | null>,
  own: number,
  room: number | undefined,
): void {
  const hold = useRef<number | undefined>(undefined);
  const opened = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const centre = useRef<(smooth: boolean) => void>(() => undefined);
  centre.current = (smooth: boolean): void => {
    const element = list.current;
    const row = element?.querySelectorAll('li')[own];
    if (element === null || element === undefined || row === undefined) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = element.getBoundingClientRect();
    const target = centredScrollTop(
      { top: rowBox.top - listBox.top + element.scrollTop, height: rowBox.height },
      { height: element.clientHeight, scrollHeight: element.scrollHeight },
    );
    if (needsScroll(element.scrollTop, target)) {
      const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      element.scrollTo({ top: target, behavior: smooth && !still ? 'smooth' : 'instant' });
    }
    element.setAttribute('data-oyl-more', moreBeyond(edgesOf(element, target)));
  };

  // When the list opens, when the own line moves, and when the room changes:
  // before paint, and only if the rider is not holding the list.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    if (room === undefined) {
      opened.current = false;
      element.removeAttribute('data-oyl-more');
      return;
    }
    if (!following(hold.current, Date.now())) return;
    centre.current(opened.current);
    opened.current = true;
  }, [list, own, room]);

  useEffect(() => {
    const element = list.current;
    if (element === null) return undefined;
    const release = (): void => {
      hold.current = undefined;
      centre.current(true);
    };
    const touched = (): void => {
      hold.current = heldUntil(Date.now());
      clearTimeout(timer.current);
      timer.current = setTimeout(release, STANDINGS_RETURN_MS);
    };
    const scrolled = (): void => {
      // The rider's momentum after a finger lifts: still theirs. A scroll of
      // the list's own, back to the line, comes when nobody holds it.
      if (!following(hold.current, Date.now())) touched();
      element.setAttribute('data-oyl-more', moreBeyond(edgesOf(element, element.scrollTop)));
    };
    for (const kind of RIDER_SCROLLS) element.addEventListener(kind, touched, { passive: true });
    element.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      clearTimeout(timer.current);
      for (const kind of RIDER_SCROLLS) element.removeEventListener(kind, touched);
      element.removeEventListener('scroll', scrolled);
    };
  }, [list]);
}

function edgesOf(element: HTMLElement, scrollTop: number) {
  return { scrollTop, height: element.clientHeight, scrollHeight: element.scrollHeight };
}
