// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The slice of `@onyourleft/store` this screen needs, and the side effects it
 * cannot perform in a test.
 *
 * Narrowed to seven methods rather than taking `ActivityStore` itself, for the
 * reason `recording/recorder.ts` narrows its own: a test then hands the same
 * code the round-trip harness's store (`@onyourleft/store/testing`), so the
 * import assertions read back on a **connection this process never wrote
 * through** rather than on the handle that did the writing. docs/agents/quality-gate.md §5 calls
 * that the fourth cause of a write that reports success while the read cannot
 * see it, and it is the one a naive test cannot detect.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  ActivitySummary,
  AthleteId,
  AthleteRecord,
  AthleteDeletionCounts,
  CameraFrameRecord,
  DeviceKeyRecord,
  FramingReferenceRecord,
  SideCameraReportRecord,
  RideWriteUpRecord,
  RiderTextKind,
  RiderTextRecord,
  LapRecord,
  ListActivitiesOptions,
  NewActivity,
  NewStreamSet,
  PrivacyZoneRecord,
  RouteId,
  RouteRecord,
  SegmentRecord,
  StoredActivityRecord,
  StreamSet,
  WorkoutGoalsRead,
  WorkoutRecord,
} from '@onyourleft/store';

/**
 * Everything an account export reads that a single ride's export does not.
 *
 * Separate from {@link TransferStore} rather than folded into it, so the
 * importer and the one-ride exporter go on declaring the seven methods they
 * actually use. A port that grows a method for every feature stops being the
 * narrowing the file header argues for.
 *
 * ⚠️ `getDeviceKey` returns the whole {@link DeviceKeyRecord}, private handle
 * and all. That is the store's shape and narrowing it here would be a false
 * comfort — the handle cannot be exported by anyone, which is a property of the
 * key rather than of this type. `accountManifest` is where the public half is
 * selected, and `export-everything.test.ts` is what proves the private half
 * reaches no file.
 */
export interface AccountStore {
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  /**
   * The rider's goals, ride notes or documents (#836) — carried by the
   * account export as the rider's own data (ADR 0040 D-10).
   */
  listRiderTexts(owner: AthleteId, kind: RiderTextKind): Promise<RiderTextRecord[]>;
  /** The keys of the rider's texts of one kind, reading no row (#924). */
  listRiderTextKeys(owner: AthleteId, kind: RiderTextKind): Promise<string[]>;
  /** One of the rider's texts, read on its own, so one bad row costs only itself (#924). */
  getRiderText(
    owner: AthleteId,
    kind: RiderTextKind,
    key: string,
  ): Promise<RiderTextRecord | undefined>;
  /**
   * Removes the athlete and everything of theirs. #35's deletion half.
   *
   * The counts come back so the screen can say what happened without reading
   * anything else — and they are counts rather than names, because a route is
   * routinely called after a place and ADR 0004 decision D binds every layer
   * that formats one into a string.
   */
  deleteAthlete(id: AthleteId): Promise<AthleteDeletionCounts>;
  /**
   * The rider's typed workout goals (#1236) — carried by the account export so
   * that ADR 0005 F's rollback (export → downgrade → re-import) keeps them.
   */
  getWorkoutGoals(owner: AthleteId): Promise<WorkoutGoalsRead>;
  /**
   * Puts the athlete row back after an erase.
   *
   * `ensureAthlete` and not `putAthlete` for the reason `local-athlete.ts`
   * gives: a `put` at start-up would rewrite the row on every page load and
   * discard the display name, the creation instant and the thresholds.
   */
  ensureAthlete(record: AthleteRecord): Promise<AthleteRecord>;
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
  listSegments(owner: AthleteId, limit?: number): Promise<SegmentRecord[]>;
  listRoutes(owner: AthleteId, limit?: number): Promise<RouteRecord[]>;
  listWorkouts(owner: AthleteId, limit?: number): Promise<WorkoutRecord[]>;
  getDeviceKey(owner: AthleteId): Promise<DeviceKeyRecord | undefined>;
  /**
   * The signed record for one ride, or `undefined` — #221, ADR 0019.
   *
   * ⚠️ **`undefined` is the ordinary case, not a fault.** Records are written
   * by the recorder, so an imported ride never had one and a ride recorded
   * before #61 does not either. An export that treated the absence as a failure
   * would report most libraries as broken.
   *
   * What comes back is **parsed and not verified** — `packages/store`'s
   * `identity.ts` says so at the top, and ADR 0019 D-3 records why the export
   * carries it anyway: a record that does not verify is still the evidence this
   * device holds, and dropping it would destroy the only copy of the thing a
   * rider needs in order to find out what happened.
   */
  getActivityRecord(owner: AthleteId, id: ActivityId): Promise<StoredActivityRecord | undefined>;
  /**
   * Every picture this athlete kept — #384,
   * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-3.
   *
   * ⚠️ **This is the ONE read in the client that returns a picture**, and it is
   * here rather than on `camera/store-port.ts` deliberately. D-11 keeps a kept
   * frame off every screen: a camera port that could hand one to a component is
   * a component somebody writes. An export writes it to a **file the rider
   * asked for**, which is the one destination D-3 permits — *"it is the
   * athlete's own data coming back to them, so ADR 0004 E applies unchanged: it
   * is **not** obfuscated, trimmed or downscaled."*
   *
   * ⚠️ **Bounded by the caller**, and more sharply than any other read here:
   * every row is a whole JPEG, so a rider who kept a hundred is tens of
   * megabytes decoded by one call. `export-everything.ts`
   * §`ACCOUNT_EXPORT_FRAME_LIMIT` states the budget.
   *
   * Usually **empty**, and that is the ordinary case rather than a fault: D-2
   * discards a frame unless the rider turned that ride's keep on.
   */
  listCameraFrames(owner: AthleteId, limit?: number): Promise<CameraFrameRecord[]>;
  /**
   * How many pictures this athlete has kept — **all of them**, whatever the
   * export's own budget is.
   *
   * ⚠️ **The manifest's `kept` comes from here and never from the length of the
   * bounded list**, and it used to come from the list: `listCameraFrames` was
   * read at `ACCOUNT_EXPORT_FRAME_LIMIT + 1` and its length reported, so a
   * rider holding three hundred pictures was told their archive contained 200
   * of 201. They would conclude one was missing, erase the device, and have
   * lost a hundred. The bound on the list is what makes the run finite; the
   * count is what makes the manifest true, and the two cannot be the same read.
   *
   * ⚠️ Counted through the index rather than by reading rows — a count that
   * decoded every JPEG on the device would be the thing the budget exists to
   * avoid.
   */
  countCameraFrames(owner: AthleteId): Promise<number>;
  /**
   * The side camera's framing reference — #528, ADR 0033 D-7: *"carried in
   * the account export under ADR 0004 E, because it is the athlete's own
   * data."* Numbers, never a picture, and at most one.
   */
  getFramingReference(owner: AthleteId): Promise<FramingReferenceRecord | undefined>;
  /**
   * The side camera's report on one ride — #388, the owner's retention ruling:
   * the report's sentences are *"included in the account export"*. Read per
   * ride, inside the export's own bound on one run, and written into that
   * ride's manifest entry.
   */
  getSideCameraReport(
    owner: AthleteId,
    activity: ActivityId,
  ): Promise<SideCameraReportRecord | undefined>;
  /**
   * A model's write-up of one ride — #800, ADR 0035: the athlete's own data,
   * so it travels in the account export (ADR 0004 E) beside the ride it is
   * about, #801's criterion. Read per ride, like the report.
   */
  getRideWriteUp(owner: AthleteId, activity: ActivityId): Promise<RideWriteUpRecord | undefined>;
}

/**
 * The one write this screen makes that is not an activity — #232.
 *
 * Separate from {@link TransferStore} for {@link AccountStore}'s reason, and it
 * matters more here: this is a *route* write on the *files* screen, which is
 * exactly the confusion #232 is about. Keeping it its own interface means a
 * reader can see in one line that the Files screen's route powers are "save a
 * route" and nothing else — it cannot list them, read them, publish one or
 * delete one.
 */
export interface CourseStore {
  putRoute(record: RouteRecord): Promise<RouteId>;
}

/** What import and export do to the store, and nothing else. */
export interface TransferStore {
  findActivityByOriginalFileHash(
    owner: AthleteId,
    sha256: string,
  ): Promise<ActivityRecord | undefined>;
  putActivity(record: NewActivity): Promise<ActivityId>;
  putStreamSet(set: NewStreamSet): Promise<ActivityId>;
  deleteActivity(owner: AthleteId, id: ActivityId): Promise<boolean>;
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  getStreamSet(owner: AthleteId, activity: ActivityId): Promise<StreamSet | undefined>;
  /**
   * The ride's splits, in `ordinal` order — #221.
   *
   * Athlete-scoped like every other read here, and that is the whole reason it
   * is a two-argument call: a lap carries a denormalised `athleteId` precisely
   * so that "the laps of this activity id" is never askable without saying
   * whose. Passing the *ride's* own owner rather than the requesting athlete's
   * would compile and would pass every single-athlete test in the suite.
   */
  listLaps(owner: AthleteId, activity: ActivityId): Promise<LapRecord[]>;
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
}

/** A file this client hands to the browser to save. */
export interface DownloadableFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

/**
 * Everything the transfer screen needs from outside itself.
 *
 * Built in `main.tsx` and passed down, like `capabilities` and
 * `rideController` before it. `undefined` is a real state and the view renders
 * an honest explanation for it: this screen needs `crypto.subtle` to fingerprint
 * a file, and that is absent outside a secure context — which includes a bundle
 * opened straight off the disk as `file://`. #48's first criterion rejects a
 * control that looks like the way in and cannot work, so there is no file
 * picker on that path at all.
 */
export interface TransferPort {
  readonly store: TransferStore & AccountStore & CourseStore;
  readonly athleteId: AthleteId;
  /** A fresh activity id per imported file. `crypto.randomUUID()` in production. */
  newActivityId(): ActivityId;
  /**
   * A fresh route id, for a file the rider turns into a course instead (#232).
   *
   * Its own generator rather than reusing {@link newActivityId} and casting: an
   * `ActivityId` and a `RouteId` are different brands precisely so that one
   * cannot be passed where the other belongs, and a cast at the call site is
   * how that guarantee gets spent.
   */
  newRouteId(): RouteId;
  now(): UnixSeconds;
  /** The IANA zone an imported ride's local start time is read in. */
  readonly timeZone: string;
  /** SHA-256 of a file's bytes, lowercase hex. @see webCryptoDigest */
  digest(bytes: Uint8Array): Promise<string>;
  /**
   * Hands a file to the browser to save.
   *
   * ⚠️ Declared as a **property with a function type**, not as a method. Method
   * syntax makes the parameter bivariant and makes the reference unbound, so
   * `port.save` passed along to another component is an
   * `@typescript-eslint/unbound-method` error — which is what #74 hit when the
   * routes screen needed the same downloader. A property type is both stricter
   * and passable.
   */
  readonly save: (file: DownloadableFile) => void;
  /**
   * The half-drawn route in `localStorage`, so an erase can forget it.
   *
   * ⚠️ It is here rather than reached for directly because it is the one piece
   * of athlete data on this device that `deleteAthlete` **cannot see** — a
   * route draft's waypoints are raw coordinates, usually starting at the
   * rider's front door. See `routing/draft-storage.ts`.
   */
  readonly drafts: DraftStore;
  /**
   * The palette choice in `localStorage` (#672), so an erase can forget it and
   * put the page back on the device's palette. Required rather than optional,
   * so a caller cannot build an erase that silently leaves it behind.
   */
  readonly theme: DraftStore;
  /**
   * The hosted model's address, model name and key in `localStorage` (#518),
   * so an erase can forget them. Required for `theme`'s reason: a caller
   * cannot build an erase that silently leaves a key behind.
   */
  readonly hostedModel: DraftStore;
  /**
   * This device's sign-in to an instance and its address in `localStorage`
   * (#777), so an erase can forget them — `instance/instance-port.ts`
   * §`instanceEraser`. Required for `theme`'s reason: an erase mints a new
   * key, and a token left behind would sign in as the identity just erased.
   */
  readonly instance: DraftStore;
  /**
   * The note of analysis jobs asked of an instance and not yet seen to end
   * (#1102) — `ride-analysis/instance-analysis.ts` §`instanceAnalysisEraser`.
   * Required, so an erase cannot leave it behind and the policy's sentence
   * about it stay true.
   */
  readonly instanceAnalysis: DraftStore;
  /**
   * The row to recreate after an erase.
   *
   * Erasing removes the athlete row every write path checks, and
   * `ensureLocalAthlete` runs once at start-up — so without this the tab
   * survives the erase and every later write throws, which is #184 exactly.
   */
  readonly athleteRow: AthleteRecord;
}

/** What the erase needs of `routing/draft-storage.ts`. One method. */
export interface DraftStore {
  forget(): void;
}
