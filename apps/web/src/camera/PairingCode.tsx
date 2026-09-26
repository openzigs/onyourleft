// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A pairing code on the screen, for the other device's camera** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1.
 *
 * One SVG path over a white square: every dark module of the code, drawn at
 * one unit a module inside a four-module quiet zone, which is the margin the
 * QR specification asks for and what a reader needs to find the corners.
 *
 * ⚠️ **Dark on light, and never themed.** The colours are the canvas and ink
 * tokens, and `forced-color-adjust: none` keeps a high-contrast mode from
 * repainting a code into something a camera cannot read (`theme.css`
 * §"THE PAIRING CODE"). A code has no text alternative a person could use —
 * the credentials in it are for a camera — so the image is named for what it
 * is FOR, and the sentence beside it says what to do.
 *
 * ⚠️ **The drawing library is loaded when a code is first shown, not at
 * launch** (#550's review). `side-link-qr.ts` names both QR libraries, and a
 * static import here put them in the entry chunk — every cold start paid for a
 * feature used only while pairing. Until the chunk arrives the picture's place
 * says the code is being drawn; if it never arrives, it says so. The chunk is
 * in the service worker's precache like every other one the build emits
 * (`tools/precache/precache.ts`), so an offline tablet draws it too.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';

import type { pairingCodeModules } from './side-link-qr';

/** What draws a code: `side-link-qr.ts` §`pairingCodeModules`, once it has loaded. */
export type PairingCodeDrawer = typeof pairingCodeModules;

/**
 * Load the drawing library. The module system keeps what it has loaded, so a
 * second code costs a resolved promise rather than a fetch.
 *
 * ⚠️ **It may keep a failure too** (#550's second review): the HTML module
 * map has historically cached a failed fetch for the life of the page
 * (whatwg/html#6768), and whether the pinned Chromium and the Android WebView
 * have stopped doing so was not confirmed. So nothing here promises that a
 * second try on the same page asks the network again, and
 * {@link PAIRING_CODE_UNDRAWN} tells the rider to reload rather than to leave
 * the screen and come back.
 */
export async function loadPairingCodeDrawer(): Promise<PairingCodeDrawer> {
  return (await import('./side-link-qr')).pairingCodeModules;
}

/** What stands in the code's place before it can be drawn. */
export const PAIRING_CODE_DRAWING = 'Drawing the pairing code…';
/** What stands in its place when the drawing library would not load. */
export const PAIRING_CODE_UNDRAWN =
  'This device could not load what draws the pairing code. Reload the page, or close the app and ' +
  'open it again, then try again.';

/** The quiet zone, in modules: the QR specification's four. */
const QUIET_ZONE = 4;

export interface PairingCodeProps {
  /** The code's text. */
  readonly code: string;
  /** What the picture is for, which is its accessible name. */
  readonly label: string;
  /**
   * How the drawer is loaded. A test's way to make the load fail; the screens
   * leave it alone.
   */
  readonly load?: () => Promise<PairingCodeDrawer>;
}

export function PairingCode({
  code,
  label,
  load = loadPairingCodeDrawer,
}: PairingCodeProps): JSX.Element {
  const [draw, setDraw] = useState<PairingCodeDrawer | 'failed' | undefined>(undefined);
  useEffect(() => {
    if (draw !== undefined) {
      return;
    }
    let current = true;
    load().then(
      (loaded) => {
        if (current) {
          setDraw(() => loaded);
        }
      },
      () => {
        if (current) {
          setDraw('failed');
        }
      },
    );
    return () => {
      current = false;
    };
  }, [draw, load]);
  if (draw === undefined) {
    return <p role="status">{PAIRING_CODE_DRAWING}</p>;
  }
  if (draw === 'failed') {
    return (
      <StatusMessage tone="warning" live>
        {PAIRING_CODE_UNDRAWN}
      </StatusMessage>
    );
  }
  return <DrawnCode code={code} label={label} draw={draw} />;
}

function DrawnCode({
  code,
  label,
  draw,
}: PairingCodeProps & { readonly draw: PairingCodeDrawer }): JSX.Element {
  const { size, path } = useMemo(() => {
    const modules = draw(code);
    const parts: string[] = [];
    for (const [row, cells] of modules.entries()) {
      for (const [column, dark] of cells.entries()) {
        if (dark) {
          parts.push(`M${String(column + QUIET_ZONE)} ${String(row + QUIET_ZONE)}h1v1h-1z`);
        }
      }
    }
    return { size: modules.length + QUIET_ZONE * 2, path: parts.join('') };
  }, [code, draw]);
  return (
    <svg
      className="oyl-pairing-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      data-oyl-pairing-code="true"
    >
      <rect className="oyl-pairing-code__paper" width={size} height={size} />
      <path className="oyl-pairing-code__ink" d={path} />
    </svg>
  );
}
