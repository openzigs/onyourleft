// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

/** What every part takes besides its own data. */
export interface IllustrationProps {
  /** Sizing from the screen that places the part. The kit sets no size. */
  readonly className?: string | undefined;
}

/**
 * The one `<svg>` every part renders — #938's house rule, in one place.
 *
 * `aria-hidden` and `focusable="false"`, and nothing inside it is text: no
 * `<text>`, `<title>` or `<desc>`, because art is decoration and the words
 * beside it carry the meaning (epic #935, principle 1; WCAG 2.2 SC 1.4.5).
 * `focusable` is for the legacy engines that made an `<svg>` a tab stop.
 *
 * `preserveAspectRatio` is the part's to choose: a scene layer is cropped to
 * fill its box (`slice`), a glyph or a rider is fitted inside it (`meet`), and
 * a data shape is stretched to it (`none`), because a profile's width is the
 * route's length and not a proportion.
 */
export function IllustrationSvg({
  className,
  viewBox,
  aspect,
  children,
}: IllustrationProps & {
  readonly viewBox: string;
  readonly aspect: 'xMidYMid slice' | 'xMidYMid meet' | 'xMidYMax slice' | 'none';
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      preserveAspectRatio={aspect}
      viewBox={viewBox}
    >
      {children}
    </svg>
  );
}

/** A number for a path, to two decimal places and no more. */
export function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}
