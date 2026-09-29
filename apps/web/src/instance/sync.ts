// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two-way sync with an instance (#776): pull what this device is missing,
 * then push what the instance is missing.
 *
 * ## What this module does NOT do: talk to the network
 *
 * It names no `fetch`, for `sign-in.ts`'s reason: it takes a
 * {@link SyncTransport}, and #777 — the one module `privacy/no-network.test.ts`
 * will permit to call an instance — supplies the production one after #778
 * has changed every promise about what leaves the device. Until then nothing
 * in the shipped client calls this, so a rider connected to no instance sees no
 * sync, no sync error and no request (#776's last criterion).
 *
 * ## Pull — a new device, or a reinstall
 *
 * 1. Page through the instance's manifest (`GET /v1/sync/manifest`), from the
 *    start every time. A cursor kept between syncs would skip an item whose
 *    local write failed last time; the full walk costs one request per page.
 * 2. For each live ACTIVITY this device does not hold — by its activity id,
 *    and by the file's hash for a ride this device itself imported — fetch the
 *    signed record and the original file, and **verify the signature and the
 *    file's hash BEFORE anything is written** (ADR 0014 D-6). A record that
 *    does not verify is not written, and the report names which of D-6's
 *    answers it got.
 * 3. Import the file through the SAME path a rider's own import takes
 *    (`transfer/import-batch.ts`), under the record's own activity id, so the
 *    ride library reads it exactly as it reads any other ride.
 * 4. Then each write-up and side-camera report whose ride is on this device,
 *    written through the store's own validating writes. A tombstoned ACTIVITY
 *    is deleted here, which takes its write-up and report with it.
 *
 * ⚠️ **A pulled record is not kept on this device.** `packages/store`'s
 * `putActivityRecord` refuses a record signed by a key that is not THIS
 * device's (ADR 0014 D-7: one key per device, no rotation in this phase), and
 * that rule is not loosened here: the instance keeps the record, and this
 * device keeps the ride. Pushing skips a pulled ride by its file hash, so it
 * is never signed a second time by the device that pulled it.
 *
 * ## Push
 *
 * Every local ride whose file the instance does not hold: a ride with no
 * signed record is written out as FIT by the export path (`transfer/export-
 * activity.ts`), signed by this device's key, its record kept locally, and the
 * two sent to `POST /v1/sync/records` — which is idempotent, so a push that
 * did not hear its answer is simply sent again. Then each write-up and
 * side-camera report, as JSON with the device's own athlete id left out
 * (every device's local athlete is `local`), sent only when its digest differs
 * from the manifest's — so the instance stores exactly the device's screened
 * copy (#776's addition).
 *
 * Goals, notes and reference documents (#836) are carried by the instance
 * already; this module pushes them when #836 gives the device something to
 * push.
 */

import {
  contentHashOf,
  parseContentHash,
  signActivityRecord,
  toHex,
  unixSeconds,
  verifyActivityRecord,
  type ActivityClaims,
  type Sha256,
  type SignatureVerifier,
  type SigningKey,
  type UnixSeconds,
} from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  ActivityStore,
  AthleteId,
  RideWriteUpRecord,
  SideCameraReportRecord,
} from '@onyourleft/store';

import { exportActivity } from '../transfer/export-activity';
import { importActivityFiles } from '../transfer/import-batch';
import type { TransferStore } from '../transfer/store-port';

/** One request to the instance, with this device's session already attached. */
export interface SyncTransport {
  /** A JSON request: the status and the parsed body. */
  json(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  /** A request answered with bytes: the status and the bytes. */
  bytes(path: string): Promise<{ readonly status: number; readonly bytes: Uint8Array }>;
}

/** What sync needs of the local store: the transfer screen's port, and six writes and reads. */
export type SyncStore = TransferStore &
  Pick<
    ActivityStore,
    | 'getActivityRecord'
    | 'putActivityRecord'
    | 'getRideWriteUp'
    | 'putRideWriteUp'
    | 'getSideCameraReport'
    | 'putSideCameraReport'
  >;

export interface SyncDependencies {
  readonly transport: SyncTransport;
  readonly store: SyncStore;
  readonly athleteId: AthleteId;
  /** This device's signing key — `ensureDeviceSigningKey`, bound. Asked for only to push. */
  readonly signingKey: () => Promise<SigningKey>;
  readonly sha256: Sha256;
  readonly verifier: SignatureVerifier;
  readonly now: () => UnixSeconds;
  /** The zone a pulled ride is imported in when its record does not name one it can use. */
  readonly timeZone: string;
}

/** The two item kinds this device syncs beside its rides. */
type ItemKind = 'write-up' | 'side-camera-report';

/** One manifest entry, as the instance sends it. */
interface ManifestEntry {
  readonly kind: string;
  readonly key: string;
  readonly digest: string | null;
  readonly deleted: boolean;
  readonly activityId: string | null;
}

/** Why one thing did not sync. */
export interface SyncFailure {
  readonly kind: string;
  readonly key: string;
  /** An instance error code, a verification status, or `not-stored`. */
  readonly reason: string;
}

export interface SyncReport {
  readonly pulled: number;
  readonly pushed: number;
  readonly itemsPulled: number;
  readonly itemsPushed: number;
  readonly deleted: number;
  readonly failures: readonly SyncFailure[];
}

/** Why the whole sync stopped: the instance refused the manifest itself. */
export class InstanceSyncError extends Error {
  override readonly name = 'InstanceSyncError';
  constructor(readonly code: string) {
    super(`The instance refused to sync: ${code}.`);
  }
}

const codeOf = (body: unknown): string => {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : 'unknown';
};

const hex = async (bytes: Uint8Array, sha256: Sha256): Promise<string> =>
  toHex(await sha256(bytes));

/** The instance's whole manifest for this athlete, tombstones included. */
async function readManifest(transport: SyncTransport): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let cursor: string | null = null;
  do {
    const answer = await transport.json(
      'GET',
      `/v1/sync/manifest?limit=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
    );
    if (answer.status !== 200) throw new InstanceSyncError(codeOf(answer.body));
    const page = answer.body as { items: ManifestEntry[]; next: string | null };
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== null);
  return entries;
}

/** Every local ride of this athlete, oldest first, a page at a time. */
async function localRides(store: SyncStore, athleteId: AthleteId): Promise<ActivityId[]> {
  const ids: ActivityId[] = [];
  let after: { startedAfter: UnixSeconds; afterActivityId: ActivityId } | undefined;
  for (;;) {
    const page = await store.listActivitySummaries(athleteId, {
      orderBy: 'startedAt',
      direction: 'ascending',
      limit: 50,
      ...(after ?? {}),
    });
    ids.push(...page.map((ride) => ride.id));
    const last = page.at(-1);
    if (page.length < 50 || last === undefined) return ids;
    after = { startedAfter: last.startedAt, afterActivityId: last.id };
  }
}

/** A write-up or report as the instance keeps it: the device's copy, its athlete id left out. */
function itemBody(record: RideWriteUpRecord | SideCameraReportRecord): string {
  return JSON.stringify({ ...record, athleteId: undefined });
}

/** Pull what the instance holds and this device does not, then push the reverse. */
export async function syncWithInstance(dependencies: SyncDependencies): Promise<SyncReport> {
  const { transport, store, athleteId, sha256 } = dependencies;
  const failures: SyncFailure[] = [];
  let pulled = 0;
  let pushed = 0;
  let itemsPulled = 0;
  let itemsPushed = 0;
  let deleted = 0;

  const manifest = await readManifest(transport);
  const live = manifest.filter((entry) => !entry.deleted);

  // --- Pull: rides ---------------------------------------------------------
  for (const entry of live.filter((each) => each.kind === 'activity')) {
    const id = entry.activityId as ActivityId | null;
    if (id !== null && (await store.getActivity(athleteId, id)) !== undefined) continue;
    if ((await store.findActivityByOriginalFileHash(athleteId, entry.key)) !== undefined) continue;
    const outcome = await pullRide(dependencies, entry.key);
    if (outcome === 'pulled') pulled += 1;
    else failures.push({ kind: 'activity', key: entry.key, reason: outcome });
  }

  // --- Pull: a ride deleted on another device -------------------------------
  for (const entry of manifest.filter((each) => each.deleted && each.kind === 'activity')) {
    const id = entry.activityId as ActivityId | null;
    const ride =
      (id === null ? undefined : await store.getActivity(athleteId, id)) ??
      (await store.findActivityByOriginalFileHash(athleteId, entry.key));
    if (ride !== undefined && (await store.deleteActivity(athleteId, ride.id))) deleted += 1;
  }

  // --- Pull: write-ups and side-camera reports -----------------------------
  for (const entry of live) {
    if (entry.kind !== 'write-up' && entry.kind !== 'side-camera-report') continue;
    const activity = entry.key as ActivityId;
    if ((await store.getActivity(athleteId, activity)) === undefined) continue;
    const local = await localItem(store, athleteId, entry.kind, activity);
    if (local !== undefined && (await hex(utf8(itemBody(local)), sha256)) === entry.digest) {
      continue;
    }
    const answer = await transport.json(
      'GET',
      `/v1/sync/items/${entry.kind}/${encodeURIComponent(entry.key)}`,
    );
    if (answer.status !== 200) {
      failures.push({ kind: entry.kind, key: entry.key, reason: codeOf(answer.body) });
      continue;
    }
    try {
      const body = JSON.parse((answer.body as { body: string }).body) as object;
      const record = { ...body, athleteId, activityId: activity };
      if (entry.kind === 'write-up') await store.putRideWriteUp(record as RideWriteUpRecord);
      else await store.putSideCameraReport(record as SideCameraReportRecord);
      itemsPulled += 1;
    } catch {
      failures.push({ kind: entry.kind, key: entry.key, reason: 'not-stored' });
    }
  }

  // --- Push: rides -----------------------------------------------------------
  const onInstance = new Set(
    manifest.filter((entry) => entry.kind === 'activity').map((entry) => entry.key),
  );
  const digests = new Map(live.map((entry) => [`${entry.kind}\u0000${entry.key}`, entry.digest]));
  const rides = await localRides(store, athleteId);
  for (const id of rides) {
    const outcome = await pushRide(dependencies, id, onInstance);
    if (outcome === 'pushed') pushed += 1;
    else if (outcome !== 'held') failures.push({ kind: 'activity', key: id, reason: outcome });
  }

  // --- Push: write-ups and side-camera reports --------------------------------
  for (const id of rides) {
    for (const kind of ['write-up', 'side-camera-report'] as const) {
      const local = await localItem(store, athleteId, kind, id);
      if (local === undefined) continue;
      const body = itemBody(local);
      if (digests.get(`${kind}\u0000${id}`) === (await hex(utf8(body), sha256))) continue;
      const answer = await transport.json(
        'POST',
        `/v1/sync/items/${kind}/${encodeURIComponent(id)}`,
        {
          body,
        },
      );
      if (answer.status === 200) itemsPushed += 1;
      else failures.push({ kind, key: id, reason: codeOf(answer.body) });
    }
  }

  return { pulled, pushed, itemsPulled, itemsPushed, deleted, failures };
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function localItem(
  store: SyncStore,
  athleteId: AthleteId,
  kind: ItemKind,
  activity: ActivityId,
): Promise<RideWriteUpRecord | SideCameraReportRecord | undefined> {
  return kind === 'write-up'
    ? store.getRideWriteUp(athleteId, activity)
    : store.getSideCameraReport(athleteId, activity);
}

/**
 * One ride from the instance: fetched, VERIFIED, then imported. Answers
 * `pulled`, or why not: an instance error code, one of ADR 0014 D-6's
 * verification answers (`RecordVerification`'s status), or an import code.
 */
async function pullRide(dependencies: SyncDependencies, content: string): Promise<string> {
  const { transport, store, athleteId, sha256, verifier } = dependencies;
  const recordAnswer = await transport.json('GET', `/v1/sync/records/${content}`);
  if (recordAnswer.status !== 200) return codeOf(recordAnswer.body);
  const fileAnswer = await transport.bytes(`/v1/sync/files/${content}`);
  if (fileAnswer.status !== 200) return 'file-not-found';

  // Before anything is written (ADR 0014 D-6, #776's third criterion).
  const verification = await verifyActivityRecord(
    (recordAnswer.body as { record: unknown }).record,
    {
      verifier,
      fileDigest: await sha256(fileAnswer.bytes),
    },
  );
  if (verification.status !== 'verified') return verification.status;
  const claims: ActivityClaims = verification.record.claims;

  const report = await importActivityFiles({
    // A FIT file carries no name, so the import takes one from the file's
    // name: this is the name the record claims. The extension is only a hint —
    // the type is read from the bytes — and a `/` would be read as a folder.
    sources: [
      {
        fileName: `${claims.name.replaceAll('/', '\u2215')}.fit`,
        bytes: () => Promise.resolve(fileAnswer.bytes),
      },
    ],
    store,
    athleteId,
    newActivityId: () => claims.activityId as ActivityId,
    now: dependencies.now,
    digest: (bytes) => hex(bytes, sha256),
    timeZone: claims.startedAtTimeZone,
  });
  const [outcome] = report.outcomes;
  return outcome?.kind === 'imported' || outcome?.kind === 'duplicate'
    ? 'pulled'
    : (outcome?.code ?? 'not-stored');
}

/**
 * One local ride to the instance, unless it holds the file already. Answers
 * `pushed`, `held`, or why not.
 */
async function pushRide(
  dependencies: SyncDependencies,
  id: ActivityId,
  onInstance: ReadonlySet<string>,
): Promise<string> {
  const { transport, store, athleteId, sha256 } = dependencies;
  const kept = await store.getActivityRecord(athleteId, id);
  if (kept !== undefined && onInstance.has(toHex(parseContentHash(kept.record.contentHash)))) {
    return 'held';
  }
  const ride: ActivityRecord | undefined = await store.getActivity(athleteId, id);
  if (ride === undefined) return 'not-stored';
  // A ride this device pulled: the instance has its file already.
  if (ride.originalFile !== undefined && onInstance.has(ride.originalFile.sha256)) return 'held';

  let bytes: Uint8Array;
  try {
    bytes = (await exportActivity({ store, athleteId, activityId: id, format: 'fit' })).file.bytes;
  } catch {
    return 'no-file';
  }
  const contentHash = await contentHashOf(bytes, sha256);
  let record = kept?.record;
  if (record === undefined) {
    record = await signActivityRecord(
      { claims: claimsOf(ride), contentHash },
      await dependencies.signingKey(),
    );
    await store.putActivityRecord({
      athleteId,
      activityId: id,
      record,
      recordedAt: dependencies.now(),
    } as Parameters<SyncStore['putActivityRecord']>[0]);
  } else if (record.contentHash !== contentHash) {
    // The record vouches for bytes this device can no longer write.
    return 'file-changed';
  }
  if (onInstance.has(toHex(parseContentHash(contentHash)))) return 'held';
  const answer = await transport.json('POST', '/v1/sync/records', {
    record,
    file: toBase64(bytes),
  });
  return answer.status === 200 ? 'pushed' : codeOf(answer.body);
}

/** The claims a ride's record makes: #62's list row, and never a coordinate. */
function claimsOf(ride: ActivityRecord): ActivityClaims {
  return {
    activityId: ride.id,
    name: ride.name,
    startedAt: unixSeconds(ride.startedAt),
    startedAtTimeZone: ride.startedAtTimeZone,
    elapsedTime: ride.elapsedTime,
    movingTime: ride.movingTime,
    distance: ride.distance,
    hasPosition: ride.hasPosition,
    ...(ride.averagePower === undefined ? {} : { averagePower: ride.averagePower }),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
