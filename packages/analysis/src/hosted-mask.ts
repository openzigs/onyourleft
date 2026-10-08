// SPDX-License-Identifier: Apache-2.0

/**
 * **What is masked before anything is sent to a hosted model** —
 * [#839](https://github.com/openzigs/onyourleft/issues/839), epic #795.
 *
 * The owner's ruling of 2026-09-29: everything the AI analysis sends to the
 * rider's **hosted** model passes through one masking function on the device
 * first. The rider's own computer, and later their own instance, get the full
 * text; a third party gets it masked.
 *
 * ## One seam
 *
 * {@link maskForHosted} is the function, and `camera/hosted-transport.ts`
 * §`hostedRequestBody` is its one caller on the wire: every message of every
 * hosted request body goes through it, and the transport will not build a
 * body without a {@link MaskingGuard} (`hosted-transport.ts` §`hostedModelPort`
 * requires one, and a guard that cannot be read is a request not sent). The
 * preview on a ride's page (`ride-analysis.ts` §`previewHostedRequest`) calls
 * the same function over the same steps, so what the rider reads is what
 * leaves. `hosted-mask-reachable.test.ts` holds both with the details
 * `personal-details-testing.ts` plants.
 *
 * It has the no-picture check's shape (#799, #822) on purpose: one seam, test
 * support that plants what must not leave, and a walk proving no hosted
 * request skips it.
 *
 * ## What is masked
 *
 * Each match is replaced by a fixed placeholder ({@link MASK_PLACEHOLDER}):
 *
 * | Placeholder | What |
 * |---|---|
 * | `[email]` | an e-mail address |
 * | `[phone]` | a telephone number: international (`+44 20 7946 0958`), a UK national number with its leading 0, or a US one written `(555) 123-4567`, `555-123-4567` or `555.123.4567` |
 * | `[link]` | a URL with a scheme, anything starting `www.`, and a bare domain ending in a common top-level domain |
 * | `[address]` | a house number followed by one to four capitalised words and a street word (`12 Acacia Avenue`); a German street word and number (`Hauptstraße 5`); a French, Spanish or Italian street with its number |
 * | `[postcode]` | a UK postcode; a US ZIP+4, or a five-digit ZIP after a state's two letters; an EU code with a country prefix (`D-10115`), a Dutch code (`1012 AB`), a Portuguese one (`1000-001`), or a four- or five-digit code followed by a capitalised place name (`75001 Paris`) |
 * | `[coordinates]` | a coordinate written as text: a decimal latitude and longitude pair with at least three decimals, whatever the spacing; either with hemisphere letters and any decimals; a pair written with its labels (`lat 51.25 lon -0.33`, either order) and any decimals; and degrees with minutes (and seconds) written with their symbols |
 * | `[place]` | the label of any of the rider's privacy zones, whole-word; and a decimal pair of ANY precision that falls inside one of their zones |
 * | `[masked]` | every entry of the rider's own word list (`@onyourleft/store` §`masked-words.ts`), whole-word |
 *
 * ## How text is read
 *
 * Matched on a **reading** of the text in which every invisible character —
 * `angle-claims.ts` §`INVISIBLE`, the #798 lesson — is gone, and every other
 * character is in its compatibility decomposition with its combining marks
 * removed: so a full-width `＠`, a soft hyphen inside a street name, and
 * `Café` against a listed `Cafe` are all read as the plain text they spell.
 * Words and labels are matched case-insensitively. ⚠️ **What is replaced is
 * the original text**, mapped back from the reading character by character,
 * so text that matches nothing leaves exactly as it was — the prompt's own
 * `…` is not turned into `...` — and a real run's bodies over a guard that
 * masks nothing are byte-identical to the unmasked ones (the gate's control).
 *
 * All matches are found first and replaced in one pass, so a placeholder is
 * never itself matched: a rider who lists the word "email" does not turn
 * `[email]` into `[[masked]]`.
 *
 * ## What is NOT masked, and the limits
 *
 * - **Ride numbers.** They are already free of coordinates, dates and
 *   identifiers (#809), and the patterns are drawn so that ordinary cycling
 *   text — `Box Hill`, `20 km`, `4x8 min`, `Zone 2`, a run of heart rates —
 *   matches none of them. `hosted-mask.test.ts` holds those negatives.
 * - **Names.** Nothing here can tell a person's or a place's name from any
 *   other capitalised word. A name is masked **only** when it is on the
 *   rider's word list or is a privacy zone's label. The consent says so.
 * - A street named with no number, a lowercase UK postcode with a one-letter
 *   area, a bare five-digit ZIP with no state, an address or a number spelled
 *   out in words ("oh-seven-seven…", "name at example dot com"), and degrees
 *   and minutes written without their symbols are not found.
 * - A pair of numbers with two or fewer decimals that happens to fall inside
 *   one of the rider's zones is masked as `[place]` even when it was not a
 *   position (`0.98, 0.95` for a zone at that spot): the over-masking
 *   direction, and a changed number the model is not told about.
 * - A one-character word-list entry or zone label is not matched: it would
 *   mask every "a" in the prompt. The Settings screen refuses one.
 * - A zone label or listed word is masked wherever it appears as a whole
 *   word, the app's own prompt text included — a zone labelled "power" would
 *   mask the word in the instructions. That is the rider's choice, and the
 *   over-masking direction.
 *
 * So masking **reduces** what a hosted service is sent and does not
 * **guarantee** anything, which is what the consent wording says (ADR 0029,
 * amendment of 2026-09-29, #839).
 */

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

import { parseMaskedWords } from './masked-words';
import { INVISIBLE } from './screen/angle-claims';

/** What a masked detail is replaced by. */
export type MaskKind =
  'email' | 'phone' | 'link' | 'address' | 'postcode' | 'coordinates' | 'place' | 'masked';

/** The fixed placeholder for each kind. */
export const MASK_PLACEHOLDER: Readonly<Record<MaskKind, string>> = {
  email: '[email]',
  phone: '[phone]',
  link: '[link]',
  address: '[address]',
  postcode: '[postcode]',
  coordinates: '[coordinates]',
  place: '[place]',
  masked: '[masked]',
};

/** One of the rider's privacy zones, as masking reads it. */
export interface MaskingZone {
  readonly centre: GeographicPosition;
  /** Metres. */
  readonly radius: number;
  readonly label: string;
}

/** What masking knows about this rider: their word list and their privacy zones. */
export interface MaskingGuard {
  readonly words: readonly string[];
  readonly zones: readonly MaskingZone[];
}

/** A guard with nothing of the rider's in it — the patterns alone. */
export const PATTERNS_ONLY: MaskingGuard = { words: [], zones: [] };

// --- The reading ------------------------------------------------------------------

/** The text as matched, and where each of its characters came from. */
interface Reading {
  readonly text: string;
  /** The original index each reading character starts at. */
  readonly from: readonly number[];
  /** The original index just past each reading character's source. */
  readonly to: readonly number[];
}

/** A fresh copy of `INVISIBLE` that answers one character at a time. */
const INVISIBLE_ONE = new RegExp(`^${INVISIBLE.source}$`, 'u');

/** Combining marks, removed from the reading. */
const MARKS = /\p{M}/gu;

/** One character's reading: nothing when invisible, else its folded form. */
function readCharacter(character: string): string {
  if (INVISIBLE_ONE.test(character)) {
    return '';
  }
  return character.normalize('NFKD').replace(MARKS, '');
}

/** `text` as matched: invisible characters out, compatibility forms folded. */
function readingOf(text: string): Reading {
  let reading = '';
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  for (const character of text) {
    const read = readCharacter(character);
    for (let unit = 0; unit < read.length; unit += 1) {
      from.push(index);
      to.push(index + character.length);
    }
    reading += read;
    index += character.length;
  }
  return { text: reading, from, to };
}

/**
 * `text` as masking reads it — invisible characters out, compatibility forms
 * folded, combining marks removed. For a gate that has to look for a planted
 * detail however it was hidden (`personal-details-testing.ts`).
 */
export function maskingReading(text: string): string {
  return readingOf(text).text;
}

/** A term (a listed word, a zone label) as it is read — for building its pattern. */
function readTerm(term: string): string {
  return readingOf(term).text.trim();
}

// --- The patterns -----------------------------------------------------------------

/** No letter or digit before. */
const START = '(?<![\\p{L}\\p{N}])';
/** No letter or digit after. */
const END = '(?![\\p{L}\\p{N}])';

const EMAIL = new RegExp(
  `(?<![\\p{L}\\p{N}._%+-])[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.\\p{L}{2,}${END}`,
  'gu',
);

/** Top-level domains a bare domain is recognised by. Not every one: the common ones. */
const TOP_LEVEL = [
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'info',
  'biz',
  'io',
  'app',
  'dev',
  'me',
  'co',
  'uk',
  'ie',
  'de',
  'fr',
  'nl',
  'be',
  'es',
  'it',
  'eu',
  'us',
  'ca',
  'au',
  'nz',
  'ch',
  'at',
  'se',
  'no',
  'dk',
  'fi',
  'pl',
  'pt',
  'cz',
  'tv',
  'ly',
  'gg',
].join('|');

const LINK_WITH_SCHEME = /(?<![\p{L}\p{N}])(?:https?|ftp):\/\/[^\s<>"'`]+/giu;
const LINK_WWW = /(?<![\p{L}\p{N}.])www\.[^\s<>"'`]+/giu;
const LINK_BARE = new RegExp(
  `(?<![\\p{L}\\p{N}@.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TOP_LEVEL})(?![\\p{L}\\p{N}-])(?:/[^\\s<>"'\`]*)?`,
  'giu',
);

const PHONE_INTERNATIONAL = /(?<![\p{L}\p{N}+])\+\s?\d(?:[\s().-]{0,2}\d){7,14}(?!\p{N})/gu;
const PHONE_UK = /(?<![\p{N}.,])\(?0\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\p{N})/gu;
const PHONE_US = /(?<![\p{N}.])(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\d{3}([.-])\d{3}\1\d{4})(?!\p{N})/gu;

/** A UK postcode, upper case, with or without its space. */
const POSTCODE_UK = new RegExp(
  `${START}[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[ABD-HJLNP-UW-Z]{2}${END}`,
  'gu',
);
/** In lower case, only with a two-letter area and its space — `rh5 6bu`. */
const POSTCODE_UK_LOWER = new RegExp(
  `${START}[a-z]{2}\\d[a-z\\d]?\\s\\d[abd-hjlnp-uw-z]{2}${END}`,
  'gu',
);
const STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
const ZIP_PLUS_FOUR = /(?<![\p{N}-])\d{5}-\d{4}(?![\p{N}-])/gu;
const ZIP_AFTER_STATE = new RegExp(`(?<=${START}(?:${STATES}),?\\s{1,3})\\d{5}(?!\\p{N})`, 'gu');
const POSTCODE_COUNTRY_PREFIX = new RegExp(`${START}[A-Z]{1,2}-\\d{4,5}(?!\\p{N})`, 'gu');
/** Letters a Dutch code never ends in, and the cycling abbreviations that look like one. */
const DUTCH_LOOKALIKES = 'SA|SD|SS|HR|KJ|KM|MI|FT|IF|NP|TT|CP|KG|LB|MS|AM|PM|OK';
const POSTCODE_DUTCH = new RegExp(
  `${START}[1-9]\\d{3}\\s?(?!(?:${DUTCH_LOOKALIKES})(?![A-Z]))[A-Z]{2}${END}`,
  'gu',
);
const POSTCODE_PORTUGUESE = /(?<![\p{N}-])\d{4}-\d{3}(?![\p{N}-])/gu;
/** Words that follow a number in ride text and are not places. */
const NOT_PLACES =
  'Watts?|Metres?|Meters?|Seconds?|Minutes?|Hours?|Kilometres?|Kilometers?|Miles?|Calories|Kilojoules?|Joules?|Beats?|Revolutions?|Steps?|Sections?|Laps?';
const POSTCODE_BEFORE_PLACE = new RegExp(
  `(?<![\\p{N}.,:-])(?:\\d{4,5}|\\d{2}-\\d{3})(?=\\s+(?!(?:${NOT_PLACES})${END})\\p{Lu}\\p{Ll}{2,})`,
  'gu',
);

/** A street word, capitalised or not. */
function streetWords(words: readonly string[]): string {
  return words.flatMap((word) => [word, word.toLowerCase()]).join('|');
}
const STREET_SUFFIX = streetWords([
  'Street',
  'St',
  'Road',
  'Rd',
  'Avenue',
  'Ave',
  'Lane',
  'Ln',
  'Drive',
  'Dr',
  'Close',
  'Way',
  'Court',
  'Ct',
  'Crescent',
  'Cres',
  'Place',
  'Pl',
  'Terrace',
  'Gardens',
  'Grove',
  'Boulevard',
  'Blvd',
  'Highway',
  'Hwy',
  'Row',
  'Mews',
  'Square',
  'Sq',
  'Parade',
]);
const ADDRESS_ENGLISH = new RegExp(
  `${START}\\d{1,5}[A-Za-z]?,?\\s+(?:\\p{Lu}[\\p{L}'’-]*\\s+){1,4}(?:${STREET_SUFFIX})${END}`,
  'gu',
);
const ADDRESS_GERMAN = new RegExp(
  `${START}\\p{Lu}[\\p{L}-]*(?:straße|strasse|str\\.|weg|gasse|allee|platz)\\s+\\d{1,4}[a-z]?${END}`,
  'gu',
);
const ROMANCE_STREET = streetWords([
  'Rue',
  'Avenue',
  'Boulevard',
  'Chemin',
  'Impasse',
  'Place',
  'Quai',
  'Calle',
  'Carrer',
  'Avenida',
  'Rua',
  'Via',
  'Viale',
  'Piazza',
  'Corso',
]);
const LINKING = "(?:(?:de|du|des|la|le|les|del|della|di|da|do)\\s+|[ld]['’])*";
/** `10 rue de la Paix`. */
const ADDRESS_ROMANCE_NUMBER_FIRST = new RegExp(
  `${START}\\d{1,4}(?:\\s?(?:bis|ter))?,?\\s+(?:${ROMANCE_STREET})\\s+${LINKING}\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,3}`,
  'gu',
);
/** `Via Roma 10`, `Calle Mayor 5`. */
const ADDRESS_ROMANCE_NUMBER_LAST = new RegExp(
  `${START}(?:${ROMANCE_STREET})\\s+${LINKING}\\p{Lu}[\\p{L}'’-]*(?:\\s+\\p{Lu}[\\p{L}'’-]*){0,3},?\\s+\\d{1,4}${END}`,
  'gu',
);

const HEMISPHERE_LAT = '[NSns]';
const HEMISPHERE_LON = '[EWew]';
/** Degrees, minutes and optional seconds, with their symbols. */
const COORDINATE_DMS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:[NSEW]\\s*)?\\d{1,3}\\s*\\u00b0\\s*\\d{1,2}(?:[.,]\\d+)?\\s*(?:'|′|’)(?:\\s*\\d{1,2}(?:[.,]\\d+)?\\s*(?:"|″|”|''|′′))?(?:\\s*[NSEWnsew](?![\\p{L}]))?`,
  'gu',
);
/** Decimal degrees with a degree sign and a hemisphere, either side. */
const COORDINATE_DEGREE_HEMISPHERE =
  /(?<![\p{L}\p{N}])(?:\d{1,3}(?:[.,]\d+)?\s*\u00b0\s*[NSEWnsew](?!\p{L})|[NSEW]\s*\d{1,3}(?:[.,]\d+)?\s*\u00b0)/gu;
/** A decimal pair with hemisphere letters, any precision: `51.5N 0.12W`. */
const COORDINATE_PAIR_HEMISPHERE = new RegExp(
  `(?<![\\p{L}\\p{N}.])\\d{1,2}(?:\\.\\d+)?(?:\\s*\\u00b0)?\\s*${HEMISPHERE_LAT}(?:\\s*[,;/])?\\s*\\d{1,3}(?:\\.\\d+)?(?:\\s*\\u00b0)?\\s*${HEMISPHERE_LON}(?!\\p{L})`,
  'gu',
);
/**
 * A decimal pair, whatever the spacing. Checked in range before it is masked.
 * ⚠️ No two runs of `\s` may sit side by side with only optional text between
 * them — `\s*\u00b0?\s*` is cubic on a decimal followed by a long run of
 * spaces (#854's review hung on 20 000 of them); each optional piece carries
 * its own leading `\s*` instead.
 */
const DECIMAL_PAIR =
  /(?<![\p{L}\p{N}.])([-+−]?\d{1,2}\.(\d+))(?:\s*\u00b0)?(?:\s*[,;/]\s*|\s+)([-+−]?\d{1,3}\.(\d+))(?:\s*\u00b0)?(?![\p{N}.])/gu;

/** A label and its number: `lat 51.25`, `Longitude: -0.33`, `lng=-0.3`. */
function labelled(label: string, degrees: string): string {
  return `(?:${label})(?:\\s*[:=])?\\s*[-+−]?\\d{${degrees}}(?:\\.\\d+)?(?:\\s*\\u00b0)?`;
}
const LATITUDE_LABEL = 'latitude|lat';
const LONGITUDE_LABEL = 'longitude|long|lng|lon';
/**
 * A pair written with its labels, either order, ANY precision — the labels say
 * it is a position (#854's review). Both labels are needed: `long 12.5 min`
 * alone is a ride.
 */
const COORDINATE_LABELLED = new RegExp(
  `${START}(?:${labelled(LATITUDE_LABEL, '1,2')}(?:\\s*[,;/])?\\s*${labelled(LONGITUDE_LABEL, '1,3')}|${labelled(LONGITUDE_LABEL, '1,3')}(?:\\s*[,;/])?\\s*${labelled(LATITUDE_LABEL, '1,2')})(?![\\p{N}.])`,
  'giu',
);

/** A found detail: where it is in the reading, and what replaces it. */
interface Found {
  readonly start: number;
  readonly end: number;
  readonly kind: MaskKind;
}

function* matchesOf(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match[0] === '') {
      pattern.lastIndex += 1;
      continue;
    }
    yield match;
  }
}

function findAll(pattern: RegExp, text: string, kind: MaskKind, found: Found[]): void {
  for (const match of matchesOf(pattern, text)) {
    found.push({ start: match.index, end: match.index + match[0].length, kind });
  }
}

/** A link loses what a sentence put after it: a full stop, a comma, a bracket. */
function findLinks(pattern: RegExp, text: string, found: Found[]): void {
  for (const match of matchesOf(pattern, text)) {
    const trimmed = match[0].replace(/[.,;:!?)\]}>'"’”]+$/u, '');
    found.push({ start: match.index, end: match.index + trimmed.length, kind: 'link' });
  }
}

/** A phone number has 10 to 15 digits, whatever separates them. */
function findPhones(pattern: RegExp, text: string, found: Found[]): void {
  for (const match of matchesOf(pattern, text)) {
    const digits = match[0].replace(/\D/gu, '').length;
    if (digits >= 10 && digits <= 15) {
      found.push({ start: match.index, end: match.index + match[0].length, kind: 'phone' });
    }
  }
}

function decimal(written: string): number {
  return Number(written.replace('−', '-'));
}

/** How far a position written to `decimals` places may be from where it was, in metres. */
function roundingMetres(decimals: number): number {
  return 111_320 * 0.5 * 10 ** -decimals * Math.SQRT2;
}

function insideZone(
  latitude: number,
  longitude: number,
  decimals: number,
  zone: MaskingZone,
): boolean {
  const point = geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
  return distanceBetween(point, zone.centre) <= zone.radius + roundingMetres(decimals);
}

/** Decimal pairs: precise ones always, coarse ones when inside one of the rider's zones. */
function findDecimalPairs(text: string, zones: readonly MaskingZone[], found: Found[]): void {
  for (const match of matchesOf(DECIMAL_PAIR, text)) {
    const latitude = decimal(match[1] ?? '');
    const longitude = decimal(match[3] ?? '');
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      continue;
    }
    const decimals = Math.min((match[2] ?? '').length, (match[4] ?? '').length);
    const where = { start: match.index, end: match.index + match[0].trimEnd().length };
    if (decimals >= 3) {
      found.push({ ...where, kind: 'coordinates' });
    } else if (zones.some((zone) => insideZone(latitude, longitude, decimals, zone))) {
      found.push({ ...where, kind: 'place' });
    }
  }
}

function escaped(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The pattern for a list of whole-word terms, or `undefined` for none. Longest
 * first, so "Old Town Road" wins over "Old Town".
 */
function termPattern(terms: readonly string[]): RegExp | undefined {
  const read = [
    ...new Set(
      terms
        .map(readTerm)
        .filter((term) => [...term].length >= 2)
        .map((term) => term.toLowerCase()),
    ),
  ].sort((a, b) => b.length - a.length);
  if (read.length === 0) {
    return undefined;
  }
  const alternatives = read.map((term) => escaped(term).replace(/\s+/gu, '\\s+')).join('|');
  return new RegExp(`${START}(?:${alternatives})${END}`, 'giu');
}

/** Every detail in `reading`, overlapping or not. */
function detailsIn(reading: string, guard: MaskingGuard): Found[] {
  const found: Found[] = [];
  const words = termPattern(parseMaskedWords(guard.words));
  if (words !== undefined) {
    findAll(words, reading, 'masked', found);
  }
  const labels = termPattern(guard.zones.map((zone) => zone.label));
  if (labels !== undefined) {
    findAll(labels, reading, 'place', found);
  }
  findAll(EMAIL, reading, 'email', found);
  findLinks(LINK_WITH_SCHEME, reading, found);
  findLinks(LINK_WWW, reading, found);
  findLinks(LINK_BARE, reading, found);
  findAll(COORDINATE_DMS, reading, 'coordinates', found);
  findAll(COORDINATE_DEGREE_HEMISPHERE, reading, 'coordinates', found);
  findAll(COORDINATE_PAIR_HEMISPHERE, reading, 'coordinates', found);
  findAll(COORDINATE_LABELLED, reading, 'coordinates', found);
  findDecimalPairs(reading, guard.zones, found);
  findPhones(PHONE_INTERNATIONAL, reading, found);
  findPhones(PHONE_UK, reading, found);
  findPhones(PHONE_US, reading, found);
  findAll(ADDRESS_ENGLISH, reading, 'address', found);
  findAll(ADDRESS_GERMAN, reading, 'address', found);
  findAll(ADDRESS_ROMANCE_NUMBER_FIRST, reading, 'address', found);
  findAll(ADDRESS_ROMANCE_NUMBER_LAST, reading, 'address', found);
  findAll(POSTCODE_UK, reading, 'postcode', found);
  findAll(POSTCODE_UK_LOWER, reading, 'postcode', found);
  findAll(ZIP_PLUS_FOUR, reading, 'postcode', found);
  findAll(ZIP_AFTER_STATE, reading, 'postcode', found);
  findAll(POSTCODE_COUNTRY_PREFIX, reading, 'postcode', found);
  findAll(POSTCODE_DUTCH, reading, 'postcode', found);
  findAll(POSTCODE_PORTUGUESE, reading, 'postcode', found);
  findAll(POSTCODE_BEFORE_PLACE, reading, 'postcode', found);
  return found;
}

/**
 * `text` with every personal detail replaced by its placeholder — see the file
 * comment for what is found and how. Text that matches nothing is returned
 * exactly as it was.
 */
export function maskForHosted(text: string, guard: MaskingGuard): string {
  const reading = readingOf(text);
  const found = detailsIn(reading.text, guard)
    // The earliest first, and of two starting together the longer — so an
    // address is not cut short by the postcode inside it.
    .sort((a, b) => a.start - b.start || b.end - a.end);
  // Overlaps MERGED into one span under the earlier detail's placeholder —
  // never dropped, because a later match running past an earlier one (a
  // listed "Avenue Hotel" starting inside `12 Acacia Avenue`) would leave its
  // tail in clear (#854's review). Then a latitude and a longitude written as
  // two coordinates joined into one: `51°30′N 0°7′W` is one place.
  const kept: Found[] = [];
  for (const detail of found) {
    const last = kept.at(-1);
    if (last !== undefined && detail.start < last.end) {
      if (detail.end > last.end) {
        kept[kept.length - 1] = { ...last, end: detail.end };
      }
      continue;
    }
    if (
      last?.kind === 'coordinates' &&
      detail.kind === 'coordinates' &&
      /^[\s,;/]*$/u.test(reading.text.slice(last.end, detail.start))
    ) {
      kept[kept.length - 1] = { ...last, end: detail.end };
      continue;
    }
    kept.push(detail);
  }
  let masked = '';
  let copied = 0;
  for (const detail of kept) {
    const from = reading.from[detail.start] ?? text.length;
    const to = reading.to[detail.end - 1] ?? text.length;
    masked += text.slice(copied, from) + MASK_PLACEHOLDER[detail.kind];
    copied = to;
  }
  return masked + text.slice(copied);
}

// --- Where the guard comes from ------------------------------------------------------

/**
 * The athlete row's one field the guard reads. `packages/store` §`AthleteRecord`
 * satisfies it; it is restated here because this package does not depend on
 * the store (ADR 0046 D-5, #1094). The list is parsed whatever it holds.
 */
export interface MaskingAthlete {
  readonly maskedWords?: unknown;
}

/**
 * What {@link readMaskingGuard} reads, keyed by the store's own athlete id.
 * `ActivityStore` satisfies it as it stands.
 */
export interface MaskingStore<Owner> {
  getAthlete(id: Owner): Promise<MaskingAthlete | undefined>;
  listPrivacyZones(owner: Owner): Promise<readonly MaskingZone[]>;
}

/**
 * This rider's guard, read from the store: their word list and their privacy
 * zones. ⚠️ **Rejects when either cannot be read**, and the transport answers
 * that by sending nothing (`hosted-transport.ts` §`not-masked`) — a request
 * masked with half a guard would look masked and not be.
 */
export async function readMaskingGuard<Owner>(
  store: MaskingStore<Owner>,
  owner: Owner,
): Promise<MaskingGuard> {
  const [athlete, zones] = await Promise.all([
    store.getAthlete(owner),
    store.listPrivacyZones(owner),
  ]);
  return {
    words: parseMaskedWords(athlete?.maskedWords),
    zones: zones.map((zone) => ({ centre: zone.centre, radius: zone.radius, label: zone.label })),
  };
}
