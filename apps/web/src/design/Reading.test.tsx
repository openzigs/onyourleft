// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A reading — #992. The numerals and the unit are two elements so they can be
 * two sizes, and the element's TEXT must still be the sentence it replaced,
 * because that is what a screen reader reads and what
 * `a11y/route-sentences.a11y.test.tsx` holds every route to. The sizes are
 * `theme.a11y.test.ts` §"#992 — a reading".
 */

import { afterEach, describe, expect, it } from 'vitest';

import { mount, type Mounted } from '../testing/mount';

import { Reading } from './Reading';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('a reading — #992', () => {
  it('draws the value and the unit apart, and reads as the sentence it replaced', async () => {
    mounted = await mount(<Reading value="42.2" unit="km" />);
    const reading = mounted.container.querySelector('.oyl-reading');
    expect(reading?.querySelector('.oyl-reading__value')?.textContent).toBe('42.2');
    expect(reading?.querySelector('.oyl-reading__unit')?.textContent).toBe('km');
    expect(reading?.textContent).toBe('42.2 km');
  });

  it('is the value alone when it has no unit — a time or a count', async () => {
    mounted = await mount(<Reading value="1:23:45" />);
    const reading = mounted.container.querySelector('.oyl-reading');
    expect(reading?.querySelector('.oyl-reading__unit')).toBeNull();
    expect(reading?.textContent).toBe('1:23:45');
  });
});
