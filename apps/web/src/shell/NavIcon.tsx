// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The navigation's icons — #427, drawn by Lucide since #673.
 *
 * ## Why they come from a package now
 *
 * [ADR 0034](../../../../docs/adr/0034-lucide-icons.md) adopts `lucide-react`
 * (ISC, with MIT for the icons derived from Feather) and reverses what this
 * header used to say: that five glyphs were authored here, as source, rather
 * than installed. The owner ruled on #654 that the app adopts one icon set and
 * ships only the icons it uses; this file is the first caller.
 *
 * ⚠️ **Named imports only, and never a dynamic one.** `lucide-react/dynamic`
 * maps every icon in the set to a lazy import, which would put all of them in
 * the build and, because the precache is derived from the build (#406), in
 * every rider's first download. `eslint.config.js` refuses every subpath of
 * the package and both names, and `tools/bundle/icon-modules.ts` fails the
 * build when the number of Lucide icon modules in it differs from the number
 * of icons imported in source.
 *
 * ⚠️ **The artwork is Lucide's and is not copied into this file.** Pasting its
 * paths here would put ISC and MIT artwork under this directory's
 * `AGPL-3.0-or-later` header, which is §3a's misdeclaration. The notice travels
 * in the third-party notices document instead (#664).
 *
 * ⚠️ **Decoration, never the name.** Every navigation item carries a visible
 * text label beside its icon, so each icon is `aria-hidden` and the link is
 * named by its words — which a speech-control user can say and a sighted one
 * can read. It is set here explicitly rather than left to Lucide's own default,
 * so a Lucide release that changed the default could not change this. An
 * icon-only control would carry `aria-label` on the CONTROL, never a `<title>`
 * on the SVG (ADR 0034 D-4).
 */

import type { JSX } from 'react';
import { Bike, Ellipsis, House, RotateCcwClock, Route, type LucideIcon } from 'lucide-react';

import type { NavIconName } from './routes';

/** One stroke for every icon, so the five read as one set. */
const NAV_ICON_STROKE_WIDTH = 1.8;

const SHAPES: Record<NavIconName, LucideIcon> = {
  ride: Bike,
  // ⚠️ `History` in #673's list is an ALIAS of this icon in lucide-react
  // 1.48.0 (its class is `lucide-rotate-ccw-clock`); the canonical name is
  // imported so a major release that drops the alias cannot drop the icon.
  history: RotateCcwClock,
  routes: Route,
  home: House,
  more: Ellipsis,
};

export function NavIcon({ name }: { readonly name: NavIconName }): JSX.Element {
  const Shape = SHAPES[name];
  return (
    <Shape
      className="oyl-nav-icon"
      size={24}
      color="currentColor"
      strokeWidth={NAV_ICON_STROKE_WIDTH}
      aria-hidden="true"
      focusable="false"
    />
  );
}
