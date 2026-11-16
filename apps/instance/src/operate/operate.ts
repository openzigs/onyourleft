// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Operate** (#2601): the owner-only area of the app for running the
 * instance, and this — its instance half (#2602).
 *
 * Who may reach it is not decided here. Every Operate route declares
 * `reaches: 'owner'` (`route-kit.ts` §`Reach`), and the handler answers
 * anybody but the athlete holding `OYL_INSTANCE_OWNER_KEY` — the deputy
 * included (ADR 0046 D-9 Q9: the deputy key does not make its athlete the
 * operator) — `not_found`, as though the route were not there, before the
 * route is called. On an instance with no `OYL_INSTANCE_SECRET_KEY`, which
 * seals nothing, every Operate route answers `unavailable` naming it, rather
 * than serving an admin surface in plaintext through the tunnel (ADR 0047
 * D-7, D-13).
 *
 * What it holds today is the operator log's read: every action taken as the
 * operator, from the app or the CLI, newest first — the instance's Status
 * (#2604, `status.ts`), which changes nothing and so logs nothing — and its
 * backups (#2606): the records the `backup` service writes, and "back up
 * now". Every action is WRITTEN through `SqlStore.recordOperatorAction`,
 * which applies it and logs it in one transaction.
 *
 * ## Backups: through the database, never the folders
 *
 * In the home deployment only the `backup` service mounts the backup folders,
 * and the instance holds `OYL_INSTANCE_SECRET_KEY`, which the docs keep away
 * from them (#2601's decision 5). So the instance reads backups from the
 * records that service writes, and asks for one by writing a request it picks
 * up. A record names a snapshot's directory and never the folder it is in.
 * Restore stays on the CLI.
 *
 * ## Rooms: from the workers, and ended by the one close
 *
 * The open rooms (#2612) are the riders' rooms the store holds open — what
 * Status counts — each with what the room worker holding it says of it: its
 * phase, and the athletes in it, shown by the display name the owner may see
 * of each (#83's choke point). **Never** a rider's place, distance, speed,
 * power, heart rate or Discord id: the worker sends none of them
 * (`room/node/room-host.ts` §`HostedRoomSummary`). Ending one takes the
 * room's short code as its confirmation, and is the ONE close a room is over
 * by (`rooms/rooms.ts` §`end`), written with its `room_ended` entry in one
 * transaction while the router places no socket in it; then the worker
 * closes every socket `4005 room-closed`. Nothing here reaches a trainer.
 *
 * ## Keys: the card, and the routine rotation
 *
 * The owner is shown the instance's card and its identity key's fingerprint
 * whole — what `instance-key show` prints, public material only — and the
 * current encryption key's serial, age and next rotation (#2613). **Rotate
 * the encryption key** is what `instance-key rotate` does, no more: it takes
 * the same key lease, so while the instance's own maintenance pass holds it
 * the answer is `busy` and nothing is written; and it runs over the operator
 * log's transaction, so a rotation is logged `instance_key_rotate` or not
 * made. Devices pick the new key up from `GET /v1/instance/keys` by
 * themselves, and nobody pins again. `--drop-old`, `rotate-identity` and
 * `reset` make devices pin again, or answer a leak: they stay on the CLI.
 */

import {
  clearAnalysisSettings,
  effectiveAnalysisSettings,
  localServerOf,
  saveAnalysisSettings,
  type AnalysisEnvironment,
  type EffectiveAnalysisSettings,
} from '../analysis/settings.ts';
import { hostedOriginOf, type HostedKeyState } from '../analysis/hosted-key.ts';
import { readLocalServer, type LocalServerRead } from '../analysis/local-server.ts';
import { REPLAN_TEMPLATE } from '../analysis/replan-template.ts';
import {
  createToolCheck,
  type ToolCheckOutcome,
  type ToolCheckTarget,
} from '../analysis/tool-check.ts';
import type { ModelConnection } from '../analysis/model-turn.ts';
import { analysisModelNameProblem, type AnalysisModelOffCode } from '../config.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { RoomPhase } from '../room/core/room.ts';
import type { Rooms } from '../rooms/rooms.ts';
import type { Resolver } from '../history/address.ts';
import { encodeCursor, parsePageRequest, type Page } from '../pagination.ts';
import type {
  AnalysisJobStatus,
  BackupRecord,
  BackupRequestOutcome,
  OperateCounts,
  OperateJobs,
  OperatorLogEntry,
  SqlStore,
} from '../store/sql-store.ts';
import { ROOM_END_REASONS } from '../store/sql-store.ts';
import {
  ENCRYPTION_KEY_LIFE_SECONDS,
  InstanceKeysUnavailable,
  type InstanceKeys,
} from '../keys/instance-keys.ts';
import { type DiskSpace, type KeysState, type StatusSources, type TunnelState } from './status.ts';

export type OperateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/** The backup service's newest snapshot (#2606): `backup-loop`'s, not a one-off pre-deploy run's. */
export interface LastBackup {
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly offBox: 'copied' | 'failed' | 'not-configured';
  readonly intervalSeconds: number;
}

/**
 * What the owner's Status shows that the instance reads for itself (#2604).
 * Health, version, commit and registration mode are the handler's own and
 * are added by the route. Counts and states only: nothing secret, no path.
 */
export interface InstanceStatus {
  /** Whole seconds since this process started. */
  readonly uptimeSeconds: number;
  readonly disk: readonly DiskSpace[];
  /**
   * The backup service's newest snapshot (#2606) — `null` while it has
   * recorded none: shown as "not recorded".
   */
  readonly lastBackup: LastBackup | null;
  readonly tunnel: TunnelState;
  readonly counts: OperateCounts;
  readonly keys: KeysState;
}

/** How many backup records the owner is shown, newest first (#2606). */
export const BACKUPS_SHOWN = 50;

/** The owner's view of the backups (#2606). */
export interface BackupsView {
  readonly records: readonly BackupRecord[];
  /** The "back up now" still waiting, Unix seconds, or `null`. */
  readonly pendingSince: number | null;
  /** Now, Unix seconds: what each record's age is from. */
  readonly now: number;
}

/**
 * The operator's analysis settings as the owner reads them (#2609): what the
 * local model is and where it is set, which sources are offered, the switch
 * for other riders, and whether the operator's own hosted key is held and for
 * which origin. **Never a key**, and never the address a name resolved to.
 */
export interface AnalysisSettingsView {
  readonly local: {
    readonly url: string | null;
    readonly model: string | null;
    readonly reasoningTokens: number | null;
    readonly offered: boolean;
    /** Whether riders other than the operator may use it (ADR 0046 D-9's switch). */
    readonly othersMayUse: boolean;
    readonly setIn: 'app' | 'env' | 'none';
    /** `on`, or the code it is off for: the same codes `.env` is refused with. */
    readonly state: 'on' | AnalysisModelOffCode;
  };
  readonly hosted: {
    readonly offered: boolean;
    readonly operatorKey: 'none' | 'held' | 'held-unreadable';
    /** The origin the operator's own key is for, or `null`. */
    readonly operatorKeyOrigin: string | null;
  };
}

/** How many of the newest analysis jobs the owner is shown (#2610). */
export const JOBS_SHOWN = 50;

/** How far back the ended jobs are counted (#2610): the seven days an ended job is kept. */
export const JOBS_COUNTED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One analysis job as the owner is shown it (#2610): never the athlete, the
 * input, the events or the write-up — only whether it was the owner's own.
 */
export interface OperateJobView {
  readonly kind: 'write-up' | 're-plan';
  readonly source: 'local' | 'hosted';
  readonly status: AnalysisJobStatus;
  readonly failure: string | null;
  /** Unix milliseconds. */
  readonly createdAt: number;
  readonly endedAt: number | null;
  readonly whose: 'own' | 'other';
}

/** The owner's view of the analysis queue (#2610). */
export interface JobsView {
  readonly counts: OperateJobs['counts'];
  readonly failures: OperateJobs['failures'];
  readonly recent: readonly OperateJobView[];
}

/** How many characters of a room's id its short code is (#2612): what the owner types to end it. */
export const ROOM_SHORT_CODE_LENGTH = 6;

/** A room's short code (#2612): the first {@link ROOM_SHORT_CODE_LENGTH} characters of its id. */
export function roomShortCode(roomId: string): string {
  return roomId.slice(0, ROOM_SHORT_CODE_LENGTH).toLowerCase();
}

/** Where a room is, as the owner is shown it (#2612). */
export type OperateRoomPhase = 'lobby' | 'countdown' | 'riding' | 'finished';

/**
 * One open room as the owner is shown it (#2612). **Never** a rider's place,
 * distance, speed, power, heart rate, Discord id or athlete id.
 */
export interface OperateRoomView {
  readonly roomId: string;
  /** What the owner types to end it: {@link roomShortCode}. */
  readonly shortCode: string;
  readonly kind: 'group' | 'race' | 'lap-race';
  readonly visibility: 'private' | 'public';
  readonly phase: OperateRoomPhase;
  /** When it was made, Unix seconds. */
  readonly openedAt: number;
  /** The display name of the rider who made it, as the owner may see it; `null` for "a rider". */
  readonly host: string | null;
  /** The display name of each rider in it, `null` for "a rider"; empty when no worker holds it. */
  readonly riders: readonly (string | null)[];
}

/** A room a live room worker holds (#2612): `room/node/router.ts` §`roomSummaries`. */
export interface LiveRoom {
  readonly roomId: string;
  readonly phase: RoomPhase;
  readonly athleteIds: readonly string[];
}

/**
 * What the owner's Rooms reads and ends with beyond the store (#2612): the
 * room router and the rooms. Absent — the Durable Object adapter, which has
 * no router — both Rooms routes answer `unavailable`.
 */
export interface OperateRoomSources {
  /** Every room each live worker holds. */
  readonly live: () => Promise<readonly LiveRoom[]>;
  /**
   * Ends `roomId` on the worker holding it, `commit` run while no socket is
   * placed in it: `RoomRouter.endRoom`.
   */
  readonly end: (roomId: string, commit: () => Promise<boolean>) => Promise<boolean>;
  readonly rooms: Pick<Rooms, 'end'>;
  /** The display name `viewerId` may see of `subjectId`, or `undefined` (#83's choke point). */
  readonly nameFor: (viewerId: string, subjectId: string) => Promise<string | undefined>;
}

const PHASE_SHOWN: Readonly<Record<RoomPhase, OperateRoomPhase>> = {
  lobby: 'lobby',
  countdown: 'countdown',
  running: 'riding',
  finished: 'finished',
  closed: 'finished',
};

/** The fields `POST /v1/operate/rooms/{roomId}/end` takes, and no other. */
const END_FIELDS = new Set(['reason', 'confirm']);

/**
 * The instance's keys as the owner reads them (#2613): public material only.
 * Never a private half, nor anything derived from `OYL_INSTANCE_SECRET_KEY`.
 */
export interface KeysView {
  /** `ready`, or why the keys cannot be read now (`status.ts` §`KeysState`). */
  readonly state: KeysState;
  /** The identity key's SHA-256 fingerprint as a rider's device shows it, 52 base32 characters; `null` unless `ready`. */
  readonly fingerprint: string | null;
  /** `oyl-instance:<origin>#<52 characters>`, whole; `null` unless `ready`. */
  readonly card: string | null;
  /** The current encryption key, or `null`. */
  readonly current: {
    readonly serial: number;
    /** Unix seconds. */
    readonly createdAt: number;
    /** When the instance rotates it by itself, Unix seconds. */
    readonly rotatesAt: number;
  } | null;
  /** How many superseded encryption keys are still held, each for 7 days after its successor. */
  readonly olderHeld: number;
}

/**
 * What the owner's Keys reads and rotates with (#2613). Absent — a world
 * handed none — both Keys routes answer `unavailable`.
 */
export interface OperateKeySources {
  /** The instance's own keys: what is shown, and their state. */
  readonly keys: Pick<InstanceKeys, 'show'>;
  /**
   * The same keys over `store` — the operator log's transaction — for a
   * rotation that is logged or not made: the CLI's `withInstanceKeys` does
   * the same.
   */
  readonly over: (store: SqlStore) => Pick<InstanceKeys, 'rotate'>;
}

/** What `POST /v1/operate/keys/rotate` came to (#2613). */
export type KeyRotation =
  | { readonly outcome: 'rotated'; readonly serial: number }
  /** The key lease is held — the instance's own maintenance pass — and nothing was written. */
  | { readonly outcome: 'busy' };

/** What the analysis settings are read and written with (#2609). */
export interface OperateAnalysisSources {
  readonly environment: AnalysisEnvironment;
  /** Where a name resolves to: a save checks it as every request does. */
  readonly resolve: Resolver;
  /** Unix milliseconds. */
  readonly now: () => number;
  /** The athlete's OWN hosted key, opened if it can be (`hosted-key.ts` §`ownHostedKeyState`). */
  readonly hostedKey: (athleteId: string) => Promise<HostedKeyState>;
  /** Told the settings after every write, for the `analysis-model` log line. */
  readonly changed?: (settings: EffectiveAnalysisSettings) => void;
  /** Aborted when the instance stops: a tool check that is out ends then (#2610). */
  readonly stopped?: AbortSignal;
  /**
   * The connection a tool check goes through (#2610): `model.ts`
   * §`createLocalModel` with this resolver, built where the SDK may be named.
   */
  readonly localModel: (target: ToolCheckTarget) => ModelConnection;
}

export interface Operate {
  /** The instance's own state, read-only (#2604). Writes nothing, logs nothing. */
  status(): Promise<InstanceStatus>;
  /** The operator log a page at a time, NEWEST first: `?limit=` (1–200, default 50) and `?cursor=`. */
  logPage(query: URLSearchParams): Promise<OperateResult<Page<OperatorLogEntry>>>;
  /** The newest backup records and any waiting request (#2606). Writes nothing, logs nothing. */
  backups(): Promise<BackupsView>;
  /**
   * "Back up now" (#2606), as the owner `athleteId`: the request and its
   * `backup_requested` entry in ONE transaction, or `too_many` — logged
   * `refused` — while one waits or a backup ran in the last 15 minutes.
   * Answers when it was asked, Unix seconds.
   */
  requestBackup(athleteId: string): Promise<OperateResult<{ readonly requestedAt: number }>>;
  /** The analysis settings (#2609), for the owner `athleteId`. Writes nothing. */
  analysisSettings(athleteId: string): Promise<AnalysisSettingsView>;
  /** Save the fields `body` names, checked first; logged either way. */
  setAnalysisSettings(
    athleteId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<OperateResult<AnalysisSettingsView>>;
  /** Back to `.env` for every field, logged. */
  clearAnalysisSettings(athleteId: string): Promise<AnalysisSettingsView>;
  /** What the configured local server offers (#2610). Writes nothing, logs nothing. */
  localModels(): Promise<LocalServerRead>;
  /**
   * Whether the model `body.model` on the configured local server calls
   * tools (#2610), as the owner `athleteId`: logged `analysis_model_checked`
   * with the outcome. `validation_failed` for a body that names no model.
   */
  checkModel(
    athleteId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<OperateResult<{ readonly outcome: ToolCheckOutcome }>>;
  /** The analysis queue and the newest jobs, for the owner `athleteId` (#2610). Writes nothing. */
  jobs(athleteId: string): Promise<JobsView>;
  /**
   * Every open rider's room, newest first, as the owner `athleteId` is shown
   * it (#2612). Writes nothing. `unavailable` with no room router.
   */
  rooms(athleteId: string): Promise<OperateResult<readonly OperateRoomView[]>>;
  /**
   * End `roomId` as the owner `athleteId` (#2612): `body.reason` one of
   * `ROOM_END_REASONS`, and `body.confirm` the room's short code — else
   * `validation_failed`, with nothing changed and nothing logged. `not_found`
   * for a room that is not an open rider's room. Closed and logged
   * `room_ended` in one transaction, then every socket in it closed.
   */
  endRoom(
    athleteId: string,
    roomId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<OperateResult<{ readonly endedAt: number }>>;
  /** The card, the fingerprint and the encryption keys (#2613). Writes nothing. `unavailable` with no keys source. */
  keys(): Promise<OperateResult<KeysView>>;
  /**
   * Rotate the encryption key as the owner `athleteId` (#2613): `body` must
   * be `{ confirm: 'rotate' }`, else `validation_failed` and nothing is
   * written or logged. Logged `instance_key_rotate` — `refused` with `busy`
   * while the key lease is held — in the same transaction as the rotation.
   */
  rotateKey(
    athleteId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<OperateResult<KeyRotation>>;
}

/** What `unavailable` says on an instance with no keys. Names the variable, never a value. */
export const OPERATE_NEEDS_KEYS =
  'This instance offers no Operate area: OYL_INSTANCE_SECRET_KEY is not set, so nothing here is sealed, and the owner’s area is not served in plaintext.';

/** What a cursor this instance did not write is refused with, by name and never by value. */
const NOT_OUR_CURSOR: readonly FieldProblem[] = [
  { field: 'cursor', problem: 'must be a cursor this instance returned' },
];

/** The cursor's key: an operator log position, and nothing else's. */
const CURSOR_KEY = 'operator-log';

export function createOperate(options: {
  readonly store: SqlStore;
  /** What Status reads beyond the store (#2604): `status.ts` builds each. */
  readonly status: StatusSources;
  /** What the analysis settings are read and written with (#2609). */
  readonly analysis: OperateAnalysisSources;
  /** The room router and the rooms (#2612); absent where there is no router. */
  readonly rooms?: OperateRoomSources;
  /** The instance's keys (#2613); absent, the Keys routes answer `unavailable`. */
  readonly keys?: OperateKeySources;
}): Operate {
  const { store, status, analysis } = options;
  const roomSources = options.rooms;
  const keySources = options.keys;
  const seconds = (): number => Math.floor(status.now() / 1000);
  // #2610: ONE check for the instance, so a second while one is out is `busy`.
  const toolCheck = createToolCheck({
    connect: analysis.localModel,
    now: analysis.now,
    ...(analysis.stopped === undefined ? {} : { stopped: analysis.stopped }),
  });

  /** The configured local server: the row's address over `.env`'s. */
  async function localServer(): Promise<ReturnType<typeof localServerOf>> {
    return localServerOf(await store.getAnalysisSetting(), analysis.environment.analysisEnv);
  }

  async function analysisView(athleteId: string): Promise<AnalysisSettingsView> {
    const row = await store.getAnalysisSetting();
    const effective = effectiveAnalysisSettings(row, analysis.environment);
    const env = analysis.environment.analysisEnv;
    const local = effective.local;
    const said = (text: string | undefined): string | null =>
      text === undefined || text.trim() === '' ? null : text.trim();
    const envTokens = said(env.analysisModelReasoningTokens);
    const key = await analysis.hostedKey(athleteId);
    return {
      local: {
        // On: what a job is built with. Off: what is set, so the owner sees what to fix.
        url:
          local.kind === 'on' ? local.baseUrl.href : (row?.localUrl ?? said(env.analysisModelUrl)),
        model: local.kind === 'on' ? local.model : (row?.localModel ?? said(env.analysisModel)),
        reasoningTokens:
          local.kind === 'on'
            ? (local.reasoningTokens ?? null)
            : (row?.reasoningTokens ?? (envTokens === null ? null : Number(envTokens) || null)),
        offered: effective.offerLocal,
        othersMayUse: effective.othersLocal,
        setIn: effective.setIn,
        state: local.kind === 'on' ? 'on' : local.code,
      },
      hosted: {
        offered: effective.offerHosted,
        operatorKey:
          key.kind === 'none' ? 'none' : key.kind === 'held' ? 'held' : 'held-unreadable',
        operatorKeyOrigin: key.kind === 'none' ? null : (hostedOriginOf(key.url) ?? null),
      },
    };
  }

  async function told(): Promise<void> {
    if (analysis.changed === undefined) return;
    analysis.changed(
      effectiveAnalysisSettings(await store.getAnalysisSetting(), analysis.environment),
    );
  }

  /** A display name the owner may see, or `null` for "a rider". */
  async function shownName(
    sources: OperateRoomSources,
    ownerId: string,
    athleteId: string,
  ): Promise<string | null> {
    return (await sources.nameFor(ownerId, athleteId)) ?? null;
  }

  return {
    async rooms(athleteId) {
      if (roomSources === undefined) return { ok: false, code: 'unavailable' };
      const [open, live] = await Promise.all([store.listOpenPrivateRooms(), roomSources.live()]);
      const held = new Map(live.map((room) => [room.roomId, room]));
      const shown: OperateRoomView[] = [];
      for (const each of open) {
        const room = await store.getRoom(each.roomId);
        const course = await store.getRoomCourse(each.roomId);
        if (room === undefined) continue;
        const creator = await store.getRoomCreator(each.roomId);
        const holding = held.get(each.roomId);
        const riders: (string | null)[] = [];
        for (const rider of holding?.athleteIds ?? []) {
          riders.push(await shownName(roomSources, athleteId, rider));
        }
        shown.push({
          roomId: each.roomId,
          shortCode: roomShortCode(each.roomId),
          kind: course?.lapRace !== undefined ? 'lap-race' : room.kind,
          visibility: room.visibility,
          // No worker holds it: nobody is in it — a lobby nobody opened yet,
          // or a race a restart interrupted, which is never opened again.
          phase:
            holding !== undefined
              ? PHASE_SHOWN[holding.phase]
              : each.raceStarted
                ? 'finished'
                : 'lobby',
          openedAt: each.createdAt,
          host: creator === undefined ? null : await shownName(roomSources, athleteId, creator),
          riders,
        });
      }
      shown.sort((a, b) => b.openedAt - a.openedAt || a.roomId.localeCompare(b.roomId));
      return { ok: true, value: shown };
    },
    async endRoom(athleteId, roomId, body) {
      if (roomSources === undefined) return { ok: false, code: 'unavailable' };
      const fields: FieldProblem[] = [];
      for (const name of Object.keys(body)) {
        if (!END_FIELDS.has(name))
          fields.push({ field: name, problem: 'is not a field of this request' });
      }
      const reason = body.reason;
      if (typeof reason !== 'string' || !(ROOM_END_REASONS as readonly string[]).includes(reason)) {
        fields.push({ field: 'reason', problem: `must be one of ${ROOM_END_REASONS.join(', ')}` });
      }
      const confirm = body.confirm;
      if (typeof confirm !== 'string') {
        fields.push({ field: 'confirm', problem: 'must be the room’s short code' });
      }
      if (fields.length > 0 || typeof confirm !== 'string' || typeof reason !== 'string') {
        return { ok: false, code: 'validation_failed', fields };
      }
      const made = await store.getPrivateRoom(roomId);
      const room = await store.getRoom(roomId);
      if (made === undefined || made.closedAt !== null || room === undefined) {
        return { ok: false, code: 'not_found' };
      }
      // Only once the room is known: a code is checked against a room that is there.
      if (confirm.trim().toLowerCase() !== roomShortCode(roomId)) {
        return {
          ok: false,
          code: 'validation_failed',
          fields: [{ field: 'confirm', problem: 'must be the room’s short code' }],
        };
      }
      const course = await store.getRoomCourse(roomId);
      const kind = course?.lapRace !== undefined ? 'lap_race' : room.kind;
      const riders =
        (await roomSources.live()).find((each) => each.roomId === roomId)?.athleteIds.length ?? 0;
      const at = seconds();
      const sources = roomSources;
      const ended = await sources.end(roomId, () =>
        sources.rooms.end(roomId, async (close) => {
          const { value } = await store.recordOperatorAction(
            { actor: { source: 'app', athleteId }, action: 'room_ended', at },
            async (inside) => {
              const closed = await close(inside);
              return {
                outcome: closed ? 'done' : 'refused',
                detail: `${reason},${kind},riders=${String(riders)}`,
                value: closed,
              };
            },
          );
          return value;
        }),
      );
      return ended ? { ok: true, value: { endedAt: at } } : { ok: false, code: 'not_found' };
    },
    async keys() {
      if (keySources === undefined) return { ok: false, code: 'unavailable' };
      // One read: a second one could meet keys changed from the CLI in between.
      let shown: Awaited<ReturnType<typeof keySources.keys.show>>;
      try {
        shown = await keySources.keys.show();
      } catch (error) {
        const state: KeysState =
          error instanceof InstanceKeysUnavailable ? error.code : 'unreadable';
        return {
          ok: true,
          value: { state, fingerprint: null, card: null, current: null, olderHeld: 0 },
        };
      }
      const current = shown.encryptionKeys
        .filter((key) => key.supersededAt === null)
        .sort((a, b) => b.serial - a.serial)[0];
      return {
        ok: true,
        value: {
          state: 'ready',
          fingerprint: shown.fingerprintBase32,
          card: shown.card,
          current:
            current === undefined
              ? null
              : {
                  serial: current.serial,
                  createdAt: current.createdAt,
                  rotatesAt: current.createdAt + ENCRYPTION_KEY_LIFE_SECONDS,
                },
          olderHeld: shown.encryptionKeys.filter((key) => key.supersededAt !== null).length,
        },
      };
    },
    async rotateKey(athleteId, body) {
      if (keySources === undefined) return { ok: false, code: 'unavailable' };
      const fields: FieldProblem[] = [];
      for (const name of Object.keys(body)) {
        if (name !== 'confirm')
          fields.push({ field: name, problem: 'is not a field of this request' });
      }
      if (body.confirm !== 'rotate') fields.push({ field: 'confirm', problem: 'must be rotate' });
      if (fields.length > 0) return { ok: false, code: 'validation_failed', fields };
      const sources = keySources;
      const { value } = await store.recordOperatorAction<KeyRotation>(
        { actor: { source: 'app', athleteId }, action: 'instance_key_rotate', at: seconds() },
        async (inside) => {
          try {
            // No `dropOld`, no `serialAbove`: the routine rotation, and only it.
            const rotated = await sources.over(inside).rotate();
            return { outcome: 'done', value: { outcome: 'rotated', serial: rotated.serial } };
          } catch (error) {
            if (error instanceof InstanceKeysUnavailable && error.code === 'busy') {
              return { outcome: 'refused', detail: 'busy', value: { outcome: 'busy' } };
            }
            throw error;
          }
        },
      );
      return { ok: true, value };
    },
    analysisSettings: analysisView,
    async localModels() {
      const server = await localServer();
      if (!server.ok) {
        return {
          state: server.code === 'not-local' ? 'not-local' : 'no-address',
          version: null,
          models: [],
        };
      }
      return readLocalServer(server.baseUrl, { resolve: analysis.resolve });
    },
    async checkModel(athleteId, body) {
      const fields: FieldProblem[] = [];
      for (const name of Object.keys(body)) {
        if (name !== 'model')
          fields.push({ field: name, problem: 'is not a field of this request' });
      }
      const model = body.model;
      if (typeof model !== 'string' || analysisModelNameProblem(model) !== undefined) {
        fields.push({ field: 'model', problem: 'bad-model' });
      }
      if (fields.length > 0 || typeof model !== 'string') {
        return { ok: false, code: 'validation_failed', fields };
      }
      const server = await localServer();
      const outcome: ToolCheckOutcome = server.ok
        ? await toolCheck.run({
            baseUrl: server.baseUrl,
            model: model.trim(),
            ...(server.reasoningTokens === undefined
              ? {}
              : { reasoningTokens: server.reasoningTokens }),
          })
        : server.code === 'not-local'
          ? 'not-local'
          : 'no-address';
      // Logged once the check is over, so the store is not held while a
      // model loads. A log that cannot be written is the request's failure:
      // the owner is not told an outcome the log does not hold.
      const sent = outcome !== 'busy' && outcome !== 'no-address' && outcome !== 'not-local';
      await store.recordOperatorAction(
        {
          actor: { source: 'app', athleteId },
          action: 'analysis_model_checked',
          at: Math.floor(analysis.now() / 1000),
        },
        () => ({
          outcome: sent ? 'done' : 'refused',
          detail: outcome.replaceAll('-', '_'),
          value: undefined,
        }),
      );
      return { ok: true, value: { outcome } };
    },
    async jobs(athleteId) {
      const read = await store.operateJobs(athleteId, analysis.now() - JOBS_COUNTED_MS, JOBS_SHOWN);
      return {
        counts: read.counts,
        failures: read.failures,
        recent: read.recent.map((job) => ({
          kind: job.templateVersion === REPLAN_TEMPLATE.version ? 're-plan' : 'write-up',
          source: job.source === 'instance-hosted' ? 'hosted' : 'local',
          status: job.status,
          failure: job.failure,
          createdAt: job.createdAt,
          endedAt: job.endedAt,
          whose: job.own ? 'own' : 'other',
        })),
      };
    },
    async setAnalysisSettings(athleteId, body) {
      const saved = await saveAnalysisSettings(store, { source: 'app', athleteId }, body, {
        resolve: analysis.resolve,
        now: analysis.now,
      });
      if (!saved.ok) return { ok: false, code: 'validation_failed', fields: saved.fields };
      await told();
      return { ok: true, value: await analysisView(athleteId) };
    },
    async clearAnalysisSettings(athleteId) {
      await clearAnalysisSettings(store, { source: 'app', athleteId }, analysis.now);
      await told();
      return analysisView(athleteId);
    },
    async status() {
      const [counts, disk, tunnel, keys, backup] = await Promise.all([
        store.operateCounts(),
        status.disk(),
        status.tunnel(),
        status.keys(),
        store.newestServiceBackup(true),
      ]);
      return {
        uptimeSeconds: Math.max(0, Math.floor((status.now() - status.startedAt) / 1000)),
        disk,
        lastBackup:
          backup === undefined || backup.offBox === null || backup.intervalSeconds === null
            ? null
            : {
                at: new Date(backup.at * 1000).toISOString(),
                offBox: backup.offBox,
                intervalSeconds: backup.intervalSeconds,
              },
        tunnel,
        counts,
        keys,
      };
    },
    async backups() {
      const [records, pending] = await Promise.all([
        store.listBackupRecords(BACKUPS_SHOWN),
        store.pendingBackupRequest(),
      ]);
      return { records, pendingSince: pending?.requestedAt ?? null, now: seconds() };
    },
    async requestBackup(athleteId) {
      const at = seconds();
      const { value } = await store.recordOperatorAction<BackupRequestOutcome>(
        { actor: { source: 'app', athleteId }, action: 'backup_requested', at },
        async (inside) => {
          const asked = await inside.requestBackup(at);
          return asked.outcome === 'requested'
            ? { outcome: 'done', value: asked }
            : { outcome: 'refused', detail: asked.outcome, value: asked };
        },
      );
      return value.outcome === 'requested'
        ? { ok: true, value: { requestedAt: value.request.requestedAt } }
        : { ok: false, code: 'too_many' };
    },
    async logPage(query) {
      const request = parsePageRequest(query);
      if (!request.ok) return { ok: false, code: 'validation_failed', fields: request.fields };
      const { limit, after } = request.request;
      let beforeId: number | undefined;
      if (after !== undefined) {
        // Only a forged cursor carries an id the log could not have written.
        if (after.key !== CURSOR_KEY || !/^[1-9][0-9]{0,15}$/.test(after.id)) {
          return { ok: false, code: 'validation_failed', fields: NOT_OUR_CURSOR };
        }
        beforeId = Number(after.id);
        if (!Number.isSafeInteger(beforeId)) {
          return { ok: false, code: 'validation_failed', fields: NOT_OUR_CURSOR };
        }
      }
      // One row more than the page says whether there is a next one.
      const rows = await store.listOperatorLogPage(beforeId, limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        ok: true,
        value: {
          items,
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: CURSOR_KEY, id: String(last.id) })
              : null,
        },
      };
    },
  };
}
