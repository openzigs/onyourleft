// SPDX-License-Identifier: Apache-2.0

/**
 * The channels GPX and TCX carry in `<extensions>`, and how they are recognised.
 *
 * ## The defining failure of a naive GPX importer
 *
 * #32, in as many words: *"GPX has no native power or cadence field. Cycling
 * data is carried in `<extensions>` using vendor namespaces... An importer that
 * ignores extensions silently discards power data, which is the single most
 * valuable channel in this product."* It is silent because the import succeeds:
 * the track is there, the elevation is there, and nobody notices until a rider
 * opens a ride they remember having power in.
 *
 * ## Recognised by local name, and why that is the right amount of strictness
 *
 * Garmin's `TrackPointExtension` has two namespace versions in the wild; Strava,
 * Wahoo, Hammerhead and Zwift each write their own; the power channel alone
 * appears as `PowerInWatts`, `power` and `Watts` depending on who wrote the
 * file. An importer that matched on namespace URI would be correct and would
 * drop most real files.
 *
 * So the rule is: **inside `<extensions>` (GPX) or `<Extensions>` (TCX),
 * recognise a leaf element by its local name, case-insensitively, whatever its
 * prefix or namespace.** The scoping to an extensions subtree is what keeps
 * this from being reckless — a `<name>` element elsewhere in the document is
 * not a channel, and nothing outside `<extensions>` is looked at by this table.
 *
 * The namespace URIs are still exported below, and the tests assert against
 * them rather than only against local names: `xml-corpus.test.ts` checks that
 * the committed GPX fixture really declares Garmin's `TrackPointExtension`
 * namespace before it checks that heart rate and cadence came out of it. #32's
 * first criterion names that namespace specifically, and a test that matched
 * only on `hr` would pass for a document with no Garmin namespace in it.
 */

/** The channel a recognised extension element carries. */
export type ExtensionChannel =
  'heartRate' | 'cadence' | 'power' | 'speed' | 'distance' | 'temperature';

/**
 * Local element name → channel, lower-cased.
 *
 * Each entry is a name observed in the formats' own published extension
 * schemas or in the #29 corpus, not a guess: `hr`, `cad`, `atemp` and `speed`
 * are Garmin's `TrackPointExtension`; `PowerInWatts` is Garmin's
 * `PowerExtension`; `Watts` and `Speed` are Garmin's TCX `ActivityExtension`
 * `TPX`; `heartrate`, `cadence`, `power`, `temp`, `temperature` and `distance`
 * are the long spellings other writers use for the same channels.
 */
const CHANNELS = new Map<string, ExtensionChannel>([
  ['hr', 'heartRate'],
  ['heartrate', 'heartRate'],
  ['cad', 'cadence'],
  ['cadence', 'cadence'],
  ['power', 'power'],
  ['powerinwatts', 'power'],
  ['watts', 'power'],
  ['speed', 'speed'],
  ['distance', 'distance'],
  ['atemp', 'temperature'],
  ['temp', 'temperature'],
  ['temperature', 'temperature'],
]);

/** The channel a local element name denotes inside an extensions subtree. */
export function extensionChannelOf(localName: string): ExtensionChannel | undefined {
  return CHANNELS.get(localName.toLowerCase());
}

/**
 * Garmin's `TrackPointExtension` v1 namespace — read, never written.
 *
 * The #29 corpus's GPX fixtures declare it and so do most files in the wild.
 * `encodeGpx` writes {@link GPX_TRACK_POINT_EXTENSION_V2}, because v1 has no
 * `speed`.
 */
export const GPX_TRACK_POINT_EXTENSION_V1 =
  'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

/**
 * Garmin's `TrackPointExtension` v2 namespace, which adds `speed` and `course`.
 *
 * **This is the one a GPX export writes.** Recognition is still by local name
 * whatever the namespace, per the module comment — the URI matters on the way
 * out, not on the way in.
 */
export const GPX_TRACK_POINT_EXTENSION_V2 =
  'http://www.garmin.com/xmlschemas/TrackPointExtension/v2';

/** Garmin's `PowerExtension` namespace, where `PowerInWatts` lives. */
export const GPX_POWER_EXTENSION_V1 = 'http://www.garmin.com/xmlschemas/PowerExtension/v1';

/** Garmin's TCX `ActivityExtension` namespace, where `TPX` lives. */
export const TCX_ACTIVITY_EXTENSION_V2 = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2';
