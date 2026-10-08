// SPDX-License-Identifier: Apache-2.0

/**
 * **Personal details a hosted request must never carry**, planted — test
 * support for #839, never shipped (the `-testing.ts` suffix).
 *
 * The masking gate's counterpart of `camera/no-picture-testing.ts`: a list of
 * details of every kind `hosted-mask.ts` masks, each also hidden with
 * invisible characters and in full-width forms, the rider's guard that makes
 * the zone and word-list ones findable, some free text that carries them all,
 * and {@link personalDetailFaults}, which walks a request body for any of
 * them. A detail is looked for in the body's MASKING READING, so a planted
 * detail that survived with a soft hyphen inside it is still found.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';

import { maskingReading, PATTERNS_ONLY, type MaskingGuard, type MaskKind } from './hosted-mask';

/**
 * A degree sign, built from its code point: `camera/no-absolute-angles.ts`
 * reads every string in the tree, and a coordinate is not an angle of a body.
 */
const DEGREE = String.fromCodePoint(0xb0);

/** One planted detail. */
export interface PlantedDetail {
  readonly kind: MaskKind;
  readonly text: string;
}

/** Every kind of detail, written plainly. */
export const PLANTED_DETAILS: readonly PlantedDetail[] = [
  { kind: 'email', text: 'priya.rider+club@example.com' },
  { kind: 'phone', text: '+44 20 7946 0958' },
  { kind: 'phone', text: '07700 900123' },
  { kind: 'phone', text: '(555) 123-4567' },
  { kind: 'link', text: 'https://clubsite.example.org/members/priya' },
  { kind: 'link', text: 'www.strava-alternative.example.net/athlete/991' },
  { kind: 'address', text: '12 Acacia Avenue' },
  { kind: 'address', text: 'Hauptstraße 5' },
  { kind: 'address', text: '10 rue de la Paix' },
  { kind: 'postcode', text: 'SW1A 1AA' },
  { kind: 'postcode', text: '94103-1234' },
  { kind: 'postcode', text: 'D-10115' },
  { kind: 'postcode', text: '1012 AB' },
  { kind: 'coordinates', text: '51.5074, -0.1278' },
  { kind: 'coordinates', text: '51.5074,-0.1278' },
  { kind: 'coordinates', text: `51${DEGREE}30′26″N 0${DEGREE}7′39″W` },
  { kind: 'coordinates', text: `51${DEGREE} 30.44' N` },
  { kind: 'place', text: 'Oakbrook' },
  { kind: 'place', text: '52.20, 0.12' },
  { kind: 'masked', text: 'Kestrel Farm' },
  { kind: 'masked', text: 'Anneliese' },
];

/** The rider's guard: a zone labelled with a place name near Cambridge, and a word list. */
export const PLANTED_GUARD: MaskingGuard = {
  words: ['Kestrel Farm', 'Anneliese'],
  zones: [
    {
      centre: geographicPosition(degreesLatitude(52.2), degreesLongitude(0.12)),
      radius: 500,
      label: 'Oakbrook',
    },
  ],
};

/** `text` with a soft hyphen and a zero-width space inside it. */
export function withInvisibles(text: string): string {
  const characters = [...text];
  const middle = Math.max(1, Math.floor(characters.length / 2));
  return [
    ...characters.slice(0, 1),
    '­',
    ...characters.slice(1, middle),
    '​',
    ...characters.slice(middle),
  ].join('');
}

/** `text` in full-width forms, where there is one. */
export function fullWidth(text: string): string {
  return [...text]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x21 && code <= 0x7e ? String.fromCodePoint(code + 0xfee0) : character;
    })
    .join('');
}

/** Every planted detail three ways: plain, with invisibles, in full-width forms. */
export function plantedVariants(): readonly PlantedDetail[] {
  return PLANTED_DETAILS.flatMap((detail) => [
    detail,
    { kind: detail.kind, text: withInvisibles(detail.text) },
    { kind: detail.kind, text: fullWidth(detail.text) },
  ]);
}

/**
 * Free text of the kinds #839 names — goals, notes, a document and a
 * retrieved write-up — each carrying planted details. None of these exist in
 * the input yet (#835 brings the history); a test template puts this text in
 * a prompt so the seam is held for them before they arrive.
 */
export function plantedFreeText(): string {
  const variants = plantedVariants();
  const sentences = variants.map((detail, index) => {
    const where = ['Goal', 'Note', 'Document', 'Earlier write-up'][index % 4] ?? 'Note';
    return `${where}: remember ${detail.text} for next time.`;
  });
  return sentences.join('\n');
}

/** Every string anywhere in `value`. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

/**
 * Every planted detail that is still in `body`, however it was hidden —
 * empty when there is none. Read through the masking reading, case-folded.
 */
export function personalDetailFaults(
  body: unknown,
  details: readonly PlantedDetail[] = PLANTED_DETAILS,
): string[] {
  const read = stringsIn(body)
    .map((text) => maskingReading(text).toLowerCase())
    .join('\n');
  return details
    .filter((detail) => read.includes(maskingReading(detail.text).toLowerCase()))
    .map((detail) => `${detail.kind}: ${detail.text}`);
}

/** A guard reader holding nothing of the rider's — the patterns alone. For tests about something else. */
export function patternsOnlyGuard(): Promise<MaskingGuard> {
  return Promise.resolve(PATTERNS_ONLY);
}
