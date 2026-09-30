// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two-way sync with an instance (#776): bring this device and the instance to
 * the same rides, write-ups and side-camera reports, **with this device's
 * changes winning** — the device copy is canonical (ADR 0036 D-3).
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
 * ## The sync base: telling a change here from a change there
 *
 * Two copies that differ say nothing about which one changed, and #893's
 * review found both ways that goes wrong: a ride the rider deleted here was
 * pulled straight back (B1), and a write-up replaced here was overwritten by
 * the instance's older copy (B2). So the device keeps a **base** — what it and
 * the instance agreed on at the last sync, one row per ride and per item
 * (`packages/store` §`SyncBaseRecord`) — and each side's change is its copy
 * against the base. A base row outlives its ride on purpose: it is the
 * device's record that a synced ride was deleted here.
 *
 * ## The rules, thing by thing
 *
 * 1. Read the whole manifest (`GET /v1/sync/manifest`), from the start every
 *    time — a cursor kept between syncs would skip an item whose local write
 *    failed last time — and the whole base.
 * 2. **A live ride on the instance.** On this device (by its activity id, or
 *    by the file's hash for a ride this device itself imported): remembered.
 *    Not on this device, and in the base: **the rider deleted it here**, so it
 *    is deleted on the instance — its write-up and report first, then the ride
 *    — and never pulled back. Not on this device and never synced: pulled —
 *    the signed record and the original file are fetched, and **the signature
 *    and the file's hash are verified BEFORE anything is written** (ADR 0014
 *    D-6); a record that does not verify is not written, and the report names
 *    which of D-6's answers it got. ⚠️ **Nor is a record signed by a key that
 *    is not one of the athlete's own** (#898): a signature proves who signed,
 *    not whose ride it is, so the key is checked against
 *    {@link SyncDependencies.athleteKeys} — and a key since revoked vouches
 *    only for a ride that started before it was revoked, the instance's own
 *    rule. The file is imported through the SAME path
 *    a rider's own import takes (`transfer/import-batch.ts`), under the
 *    record's own activity id, so the ride library reads it like any other.
 * 3. **A tombstoned ride** — deleted on another device — is **kept here**
 *    (#898, the owner's ruling of 2026-09-30). A tombstone is unsigned, and
 *    the device is canonical (ADR 0036 D-3): it hides the ride on the instance
 *    and from devices that do not hold it yet, and never deletes a copy the
 *    rider did not delete on THIS device. Nothing of that ride is sent again —
 *    not the ride, its write-up, report, summary or consent — so the instance
 *    keeps it hidden; its base row stays, so the ride is still known here.
 *    ⚠️ A reviewer who remembers "deleted here, with its write-up and report"
 *    is reading the old file.
 * 4. **A local ride the instance lacks** is written out as FIT by the export
 *    path (`transfer/export-activity.ts`), signed by this device's key, its
 *    record kept locally, and sent to `POST /v1/sync/records` — idempotent, so
 *    a push that did not hear its answer is simply sent again. ⚠️ **Its base
 *    row is written BEFORE it is sent** (#901): a push the instance stored and
 *    whose answer was lost is then a synced ride all the same, so if the rider
 *    deletes it here before the next sync it is deleted there, not pulled
 *    back. A push that did not arrive leaves a base row the ride's own next
 *    push, or rule 7, settles.
 * 5. **Each write-up and side-camera report of a ride on this device**, as
 *    JSON with the device's own athlete id left out (every device's local
 *    athlete is `local`):
 *    - the same on both sides: remembered;
 *    - here and unchanged since the base, and the instance's copy moved:
 *      another device replaced it, so it is pulled;
 *    - changed here, never synced, or gone from the instance: **pushed**, so
 *      the instance stores exactly the device's screened copy (#776's
 *      addition);
 *    - not here at all (the store cannot remove an item and keep its ride):
 *      pulled.
 * 6. **A ride's "may be raced" consent** (#793, ADR 0039 D-2.5), for every
 *    ride on both sides: the same three-way rule as an item's, against a
 *    `race-consent` base row — changed here, it is sent
 *    (`POST /v1/sync/records/{content}/race-consent`); unchanged here and moved
 *    there, it is taken. So a revocation reaches the instance in one sync, and
 *    a device that still says "yes" cannot put it back. A ride this device
 *    pulls takes the instance's consent with it (the two then agree, and that
 *    is remembered as the base in the same sync), and a ride it pushes starts
 *    from the instance's "off", which is remembered as its base. **With no
 *    base** (a ride synced before the consent existed), the two differing
 *    means off wins: a "yes" is never re-granted by a sync that cannot tell
 *    which device changed.
 * 7. The base forgets a ride neither side holds any more.
 *
 * ⚠️ **A pulled record is not kept on this device.** `packages/store`'s
 * `putActivityRecord` refuses a record signed by a key that is not THIS
 * device's (ADR 0014 D-7: one key per device, no rotation in this phase), and
 * that rule is not loosened here: the instance keeps the record, and this
 * device keeps the ride. Pushing skips a pulled ride by its file hash, so it
 * is never signed a second time by the device that pulled it.
 *
 * ⚠️ **An erased device is a fresh device.** `deleteAthlete` takes the base
 * with everything else, so the next sync pulls rather than deletes: erasing
 * this device does not erase the instance's copy. That is the account's own
 * deletion (`DELETE /v1/account`, #35).
 *
 * 7. **Each ride's summary** (#835, ADR 0040 D-2): the passages of the
 *    rider's history the instance indexes for a later write-up, built HERE
 *    from #809's input by `ride-analysis/ride-summary.ts` — the instance
 *    interprets no text. It is derived, never pulled and never kept on the
 *    device, and deleted with its ride. It is pushed when the instance holds
 *    none, and — for a ride this device recorded or imported, the one it
 *    signed — whenever the instance's copy differs from what it builds now.
 *    ⚠️ Not for a PULLED ride whose summary the instance holds: two devices
 *    reading one ride from different files can build different summaries,
 *    and each pushing its own would change the instance's copy on every sync.
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
  SyncBaseRecord,
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

/** What sync needs of the local store: the transfer screen's port, and ten writes and reads. */
export type SyncStore = TransferStore &
  Pick<
    ActivityStore,
    | 'getActivityRecord'
    | 'putActivityRecord'
    | 'getRideWriteUp'
    | 'putRideWriteUp'
    | 'getSideCameraReport'
    | 'putSideCameraReport'
    | 'putSyncBase'
    | 'listSyncBase'
    | 'deleteSyncBase'
    | 'setActivityMayBeRaced'
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
  /**
   * A ride's summary, as the body of its `ride-summary` item (#835) — or
   * `undefined` when the ride cannot be read. `ride-analysis/ride-summary.ts`
   * §`rideSummaryOf`, bound to this store and athlete.
   */
  readonly rideSummary: (activityId: ActivityId) => Promise<string | undefined>;
  /**
   * The athlete's device keys (#898): a pulled record signed by a key that is
   * not one of them is refused, and one signed by a key since revoked only
   * vouches for a ride that started before it was revoked. Asked for at most
   * once a sync, and only when there is something to pull; a list that cannot
   * be read pulls nothing. ⚠️ Read from the instance's own device list
   * ({@link athleteKeysFrom}), which is a second route checked against the
   * record, not a key pinned on this device: it stops a record that is not
   * the athlete's being pulled, and cannot stop an instance that lies the
   * same way on both routes.
   */
  readonly athleteKeys: () => Promise<readonly AthleteKey[]>;
}

/** One of the athlete's device keys, as {@link SyncDependencies.athleteKeys} gives it. */
export interface AthleteKey {
  /** Lowercase hex, as a signed record carries it. */
  readonly publicKey: string;
  /** Unix seconds, or `null` for a live key. */
  readonly revokedAt: number | null;
}

/**
 * The athlete's keys, from `GET /v1/auth/devices` (#773) — the source
 * {@link SyncDependencies.athleteKeys} is meant to be bound to. Throws when the
 * instance does not answer with a list, so nothing is pulled on a guess.
 */
export async function athleteKeysFrom(transport: SyncTransport): Promise<readonly AthleteKey[]> {
  const answer = await transport.json('GET', '/v1/auth/devices');
  const rows = (answer.body as { devices?: unknown } | null)?.devices;
  if (answer.status !== 200 || !Array.isArray(rows))
    throw new InstanceSyncError(codeOf(answer.body));
  return rows.map((row: unknown) => {
    const { publicKey, revokedAt } = (row ?? {}) as { publicKey?: unknown; revokedAt?: unknown };
    if (
      typeof publicKey !== 'string' ||
      !(revokedAt === null || (typeof revokedAt === 'number' && Number.isFinite(revokedAt)))
    ) {
      throw new InstanceSyncError('malformed-devices');
    }
    return { publicKey, revokedAt };
  });
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
  /** A live ride's "may be raced" consent (#793); absent from an instance that predates it. */
  readonly mayBeRaced?: boolean | null;
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
  /** Ride summaries pushed for the rider's history (#835): derived, so counted apart from items. */
  readonly summariesPushed: number;
  /** Rides deleted on this device since the last sync, now deleted on the instance too. */
  readonly deletedOnInstance: number;
  /**
   * Rides another device deleted on the instance that this device still
   * holds (#898): KEPT here, and hidden there. Never deleted by a sync.
   */
  readonly hiddenOnInstance: number;
  /** Rides whose "may be raced" consent was sent to the instance (#793). */
  readonly consentsPushed: number;
  /** Rides whose consent was taken from the instance — set or revoked on another device. */
  readonly consentsPulled: number;
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

/** The map key of one thing of a ride's, in the manifest and in the base alike. */
const keyOf = (kind: string, key: string): string => `${kind}\u0000${key}`;

/**
 * Bring this device and the instance to the same rides, write-ups and
 * side-camera reports, with **this device's changes winning** (ADR 0036 D-3).
 * See the module header for the rule, thing by thing.
 */
export async function syncWithInstance(dependencies: SyncDependencies): Promise<SyncReport> {
  const { transport, store, athleteId, sha256 } = dependencies;
  const failures: SyncFailure[] = [];
  let pulled = 0;
  let pushed = 0;
  let itemsPulled = 0;
  let itemsPushed = 0;
  let summariesPushed = 0;
  let hiddenOnInstance = 0;
  let deletedOnInstance = 0;
  /** Rides this device holds that the instance hides: nothing of them is sent (#898). */
  const hidden = new Set<string>();
  let keys: Promise<readonly AthleteKey[]> | undefined;
  /** The athlete's keys, read once, and only if something is pulled (#898). */
  const athleteKeys = (): Promise<readonly AthleteKey[]> => (keys ??= dependencies.athleteKeys());
  let consentsPushed = 0;
  let consentsPulled = 0;

  const manifest = await readManifest(transport);
  const remote = new Map(manifest.map((entry) => [keyOf(entry.kind, entry.key), entry]));
  const base = new Map(
    (await store.listSyncBase(athleteId)).map((row) => [keyOf(row.kind, row.key), row]),
  );
  const remember = async (row: Omit<SyncBaseRecord, 'athleteId'>): Promise<void> => {
    const known = base.get(keyOf(row.kind, row.key));
    if (
      known?.activityId === row.activityId &&
      known.localDigest === row.localDigest &&
      known.remoteDigest === row.remoteDigest
    ) {
      return;
    }
    const record: SyncBaseRecord = { athleteId, ...row };
    await store.putSyncBase(record);
    base.set(keyOf(row.kind, row.key), record);
  };
  /** Forget a ride's base row and its items' — the ride is gone on both sides. */
  const forgetRide = async (content: string, activity: string): Promise<void> => {
    for (const [kind, key] of [
      ['activity', content],
      ...ITEM_KINDS.map((each) => [each, activity] as const),
      ['race-consent', activity],
    ] as const) {
      if (base.delete(keyOf(kind, key))) await store.deleteSyncBase(athleteId, kind, key);
    }
  };
  const localRide = async (
    id: string | null,
    content: string,
  ): Promise<ActivityRecord | undefined> =>
    (id === null ? undefined : await store.getActivity(athleteId, id as ActivityId)) ??
    (await store.findActivityByOriginalFileHash(athleteId, content));

  // --- Rides the instance holds ----------------------------------------------
  for (const entry of manifest) {
    if (entry.kind !== 'activity' || entry.deleted) continue;
    const ride = await localRide(entry.activityId, entry.key);
    const known = base.get(keyOf('activity', entry.key));
    if (ride !== undefined) {
      await remember({
        kind: 'activity',
        key: entry.key,
        activityId: ride.id,
        localDigest: entry.key,
        remoteDigest: entry.key,
      });
      continue;
    }
    if (known !== undefined) {
      // Synced before, and not on this device now: the rider deleted it HERE.
      // Delete it there — its items first, so a failure part way leaves the
      // ride for the next sync to finish rather than orphaned items.
      const outcome = await deleteRideOnInstance(transport, entry.key, known.activityId);
      if (outcome === 'deleted') {
        deletedOnInstance += 1;
        await forgetRide(entry.key, known.activityId);
      } else {
        failures.push({ kind: 'activity', key: entry.key, reason: outcome });
      }
      continue;
    }
    const outcome = await pullRide(dependencies, entry.key, athleteKeys);
    if (typeof outcome === 'string') {
      failures.push({ kind: 'activity', key: entry.key, reason: outcome });
      continue;
    }
    pulled += 1;
    await remember({
      kind: 'activity',
      key: entry.key,
      activityId: outcome.activityId,
      localDigest: entry.key,
      remoteDigest: entry.key,
    });
    // A ride this device has only now received takes the instance's consent:
    // it cannot have changed here, and pushing this device's default "off"
    // would revoke a consent its rider gave elsewhere (#793).
    if (entry.mayBeRaced === true) {
      await store.setActivityMayBeRaced(athleteId, outcome.activityId, true);
    }
  }

  // --- A ride deleted on another device ---------------------------------------
  // KEPT here (#898): a tombstone is unsigned and the device is canonical
  // (ADR 0036 D-3). It hides the ride on the instance; it never deletes a copy
  // the rider did not delete on THIS device.
  for (const entry of manifest) {
    if (entry.kind !== 'activity' || !entry.deleted) continue;
    // A tombstone names no ride (its record is gone), and on the device that
    // PUSHED the ride its key is the hash of the FIT it exported, which is not
    // the ride's `originalFile` — so the base is what says which ride it is
    // (#893's re-review, N1). So the base row STAYS while the ride is here.
    const known = base.get(keyOf('activity', entry.key));
    const ride = await localRide(entry.activityId ?? known?.activityId ?? null, entry.key);
    if (ride !== undefined) {
      hidden.add(ride.id);
      hiddenOnInstance += 1;
    } else if (known !== undefined) {
      await forgetRide(entry.key, known.activityId);
    }
  }

  // --- Push: rides -----------------------------------------------------------
  const onInstance = new Set(
    manifest.filter((entry) => entry.kind === 'activity').map((entry) => entry.key),
  );
  const rides = await localRides(store, athleteId);
  const onDevice = new Set<string>(rides);
  /**
   * A push's base rows, written BEFORE it is sent (#901): the ride's, so a
   * push whose answer is lost is still known as synced — a local delete then
   * deletes it on the instance rather than pulling it back — and its consent's
   * "off", which is what the instance creates a pushed ride with: a "yes"
   * given here before the push is then a change here, and the next sync sends
   * it rather than losing it to the "off wins" rule below (#793, #915's
   * review).
   */
  const pending = async (id: ActivityId, content: string): Promise<void> => {
    await remember({
      kind: 'activity',
      key: content,
      activityId: id,
      localDigest: content,
      remoteDigest: content,
    });
    const off = await consentDigest(false, sha256);
    await remember({
      kind: 'race-consent',
      key: id,
      activityId: id,
      localDigest: off,
      remoteDigest: off,
    });
  };
  for (const id of rides) {
    const outcome = await pushRide(dependencies, id, onInstance, (content) => pending(id, content));
    if (typeof outcome !== 'string') {
      pushed += 1;
    } else if (outcome !== 'held') {
      failures.push({ kind: 'activity', key: id, reason: outcome });
    }
  }

  // --- Write-ups and side-camera reports, three ways -------------------------
  for (const id of rides) {
    // Hidden on the instance by another device's delete: nothing of it is
    // sent back, or the instance would hold a write-up of a ride it hides.
    if (hidden.has(id)) continue;
    for (const kind of ITEM_KINDS) {
      const entry = remote.get(keyOf(kind, id));
      const remoteDigest = entry === undefined || entry.deleted ? null : entry.digest;
      const known = base.get(keyOf(kind, id));
      const local = await localItem(store, athleteId, kind, id);
      if (local === undefined) {
        // Nothing here — the store has no way to remove an item and keep its
        // ride, so this is an item another device made. Take it.
        if (remoteDigest === null) continue;
        const outcome = await pullItem(dependencies, kind, id);
        if (outcome === 'pulled') {
          itemsPulled += 1;
          await rememberItem(kind, id, remoteDigest);
        } else {
          failures.push({ kind, key: id, reason: outcome });
        }
        continue;
      }
      const body = itemBody(local);
      const localDigest = await hex(utf8(body), sha256);
      if (remoteDigest === localDigest) {
        await remember({ kind, key: id, activityId: id, localDigest, remoteDigest });
        continue;
      }
      if (known !== undefined && known.localDigest === localDigest && remoteDigest !== null) {
        // Unchanged here since the last sync. If the instance's copy moved,
        // another device replaced it: take that. If not, the two already agree
        // — a pulled item need not serialise back to the bytes it came in.
        if (remoteDigest === known.remoteDigest) continue;
        const outcome = await pullItem(dependencies, kind, id);
        if (outcome === 'pulled') {
          itemsPulled += 1;
          await rememberItem(kind, id, remoteDigest);
        } else {
          failures.push({ kind, key: id, reason: outcome });
        }
        continue;
      }
      // Changed here, never synced, or gone from the instance: this device's
      // copy is canonical (ADR 0036 D-3), so it is what the instance keeps.
      const answer = await transport.json(
        'POST',
        `/v1/sync/items/${kind}/${encodeURIComponent(id)}`,
        { body },
      );
      if (answer.status === 200) {
        itemsPushed += 1;
        await remember({ kind, key: id, activityId: id, localDigest, remoteDigest: localDigest });
      } else {
        failures.push({ kind, key: id, reason: codeOf(answer.body) });
      }
    }
  }

  // --- "May be raced", three ways (#793) --------------------------------------
  // After the rides, so a ride pushed in this sync has its content key in the
  // base. The same rule as an item's: a change here is pushed, a change there
  // on an unchanged copy here is pulled — so a device that still says "yes"
  // cannot put back a consent another device revoked. With no base, off wins.
  const contentOf = new Map(
    [...base.values()]
      .filter((row) => row.kind === 'activity')
      .map((row) => [row.activityId as string, row.key]),
  );
  const liveRemote = new Map(
    manifest
      .filter((entry) => entry.kind === 'activity' && !entry.deleted)
      .map((entry) => [entry.key, entry]),
  );
  for (const id of rides) {
    const content = contentOf.get(id);
    const entry = content === undefined ? undefined : liveRemote.get(content);
    // Not on the instance yet (it arrives next sync), or an instance that
    // predates the consent: nothing to agree with.
    if (content === undefined || typeof entry?.mayBeRaced !== 'boolean') continue;
    const ride = await store.getActivity(athleteId, id);
    if (ride === undefined) continue;
    const local = ride.mayBeRaced;
    const remote = entry.mayBeRaced;
    const localDigest = await consentDigest(local, sha256);
    const remoteDigest = await consentDigest(remote, sha256);
    const known = base.get(keyOf('race-consent', id));
    if (local === remote) {
      await remember({ kind: 'race-consent', key: id, activityId: id, localDigest, remoteDigest });
      continue;
    }
    // Unchanged here since the last sync, and the instance's moved: another
    // device set or revoked it — take it. With NO base (every ride synced
    // before store v15, or against an instance that predates migration 0011)
    // neither side can be shown to have changed, so OFF wins: a device still
    // saying "yes" takes a "no", and a device saying "no" sends it. A consent
    // is never granted by a sync that cannot tell who gave it (ADR 0021
    // D-5.1, off by default; #915's review).
    const takeTheInstances =
      known === undefined ? remote === false : known.localDigest === localDigest;
    if (takeTheInstances) {
      if (await store.setActivityMayBeRaced(athleteId, id, remote)) {
        consentsPulled += 1;
        await remember({
          kind: 'race-consent',
          key: id,
          activityId: id,
          localDigest: remoteDigest,
          remoteDigest,
        });
      } else {
        failures.push({ kind: 'race-consent', key: id, reason: 'not-stored' });
      }
      continue;
    }
    const answer = await transport.json('POST', `/v1/sync/records/${content}/race-consent`, {
      mayBeRaced: local,
    });
    if (answer.status === 200) {
      consentsPushed += 1;
      await remember({
        kind: 'race-consent',
        key: id,
        activityId: id,
        localDigest,
        remoteDigest: localDigest,
      });
    } else {
      failures.push({ kind: 'race-consent', key: id, reason: codeOf(answer.body) });
    }
  }

  // --- Each ride's summary, for the rider's history (#835) -------------------
  // Derived from the ride, so never pulled and never in the base (rule 7).
  for (const id of rides) {
    // A hidden ride's summary would put it back in the rider's history (#898).
    if (hidden.has(id)) continue;
    const entry = remote.get(keyOf(SUMMARY_KIND, id));
    const remoteDigest = entry === undefined || entry.deleted ? null : entry.digest;
    // A ride another device signed is that device's to describe, once described.
    if (remoteDigest !== null && (await store.getActivityRecord(athleteId, id)) === undefined) {
      continue;
    }
    const body = await dependencies.rideSummary(id);
    if (body === undefined) continue;
    if (remoteDigest === (await hex(utf8(body), sha256))) continue;
    const answer = await transport.json(
      'POST',
      `/v1/sync/items/${SUMMARY_KIND}/${encodeURIComponent(id)}`,
      { body },
    );
    if (answer.status === 200) {
      summariesPushed += 1;
    } else {
      failures.push({ kind: SUMMARY_KIND, key: id, reason: codeOf(answer.body) });
    }
  }

  // --- The base forgets what neither side holds any more ---------------------
  for (const row of [...base.values()]) {
    if (row.kind !== 'activity' || remote.has(keyOf('activity', row.key))) continue;
    if (!onDevice.has(row.activityId)) await forgetRide(row.key, row.activityId);
  }

  return {
    pulled,
    pushed,
    itemsPulled,
    itemsPushed,
    summariesPushed,
    hiddenOnInstance,
    deletedOnInstance,
    consentsPushed,
    consentsPulled,
    failures,
  };

  /** The base for an item just pulled: the copy as this device now reads it. */
  async function rememberItem(kind: ItemKind, id: ActivityId, remoteDigest: string): Promise<void> {
    const kept = await localItem(store, athleteId, kind, id);
    if (kept === undefined) return;
    const localDigest = await hex(utf8(itemBody(kept)), sha256);
    await remember({ kind, key: id, activityId: id, localDigest, remoteDigest });
  }
}

/** The two item kinds, in the order a sync visits them. */
const ITEM_KINDS: readonly ItemKind[] = ['write-up', 'side-camera-report'];

/** A ride's summary (#835): derived from the ride, so pushed and deleted, never pulled. */
const SUMMARY_KIND = 'ride-summary';

/**
 * Delete a ride on the instance: its write-up, side-camera report and summary
 * (#835), then the ride (whose file the instance collects unless another rider sent the same
 * bytes). `not_found` is success — somebody got there first. Answers `deleted`
 * or the instance's error code.
 */
async function deleteRideOnInstance(
  transport: SyncTransport,
  content: string,
  activity: string,
): Promise<string> {
  for (const [kind, key] of [
    ...[...ITEM_KINDS, SUMMARY_KIND].map((each) => [each, activity] as const),
    ['activity', content] as const,
  ]) {
    const answer = await transport.json(
      'DELETE',
      `/v1/sync/items/${kind}/${encodeURIComponent(key)}`,
    );
    if (answer.status !== 204 && answer.status !== 200 && codeOf(answer.body) !== 'not_found') {
      return codeOf(answer.body);
    }
  }
  return 'deleted';
}

/**
 * One write-up or report from the instance, written through the store's own
 * validating write. Answers `pulled`, an instance error code, or `not-stored`.
 */
async function pullItem(
  dependencies: SyncDependencies,
  kind: ItemKind,
  activity: ActivityId,
): Promise<string> {
  const { transport, store, athleteId } = dependencies;
  const answer = await transport.json(
    'GET',
    `/v1/sync/items/${kind}/${encodeURIComponent(activity)}`,
  );
  if (answer.status !== 200) return codeOf(answer.body);
  try {
    const body = JSON.parse((answer.body as { body: string }).body) as object;
    const record = { ...body, athleteId, activityId: activity };
    if (kind === 'write-up') await store.putRideWriteUp(record as RideWriteUpRecord);
    else await store.putSideCameraReport(record as SideCameraReportRecord);
    return 'pulled';
  } catch {
    return 'not-stored';
  }
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The digest a consent is remembered by in the sync base: of the body it is sent as. */
const consentDigest = (mayBeRaced: boolean, sha256: Sha256): Promise<string> =>
  hex(utf8(JSON.stringify({ mayBeRaced })), sha256);

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
async function pullRide(
  dependencies: SyncDependencies,
  content: string,
  athleteKeys: () => Promise<readonly AthleteKey[]>,
): Promise<{ readonly activityId: ActivityId } | string> {
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
  // Whose it is, not only who signed it (#898): never the instance's say-so.
  let held: readonly AthleteKey[];
  try {
    held = await athleteKeys();
  } catch {
    return 'keys-unavailable';
  }
  const signer = held.find((key) => key.publicKey === verification.record.publicKey);
  if (signer === undefined) return 'not-your-key';
  if (signer.revokedAt !== null && claims.startedAt >= signer.revokedAt) return 'key-revoked';

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
  if (outcome?.kind === 'imported') return { activityId: claims.activityId as ActivityId };
  if (outcome?.kind === 'duplicate') {
    return { activityId: outcome.activityId ?? (claims.activityId as ActivityId) };
  }
  return outcome?.code ?? 'not-stored';
}

/**
 * One local ride to the instance, unless it holds the file already. Answers
 * the content hash it pushed, `held`, or why not.
 */
async function pushRide(
  dependencies: SyncDependencies,
  id: ActivityId,
  onInstance: ReadonlySet<string>,
  /** Told the content hash just BEFORE it is sent (#901). */
  pending: (content: string) => Promise<void>,
): Promise<{ readonly content: string } | string> {
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
  const content = toHex(parseContentHash(contentHash));
  if (onInstance.has(content)) return 'held';
  await pending(content);
  const answer = await transport.json('POST', '/v1/sync/records', {
    record,
    file: toBase64(bytes),
  });
  return answer.status === 200 ? { content } : codeOf(answer.body);
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
