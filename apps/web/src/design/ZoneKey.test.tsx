// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import type { JSX } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HEART_RATE_ZONE_NAMES, POWER_ZONE_NAMES } from '@onyourleft/domain';

import { BAND_TOKENS, HEART_RATE_BAND_TOKENS } from './tokens';
import { ZoneKey, zoneLabel, zoneSwatchClass } from './ZoneKey';

function rendered(element: JSX.Element): Element {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(element);
  return holder;
}

describe('ZoneKey, heart-rate basis — #2039, ADR 0063 D-4', () => {
  const root = rendered(<ZoneKey basis="heartRate" zones={[0, 1, 2, 3, 4]} />);

  it('is labelled as heart-rate zones and says so in its data attribute', () => {
    const list = root.querySelector('ul');
    expect(list?.getAttribute('aria-label')).toBe('Heart-rate zones');
    expect(list?.getAttribute('data-oyl-zone-key')).toBe('heartRate');
  });

  it('names each zone by its heart-rate name, not the power one', () => {
    const words = [...root.querySelectorAll('li')].map((li) => li.textContent?.trim());
    expect(words).toEqual(HEART_RATE_ZONE_NAMES.map((name, i) => `${String(i + 1)} ${name}`));
    expect(zoneLabel('heartRate', 0)).toBe(`1 ${HEART_RATE_ZONE_NAMES[0] ?? ''}`);
  });

  it("paints zone n in power zone n's colour, by position", () => {
    const swatches = [...root.querySelectorAll('li')].map(
      (li) => li.querySelector('span')?.className ?? '',
    );
    expect(swatches).toEqual(
      HEART_RATE_BAND_TOKENS.map((token) => `oyl-zone-key__swatch ${zoneSwatchClass(token)}`),
    );
    expect(HEART_RATE_BAND_TOKENS).toEqual(BAND_TOKENS.slice(0, 5));
  });

  it('drops a zone the basis does not have: heart rate has five, not seven', () => {
    const six = rendered(<ZoneKey basis="heartRate" zones={[4, 5, 6]} />);
    expect([...six.querySelectorAll('li')].map((li) => li.getAttribute('data-oyl-zone'))).toEqual([
      '5',
    ]);
    expect(rendered(<ZoneKey basis="heartRate" zones={[5, 6]} />).querySelector('ul')).toBeNull();
  });
});

describe('ZoneKey, power basis', () => {
  it('is the default, labelled as power zones, with the power names', () => {
    const root = rendered(<ZoneKey zones={[5, 6]} />);
    expect(root.querySelector('ul')?.getAttribute('aria-label')).toBe('Power zones');
    expect([...root.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      `6 ${POWER_ZONE_NAMES[5] ?? ''}`,
      `7 ${POWER_ZONE_NAMES[6] ?? ''}`,
    ]);
  });
});
