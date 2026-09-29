// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The masking function (#839): every kind of detail it masks, hidden or not;
 * the ordinary cycling text it must leave alone; and the rider's guard.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  MASK_PLACEHOLDER,
  maskForHosted,
  PATTERNS_ONLY,
  readMaskingGuard,
  type MaskingGuard,
} from './hosted-mask';
import {
  fullWidth,
  personalDetailFaults,
  PLANTED_DETAILS,
  PLANTED_GUARD,
  plantedFreeText,
  plantedVariants,
  withInvisibles,
} from './personal-details-testing';

describe('each kind of detail is masked with its placeholder (#839)', () => {
  it.each(PLANTED_DETAILS.map((detail) => [detail.kind, detail.text] as const))(
    '%s: %s',
    (kind, text) => {
      const masked = maskForHosted(`Before ${text} after.`, PLANTED_GUARD);
      expect(masked).toBe(`Before ${MASK_PLACEHOLDER[kind]} after.`);
    },
  );

  it.each(PLANTED_DETAILS.map((detail) => [detail.kind, detail.text] as const))(
    '%s hidden with invisible characters or in full-width forms: %s',
    (kind, text) => {
      for (const hidden of [withInvisibles(text), fullWidth(text)]) {
        expect(maskForHosted(`Before ${hidden} after.`, PLANTED_GUARD), hidden).toBe(
          `Before ${MASK_PLACEHOLDER[kind]} after.`,
        );
      }
    },
  );

  it('masks every planted detail in free text, and the gate finds none left', () => {
    const text = plantedFreeText();
    expect(personalDetailFaults(text, plantedVariants())).not.toStrictEqual([]);
    expect(
      personalDetailFaults(maskForHosted(text, PLANTED_GUARD), plantedVariants()),
    ).toStrictEqual([]);
  });

  it.each([
    ['+1 415 555 0100', '[phone]'],
    ['020 7946 0958', '[phone]'],
    ['555.123.4567', '[phone]'],
    ['rider@club.co.uk', '[email]'],
    ['R I D E R＠EXAMPLE.COM', 'R I D E [email]'],
    ['http://a.example.com/x?y=1', '[link]'],
    ['myclub.co.uk', '[link]'],
    ['M1 1AE', '[postcode]'],
    ['rh5 6bu', '[postcode]'],
    ['CA 94103', 'CA [postcode]'],
    ['75001 Paris', '[postcode] Paris'],
    ['1000-001 Lisboa', '[postcode] Lisboa'],
    ['Via Roma 10', '[address]'],
    ['221B Baker Street', '[address]'],
    ['51.5N 0.12W', '[coordinates]'],
    ['51.50740 −0.12780', '[coordinates]'],
    ['51.5074   ,   -0.1278', '[coordinates]'],
    ['40.7128° N', '[coordinates]'],
  ])('%s', (text, expected) => {
    expect(maskForHosted(text, PATTERNS_ONLY)).toBe(expected);
  });

  it('keeps the punctuation a sentence put after a link', () => {
    expect(maskForHosted('See https://example.com/a.', PATTERNS_ONLY)).toBe('See [link].');
  });
});

describe('a coordinate written with its labels (#854 review)', () => {
  it.each([
    'lat 51.2503 lon -0.3302',
    'Lat: 51.25, Long: -0.33',
    'latitude=51.2503; longitude=-0.3302',
    'LAT 51.2 LNG -0.3',
  ])('%s', (text) => {
    expect(maskForHosted(`At ${text} today.`, PATTERNS_ONLY)).toBe('At [coordinates] today.');
  });

  it('leaves a lone number after a word that is not a label', () => {
    expect(maskForHosted('Lap 51.25 then long 12.5 min', PATTERNS_ONLY)).toBe(
      'Lap 51.25 then long 12.5 min',
    );
  });
});

describe('ordinary cycling text is not masked (#839)', () => {
  it.each([
    'Box Hill',
    'Three laps of Box Hill, then 2 Box Hill repeats.',
    '20 km',
    '4x8 min',
    'Zone 2',
    'Z2 2hr ride at 250 W',
    'FTP 250, 3.4 W/kg, 180 bpm max, 90 rpm.',
    'Heart rate by section: 142 148 151 155 158 160 162 165 170 171.',
    'Sections 1-3: 90-100 rpm, 250-300 W, 12.5 km, 3.2% average, 1200 kJ.',
    '{"section":3,"notes":"…"}',
    'Power 185.5, cadence 88.2, mean 3.25 W/kg.',
    'It lasted 3600 Seconds over 45 Kilometres.',
    'e.g. a steady 2x20 at 95%, then 1500 m of climbing.',
    'coverage 0.985, mean 190, max 410',
  ])('%s', (text) => {
    expect(maskForHosted(text, PATTERNS_ONLY)).toBe(text);
  });

  it('masks a cycling word when it is on the rider’s own list', () => {
    const guard: MaskingGuard = { words: ['Box Hill'], zones: [] };
    expect(maskForHosted('Three laps of box  hill today.', guard)).toBe(
      'Three laps of [masked] today.',
    );
  });

  it('masks a coarse pair inside a zone and not the same pair outside one', () => {
    expect(maskForHosted('At 52.20, 0.12 again', PLANTED_GUARD)).toBe('At [place] again');
    expect(maskForHosted('At 52.20, 0.12 again', PATTERNS_ONLY)).toBe('At 52.20, 0.12 again');
    expect(maskForHosted('At 53.20, 0.12 again', PLANTED_GUARD)).toBe('At 53.20, 0.12 again');
  });
});

describe('the rider’s words and zone labels (#839)', () => {
  it('matches whole words only, case-insensitively, with accents and invisibles folded', () => {
    const guard: MaskingGuard = { words: ['Cafe', 'Ann'], zones: [] };
    expect(maskForHosted('Stopped at the CAFÉ with ann, then Anna and Annex.', guard)).toBe(
      'Stopped at the [masked] with [masked], then Anna and Annex.',
    );
    expect(maskForHosted(`Met ${withInvisibles('Ann')} there`, guard)).toBe('Met [masked] there');
  });

  it('prefers the longest listed phrase, and never masks a placeholder', () => {
    const guard: MaskingGuard = { words: ['Old Town', 'Old Town Road', 'email'], zones: [] };
    expect(maskForHosted('Old Town Road, and rider@example.com', guard)).toBe(
      '[masked], and [email]',
    );
  });

  it('masks the whole of a listed word or label that starts inside another detail (#854 review)', () => {
    // An overlap used to drop the later match, so the part of it past the
    // earlier one left in clear: '12 Acacia Avenue Hotel' became '[address] Hotel'.
    expect(
      maskForHosted('Stayed at 12 Acacia Avenue Hotel.', { words: ['Avenue Hotel'], zones: [] }),
    ).toBe('Stayed at [address].');
    expect(maskForHosted('Past 12 Rose Lane Farm today', { words: ['Lane Farm'], zones: [] })).toBe(
      'Past [address] today',
    );
    const zone = PLANTED_GUARD.zones[0] as MaskingGuard['zones'][number];
    expect(
      maskForHosted('From 3 Mill Road End', { words: [], zones: [{ ...zone, label: 'Road End' }] }),
    ).toBe('From [address]');
  });

  it('ignores a one-character entry or label', () => {
    const guard: MaskingGuard = {
      words: ['a'],
      zones: [{ ...(PLANTED_GUARD.zones[0] as MaskingGuard['zones'][number]), label: 'x' }],
    };
    expect(maskForHosted('a x b', guard)).toBe('a x b');
  });

  it('leaves text that matches nothing exactly as it was, down to the character', () => {
    const text = 'Reply with JSON only, in exactly this form: {"notes":"…"} — ’quoted’ ﬁne';
    expect(maskForHosted(text, PLANTED_GUARD)).toBe(text);
  });
});

describe('the guard is read from the store (#839)', () => {
  it('reads the rider’s words and zones, tidied', async () => {
    const centre = geographicPosition(degreesLatitude(51), degreesLongitude(-1));
    const guard = await readMaskingGuard(
      {
        getAthlete: async () =>
          Promise.resolve({
            id: 'a' as never,
            displayName: 'Rider',
            createdAt: 0 as never,
            maskedWords: [' Priya ', 'priya'],
          }),
        listPrivacyZones: async () =>
          Promise.resolve([
            {
              id: 'z' as never,
              athleteId: 'a' as never,
              centre,
              radius: 300 as never,
              label: 'home',
              createdAt: 0 as never,
            },
          ]),
      },
      'a' as never,
    );
    expect(guard).toStrictEqual({
      words: ['Priya'],
      zones: [{ centre, radius: 300, label: 'home' }],
    });
  });

  it('rejects when the store cannot be read, rather than answering half a guard', async () => {
    await expect(
      readMaskingGuard(
        {
          getAthlete: async () => Promise.resolve(undefined),
          listPrivacyZones: async () => Promise.reject(new Error('blocked')),
        },
        'a' as never,
      ),
    ).rejects.toThrow('blocked');
  });
});

describe('masking stays linear on text built to make a pattern backtrack (#839)', () => {
  // A model's notes reach the summary step and are masked there, so the
  // patterns see text nobody on this device wrote. Measured on 2026-09-29 at
  // 2 to 9 ms each for 20 000 characters; the bound is two orders above that.
  it.each([
    ['letters', 'a'.repeat(20_000)],
    ['hyphenated labels', 'a-'.repeat(10_000)],
    ['dotted labels, then an @', `${'a.'.repeat(10_000)}@`],
    ['digits', '1'.repeat(20_000)],
    ['spaced digits', '1 '.repeat(10_000)],
    ['capitalised words after a number', '12 Aa Bb '.repeat(2_000)],
    ['decimals', '1.1 '.repeat(5_000)],
    // #854's review: shapes that took over a second at 100 000 characters.
    ['one long hyphenated word', `a${'-a'.repeat(50_000)}`],
    ['a digit, then a long run of spaces', `1${' '.repeat(50_000)}x`],
    ['a decimal, then a long run of spaces', `1.5${' '.repeat(50_000)}x`],
    ['a decimal and a hemisphere, then spaces', `1.5N${' '.repeat(50_000)}x`],
    ['two decimals far apart', `1.5${' '.repeat(50_000)}2.5${' '.repeat(50_000)}x`],
    ['a decimal and a comma, then spaces', `1.5,${' '.repeat(50_000)}x`],
    ['a labelled latitude, then spaces', `lat 1.5${' '.repeat(50_000)}x`],
  ])('%s', (_what, text) => {
    const started = performance.now();
    maskForHosted(text, PLANTED_GUARD);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
