// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the shell half of the browser gate drives — #307's review.
 *
 * It renders the **real** `shell/AppShell.tsx`, with the **real** `ROUTES`
 * table, under the **real** `design/theme.css`. Nothing here is a stand-in, for
 * the reason `hud-harness.tsx` gives: a layout measured against a stylesheet of
 * the harness's own would be a measurement of the harness.
 *
 * ## What it exists to catch, and why no other gate could
 *
 * #307 added `position: sticky` to `.oyl-header` and `scroll-margin-top` to
 * `.oyl-main`, and the review measured what they cost: at 320×256 — the
 * viewport WCAG 2.2 SC 1.4.10 names — the header was **178 px of 256**, and the
 * `scroll-margin-top` that was supposed to clear it was 80 px, so "Skip to main
 * content" landed the `<h1>` entirely *behind* the header on a phone.
 *
 * Every gate this repository has was green throughout:
 *
 * - `test:a11y` renders every route into **jsdom**, which performs no layout
 *   and resolves no custom property (CLAUDE.md §4e). It cannot measure a pixel,
 *   so `position`, `z-index` and `scroll-margin-top` are invisible to it.
 * - `theme.a11y.test.ts` reads `theme.css` as a **file**. It can see that a
 *   declaration is present; it cannot see what the declaration does.
 * - the browser gate had a map page, a renderer page and a HUD page, and **no
 *   page that rendered the shell at all** — the chrome was the one surface a
 *   real engine never laid out.
 *
 * So the one thing this page adds is a **real Chromium doing real layout over
 * the shipping stylesheet and the shipping markup**, read back from the browser
 * rather than computed here.
 *
 * ## Why the shell is rendered with no ports
 *
 * Every `AppShellProps` member but `capabilities` is optional, and each view
 * handed `undefined` renders its own honest explanation rather than crashing —
 * which is the state the accessibility suite already audits every route in. The
 * measurements this page exists for are all of the **chrome**: the header, the
 * skip link, `main`'s box and the `h1` inside it. None of them depends on which
 * view is below, so wiring a store here would add a database to a layout gate
 * and change no number it reads.
 *
 * ## What this page does NOT prove
 *
 * That the shell looks right. There is no reference image and ADR 0009 forbids
 * deriving one from another product. This is a **layout** check and nothing
 * more: it says what fraction of a viewport the chrome takes and where a
 * fragment jump lands. It says nothing about colour — `contrast.a11y.test.ts`
 * owns that — and nothing about a real phone, because a 320 px viewport in a
 * headless Chromium is not a handlebar in the rain.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { AppShell } from '../src/shell/AppShell';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

/**
 * A browser with no Bluetooth, which is what a headless Chromium is.
 *
 * The same probe `degradation.a11y.test.tsx` uses. It selects the honest
 * cannot-pair-here branch of the Devices screen, and it changes nothing about
 * the chrome this page measures.
 */
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/**
 * How much taller than any measured viewport the document is made.
 *
 * ⚠️ **This is the control, and without it most of the spec could not fail.** A
 * fragment jump — the skip link, `AppShell`'s focus move on a route change —
 * scrolls the target up by `scroll-margin-top`, and a page that is already
 * shorter than the viewport **cannot scroll at all**: the browser leaves
 * `scrollY` at 0, the `h1` stays where it was, and an assertion that it clears
 * the header passes while measuring nothing. That is exactly what the first run
 * of this harness did — `scrollY=0` and "visible" at every viewport from
 * 320×640 up, including the ones the defect was reported on.
 *
 * The shell handed no ports renders short views, so the document is extended
 * here. The real product does not need this: its views are lists of rides and
 * forms of settings, and `.oyl-shell` grows with them.
 *
 * ## ⚠️ Where it goes is load-bearing, and two obvious places are both wrong
 *
 * It is appended **inside `.oyl-main`**, at the end. Both of the other
 * candidates were tried, and each made a different assertion vacuous — which is
 * why they are written down instead of left as a preference.
 *
 * **Not `document.body`, after the shell.** `position: sticky` is confined to
 * its own containing block, so the header can only stay pinned while
 * `.oyl-shell` is on screen. A spacer after the shell makes the *document*
 * scrollable while leaving the shell one viewport tall, so scrolling down
 * carries the whole shell — header included — off the top. The header then
 * measures as covering **0 px**, and "persistent chrome is within budget" is
 * true of a page with no persistent chrome on it. That is not a hypothesis: the
 * chrome-budget test was written that way, passed, and then **passed again**
 * with `position: sticky` restored unconditionally, which is the exact defect it
 * exists to catch.
 *
 * **Not `.oyl-shell`, after the footer.** That fixes the above, and leaves
 * `.oyl-main` itself shorter than the viewport. A `focus()` on an element that
 * already fits on screen scrolls to the top of the document and stops, so
 * `scroll-margin-top` is never consulted — and the whole skip-link measurement
 * passes without the property it is about ever being applied. Measured: with the
 * spacer there, `scroll-margin-top: 5rem` — the value #307 shipped and the
 * review blocked on — left every assertion green.
 *
 * Inside `main`, `main` is taller than every viewport measured, which is what it
 * is in the product: its views are lists of rides and forms of settings. A
 * fragment jump onto it then behaves the way it does for a real reader, and
 * `shell.browser.spec.ts` §"the apparatus can see chrome that stays" and its
 * per-viewport scroll control are what stop either of the two failures above
 * returning unnoticed.
 *
 * React owns `.oyl-main`'s children, so an appended node is in principle
 * reconcilable away. In practice nothing here re-renders — there is no state
 * change and the spec changes no route — and the spec asserts the page is
 * scrollable at every viewport, so a spacer that stopped working is a red build
 * rather than a quiet one.
 */
const SPACER_PIXELS = 4000;

/**
 * The attribute the spec waits on.
 *
 * Set **after** a synchronous flush, so that its presence means React has
 * committed and the browser has a tree to lay out. Waiting on the element
 * instead would race: `#shell` is in the HTML before any script runs, so a
 * selector for it is satisfied by an empty page.
 */
const READY_ATTRIBUTE = 'data-oyl-shell-ready';

function main(): void {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('shell harness: #shell is missing from shell.html');
  }

  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell capabilities={NO_BLUETOOTH} />
      </StrictMode>,
    );
  });

  const region = document.querySelector('.oyl-main');
  if (region === null) {
    throw new Error('shell harness: AppShell rendered no .oyl-main to extend');
  }
  const spacer = document.createElement('div');
  spacer.dataset['oylSpacer'] = 'true';
  spacer.style.height = `${String(SPACER_PIXELS)}px`;
  spacer.setAttribute('aria-hidden', 'true');
  region.append(spacer);

  document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
}

main();
