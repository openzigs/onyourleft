// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { HEART_RATE_ZONE_NAMES, POWER_ZONE_NAMES } from '@onyourleft/domain';

import { BAND_TOKENS, HEART_RATE_BAND_TOKENS, type BandToken } from './tokens';

/** Which zones a key names: power's seven or heart rate's five. */
export type ZoneBasis = 'power' | 'heartRate';

const BASIS: Readonly<
  Record<
    ZoneBasis,
    {
      readonly tokens: readonly BandToken[];
      readonly names: readonly string[];
      readonly label: string;
    }
  >
> = {
  power: { tokens: BAND_TOKENS, names: POWER_ZONE_NAMES, label: 'Power zones' },
  heartRate: {
    tokens: HEART_RATE_BAND_TOKENS,
    names: HEART_RATE_ZONE_NAMES,
    label: 'Heart-rate zones',
  },
};

/** `bandVo2` → `oyl-zone-key__swatch--band-vo2`: the rule in `theme.css` §"THE ZONE KEY". */
export function zoneSwatchClass(token: BandToken): string {
  return `oyl-zone-key__swatch--${token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** The 0-based zones a drawing's band paths paint: those with a path to draw. */
export function zonesPainted(bands: readonly string[]): readonly number[] {
  return bands.flatMap((d, zone) => (d === '' ? [] : [zone]));
}

/** What a zone is called in a key: its number, from 1, and its name — "4 Threshold". */
export function zoneLabel(basis: ZoneBasis, index: number): string {
  const name = BASIS[basis].names[index] ?? '';
  return `${String(index + 1)} ${name}`;
}

/**
 * The zones a drawing paints, each by its number and name beside its colour —
 * #2039, ADR 0063 D-4. A zone colour is never the only signal (WCAG 2.2 SC
 * 1.4.1): whatever paints one renders this beside it, and
 * `a11y/zones.a11y.test.ts` fails any component that reads a zone colour and
 * does not.
 *
 * `zones` are the 0-based zones the drawing actually paints, so the key names
 * what is on the screen and nothing else; none, and it renders nothing. The
 * swatch is decoration (`aria-hidden`); the words are the key.
 */
export function ZoneKey({
  zones,
  basis = 'power',
}: {
  readonly zones: readonly number[];
  readonly basis?: ZoneBasis;
}): JSX.Element | null {
  const { tokens, label } = BASIS[basis];
  const shown = [...new Set(zones)]
    .filter((zone) => zone >= 0 && zone < tokens.length)
    .sort((a, b) => a - b);
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul aria-label={label} className="oyl-zone-key" data-oyl-zone-key={basis}>
      {shown.map((zone) => (
        <li key={zone} className="oyl-zone-key__zone" data-oyl-zone={String(zone + 1)}>
          <span
            aria-hidden="true"
            className={`oyl-zone-key__swatch ${zoneSwatchClass(tokens[zone] ?? 'bandRecovery')}`}
          />
          {zoneLabel(basis, zone)}
        </li>
      ))}
    </ul>
  );
}
