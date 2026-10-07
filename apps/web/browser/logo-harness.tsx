// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * About's logo never holds the page — #1136.
 *
 * React 19.3 holds the commit of a transition for an `<img>` inside a
 * `<ViewTransition>` until the picture has loaded or 800 ms have passed
 * (`react-dom` §`maySuspendCommit`, §`SUSPENSEY_IMAGE_TIMEOUT`), unless it has
 * an `onLoad` or `loading="lazy"`. Every view in the shell is inside one
 * (`shell/AppShell.tsx`, #945), so About — the one view with a picture — waited
 * on its decorative logo before a rider saw any of it.
 *
 * This page is the shell's own arrangement and nothing else: a keyed
 * `<ViewTransition>` with the shell's props, a `Suspense` boundary with the
 * shell's fallback, and a navigation applied in `startTransition`, as
 * `shell/useRoute.ts` applies a menu navigation. What it navigates to is the
 * **real** `views/AboutView.tsx`, with the real `brand/Brand.tsx` §`FullLogo`.
 *
 * `window.__oylLogo.go()` navigates and resolves with how long, from the
 * transition's start, About's text took to reach the DOM.
 *
 * ## The control
 *
 * `logo.html?logo=before` navigates to the same view with the logo as it was
 * before #1136 beside it — a plain `<img>` with no `loading` and no `onLoad`.
 * With the logo's request held back, that one must hold the commit; without
 * it, "the text came at once" would be as true of a page whose image never
 * suspended anything for some other reason.
 */

import { startTransition, StrictMode, Suspense, useState, ViewTransition, type JSX } from 'react';
import { createRoot } from 'react-dom/client';

import logoLight from '../src/brand/logo-light.png';
import '../src/design/theme.css';
// After `theme.css`, as on every page (`a11y/tailwind.a11y.test.ts`).
import '../src/design/tailwind.css';
import { ViewLoading } from '../src/shell/lazy-view';
import { AboutView } from '../src/views/AboutView';

const BEFORE = new URLSearchParams(location.search).get('logo') === 'before';

/** About's first heading, which is what "the page's text is shown" looks for. */
const ABOUT_TEXT_SELECTOR = '#logo-main h2';

declare global {
  interface Window {
    __oylLogo?: {
      /** Navigate to About; resolve with the ms until its text was in the DOM. */
      go(): Promise<number>;
    };
  }
}

let navigate: (() => void) | undefined;

function Harness(): JSX.Element {
  const [route, setRoute] = useState<'home' | 'about'>('home');
  navigate = () => {
    startTransition(() => {
      setRoute('about');
    });
  };
  return (
    <ViewTransition key={route} enter="oyl-route" exit="oyl-route" update="none" default="none">
      <Suspense fallback={<ViewLoading />}>
        {route === 'home' ? (
          <p>Home</p>
        ) : (
          <>
            {BEFORE ? (
              // ⚠️ The markup #1136 replaced, on purpose: the control.
              <img src={logoLight} alt="" />
            ) : null}
            <AboutView />
          </>
        )}
      </Suspense>
    </ViewTransition>
  );
}

window.__oylLogo = {
  go: () =>
    new Promise<number>((resolve) => {
      const start = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector(ABOUT_TEXT_SELECTOR) !== null) {
          observer.disconnect();
          resolve(performance.now() - start);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      navigate?.();
    }),
};

const root = document.getElementById('logo-main');
if (root === null) throw new Error('logo.html has no #logo-main');
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
