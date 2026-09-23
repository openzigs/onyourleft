// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The sign that says a camera is running, which is the only thing in the room
 * a bystander gets** (#382,
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-5).
 *
 * D-5 refuses to blur and says what stands in its place:
 *
 * > **The live-camera indicator is the bystander's only signal**, and #377's
 * > Phase B already requires it to be **independent of the operating system's**.
 * > That is not decoration: it is the one thing in the room that tells somebody
 * > walking in that a camera is running, and it must be visible from where a
 * > person would enter, not only to the rider on the bike.
 *
 * ⚠️ **And the owner's Q4 answer moved the two apart.** The camera is *"a
 * second phone on a tripod, side-on, at roughly hip height"*, so the capturing
 * device and the rider are no longer plausibly the same screen. ADR 0029's
 * 2026-09-23 amendment records that as *"a real constraint on #382 and #383"*.
 * What follows for this component is the whole of its design: it is rendered by
 * `AppShell`, above the router, on **every** screen the app has — including the
 * full-bleed ride stage, where nothing else survives — so whichever device a
 * person walks up to is showing it.
 *
 * ## Why "independent of the operating system's" is a real requirement
 *
 * Android and iOS both draw a small privacy indicator while a camera is in use.
 * Neither is ours, both can be a few pixels in a status bar, and on the tripod
 * device the screen may be angled away from the door. More to the point, a
 * platform indicator says *the operating system believes a camera is open*; this
 * one says *this application has a camera open and is taking pictures with it*,
 * which is the claim a bystander needs and the only one this program can make
 * truthfully.
 *
 * ## What "cannot be hidden by a scrolled page or an overlay" means here
 *
 * #382 asks for that to be **decided and measured** rather than asserted, and
 * jsdom cannot measure any of it — it performs no layout and resolves no custom
 * property (CLAUDE.md §4e). So the decision is written here, the stylesheet
 * implements it in `theme.css` §"THE LIVE CAMERA INDICATOR", and
 * `browser/shell.browser.spec.ts` measures it in the pinned Chromium:
 *
 * 1. **`position: fixed`** — so scrolling the page cannot carry it off the
 *    screen. The spec scrolls to the bottom of a 4000 px document and reads its
 *    box back.
 * 2. **Above every `z-index` this stylesheet declares.** The highest other one
 *    is the ride stage's `20`, and the camera may well be running *during* a
 *    ride, so 20 is exactly the thing it has to beat.
 *    `indicator.test.ts` reads `theme.css` and asserts the indicator's is
 *    strictly the largest, so a rule added later at 999 is a red test rather
 *    than a silent covering.
 * 3. **Topmost at its own centre**, hit-tested in a real browser with an
 *    element at the product's own maximum `z-index` laid over the viewport.
 *    That is the assertion `z-index` alone cannot make: a stacking context
 *    created by an ancestor's `transform`, `filter` or `opacity` traps a child's
 *    `z-index` however large it is, and reading the CSS would never show it.
 *
 * ⚠️ **What it cannot be is proof against a hostile page**, and that is worth
 * being plain about: any element can be drawn over any other by something with
 * a higher stacking order, and there is no `z-index` that wins by construction.
 * What is claimed is that nothing **this product draws** covers it, measured
 * against the product's own maximum, and that nothing this product does to the
 * scroll position moves it.
 *
 * ## Not colour, and not an icon
 *
 * The carrier is the **word** — #48's sixth criterion is that colour is never
 * the sole carrier of meaning, and `design/StatusMessage.tsx` makes the same
 * call: *"a word, not an icon, and visible rather than `aria-label`-only: this
 * is what survives greyscale, a colour-vision deficiency, a monochrome printout
 * and a screen reader, all at once."* The dot beside it is `aria-hidden` and is
 * the redundant second signal, never the first.
 *
 * `role="status"` rather than `role="alert"`: the region is announced when it
 * appears, politely, without interrupting whatever the rider was being told.
 * An alert would interrupt a ride's own announcements to say something the
 * rider just did on purpose.
 */

import { useSyncExternalStore, type JSX } from 'react';

import type { CameraController } from './session';

/** The words. Short, because they are read at a glance from across a room. */
export const CAMERA_LIVE_LABEL = 'Camera on';

export interface CameraIndicatorProps {
  /**
   * `undefined` on a build with no camera port — every browser where
   * `main.tsx` could not construct one, and the accessibility suite's default.
   * The component then renders nothing at all, which is correct: there is no
   * camera to be on.
   */
  readonly controller?: CameraController | undefined;
}

/**
 * The indicator, rendered **only** while a camera is actually running.
 *
 * ⚠️ **Both directions are asserted** — `indicator.test.tsx` requires it
 * present while a session is live and absent when it is not. An indicator that
 * is always on is indistinguishable from one that works, which is #382's own
 * wording and is the reason the absent case is a test rather than an
 * assumption.
 */
export function CameraIndicator({ controller }: CameraIndicatorProps): JSX.Element | null {
  const live = useSyncExternalStore(
    (listener) => controller?.subscribe(listener) ?? noop,
    // ⚠️ A **boolean**, not `controller.state()`. `useSyncExternalStore`
    // compares snapshots with `Object.is`, and a getter returning a fresh
    // object every call makes React re-render for ever — a loop that shows up
    // as a hung test rather than as an error.
    () => controller?.state().live ?? false,
    () => false,
  );

  if (!live) {
    return null;
  }
  return (
    <div className="oyl-camera-indicator" role="status" data-oyl-camera-indicator="true">
      <span className="oyl-camera-indicator__dot" aria-hidden="true" />
      {CAMERA_LIVE_LABEL}
    </div>
  );
}

/** An unsubscribe for a controller that is not there. */
function noop(): void {
  /* nothing to unsubscribe from */
}
