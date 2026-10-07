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
 * the same, which is why there are two wordmark variants. The full logo's navy
 * letters sit on its own white sticker in both palettes; what differs is that
 * the light variant is laid on a soft shadow of its outline, so the white
 * sticker has an edge on the light palette's white canvas.
 *
 * ## The full logo is ONE picture, chosen by palette — #972, #1136
 *
 * The wordmark keeps the two-picture switch above: it is outside the view
 * that suspends (below) and its two files are 48 KB together. The full logo's
 * two are about 490 KB together, and About used to fetch both on every first
 * visit to draw one. So {@link FullLogo} renders ONE `<img>`, whose source is
 * the picture for the palette in force read from `data-theme` through
 * `design/theme-selection.ts` §`watchDocumentTheme` — the same attribute
 * `theme.css` keys on, so the picture still cannot disagree with the page,
 * and a change of palette (Settings, the device, another tab) swaps the
 * source. ⚠️ Both files are still PRECACHED, deliberately: a rider can change
 * palette offline (Settings, or *Match this device* at dusk), and a picture
 * that was never fetched would then be missing from an About page that
 * otherwise works offline. What #972 bought is the bytes a visit fetches, not
 * the bytes an install caches.
 *
 * ⚠️ **It is `loading="lazy"`, and that is what lets About paint without it**
 * (#1136). React 19.3 holds the commit of a transition for an `<img>` inside a
 * `<ViewTransition>` (every view is, #945) until the picture has loaded or
 * about 800 ms have passed — a "suspensey" image — unless it has an `onLoad`
 * or `loading="lazy"` (`react-dom` §`maySuspendCommit`). Without it a rider on
 * a slow device or network saw "Loading this page…" under About's heading
 * while a decorative picture loaded. `width` and `height` are the picture's
 * own, so the box is reserved before it arrives and nothing moves when it
 * does. `browser/logo.browser.spec.ts` holds the page to it with the logo's
 * request held back, against a control that is the old markup.
 */

import { useSyncExternalStore, type JSX } from 'react';

import { documentTheme, watchDocumentTheme } from '../design/theme-selection';
import type { Theme } from '../design/tokens';

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

/** The words of the full logo: the name, and nothing else (the owner dropped the tagline). */
export const FULL_LOGO_TEXT = 'On Your Left';

/** One picture of the full logo: its file and its own size in pixels. */
export interface LogoPicture {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The full logo's picture for each palette. The sizes are the files' own,
 * which `Brand.test.tsx` reads back out of each PNG's header.
 */
export const FULL_LOGO_PICTURES: Readonly<Record<Theme, LogoPicture>> = {
  light: { src: logoLight, width: 512, height: 412 },
  dark: { src: logoDark, width: 512, height: 408 },
};

function subscribeToDocumentTheme(onChange: () => void): () => void {
  return watchDocumentTheme(document, onChange);
}

function readDocumentTheme(): Theme {
  return documentTheme(document);
}

/** The full logo — the emblem, the wordmark and its sticker outline — as About shows it. */
export function FullLogo(): JSX.Element {
  const picture =
    FULL_LOGO_PICTURES[useSyncExternalStore(subscribeToDocumentTheme, readDocumentTheme)];
  return (
    <p className="oyl-brand-logo">
      <span className="oyl-visually-hidden">{FULL_LOGO_TEXT}</span>
      <img
        className="oyl-brand-logo__image"
        src={picture.src}
        width={picture.width}
        height={picture.height}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </p>
  );
}
