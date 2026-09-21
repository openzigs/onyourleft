// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Edge-to-edge safe-area insets, applied to the engine rather than to the page
 * — #439.
 *
 * Android enforces edge-to-edge for an app targeting API 35 or above, and this
 * one targets 36 (`scripts/check-repo-rules.sh` §`REL002`). So on the owner's
 * Pixel Tablet the WebView is the WHOLE display and the system bars are drawn
 * over it, reported through the safe-area insets — not taken off the
 * viewport's height. `rideview.browser.spec.ts` used to model the second
 * mechanism, with a guessed 1280×720, and the guess hid #439: a full-height
 * shell that ALSO added the insets scrolled by exactly their sum.
 *
 * ⚠️ **How the insets get in, and why this and not a custom property.**
 * `theme.css` §`--oyl-safe-top` reads Capacitor's injected
 * `--safe-area-inset-*` first and `env(safe-area-inset-*)` second.
 * `ride-harness.tsx` §`setSafeArea` already sets the first, which proves the
 * stylesheet honours a variable. This sets the SECOND, through the DevTools
 * protocol's `Emulation.setSafeAreaInsetsOverride`, so `env()` itself reports
 * the insets — the engine's own mechanism, measured in the pinned Chromium to
 * resolve `padding-top: env(safe-area-inset-top)` to 36 px. It needs the
 * `viewport-fit=cover` every harness page already carries.
 *
 * ⚠️ Chromium only, and experimental in the protocol. If a Playwright bump
 * drops it, `apply` throws rather than silently measuring a page with no
 * insets — and every #439 case also asserts the insets it was given are the
 * ones the page resolved.
 */

import type { Page } from '@playwright/test';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** No insets at all: a desktop browser. */
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * ⚠️ **Read off the device, not guessed.** The owner's Pixel Tablet, landscape,
 * 2026-09-21, `main` at `a9f07d0`, over `apps/mobile/tools/webview-probe.mjs`:
 * `innerWidth × innerHeight` 1280 × 800, safe-area insets top 36, bottom 32,
 * left 0, right 0 (#439).
 */
export const PIXEL_TABLET_LANDSCAPE_INSETS: Insets = { top: 36, right: 0, bottom: 32, left: 0 };

/**
 * ⚠️ **NOT read off the device.** #439 asks for portrait at 800×1280 "with
 * the same insets"; nobody has read the portrait insets, and on a tablet the
 * status bar and a gesture bar usually stay at the top and bottom when it
 * turns — so this is the landscape reading reused, and says so.
 * `docs/validation/0002-android-shell-and-game.md` Part Q asks for it.
 */
export const PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED: Insets = PIXEL_TABLET_LANDSCAPE_INSETS;

/** Tell the engine the display has these insets, before anything is laid out. */
export async function applyInsets(page: Page, insets: Insets): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { ...insets } });
}

/** What `env(safe-area-inset-*)` resolves to in the page, read back. */
export async function resolvedInsets(page: Page): Promise<Insets> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.append(probe);
    const style = window.getComputedStyle(probe);
    const read = {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    };
    probe.remove();
    return read;
  });
}
