// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Everything this device holds about one athlete, in files they can keep.**
 *
 * [#35](https://github.com/openzigs/onyourleft/issues/35)'s first acceptance
 * criterion — *"Export produces every activity as its original uploaded file
 * plus a machine-readable manifest of account data"* — in the shape a
 * local-first client can have it, and the only shape it can have today: #35's
 * *original uploaded file* is an object-storage key, and there is no object
 * storage. What there is instead is the ride, re-encoded through the codec that
 * wrote it, plus everything an activity file cannot carry.
 *
 * #35 says why this matters more than the legal argument, and it is worth
 * quoting rather than paraphrasing:
 *
 * > **this project's pitch is that it is the free, open alternative that does
 * > not hold your data hostage.** A migration path out is the credibility of
 * > that pitch. A user who cannot leave has not chosen to stay.
 *
 * Until now that promise had an importer and no exporter above one ride at a
 * time. `import-batch.ts` reads a folder; this is its mirror.
 *
 * ## It is `retained`, and the whole file turns on that
 *
 * `privacy/boundaries.ts` splits every boundary two ways. This one faces the
 * athlete, so the coordinates are **true and untrimmed** and the privacy zones
 * are **in the manifest** — they are the athlete's own record of where their
 * home is, and an export that withheld them would be withholding the thing that
 * is hardest to reconstruct. #35: *"privacy zones protect the user from others,
 * not from themselves."*
 *
 * ⚠️ **So the file this produces is exactly as sensitive as the rides**, and
 * more concentrated: one archive with every trace and every zone centre in it.
 * That is the correct trade for a data-portability export and it is not a
 * reason to weaken the export — but a screen offering it should say so, and
 * nothing here should ever be uploaded anywhere by default.
 *
 * ## The private key is not in it, and that is checked rather than argued
 *
 * The manifest carries the device's **public** key, because that is the
 * identity a verifier needs and `identity.ts` says it is safe to publish. The
 * private half is a non-extractable `CryptoKey`, so serialising the record
 * wholesale would emit `{}` — which is worse than omitting it, because it looks
 * like the key was exported and it was not. {@link accountManifest} therefore
 * names the two fields it takes rather than spreading the row, and
 * `export-everything.test.ts` asserts a known key's bytes appear nowhere in the
 * output, using the same `extractableDeviceKey` fixture #61's second criterion
 * exists for.
 *
 * ## The signed record travels beside the ride, not inside it
 *
 * [#221](https://github.com/openzigs/onyourleft/issues/221) found the pair of
 * holes this file and `erase-device.ts` had between them: `activityRecords` and
 * `laps` both went in the erase and neither came out in the export, so a rider
 * who did the responsible thing — export everything, then erase — lost both,
 * silently, and the manifest did not say so. ADR 0014 D-7 makes the record half
 * permanent: the private key is non-extractable, so an erased identity can never
 * sign again and a destroyed record can never be re-minted.
 *
 * [ADR 0019](../../../../docs/adr/0019-signed-records-in-an-export.md) decides
 * how one travels: **its own `.record.json` beside the activity file**, not
 * inline in this manifest and not inside the FIT file. The short version of why
 * not the other two is worth having here, because both look tidier from a
 * distance:
 *
 * - **Not inline**, because the manifest is the most sensitive file in the
 *   archive — it carries the privacy zones, which are a home address stated
 *   precisely — and a record is the *least* sensitive thing this project
 *   produces. Welding them means an athlete cannot hand somebody one ride's
 *   record without handing over the file with their home in it.
 * - **Not a FIT developer field**, because it is circular: a record's
 *   `contentHash` is the SHA-256 of the file it vouches for, and putting the
 *   record inside that file changes the file's bytes.
 *
 * ⚠️ **Nothing here signs anything.** ADR 0014: *"re-signing an old ride with a
 * new key would be the device asserting something it did not witness."* An
 * export moves records. A ride with none exports cleanly and its manifest entry
 * says `"signedRecord": null`.
 *
 * ⚠️ **And the record's `contentHash` will not match the file beside it**, in
 * general — that file is a re-encode, and the same ride exported as GPX and as
 * TCX is two files and one record. So the check that applies to an archive is
 * `verifyRecordSignature` (authentic, and whose), not `verifyActivityRecord`
 * (which also checks the file, and would correctly answer `content-mismatch`).
 * ADR 0019 D-4.
 *
 * ## The report never holds the bytes
 *
 * A library of five hundred four-hour rides is gigabytes. {@link exportEverything}
 * hands each file to `onFile` as it is produced and keeps only the outcome, so
 * *this function* holds one ride at a time rather than the library. That is a
 * deliberate asymmetry with {@link ExportedActivity}, which does return its
 * bytes: one ride fits in memory and a caller wants it there.
 *
 * ⚠️ **That is a claim about this function and not about the tab**, and the
 * first version of this comment overreached by saying "peak memory is one
 * ride". `main.tsx`'s `saveWithAnchor` creates an object URL per file and
 * revokes it on a timer, so a bulk run holds every blob alive until those
 * timers fire — and a browser's own guard on many downloads in quick
 * succession is a separate problem for the same code. Both are the *sink*'s to
 * fix, and neither is fixed here; what this function guarantees is that it does
 * not itself accumulate.
 */

import type { SignedActivityRecord, UnixSeconds } from '@onyourleft/domain';
import type { ActivityId, AthleteId } from '@onyourleft/store';

import { ActivityExportError, exportActivity, fileStemOf } from './export-activity';
import type { ActivityFileFormat } from './file-format';
import type { AccountStore, DownloadableFile, TransferStore } from './store-port';

/**
 * One ride's line in the manifest.
 *
 * `written: false` is the important case: it names a ride the archive does
 * **not** contain, so the index is a record of the athlete's library rather
 * than only of this run's successes.
 */
export interface ManifestEntry {
  readonly activityId: ActivityId;
  readonly fileName: string;
  readonly written: boolean;
  readonly reason?: string;
  /**
   * The signed record's file name, or **`null`** when this ride has none —
   * #221's fifth criterion, ADR 0019 D-2.
   *
   * ⚠️ **`null` and not `undefined`, and that is the whole point of the
   * member.** `JSON.stringify` omits an `undefined`, and an omitted member puts
   * a reader straight back where they started: unable to tell "this ride never
   * had a record" from "the export dropped it". A record is destroyed by the
   * erase and can never be re-minted (ADR 0014 D-7), so that distinction is the
   * difference between a rider knowing what they lost and not.
   */
  readonly signedRecord: string | null;
}

/**
 * Where an export stopped, in the terms the list is ordered by.
 *
 * **A pair, because `startedAt` is not a key.** Activities come back ordered by
 * `[startedAt, id]` — IndexedDB orders index entries with equal keys by primary
 * key — so the instant alone names a *set* of rides rather than a place in the
 * list, and a `startedAfter` bound that is strictly after it steps over every
 * other member of that set. Two rides sharing a second is not exotic:
 * `import-batch.ts` run twice over one file produces it, and so does any two
 * indoor sessions started from a clock with second resolution. #306.
 *
 * ⚠️ **An object here, and two sibling options at the store — that difference
 * is deliberate.** `ListActivitiesOptions` is a flat bag whose members are
 * independently optional and independently refused: `activity-store.ts` rejects
 * an id with no instant, and an id read backwards, with two different messages
 * that name the member at fault. Folding those into one object would replace
 * three precise refusals with one, and would touch `segments/backfill.ts` and
 * `segments/match-testing.ts`, which are the proven callers of the read #293
 * fixed. What a *report* needs is the opposite shape: one value a screen can
 * hold in one state slot and hand back unexamined, where carrying half of it is
 * not expressible. So the pair is named here and spread at the one call site.
 */
export interface AccountExportCursor {
  /** The `startedAt` of the last activity this run finished. */
  readonly startedAt: UnixSeconds;
  /** That activity's id — the tie-break, not decoration. @see AccountExportCursor */
  readonly activityId: ActivityId;
}

/** The format version, and the identity, in one key — ADR 0017 D-3's shape. */
export const ACCOUNT_EXPORT_VERSION = 1;

/** What the manifest is called inside the export. */
export const MANIFEST_FILE_NAME = 'on-your-left-account.json';

/**
 * How many activities one export covers.
 *
 * A bound rather than no bound, for the reason `read-activity-file.ts` bounds
 * an import: an unbounded loop over a library is an unbounded amount of work
 * started by one click, and a tab that never finishes is indistinguishable from
 * one that has crashed. A caller wanting more passes `limit`; a caller wanting
 * all of a larger library runs it again from where it stopped, which is what
 * `after` is for.
 */
export const ACCOUNT_EXPORT_LIMIT = 500;

/**
 * How many kept pictures one run carries — #384, ADR 0029 D-3.
 *
 * ⚠️ **Its own budget rather than a share of {@link ACCOUNT_EXPORT_LIMIT}**,
 * because the two are counted in different things: a ride is a few hundred
 * kilobytes re-encoded from packed streams, and a picture is a whole JPEG read
 * straight off the disk. Two hundred 1080p frames is of the order of a hundred
 * megabytes handed to the browser's download machinery, which
 * `exportEverything`'s own header already records as the **sink's** problem
 * rather than this function's — and a budget is how this function avoids
 * making it worse.
 *
 * ⚠️ **It is a bound on a RUN and not a cap on a rider's data.** A run that hit
 * it says so in the manifest (`camera.written` below is less than
 * `camera.kept`), which is the honest record #35's *"a ride is yours and this
 * archive does not contain it"* rule already applies to a ride. Unlike a ride
 * there is no cursor for it, and that is stated rather than hidden: the
 * archive's completeness for pictures is a count in the manifest, and a rider
 * with more than this has to delete some or wait for the issue that pages them.
 */
export const ACCOUNT_EXPORT_FRAME_LIMIT = 200;

/** What a kept picture's file is called, after its capture instant. */
export function cameraFrameFileName(capturedAt: number, ordinal: number): string {
  // ⚠️ No ride name, no place, no id of anything. ADR 0004 decision D binds
  // every layer that formats location data into a string and a ride's name is
  // routinely a place; an instant and an ordinal name the file uniquely and say
  // nothing. The ordinal is what separates two pictures taken in one second.
  return `picture-${String(capturedAt)}-${String(ordinal)}.jpg`;
}

/** Everything the exporter needs. @see AccountStore */
export type AccountExportStore = TransferStore & AccountStore;

export type AccountExportOutcomeKind = 'exported' | 'failed' | 'cancelled';

/** What happened to one ride. Never carries its bytes — see the file header. */
export interface AccountExportOutcome {
  readonly activityId: ActivityId;
  readonly fileName: string;
  readonly kind: AccountExportOutcomeKind;
  /** What the format could not carry. Empty for a clean file. */
  readonly lost: readonly string[];
  /** Why it failed, in words a rider can act on. `undefined` when it did not. */
  readonly reason: string | undefined;
  /**
   * The signed record file written beside this ride, or `undefined` for a ride
   * that has no record.
   *
   * `undefined` here rather than the manifest's `null` deliberately: this type
   * is read in TypeScript, where an absent value is `undefined` and the
   * compiler makes the case unmissable. The manifest is read as JSON by a
   * stranger, where only an explicit `null` says anything at all.
   */
  readonly signedRecord: string | undefined;
}

/** Where the export has got to. Emitted after every ride. */
export interface AccountExportProgress {
  readonly completed: number;
  readonly total: number;
  readonly outcome: AccountExportOutcome;
}

/** The whole export, counted. */
export interface AccountExportReport {
  readonly outcomes: readonly AccountExportOutcome[];
  readonly exported: number;
  readonly failed: number;
  readonly cancelled: number;
  /**
   * How many signed records went with the rides — #221.
   *
   * Not equal to `exported`, and it is not meant to be: most rides have no
   * record. It is here so a screen can say "and 12 signed records" rather than
   * leaving the extra files in the download folder unexplained.
   */
  readonly signedRecords: number;
  /**
   * What to pass as `after` to continue, or `undefined` when the library ended
   * inside this run.
   *
   * A cursor rather than an offset, for the reason `segments/backfill.ts` uses
   * one: a ride imported between two runs shifts every offset after it, which
   * silently skips a ride rather than repeating one.
   *
   * ⚠️ **The bound it produces is exclusive of exactly one row: the activity
   * this cursor names.** It used to be the instant alone, and `startedAfter`
   * alone is strictly after the *instant* — so two rides that started in the
   * same second straddled a resume badly and the second never reached the
   * archive, on this press or any later one, because the ordering is
   * deterministic and every retry reproduced it. {@link AccountExportCursor}
   * carries the id beside the instant and `activity-store.ts`'s
   * `afterActivityId` makes the instant inclusive and drops the ids already
   * covered at it, before `limit` counts. #306, the export's half of #293.
   *
   * ⚠️ **Both halves or neither**, which is why this is one value and not two
   * optional ones: the instant alone skips a ride and an inclusive instant with
   * no id re-reads one for ever.
   */
  readonly continueAfter: AccountExportCursor | undefined;
}

/** @see exportEverything */
export interface AccountExportOptions {
  readonly store: AccountExportStore;
  readonly athleteId: AthleteId;
  readonly format: ActivityFileFormat;
  /**
   * Called once per produced file. The manifest is **last**, not first — see
   * {@link exportEverything}.
   *
   * ⚠️ Declared as a **property with a function type**, not as a method, for
   * the reason `store-port.ts` gives for `TransferPort.save`: method syntax
   * makes the reference unbound, so passing `port.save` straight in — which is
   * exactly what the screen does — is an `@typescript-eslint/unbound-method`
   * error. A property type is both stricter and passable.
   */
  readonly onFile: (file: DownloadableFile) => Promise<void> | void;
  readonly limit?: number | undefined;
  /**
   * Continue after this ride. From a previous report's `continueAfter`, handed
   * back unexamined — see {@link AccountExportCursor} for why it is one value.
   */
  readonly after?: AccountExportCursor | undefined;
  /** Aborting stops the loop between rides. Files already handed over stand. */
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: AccountExportProgress) => void) | undefined;
}

/**
 * What a signed record's file is called: the activity file's name with its
 * extension replaced. ADR 0019 D-1.
 *
 * Derived from the **de-duplicated** activity file name rather than from the
 * ride's own stem, so uniqueness here is a consequence of uniqueness there
 * instead of a second rule that could disagree with the first. Two rides both
 * called "Morning ride" produce `Morning ride.gpx` / `Morning ride.record.json`
 * and `Morning ride (2).gpx` / `Morning ride (2).record.json`.
 *
 * The extension is removed by looking for the last dot **after the last path
 * separator would have been** — there are none, `fileStemOf` replaces them —
 * and a name with no dot simply gains the suffix. A ride called `2026.03.14`
 * therefore yields `2026.03.record.json` for its `.14`-looking tail only if the
 * format made one, which it always does: every caller passes a name this
 * function's own module produced, ending in `.fit`, `.gpx` or `.tcx`.
 */
export function signedRecordFileName(activityFileName: string): string {
  const dot = activityFileName.lastIndexOf('.');
  const stem = dot <= 0 ? activityFileName : activityFileName.slice(0, dot);
  return `${stem}${SIGNED_RECORD_SUFFIX}`;
}

/** What a signed record file is called, after the ride's own stem. */
export const SIGNED_RECORD_SUFFIX = '.record.json';

/**
 * A signed record as the file it travels in — ADR 0019 D-1.
 *
 * The record's own JSON object and nothing wrapping it: no envelope, no
 * `exportedAt`, no copy of the ride's name. A wrapper would be a second format
 * to specify and to keep in step with `docs/architecture.md`, and the whole
 * value of the record is that somebody outside this project can verify it with
 * a stock Ed25519 library and a stock RFC 8785 canonicaliser.
 *
 * ⚠️ **Pretty-printed, and that is safe** precisely because the signature is
 * taken over the *canonical* serialisation rather than over these bytes: a
 * verifier re-canonicalises the six payload members before it hashes anything,
 * so whitespace and member order in this file cannot affect the answer. Writing
 * it minified would buy nothing and cost a reader being able to read it.
 */
export function signedRecordFile(fileName: string, record: SignedActivityRecord): DownloadableFile {
  return {
    fileName,
    bytes: new TextEncoder().encode(`${JSON.stringify(record, undefined, 2)}\n`),
    mediaType: 'application/json',
  };
}

/**
 * The account data an activity file cannot carry, as JSON.
 *
 * ⚠️ **Every field is named, and the rows are not spread.** `{...athlete}` here
 * would export whatever the record grows next — which is the behaviour that
 * makes an export leak a field nobody meant to publish, and the mirror of the
 * reason `format.ts` refuses an unknown key rather than ignoring it. A field
 * added to `AthleteRecord` is absent from this export until somebody adds it
 * here on purpose.
 *
 * That is a real cost: a new field is silently *missing* rather than silently
 * *present*. For an export whose failure modes are "leaked something" and
 * "omitted something", omission is the one you can fix later.
 */
export function accountManifest(input: {
  readonly athleteId: AthleteId;
  readonly athlete:
    | {
        readonly displayName: string;
        readonly createdAt: number;
        readonly thresholdPower?: number | undefined;
        readonly thresholdHeartRate?: number | undefined;
        readonly mass?: number | undefined;
        /** #238's display preference. ADR 0020 D-2 puts it on the athlete so it travels here. */
        readonly units?: string | undefined;
      }
    | undefined;
  readonly deviceKey: { readonly algorithm: string; readonly publicKey: string } | undefined;
  readonly privacyZones: readonly unknown[];
  readonly segments: readonly unknown[];
  readonly routes: readonly unknown[];
  readonly workouts: readonly unknown[];
  readonly activities: readonly ManifestEntry[];
  /** #384. @see CameraManifest */
  readonly camera: CameraManifest;
  /**
   * #528, ADR 0033 D-7: where the rider was in the side camera's picture the
   * last time the framing check passed — numbers, never a picture — or
   * `undefined` when there is none.
   */
  readonly framingReference:
    | {
        readonly aspect: number;
        readonly landmarks: readonly {
          readonly name: string;
          readonly x: number;
          readonly y: number;
        }[];
      }
    | undefined;
  readonly exportedAt: number;
}): DownloadableFile {
  const manifest = {
    onYourLeftAccountExport: ACCOUNT_EXPORT_VERSION,
    exportedAt: input.exportedAt,
    athlete: {
      id: input.athleteId,
      displayName: input.athlete?.displayName ?? '',
      createdAt: input.athlete?.createdAt ?? 0,
      thresholdPower: input.athlete?.thresholdPower,
      thresholdHeartRate: input.athlete?.thresholdHeartRate,
      mass: input.athlete?.mass,
      // ⚠️ A **display** preference, exported because ADR 0020 D-2 put it on
      // the athlete precisely so it travels with them and survives an
      // erase-and-reimport. It describes nothing else in this file: every
      // distance in every activity beside it is in the canonical unit, and
      // that is true whichever way this reads.
      units: input.athlete?.units,
    },
    // The public half only. See the file header: the private half is a handle
    // and would serialise to `{}`, which reads as "exported" and is not.
    deviceKey:
      input.deviceKey === undefined
        ? undefined
        : { algorithm: input.deviceKey.algorithm, publicKey: input.deviceKey.publicKey },
    privacyZones: input.privacyZones,
    segments: input.segments,
    routes: input.routes,
    workouts: input.workouts,
    // Which file holds which ride, so the archive is navigable without opening
    // every file to find out what is in it.
    activities: input.activities,
    // #384, ADR 0029 D-3: the manifest **names** the pictures, and says in
    // words what an activity file cannot carry.
    camera: input.camera,
    // #528, ADR 0033 D-7 and ADR 0004 E: the athlete's own numbers coming back
    // to them. Fields, not the row: the record's `athleteId` is already the
    // manifest's own, and a spread would carry whatever the record grows next.
    // `null` rather than omitted, so "there was none" is written down.
    framingReference:
      input.framingReference === undefined
        ? null
        : {
            aspect: input.framingReference.aspect,
            landmarks: input.framingReference.landmarks.map((landmark) => ({
              name: landmark.name,
              x: landmark.x,
              y: landmark.y,
            })),
          },
  };
  return {
    fileName: MANIFEST_FILE_NAME,
    bytes: new TextEncoder().encode(`${JSON.stringify(manifest, undefined, 2)}\n`),
    mediaType: 'application/json',
  };
}

/**
 * What the archive says about the pictures in it — #384, ADR 0029 D-3.
 *
 * ⚠️ **Fields, not a spread row**, like everything else `accountManifest`
 * writes: *"a field added to `AthleteRecord` is absent from this export until
 * somebody adds it here on purpose"*. Here that matters more than anywhere
 * else in the file — a spread of a `CameraFrameRecord` would put the JPEG's
 * bytes into the manifest as a JSON array of numbers, which is both a
 * hundred-megabyte text file and a picture in the one file that also carries
 * the privacy zones.
 *
 * ⚠️ **`cannotCarry` is the line ADR 0029 D-3 asks for by name**: *"lists **"a
 * photograph of you"** in the *what an activity file cannot carry* list by
 * name. It is the most extreme member of that list: a FIT, GPX or TCX file has
 * no field for an image at all, so unlike a lap or a signed record this is not
 * a lossy carry, it is no carry."*
 */
export interface CameraManifest {
  /**
   * How many pictures this device is holding for the athlete — **all of them**.
   *
   * ⚠️ Read with `countCameraFrames`, never taken from the length of the
   * bounded list this run wrote from. See `transfer/store-port.ts`
   * §`AccountStore.countCameraFrames` for what a capped `kept` cost a rider.
   */
  readonly kept: number;
  /**
   * How many of them this archive contains. Fewer when a run hit its budget,
   * and **zero when the rider pressed Stop**.
   */
  readonly written: number;
  /** The files, in the order they were written. Names only — never bytes. */
  readonly files: readonly string[];
  /** What no activity file can hold, said in words. @see CameraManifest */
  readonly cannotCarry: string;
}

/** ADR 0029 D-3's sentence, in the manifest, in the rider's own archive. */
export const CAMERA_CANNOT_CARRY =
  'a photograph of you. A FIT, GPX or TCX file has no field for an image at all, so a picture ' +
  'travels as its own file beside the ride rather than inside it. A ride you share with somebody ' +
  'else never carries one.';

/** A kept picture as the file it travels in — ADR 0029 D-3. */
export function cameraFrameFile(fileName: string, bytes: Uint8Array): DownloadableFile {
  // ⚠️ The bytes, untouched. D-3: *"it is **not** obfuscated, trimmed or
  // downscaled"* — this is the athlete's own data coming back to them, and
  // ADR 0004 E's invariant is that it comes back whole.
  return { fileName, bytes, mediaType: 'image/jpeg' };
}

/**
 * Export every ride this athlete has, plus the manifest.
 *
 * **Never throws for anything one ride did.** A ride whose streams cannot be
 * encoded is a `failed` outcome and the export carries on — an archive missing
 * one ride is worth having and an export that aborts on the first bad ride is
 * not. The only exceptions that escape are the ones that mean this client is
 * broken.
 *
 * ⚠️ **The manifest comes last**, which is the opposite of where a reader
 * expects an index. It has to: it names every file that was actually produced,
 * and it can only know that once they have been. A manifest written first would
 * either list rides that then failed — describing an archive nobody has — or
 * list nothing, which is not an index. A reader looking for it looks at the end
 * of the sequence, and `MANIFEST_FILE_NAME` is fixed so it can be found by name
 * rather than by position.
 *
 * ⚠️ **One manifest per run, not per archive — and since #306 that is visible.**
 * Each run indexes the rides *it* exported, so a library taken in three presses
 * is three manifests, which a browser names `on-your-left-account.json`,
 * `… (2).json`, `… (3).json`. Every ride is listed in exactly one of them, so
 * the set is complete and no ride is present-but-unlisted; what it is not is a
 * single index over the whole archive. Making it one would mean this function
 * accumulating every prior run's entries, which it cannot do without being
 * handed them — the report deliberately never holds the bytes, and the cursor
 * deliberately holds a place rather than a history. It is worth doing when a
 * rider has to read one of these; until then it is a stated shape rather than a
 * defect nobody wrote down.
 */
export async function exportEverything(
  options: AccountExportOptions,
): Promise<AccountExportReport> {
  const { store, athleteId, format, onFile } = options;
  const limit = options.limit ?? ACCOUNT_EXPORT_LIMIT;

  const summaries = await store.listActivitySummaries(athleteId, {
    orderBy: 'startedAt',
    direction: 'ascending',
    limit: limit + 1,
    // ⚠️ **Both halves, spread together.** `startedAfter` on its own is
    // strictly after the *instant*, which cannot separate two rides that
    // started in the same second; `afterActivityId` makes that bound inclusive
    // and drops the ids already covered at it — **before `limit` counts**,
    // which is why it lives in the store rather than as a filter here. A page
    // of one spent on a ride already exported is an empty page that reads as an
    // exhausted library. #306.
    ...(options.after === undefined
      ? {}
      : { startedAfter: options.after.startedAt, afterActivityId: options.after.activityId }),
  });
  const wanted = summaries.slice(0, limit);
  const more = summaries.length > limit;

  const outcomes: AccountExportOutcome[] = [];
  const listed: ManifestEntry[] = [];

  // ⚠️ **Stems are made unique here, and are not unique on their own.**
  // `fileStemOf` is a ride's *name*, and a rider with two rides called
  // "Morning ride" — which is what an unnamed import is called — gets two files
  // with one name. In a single-ride export the browser suffixes the second and
  // nobody minds; in an archive it makes the manifest's index ambiguous, which
  // is the one thing the index exists not to be.
  const used = new Map<string, number>();
  const uniqueName = (stem: string): string => {
    const seen = used.get(stem) ?? 0;
    used.set(stem, seen + 1);
    return seen === 0 ? `${stem}.${format}` : `${stem} (${String(seen + 1)}).${format}`;
  };

  for (const summary of wanted) {
    const fileName = uniqueName(fileStemOf(summary));
    // Checked at the top, so a cancelled ride is one no file was handed over
    // for, rather than one handed over and then reported as cancelled.
    if (options.signal?.aborted === true) {
      const outcome: AccountExportOutcome = {
        activityId: summary.id,
        fileName,
        kind: 'cancelled',
        lost: [],
        reason: 'cancelled before this ride was reached; no file was written for it',
        signedRecord: undefined,
      };
      outcomes.push(outcome);
      options.onProgress?.({ completed: outcomes.length, total: wanted.length, outcome });
      continue;
    }

    // #221, ADR 0019 D-1. Read **before** the file is written, and written
    // whether or not the file was: the record is destroyed by the erase and
    // cannot be re-minted afterwards (ADR 0014 D-7), so a ride whose streams
    // will not encode must not take its record down with it. That is the whole
    // complaint the issue makes about the pair of them.
    const stored = await store.getActivityRecord(athleteId, summary.id);
    const recordName = stored === undefined ? undefined : signedRecordFileName(fileName);

    let outcome: AccountExportOutcome;
    let written: boolean;
    let reason: string | undefined;
    try {
      const exported = await exportActivity({
        store,
        athleteId,
        activityId: summary.id,
        format,
      });
      // The de-duplicated name, not `exported.file.fileName` — that is the
      // single-ride name and is the one that collides.
      const file = { ...exported.file, fileName };
      await onFile(file);
      written = true;
      outcome = {
        activityId: summary.id,
        fileName,
        kind: 'exported',
        lost: exported.lost,
        reason: undefined,
        signedRecord: recordName,
      };
    } catch (error) {
      // Narrowed to the exporter's own error rather than catching everything:
      // a `TypeError` here means this code is wrong, and swallowing it would
      // turn a bug in the client into a rider's ride quietly going missing.
      if (!(error instanceof ActivityExportError)) {
        throw error;
      }
      written = false;
      reason = error.message;
      outcome = {
        activityId: summary.id,
        fileName,
        kind: 'failed',
        lost: [],
        reason: error.message,
        signedRecord: recordName,
      };
    }
    if (stored !== undefined && recordName !== undefined) {
      // Not inside the `try`: a record is not what `ActivityExportError`
      // describes, so a throw from here is a bug in this client and belongs
      // uncaught, exactly as the narrowing above intends.
      await onFile(signedRecordFile(recordName, stored.record));
    }
    // ⚠️ Listed even when no file was written. An archive whose manifest
    // simply omits a ride leaves nothing saying it ever existed — the rider
    // who then erases the device has lost it without ever being told which
    // one. `written: false` says "this ride is yours and this archive does
    // not contain it", which is the honest record.
    listed.push({
      activityId: summary.id,
      fileName,
      written,
      ...(reason === undefined ? {} : { reason }),
      // `null`, never omitted. See {@link ManifestEntry.signedRecord}.
      signedRecord: recordName ?? null,
    });
    outcomes.push(outcome);
    options.onProgress?.({ completed: outcomes.length, total: wanted.length, outcome });
  }

  const [athlete, deviceKey, privacyZones, segments, routes, workouts, framingReference] =
    await Promise.all([
      store.getAthlete(athleteId),
      store.getDeviceKey(athleteId),
      store.listPrivacyZones(athleteId),
      store.listSegments(athleteId),
      store.listRoutes(athleteId),
      store.listWorkouts(athleteId),
      store.getFramingReference(athleteId),
    ]);

  // #384, ADR 0029 D-3.
  //
  // ⚠️ **The COUNT and the LIST are two different reads, and conflating them is
  // the defect this pair replaced.** The count is the truth about the device
  // and goes in the manifest; the list is bounded, because every row is a whole
  // JPEG and the budget is what stops one run handing a hundred megabytes to
  // the browser's download machinery. Reading `limit + 1` and reporting its
  // length — which is what this did — caps `kept` at 201 however many a rider
  // holds, so an archive of 200 out of 300 reported "200 of 201" and invited
  // the rider to erase a device holding a hundred pictures this archive does
  // not contain.
  const keptCameraFrames = await store.countCameraFrames(athleteId);
  const cameraFiles: string[] = [];
  // ⚠️ A function rather than a `const`, and not only for the typechecker's
  // sake: the signal can be aborted between any two `await`s here, so a value
  // read once is a stale answer by the time the loop below consults it.
  const stopped = (): boolean => options.signal?.aborted === true;
  // ⚠️ A Stop skips the pictures too. It used to skip every remaining ride and
  // then write up to two hundred photographs anyway, which is the opposite of
  // what a rider pressing Stop asked for — and `written < kept` in the manifest
  // is what says the archive is short, exactly as it does for a budget.
  //
  // ⚠️ **This outer guard saves the READ; the `break` inside the loop is what
  // makes the behaviour true, and that was measured rather than assumed.**
  // Deleting this `if` leaves every test in `export-everything.test.ts` green,
  // because the break catches the same case one iteration later. What it is
  // worth is the read it skips: `listCameraFrames` pulls up to two hundred
  // whole JPEGs into memory, and a rider who has pressed Stop should not wait
  // for that. `…test.ts` §"stops between two pictures" is the case that holds
  // the break, because aborting before the first file is answered by either
  // one alone.
  if (!stopped()) {
    const carried = await store.listCameraFrames(athleteId, ACCOUNT_EXPORT_FRAME_LIMIT);
    for (const [ordinal, frame] of carried.entries()) {
      if (stopped()) {
        break;
      }
      const name = cameraFrameFileName(frame.capturedAt, ordinal + 1);
      // ⚠️ Not inside the `try` any ride is exported in, and not guarded by
      // `ActivityExportError`: a failure to hand over a picture is not a ride
      // failing to encode, it is this client being broken, and it belongs
      // uncaught — the same call the signed record beside it makes.
      await onFile(cameraFrameFile(name, frame.bytes));
      cameraFiles.push(name);
    }
  }

  await onFile(
    accountManifest({
      athleteId,
      athlete,
      deviceKey,
      privacyZones,
      segments,
      routes,
      workouts,
      activities: listed,
      camera: {
        kept: keptCameraFrames,
        written: cameraFiles.length,
        files: cameraFiles,
        cannotCarry: CAMERA_CANNOT_CARRY,
      },
      framingReference,
      exportedAt: Math.trunc(Date.now() / 1000),
    }),
  );

  const cancelled = outcomes.filter((each) => each.kind === 'cancelled').length;
  // ⚠️ **The last ride this run actually finished with, not the last one it
  // looked at.** Taking `wanted.at(-1)` pointed the cursor past every ride a
  // Stop had skipped, so resuming from it lost them permanently — and the
  // screen invites exactly that by offering Stop and then "run it again to
  // continue". A cancelled ride is one that has not been exported, so the
  // cursor must not have passed it.
  const lastFinished = wanted.find(
    (ride) => ride.id === outcomes.filter((each) => each.kind !== 'cancelled').at(-1)?.activityId,
  );
  return {
    outcomes,
    exported: outcomes.filter((each) => each.kind === 'exported').length,
    failed: outcomes.filter((each) => each.kind === 'failed').length,
    cancelled,
    signedRecords: outcomes.filter((each) => each.signedRecord !== undefined).length,
    // More to do when the library ran past the limit **or** when this run was
    // stopped part-way. Both mean "there is more of your history than this
    // archive holds", which is the only thing the sentence claims.
    continueAfter:
      (more || cancelled > 0) && lastFinished !== undefined
        ? { startedAt: lastFinished.startedAt, activityId: lastFinished.id }
        : undefined,
  };
}
