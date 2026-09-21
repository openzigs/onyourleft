// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The navigation's icons — #427.
 *
 * ## Why they are drawn here and not installed
 *
 * Four glyphs. An icon SET as a dependency would be a
 * licence answer in both of this repository's gates — `DEP001` for the
 * package's own licence, and since ADR 0025 `DEP002`, which admits no copyleft
 * in an app's distributed closure — and a bundle cost, for five shapes. So
 * they are authored here, as source, under this directory's
 * `AGPL-3.0-or-later` like every other line in `apps/`: plain geometry, a
 * handful of circles and lines on a 24-unit grid, drawn for this file and
 * copied from nothing. ADR 0009 L1 forbids reproducing a competitor's icon set
 * as a set; these are nobody's set.
 *
 * ⚠️ **Decoration, never the name.** Every navigation item carries a visible
 * text label beside its icon, so each icon is `aria-hidden` and the link is
 * named by its words — which a speech-control user can say and a sighted one
 * can read. An icon-only rail would need `aria-label`s; this one never is.
 */

import type { JSX } from 'react';

import type { NavIconName } from './routes';

const SHAPES: Record<NavIconName, JSX.Element> = {
  // Two wheels and the frame between them.
  ride: (
    <>
      <circle cx="6" cy="16" r="4" />
      <circle cx="18" cy="16" r="4" />
      <path d="M6 16l4-7h5l3 7M10 9l3 7h-7M13 6h3" />
    </>
  ),
  // A dial with two hands, and the arrow of time turning back.
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  // A winding road from a start dot to a finish pin.
  routes: (
    <>
      <circle cx="5" cy="19" r="2" />
      <path d="M7 19h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h4" />
      <path d="M18 3.5a2.5 2.5 0 0 1 2.5 2.5c0 2-2.5 4.5-2.5 4.5S15.5 8 15.5 6A2.5 2.5 0 0 1 18 3.5z" />
    </>
  ),
  // Three dots: everything else.
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
};

export function NavIcon({ name }: { readonly name: NavIconName }): JSX.Element {
  return (
    <svg
      className="oyl-nav-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
