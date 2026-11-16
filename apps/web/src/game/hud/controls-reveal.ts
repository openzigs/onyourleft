// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's controls fade out after a few seconds with no input, and come
 * straight back on any touch, key or controller press — #2600, the owner's
 * question of 2026-11-14 from the tablet: *"wondering if the pause and end
 * ride should only appear if the person touches on the tablet"*.
 *
 * ## What the first touch does
 *
 * **It only shows them.** A tap that began while they were hidden presses no
 * control that hides: its `pointerdown` and `pointerup` are swallowed where
 * they land on one, and so is its `click` — wherever the tap came down, since
 * the click is hit-tested after this tap has drawn them again. So a rider
 * reaching for a control they cannot see never presses it, and the touch
 * lock's long press (`TouchLockButton.tsx`) never starts from one either. A
 * tap on a panel shows them and tucks nothing (`panel-tabs.ts` §"Tap out"
 * asks {@link ControlsReveal.revealingTap}); a tap on a tucked panel's tab,
 * which is always drawn, shows them and brings the panel back. The second tap
 * presses what is now drawn.
 *
 * ⚠️ **A click with `detail` 0 is never swallowed**: that is Enter, Space, or
 * the click a screen reader sends when it activates a control
 * (`design/touch-lock.ts` §"What it ignores" draws the same line). A hidden
 * control is faded (`opacity`, the owner's ruling of 2026-11-16 on PR #2670:
 * *"Fade out is better"*), never removed: it stays in the document, in the
 * tab order and in the accessibility tree, so a keyboard or a screen reader reaches it
 * and presses it as on any ride. Focus arriving on one shows them; and while
 * the keyboard holds focus on one they do not fade, so the focus ring is
 * never drawn on nothing (WCAG 2.2 SC 2.4.7).
 *
 * ## When they never hide
 *
 * That is the caller's `auto` (`HudCore.tsx` §`controlsHeld` decides it, and
 * records the safety ruling): with it `false` the controls are drawn and no
 * timer runs.
 *
 * ## Where the input is heard
 *
 * A pointer coming down anywhere on the page, a key, a mouse moving, and focus
 * arriving inside the HUD — all on `window`, in the CAPTURE phase, so they run
 * before React's own listener at the root and a swallowed tap never reaches an
 * `onClick`. A controller's press is not an event the page hears: the HUD's
 * pad and controller readers call {@link ControlsReveal.reveal} themselves.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** How long the controls stay with no input, in milliseconds. */
export const CONTROLS_HIDE_MILLISECONDS = 5000;

/**
 * The attribute every control that hides wears. `theme.css` §"#2600: THE
 * RIDE CONTROLS FADE UNTIL TOUCHED" fades them, and a tap on one while they
 * are hidden is the tap that is swallowed.
 */
export const HIDES_ATTRIBUTE = 'data-oyl-hides';

/** What {@link useControlsReveal} answers. */
export interface ControlsReveal {
  /** Whether the controls are faded out now. Always `false` while `auto` is. */
  readonly hidden: boolean;
  /**
   * Whether they have faded out on this ride: what they are drawn with after
   * is a fade back IN (`theme.css` §"#2600"), and a ride that never hid them
   * draws them with no fade at all.
   */
  readonly returned: boolean;
  /** Show them and start the wait again — a controller's press. */
  readonly reveal: () => void;
  /**
   * Whether `click` is a tap's that began while they were hidden — the tap
   * that only shows them. Asked by what a tap on something always drawn would
   * otherwise do, a panel tucking away (`panel-tabs.ts` §"Tap out").
   */
  readonly revealingTap: (click: Event) => boolean;
}

function inHiding(target: EventTarget | null, region: HTMLElement): boolean {
  return (
    target instanceof Element &&
    region.contains(target) &&
    target.closest(`[${HIDES_ATTRIBUTE}]`) !== null
  );
}

/**
 * Fade the controls in `region` out after {@link CONTROLS_HIDE_MILLISECONDS}
 * with no input, while `auto` is true. @see the module note
 */
export function useControlsReveal(
  region: RefObject<HTMLElement | null>,
  auto: boolean,
): ControlsReveal {
  const [hidden, setHidden] = useState(false);
  const [faded, setFaded] = useState(false);
  // The same answer, read by the listeners synchronously: a tap's `pointerdown`
  // shows the controls, and its `click` must still know the tap began hidden.
  const hiddenNow = useRef(false);
  const revealNow = useRef<() => void>(() => undefined);
  // The click of the tap that only showed them, while it is dispatched.
  const revealingClick = useRef<Event | undefined>(undefined);

  useEffect(() => {
    const element = region.current;
    if (!auto || element === null) {
      hiddenNow.current = false;
      setHidden(false);
      revealNow.current = () => undefined;
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Whether the last input was a key: focus held by the keyboard keeps them.
    let byKey = false;
    // Whether the tap now under way began on a hidden control.
    let swallowing = false;
    const expire = (): void => {
      timer = undefined;
      const focused = document.activeElement;
      if (byKey && inHiding(focused, element)) {
        arm();
        return;
      }
      hiddenNow.current = true;
      setHidden(true);
      setFaded(true);
    };
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(expire, CONTROLS_HIDE_MILLISECONDS);
    };
    const reveal = (): void => {
      if (hiddenNow.current) {
        hiddenNow.current = false;
        setHidden(false);
      }
      arm();
    };
    const swallow = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointerDown = (event: PointerEvent): void => {
      byKey = false;
      // ⚠️ ANY touch that comes down while they are hidden, not only one on a
      // control: once faded, the actions panel is clipped below the trainer's
      // line (`theme.css` §"#2600"), so the finger lands on the road — and by the time the tap's click is hit-tested this
      // touch has shown them, so the click would land on the control now
      // drawn under the finger. Measured: the first tap paused the ride.
      swallowing = hiddenNow.current;
      if (swallowing && inHiding(event.target, element)) swallow(event);
      reveal();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (swallowing && inHiding(event.target, element)) swallow(event);
    };
    const onClick = (event: MouseEvent): void => {
      const revealing = swallowing && event.detail > 0;
      revealingClick.current = revealing ? event : undefined;
      if (revealing && inHiding(event.target, element)) swallow(event);
      swallowing = false;
    };
    const onKey = (): void => {
      byKey = true;
      reveal();
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse') reveal();
    };
    const onFocus = (event: FocusEvent): void => {
      if (event.target instanceof Node && element.contains(event.target)) reveal();
    };
    const capture = { capture: true } as const;
    window.addEventListener('pointerdown', onPointerDown, capture);
    window.addEventListener('pointerup', onPointerUp, capture);
    window.addEventListener('click', onClick, capture);
    window.addEventListener('keydown', onKey, capture);
    window.addEventListener('pointermove', onMove, capture);
    window.addEventListener('focusin', onFocus, capture);
    revealNow.current = reveal;
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      revealNow.current = () => undefined;
      window.removeEventListener('pointerdown', onPointerDown, capture);
      window.removeEventListener('pointerup', onPointerUp, capture);
      window.removeEventListener('click', onClick, capture);
      window.removeEventListener('keydown', onKey, capture);
      window.removeEventListener('pointermove', onMove, capture);
      window.removeEventListener('focusin', onFocus, capture);
    };
  }, [region, auto]);

  const reveal = useCallback(() => {
    revealNow.current();
  }, []);
  const revealingTap = useCallback(
    (click: Event) => auto && revealingClick.current === click,
    [auto],
  );
  return { hidden: auto && hidden, returned: faded && !(auto && hidden), reveal, revealingTap };
}
