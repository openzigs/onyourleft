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
 */

import { useMemo, type JSX } from 'react';

import { pairingCodeModules } from './side-link-qr';

/** The quiet zone, in modules: the QR specification's four. */
const QUIET_ZONE = 4;

export interface PairingCodeProps {
  /** The code's text. */
  readonly code: string;
  /** What the picture is for, which is its accessible name. */
  readonly label: string;
}

export function PairingCode({ code, label }: PairingCodeProps): JSX.Element {
  const { size, path } = useMemo(() => {
    const modules = pairingCodeModules(code);
    const parts: string[] = [];
    for (const [row, cells] of modules.entries()) {
      for (const [column, dark] of cells.entries()) {
        if (dark) {
          parts.push(`M${String(column + QUIET_ZONE)} ${String(row + QUIET_ZONE)}h1v1h-1z`);
        }
      }
    }
    return { size: modules.length + QUIET_ZONE * 2, path: parts.join('') };
  }, [code]);
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
