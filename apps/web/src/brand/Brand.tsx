// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's wordmark and full logo, in the page's two palettes — #965.
 *
 * The pictures are the owner's art (CC-BY-4.0, credited on Credits), cut from
 * the sheets the owner supplied by `tools/brand/derive_brand.py`; each comes in
 * a light-palette variant (navy letters) and a dark-palette one (letters in the
 * dark palette's `ink`), because navy letters on the dark header are not
 * legible. Both are rendered and `theme.css` §"The owner's wordmark and logo"
 * shows the one for the palette in force, by `data-theme` — the same switch
 * every colour token follows (#672), so the picture can never disagree with
 * the page around it.
 *
 * ⚠️ **The words are text, and the pictures are decorative.** Each picture has
 * `alt=""` and the name is a visually hidden span beside them. Giving a picture
 * the name instead would hide the name from assistive technology whenever that
 * picture is the one `display: none` takes away, and naming both would say it
 * twice wherever no stylesheet applies (the jsdom suite, a reader mode). So the
 * accessible name, the route sentences and the `banner` landmark's label are
 * exactly what they were before the pictures arrived.
 *
 * ⚠️ A logo is exempt from WCAG 2.2 SC 1.4.3 ("Logotypes"), so the arrow's blue
 * is not held to a contrast pair; the letters are legible on both headers all
 * the same, which is why there are two variants.
 */

import type { JSX } from 'react';

import logoDark from './logo-dark.png';
import logoLight from './logo-light.png';
import wordmarkDark from './wordmark-dark.png';
import wordmarkLight from './wordmark-light.png';

interface BrandPictureProps {
  /** The words the picture says, which assistive technology reads instead. */
  readonly text: string;
  readonly light: string;
  readonly dark: string;
  readonly className: string;
}

function BrandPicture(props: BrandPictureProps): JSX.Element {
  return (
    <>
      <span className="oyl-visually-hidden">{props.text}</span>
      <img
        className={`${props.className} oyl-brand--light`}
        src={props.light}
        alt=""
        draggable={false}
      />
      <img
        className={`${props.className} oyl-brand--dark`}
        src={props.dark}
        alt=""
        draggable={false}
      />
    </>
  );
}

/** The wordmark, as the header shows it, saying `text`. */
export function Wordmark(props: { readonly text: string }): JSX.Element {
  return (
    <BrandPicture
      text={props.text}
      light={wordmarkLight}
      dark={wordmarkDark}
      className="oyl-wordmark__image"
    />
  );
}

/** The words of the full logo: the name and the owner's tagline. */
export const FULL_LOGO_TEXT = 'On Your Left: agentic cycling trainer';

/** The full logo — the emblem, the wordmark and the tagline — as About shows it. */
export function FullLogo(): JSX.Element {
  return (
    <p className="oyl-brand-logo">
      <BrandPicture
        text={FULL_LOGO_TEXT}
        light={logoLight}
        dark={logoDark}
        className="oyl-brand-logo__image"
      />
    </p>
  );
}
