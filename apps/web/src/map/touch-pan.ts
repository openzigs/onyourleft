// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One finger is left to the page** on the open-world picker's map (#2889):
 * MapLibre's touch pan is told that fewer than two touches are not its to pan.
 *
 * ⚠️ **A private member of `maplibre-gl`**: `dragPan._touchPan._shouldBePrevented`,
 * which the version pinned in `apps/web/package.json` asks before every touch
 * move (the note beside the pin is `docs/agents/project-state.md` §4b). Two
 * guards stand between a `maplibre-gl` bump and a map that pans under one
 * finger, or a picker that throws (#2985):
 *
 * - **The type.** `maplibre.ts` hands this `map.dragPan._touchPan` as the
 *   library declares it, so a bump that drops the member from its types fails
 *   `pnpm run typecheck`.
 * - **The value.** The member is replaced only while it is still a function,
 *   so a bump that renames it at run time leaves MapLibre's own one-finger pan
 *   in place rather than adding a property nothing calls. The browser gate's
 *   one-finger case (`browser/controls-first.browser.spec.ts` §"#2889") is
 *   what then fails.
 */

/** The one member this module touches, as `maplibre-gl` declares it. */
export interface TouchPanPrivate {
  _shouldBePrevented: unknown;
}

/** Replaces the touch pan's check, if it is still a function. Returns whether it was. */
export function preventOneFingerPan(touchPan: TouchPanPrivate | undefined): boolean {
  if (touchPan === undefined || typeof touchPan._shouldBePrevented !== 'function') return false;
  touchPan._shouldBePrevented = (touches: number): boolean => touches < 2;
  return true;
}
