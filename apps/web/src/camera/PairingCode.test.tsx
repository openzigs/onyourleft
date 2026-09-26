// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A pairing code on the screen — #529, and since #550's review a code whose
 * drawing library is loaded when the first code is shown rather than at
 * launch.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import {
  PairingCode,
  PAIRING_CODE_DRAWING,
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
