// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A pairing code on the screen — #529, and since #550's review a code whose
 * drawing library is loaded when the first code is shown rather than at
 * launch.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { contrastRatio } from '../design/contrast';
import { mount, settle, type Mounted } from '../testing/mount';

import {
  PairingCode,
  PAIRING_CODE_DRAWING,
  PAIRING_CODE_INK,
  PAIRING_CODE_PAPER,
  PAIRING_CODE_QUIET_ZONE,
  PAIRING_CODE_UNDRAWN,
  type PairingCodeDrawer,
} from './PairingCode';

const LABEL = 'Pairing code for the side-camera phone to scan';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function drawn(): Element | null {
  return document.querySelector('[data-oyl-pairing-code]');
}

describe('a pairing code, drawn by a library loaded only when one is shown', () => {
  it('says so in the code’s place when the library will not load', async () => {
    const refused = (): Promise<PairingCodeDrawer> => Promise.reject(new Error('offline'));
    mounted = await mount(<PairingCode code="OYL1:x" label={LABEL} load={refused} />);
    await settle();
    expect(drawn()).toBeNull();
    expect(document.body.textContent).toContain(PAIRING_CODE_UNDRAWN);
  });

  it('says it is drawing, and then draws', async () => {
    mounted = await mount(<PairingCode code="OYL1:x" label={LABEL} />);
    // The first frame: the chunk has been asked for and has not arrived.
    expect(drawn()).toBeNull();
    expect(document.body.textContent).toContain(PAIRING_CODE_DRAWING);
    await expect.poll(() => drawn()?.getAttribute('aria-label'), { timeout: 5000 }).toBe(LABEL);
    expect(document.body.textContent).not.toContain(PAIRING_CODE_DRAWING);
  });
});

describe('a code a camera reads easily — #1108', () => {
  /** A drawer that draws one fixed 21 × 21 grid with its top-left module dark. */
  const grid = (): PairingCodeDrawer => (): readonly (readonly boolean[])[] =>
    Array.from({ length: 21 }, (_, row) =>
      Array.from({ length: 21 }, (__, column) => row === 0 && column === 0),
    );

  it('is black on white, the most contrast a screen has', async () => {
    mounted = await mount(
      <PairingCode code="OYL1:x" label={LABEL} load={async () => Promise.resolve(grid())} />,
    );
    await settle();
    expect(drawn()?.querySelector('rect')?.getAttribute('fill')).toBe(PAIRING_CODE_PAPER);
    expect(drawn()?.querySelector('path')?.getAttribute('fill')).toBe(PAIRING_CODE_INK);
    expect(contrastRatio(PAIRING_CODE_INK, PAIRING_CODE_PAPER)).toBeCloseTo(21, 5);
  });

  it('keeps a quiet zone of at least four modules on every side', async () => {
    mounted = await mount(
      <PairingCode code="OYL1:x" label={LABEL} load={async () => Promise.resolve(grid())} />,
    );
    await settle();
    expect(PAIRING_CODE_QUIET_ZONE).toBeGreaterThanOrEqual(4);
    const size = 21 + PAIRING_CODE_QUIET_ZONE * 2;
    expect(drawn()?.getAttribute('viewBox')).toBe(`0 0 ${String(size)} ${String(size)}`);
    // The one dark module is drawn four modules in from the corner.
    expect(drawn()?.querySelector('path')?.getAttribute('d')).toBe(
      `M${String(PAIRING_CODE_QUIET_ZONE)} ${String(PAIRING_CODE_QUIET_ZONE)}h1v1h-1z`,
    );
  });

  it('is drawn as wide as the screen allows when asked, and at its usual size otherwise', async () => {
    mounted = await mount(
      <>
        <PairingCode code="a" label="wide" fullWidth load={async () => Promise.resolve(grid())} />
        <PairingCode code="b" label="usual" load={async () => Promise.resolve(grid())} />
      </>,
    );
    await settle();
    const [wide, usual] = [...document.querySelectorAll('[data-oyl-pairing-code]')];
    expect(wide?.classList.contains('oyl-pairing-code--full')).toBe(true);
    expect(usual?.classList.contains('oyl-pairing-code--full')).toBe(false);
  });
});
