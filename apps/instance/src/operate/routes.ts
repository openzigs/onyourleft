// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Operate routes (#2601, #2602), as entries in the one route table
 * (`routes.ts`). Every one is `sealed: 'only'` and `reaches: 'owner'`: the
 * handler answers anybody but the owner `not_found` before the route is
 * called, and every one answers `unavailable` on an instance with no keys
 * (`operate.ts`). `moderation/choke-point.test.ts` holds the table to both,
 * and to every one declaring `admin` (#2641, ADR 0069 D-2): which the
 * instance's own admin pages may call in-process, as the owner.
 */

import { TOOL_CHECK_OUTCOMES } from '../analysis/tool-check.ts';
import { REGISTRATION_MODES, REPOSITORY, type Config } from '../config.ts';
import { errorResponse } from '../errors.ts';
import { RECENT_PROBLEMS_KEPT } from '../log.ts';
import type { Readiness } from '../readiness.ts';
import { OPERATOR_ACTIONS, ROOM_END_REASONS } from '../store/sql-store.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Operate, OperateOwner } from './operate.ts';

function operateOf(context: RouteContext): Operate {
  // The handler answers `unavailable` before calling a route that declares
  // `operate` without one, so this is never reached with none.
  if (context.operate === undefined) throw new Error('operate route called without operate');
  return context.operate;
}

const entrySchema: Schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    /** ISO 8601, UTC. */
    at: { type: 'string' },
    /**
     * Where it was taken: the app's Operate area, the operator's CLI on the
     * host, or the instance's own admin pages through the tunnel or on the
     * server machine (#2641, ADR 0069 D-8).
     */
    source: {
      type: 'string',
      enum: ['app', 'cli', 'admin_tunnel', 'admin_loopback', 'setup', 'start'],
    },
    action: { type: 'string', enum: OPERATOR_ACTIONS },
    detail: { type: ['string', 'null'] },
    outcome: { type: 'string', enum: ['done', 'refused', 'failed'] },
  },
  required: ['id', 'at', 'source', 'action', 'detail', 'outcome'],
  additionalProperties: false,
};

/** What `/ready` would say with nothing to ask: not ready, and nothing known. */
const NOTHING_ASKED: Readiness = {
  ready: false,
  checks: { database: false, migrations: 'unknown', rooms: false },
};

/**
 * Whether this instance runs this repository's own source (#2604): no
 * `OYL_INSTANCE_SOURCE_URL`, or one in this repository. Only then is its
 * commit compared with this repository's `main` — by a link the owner opens,
 * never by a request from here (the epic's decision 3).
 */
export function runsUpstreamSource(config: Pick<Config, 'sourceUrl'>): boolean {
  return config.sourceUrl === REPOSITORY || config.sourceUrl.startsWith(`${REPOSITORY}/`);
}

const count: Schema = { type: 'integer' };

/** Why the local model is off: the codes `.env` is refused with (`config.ts`). */
const LOCAL_STATES = [
  'on',
  'not-set',
  'not-a-url',
  'not-base-url',
  'not-local',
  'tls-by-name',
  'no-model',
  'bad-model',
  'bad-reasoning',
] as const;

/** The operator's analysis settings, as the owner reads them (#2609). Never a key. */
const analysisSchema: Schema = {
  type: 'object',
  properties: {
    local: {
      type: 'object',
      properties: {
        /** The local model's base URL: the one a job is built with while `on`. */
        url: { type: ['string', 'null'] },
        model: { type: ['string', 'null'] },
        reasoningTokens: { type: ['integer', 'null'] },
        /** Whether the instance offers the local model at all. */
        offered: { type: 'boolean' },
        /** ADR 0046 D-9's switch: riders other than the operator may use it. Off by default. */
        othersMayUse: { type: 'boolean' },
        /** Where the model's settings come from: the app's row, `.env`, or nowhere. */
        setIn: { type: 'string', enum: ['app', 'env', 'none'] },
        state: { type: 'string', enum: LOCAL_STATES },
      },
      required: ['url', 'model', 'reasoningTokens', 'offered', 'othersMayUse', 'setIn', 'state'],
      additionalProperties: false,
    },
    hosted: {
      type: 'object',
      properties: {
        offered: { type: 'boolean' },
        operatorKey: { type: 'string', enum: ['none', 'held', 'held-unreadable'] },
        operatorKeyOrigin: { type: ['string', 'null'] },
      },
      required: ['offered', 'operatorKey', 'operatorKeyOrigin'],
      additionalProperties: false,
    },
  },
  required: ['local', 'hosted'],
  additionalProperties: false,
};

/** The owner, whom the handler admitted: an Operate route is called with no other caller. */
function ownerOf(context: RouteContext): string {
  if (context.caller === undefined) throw new Error('operate route called without a caller');
  return context.caller.athleteId;
}

/**
 * The owner as the operator log names them (ADR 0069 D-8): from the app, or
 * from the admin pages on the listener the admin seam's marker names — the
 * marker is set by that seam alone, never by a request.
 */
function ownerActor(context: RouteContext): OperateOwner {
  const athleteId = ownerOf(context);
  switch (context.adminChannel) {
    case undefined:
      return { source: 'app', athleteId };
    case 'tunnel':
      return { source: 'admin_tunnel', athleteId };
    case 'loopback':
      return { source: 'admin_loopback', athleteId };
  }
}

const ANALYSIS_SUMMARY_TAIL =
  'The owner’s alone: anybody else, the deputy included, is answered as though there were no such route. `unavailable` on an instance with no `OYL_INSTANCE_SECRET_KEY`.';

const statusSchema: Schema = {
  type: 'object',
  properties: {
    /** Whether `GET /ready` would say ready, and each of its checks by name. */
    ready: { type: 'boolean' },
    checks: {
      type: 'object',
      properties: {
        database: { type: 'boolean' },
        migrations: {
          type: 'string',
          enum: ['at-head', 'migrating', 'behind', 'ahead', 'unknown'],
        },
        rooms: { type: 'boolean' },
      },
      required: ['database', 'migrations', 'rooms'],
      additionalProperties: false,
    },
    version: { type: 'string' },
    /** `OYL_INSTANCE_COMMIT`, 40 lower-case hex, or `null`. */
    commit: { type: ['string', 'null'] },
    /** The source is this repository's, so the commit may be compared with its `main`. */
    upstream: { type: 'boolean' },
    registration: { type: 'string', enum: REGISTRATION_MODES },
    uptimeSeconds: count,
    disk: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          holds: { type: 'string', enum: ['database', 'blobs', 'database_and_blobs'] },
          freeBytes: count,
          totalBytes: count,
          /** Under a tenth free. */
          low: { type: 'boolean' },
        },
        required: ['holds', 'freeBytes', 'totalBytes', 'low'],
        additionalProperties: false,
      },
    },
    /**
     * The backup service's newest snapshot (#2606) — `null` while it has
     * recorded none. A one-off run, such as the pre-deploy snapshot, is not it.
     */
    lastBackup: {
      type: ['object', 'null'],
      properties: {
        /** ISO 8601, UTC. */
        at: { type: 'string' },
        /** How its off-box copy went. */
        offBox: { type: 'string', enum: ['copied', 'failed', 'not-configured'] },
        /** The backup service's interval, in seconds. */
        intervalSeconds: count,
      },
      required: ['at', 'offBox', 'intervalSeconds'],
      additionalProperties: false,
    },
    tunnel: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['unknown', 'ready', 'not_ready'] },
        /** How many connections `cloudflared` holds ready, when it is `ready`. */
        connections: { type: ['integer', 'null'] },
      },
      required: ['state', 'connections'],
      additionalProperties: false,
    },
    counts: {
      type: 'object',
      properties: {
        athletes: {
          type: 'object',
          properties: { active: count, pending: count, suspended: count },
          required: ['active', 'pending', 'suspended'],
          additionalProperties: false,
        },
        roomsOpen: count,
        analysis: {
          type: 'object',
          properties: { queued: count, running: count },
          required: ['queued', 'running'],
          additionalProperties: false,
        },
      },
      required: ['athletes', 'roomsOpen', 'analysis'],
      additionalProperties: false,
    },
    /** The instance keys' state by name: `ready`, or why not. */
    keys: {
      type: 'string',
      enum: ['ready', 'no-secret', 'no-origin', 'no-keys', 'unreadable', 'busy'],
    },
  },
  required: [
    'ready',
    'checks',
    'version',
    'commit',
    'upstream',
    'registration',
    'uptimeSeconds',
    'disk',
    'lastBackup',
    'tunnel',
    'counts',
    'keys',
  ],
  additionalProperties: false,
};

const nullableCount: Schema = { type: ['integer', 'null'] };

const backupRecordSchema: Schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    /** When the run started, ISO 8601, UTC. */
    at: { type: 'string' },
    /** Whole seconds since then. */
    ageSeconds: count,
    /** Whether it made a snapshot. */
    outcome: { type: 'string', enum: ['done', 'failed'] },
    /** A failed run's error, by name or Node's code (`ENOSPC`) — never its message. */
    error: { type: ['string', 'null'] },
    /** The snapshot directory's NAME (`snapshot-<time>`), never the folder it is in. */
    snapshot: { type: ['string', 'null'] },
    /** Every table's rows, added up, from its manifest. */
    rows: nullableCount,
    blobs: nullableCount,
    databaseSha256: { type: ['string', 'null'] },
    sizeBytes: nullableCount,
    /** How its off-box copy went — `copied`, `failed` or `not-configured` — or `null` for a failed run. */
    offBox: { type: ['string', 'null'] },
    /** How many old snapshots `--keep` removed. */
    removed: nullableCount,
    /** Free space where the snapshots go, and where their off-box copies go, when it ran. */
    freeBytes: {
      type: 'object',
      properties: { backups: nullableCount, offBox: nullableCount },
      required: ['backups', 'offBox'],
      additionalProperties: false,
    },
    /** The backup service's interval; `null` for a one-off run such as the pre-deploy snapshot. */
    intervalSeconds: nullableCount,
    /** It was made because the owner asked for it. */
    requested: { type: 'boolean' },
  },
  required: [
    'id',
    'at',
    'ageSeconds',
    'outcome',
    'error',
    'snapshot',
    'rows',
    'blobs',
    'databaseSha256',
    'sizeBytes',
    'offBox',
    'removed',
    'freeBytes',
    'intervalSeconds',
    'requested',
  ],
  additionalProperties: false,
};

const isoOf = (seconds: number): string => new Date(seconds * 1000).toISOString();

const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'withheld'] as const;

/** What the local model server offers (#2610). Names and sizes; never an address. */
const localModelsSchema: Schema = {
  type: 'object',
  properties: {
    /** What the server is, or why it could not be read. */
    state: {
      type: 'string',
      enum: ['ollama', 'openai-compatible', 'no-address', 'not-local', 'unresolved', 'unreachable'],
    },
    /** Ollama's version, when it said one. */
    version: { type: ['string', 'null'] },
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          /** On disk, as `/api/tags` says. */
          sizeBytes: nullableCount,
          /** `7.6B`, as the server writes it. */
          parameters: { type: ['string', 'null'] },
          /** `Q4_K_M`, as the server writes it. */
          quantisation: { type: ['string', 'null'] },
          /** Whether `/api/show` lists `tools` among its capabilities, or lists none. */
          tools: { type: 'string', enum: ['listed', 'not-listed', 'not-reported'] },
          /** How much of it is in GPU memory: of a LOADED model only, never guessed from its size. */
          gpu: {
            type: 'string',
            enum: ['all', 'part', 'none', 'not-loaded', 'not-reported', 'not-known'],
          },
          /** For `part`, the whole percent in GPU memory, 1–99. */
          gpuPercent: nullableCount,
        },
        required: ['name', 'sizeBytes', 'parameters', 'quantisation', 'tools', 'gpu', 'gpuPercent'],
        additionalProperties: false,
      },
    },
  },
  required: ['state', 'version', 'models'],
  additionalProperties: false,
};

/** The analysis queue and the newest jobs (#2610): never an athlete, an input or a write-up. */
const jobsSchema: Schema = {
  type: 'object',
  properties: {
    /** Jobs queued and running now; the ended ones, those that ended in the last 7 days. */
    counts: {
      type: 'object',
      properties: Object.fromEntries(JOB_STATUSES.map((status) => [status, count])),
      required: [...JOB_STATUSES],
      additionalProperties: false,
    },
    /** The failed jobs of the last 7 days, by failure code, most first. */
    failures: {
      type: 'array',
      items: {
        type: 'object',
        /** `code` is one of `analysis/jobs.ts` §`JOB_FAILURES`. */
        properties: { code: { type: ['string', 'null'] }, count },
        required: ['code', 'count'],
        additionalProperties: false,
      },
    },
    /** The newest 50 jobs, newest first. */
    recent: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['write-up', 're-plan'] },
          source: { type: 'string', enum: ['local', 'hosted'] },
          status: { type: 'string', enum: JOB_STATUSES },
          /** One of `analysis/jobs.ts` §`JOB_FAILURES` for a failed job. */
          failure: { type: ['string', 'null'] },
          /** ISO 8601, UTC. */
          createdAt: { type: 'string' },
          endedAt: { type: ['string', 'null'] },
          /** The owner's own job, or another rider's: never which rider. */
          whose: { type: 'string', enum: ['own', 'other'] },
        },
        required: ['kind', 'source', 'status', 'failure', 'createdAt', 'endedAt', 'whose'],
        additionalProperties: false,
      },
    },
  },
  required: ['counts', 'failures', 'recent'],
  additionalProperties: false,
};

const isoOfMs = (milliseconds: number): string => new Date(milliseconds).toISOString();

/** One open room as the owner is shown it (#2612): never a rider's place, power or id. */
const roomSchema: Schema = {
  type: 'object',
  properties: {
    roomId: { type: 'string' },
    /** The first six characters of its id: what the owner types to end it. */
    shortCode: { type: 'string' },
    kind: { type: 'string', enum: ['group', 'race', 'lap-race'] },
    visibility: { type: 'string', enum: ['private', 'public'] },
    phase: { type: 'string', enum: ['lobby', 'countdown', 'riding', 'finished'] },
    /** When it was made, ISO 8601, UTC. */
    openedAt: { type: 'string' },
    /** The display name of the rider who made it, as the owner may see it; `null` for “a rider”. */
    host: { type: ['string', 'null'] },
    /** The display name of each rider in it, `null` for “a rider”. */
    riders: { type: 'array', items: { type: ['string', 'null'] } },
    riderCount: count,
  },
  required: [
    'roomId',
    'shortCode',
    'kind',
    'visibility',
    'phase',
    'openedAt',
    'host',
    'riders',
    'riderCount',
  ],
  additionalProperties: false,
};

const KEYS_STATES = ['ready', 'no-secret', 'no-origin', 'no-keys', 'unreadable', 'busy'] as const;

export const OPERATE_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/v1/operate/rooms',
    sealed: 'only',
    operationId: 'getOperateRooms',
    reaches: 'owner',
    // ADR 0069 D-2: a read; #2649's admin Rooms page renders it.
    admin: 'read',
    summary: `Every open rider’s room (#2612), newest first: its id and short code, whether it is a group ride, a race or a lap race, private or public, its phase (\`lobby\`, \`countdown\`, \`riding\`, \`finished\`), when it was made, its host’s display name, and the display name of each rider in it — read from the room worker holding it — with a count. A name the owner may not see is \`null\`, “a rider”. **Never** a rider’s place, distance, speed, power, heart rate or Discord id. Changes nothing, so it logs nothing. \`unavailable\` where the instance has no room router. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { rooms: { type: 'array', items: roomSchema } },
        required: ['rooms'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const read = await operateOf(context).rooms(ownerOf(context));
      if (!read.ok) return errorResponse(read.code);
      return json({
        rooms: read.value.map((room) => ({
          roomId: room.roomId,
          shortCode: room.shortCode,
          kind: room.kind,
          visibility: room.visibility,
          phase: room.phase,
          openedAt: isoOf(room.openedAt),
          host: room.host,
          riders: room.riders,
          riderCount: room.riders.length,
        })),
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/operate/rooms/{roomId}/end',
    sealed: 'only',
    operationId: 'endOperateRoom',
    reaches: 'owner',
    // ADR 0069 D-2: #2649's Rooms page ends one, behind a fresh passkey and
    // the typed code, logged under the channel's own source.
    admin: 'change',
    summary: `End a rider’s room (#2612): \`confirm\` must be the room’s short code and \`reason\` one of ${ROOM_END_REASONS.map((reason) => `\`${reason}\``).join(', ')}, or it is \`validation_failed\` and nothing changes. The room is over, as a finished one is: its route deleted, every socket in it sent \`refuse room-closed\` and closed \`4005\`, a rejoin refused, its voice channel deleted, and every result already final kept. A rider in it rides on alone; nothing is sent to anybody’s trainer. Logged \`room_ended\` with the reason, its kind and how many riders were in it, in the same transaction as the close. \`not_found\` for a room that is not an open rider’s room. \`unavailable\` where the instance has no room router. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    request: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ROOM_END_REASONS },
        confirm: { type: 'string' },
      },
      required: ['reason', 'confirm'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed', 'not_found', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          /** When it ended, ISO 8601, UTC. */
          endedAt: { type: 'string' },
        },
        required: ['endedAt'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const ended = await operateOf(context).endRoom(
        ownerActor(context),
        context.params.roomId ?? '',
        context.json,
      );
      if (!ended.ok) {
        return errorResponse(
          ended.code,
          ended.fields === undefined ? {} : { fields: ended.fields },
        );
      }
      return json({ endedAt: isoOf(ended.value.endedAt) });
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/keys',
    sealed: 'only',
    operationId: 'getOperateKeys',
    reaches: 'owner',
    // ADR 0069 D-2: the card and the fingerprint are worth something only
    // because the edge cannot write them (ADR 0047 D-6): never through the
    // tunnel's admin pages. #2650's loopback page formats its own.
    admin: 'never',
    summary: `The instance’s keys (#2613), public material only — what \`instance-key show\` prints: their state (\`ready\`, or \`no-secret\`, \`no-origin\`, \`no-keys\`, \`unreadable\`, \`busy\`), the identity key’s full SHA-256 fingerprint (52 base32 characters, as a rider’s device shows it), the instance card (\`oyl-instance:<origin>#<52 characters>\`, whole), the current encryption key’s serial, when it was made and when the instance rotates it by itself (30 days on), and how many superseded encryption keys are still held (each for 7 days after its successor). **Never** a private half, nor anything derived from \`OYL_INSTANCE_SECRET_KEY\`. Changes nothing, so it logs nothing. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: KEYS_STATES },
          /** 64 lower-case hex; `null` unless \`ready\`. */
          fingerprint: { type: ['string', 'null'] },
          /** The whole card; `null` unless \`ready\`. */
          card: { type: ['string', 'null'] },
          current: {
            type: ['object', 'null'],
            properties: {
              serial: count,
              /** ISO 8601, UTC. */
              createdAt: { type: 'string' },
              /** When the instance rotates it by itself, ISO 8601, UTC. */
              rotatesAt: { type: 'string' },
            },
            required: ['serial', 'createdAt', 'rotatesAt'],
            additionalProperties: false,
          },
          olderHeld: count,
        },
        required: ['state', 'fingerprint', 'card', 'current', 'olderHeld'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const read = await operateOf(context).keys();
      if (!read.ok) return errorResponse(read.code);
      const view = read.value;
      return json({
        state: view.state,
        fingerprint: view.fingerprint,
        card: view.card,
        current:
          view.current === null
            ? null
            : {
                serial: view.current.serial,
                createdAt: isoOf(view.current.createdAt),
                rotatesAt: isoOf(view.current.rotatesAt),
              },
        olderHeld: view.olderHeld,
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/operate/keys/rotate',
    sealed: 'only',
    operationId: 'rotateOperateKey',
    reaches: 'owner',
    // ADR 0069 D-2: #2650's Keys page rotates it, behind a fresh passkey and
    // the typed word, logged under the channel's own source.
    admin: 'change',
    summary: `Rotate the encryption key (#2613), with \`{ confirm: 'rotate' }\` — else \`validation_failed\` and nothing is written: what \`instance-key rotate\` does, with no \`--drop-old\` and no \`--serial-above\`. The old key keeps opening requests for 7 days, devices pick the new one up from \`GET /v1/instance/keys\` by themselves, and nobody pins again. It takes the key lease: while the instance’s own maintenance pass holds it the answer is \`busy\` and nothing is written. Logged \`instance_key_rotate\` (\`refused\` with \`busy\`) in the same transaction as the rotation. \`rotate --drop-old\`, \`rotate-identity\` and \`reset\` stay on the CLI. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    request: {
      type: 'object',
      properties: { confirm: { type: 'string', enum: ['rotate'] } },
      required: ['confirm'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['rotated', 'busy'] },
          /** The new key's serial; `null` when \`busy\`. */
          serial: { type: ['integer', 'null'] },
        },
        required: ['outcome', 'serial'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const rotated = await operateOf(context).rotateKey(ownerActor(context), context.json);
      if (!rotated.ok) {
        return errorResponse(
          rotated.code,
          rotated.fields === undefined ? {} : { fields: rotated.fields },
        );
      }
      return json(
        rotated.value.outcome === 'rotated'
          ? { outcome: 'rotated', serial: rotated.value.serial }
          : { outcome: 'busy', serial: null },
      );
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/logs',
    sealed: 'only',
    operationId: 'getOperateLogs',
    reaches: 'owner',
    // ADR 0069 D-2: a read of redacted lines; #2651's page renders it.
    admin: 'read',
    summary: `The instance’s recent problems (#2614): its last ${String(RECENT_PROBLEMS_KEPT)} problem lines — a request answered 5xx, an exception no route handled, a room worker that died, a failed analysis job, a model or the keys off or unreadable, a failed voice request, a room socket closed for a server-side reason, and the rest of \`log.ts\` §\`isProblem\`’s closed list — newest first, each exactly as standard output got it, after the log’s one redaction: never a token, a key, a name or a coordinate. Held in memory only, so a restart empties it; \`since\` is when this process started. The main process’s lines only. Changes nothing, so it logs nothing. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          /** When this process started, ISO 8601, UTC: the lines are all since then. */
          since: { type: 'string' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                /** When it was written, ISO 8601, UTC. */
                at: { type: 'string' },
                /** The JSON line exactly as standard output got it. */
                line: { type: 'string' },
              },
              required: ['at', 'line'],
              additionalProperties: false,
            },
          },
        },
        required: ['since', 'lines'],
        additionalProperties: false,
      },
    },
    handle: (context) => {
      const read = operateOf(context).problems();
      if (!read.ok) return Promise.resolve(errorResponse(read.code));
      return Promise.resolve(
        json({
          since: isoOfMs(read.value.since),
          lines: read.value.lines.map((each) => ({ at: isoOfMs(each.at), line: each.line })),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/analysis',
    sealed: 'only',
    operationId: 'getOperateAnalysis',
    reaches: 'owner',
    admin: 'read',
    summary: `The operator’s analysis settings (#2609, ADR 0046’s 2026-11-14 amendment): the local model’s base URL, name and reasoning tokens, whether each is set in the app or in \`.env\`, and whether it is \`on\` or the code it is off for; whether the instance offers the local model and a hosted service; the switch that lets riders other than the operator use the local model (off by default); and whether the operator’s own hosted key is held, and for which origin — never the key. Changes nothing, so it logs nothing. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: analysisSchema },
    handle: async (context) => json(await operateOf(context).analysisSettings(ownerOf(context))),
  },
  {
    // POST, not PUT: the route table takes GET, POST and DELETE, and a field
    // left out is unchanged, which is not a PUT's whole replacement either.
    method: 'POST',
    path: '/v1/operate/analysis',
    sealed: 'only',
    operationId: 'setOperateAnalysis',
    reaches: 'owner',
    // ADR 0069 D-2: a change the admin AI backend page makes (#2648), after
    // #2642's fresh passkey, logged with the channel's own source.
    admin: 'change',
    summary: `Save the operator’s analysis settings (#2609): every field is optional, a field left out is unchanged, and \`null\` returns it to its fallback — a model field to its \`.env\` line, a source to offered, the switch to off. They apply from the next job, with no restart; a job already running keeps its own. \`localUrl\` is held to the rule \`.env\`’s address is, and a name must resolve, now, to local addresses only; a field that fails is \`validation_failed\` with its code (\`not-a-url\`, \`not-base-url\`, \`not-local\`, \`tls-by-name\`, \`unresolved\`, \`bad-model\`, \`bad-reasoning\`) as the problem, and nothing is saved. Logged \`analysis_settings_set\` in the operator log, naming the fields changed and never a value. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    request: {
      type: 'object',
      properties: {
        localUrl: { type: ['string', 'null'] },
        localModel: { type: ['string', 'null'] },
        reasoningTokens: { type: ['integer', 'null'] },
        offerLocal: { type: ['boolean', 'null'] },
        offerHosted: { type: ['boolean', 'null'] },
        othersLocal: { type: ['boolean', 'null'] },
      },
      required: [],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed'],
    response: { contentType: 'application/json', schema: analysisSchema },
    handle: async (context) => {
      const saved = await operateOf(context).setAnalysisSettings(ownerActor(context), context.json);
      if (!saved.ok) {
        return errorResponse(
          saved.code,
          saved.fields === undefined ? {} : { fields: saved.fields },
        );
      }
      return json(saved.value);
    },
  },
  {
    method: 'DELETE',
    path: '/v1/operate/analysis',
    sealed: 'only',
    operationId: 'clearOperateAnalysis',
    reaches: 'owner',
    // ADR 0069 D-2: a change the admin AI backend page makes (#2648), after
    // #2642's fresh passkey, logged with the channel's own source.
    admin: 'change',
    summary: `Clear the operator’s analysis settings (#2609): every field falls back — the local model to \`.env\`, both sources to offered, the switch for other riders to off — from the next job. Logged \`analysis_settings_cleared\`. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: analysisSchema },
    handle: async (context) =>
      json(await operateOf(context).clearAnalysisSettings(ownerActor(context))),
  },
  {
    method: 'GET',
    path: '/v1/operate/analysis/models',
    sealed: 'only',
    operationId: 'getOperateAnalysisModels',
    reaches: 'owner',
    admin: 'read',
    summary: `What the configured local model server offers (#2610), for picking a model: whether it is Ollama (and its version) or another OpenAI-compatible server (names alone); and each model’s name, size, parameters and quantisation, whether the server lists \`tools\` among its capabilities (\`not-reported\` where it lists none, as older servers do), and how much of it is in GPU memory — \`all\`, \`part\` with a percent, or \`none\` for a model that is loaded, and \`not-loaded\` for one that is not: Ollama does not say how much memory the card has, so no fit is guessed from a size. The address is the one \`GET /v1/operate/analysis\` shows, checked as every request to it is: a name must resolve, at each request, to local addresses only. Changes nothing, so it logs nothing. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: localModelsSchema },
    handle: async (context) => json(await operateOf(context).localModels()),
  },
  {
    method: 'POST',
    path: '/v1/operate/analysis/check',
    sealed: 'only',
    operationId: 'checkOperateAnalysisModel',
    reaches: 'owner',
    // ADR 0069 D-2: a change the admin AI backend page makes (#2648), after
    // #2642's fresh passkey, logged with the channel's own source.
    admin: 'change',
    summary: `Check that a model on the configured local server calls tools (#2610, ADR 0046 D-7), before it is saved: the instance sends it a fixed instruction and one fixed, harmless tool — no ride, no rider’s text, no history — and the outcome is \`tools-ok\` only if it called the tool and then answered; else \`no-tool-call\`, \`does-not-support-tools\`, \`server-error\`, \`not-local\`, \`out-of-time\`, \`stopped\` (the instance stopped), \`no-address\` or \`busy\` (another check is out: one at a time). ⚠️ **Asking the server for a model loads it, which may unload the model a rider’s job is using.** Only the local source: a hosted service has its own test (\`POST /v1/analysis/hosted/test\`). Logged \`analysis_model_checked\` with the outcome, never the model’s name. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    request: {
      type: 'object',
      properties: { model: { type: 'string' } },
      required: ['model'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { outcome: { type: 'string', enum: TOOL_CHECK_OUTCOMES } },
        required: ['outcome'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const checked = await operateOf(context).checkModel(ownerActor(context), context.json);
      if (!checked.ok) {
        return errorResponse(
          checked.code,
          checked.fields === undefined ? {} : { fields: checked.fields },
        );
      }
      return json(checked.value);
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/analysis/jobs',
    sealed: 'only',
    operationId: 'getOperateAnalysisJobs',
    reaches: 'owner',
    admin: 'read',
    summary: `The analysis queue (#2610): how many jobs are queued and running, how many ended in each status in the last 7 days and the failed ones by failure code; and the newest 50 jobs — write-up or re-plan, local or hosted, status, failure code, when made and ended, and whether it was your own or another rider’s. Never which rider, and never a job’s input, events, sections or write-up. Changes nothing, so it logs nothing. ${ANALYSIS_SUMMARY_TAIL}`,
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: jobsSchema },
    handle: async (context) => {
      const view = await operateOf(context).jobs(ownerOf(context));
      return json({
        counts: view.counts,
        failures: view.failures,
        recent: view.recent.map((job) => ({
          kind: job.kind,
          source: job.source,
          status: job.status,
          failure: job.failure,
          createdAt: isoOfMs(job.createdAt),
          endedAt: job.endedAt === null ? null : isoOfMs(job.endedAt),
          whose: job.whose,
        })),
      });
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/status',
    sealed: 'only',
    operationId: 'getOperateStatus',
    reaches: 'owner',
    admin: 'read',
    summary:
      'The instance’s Status (#2604), read-only: the checks `GET /ready` makes, the version and deployed commit, the registration mode, uptime, disk space, the last backup, the tunnel’s readiness (`unknown` unless `OYL_INSTANCE_TUNNEL_READY_URL` is set), how many athletes are in each standing, rooms open and analysis jobs waiting or running, and the instance keys’ state. Counts and names only: no secret, no row of anybody, no path on the host. Changes nothing, so it logs nothing. The owner’s alone: anybody else, the deputy included, is answered as though there were no such route. `unavailable` on an instance with no `OYL_INSTANCE_SECRET_KEY`.',
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: statusSchema },
    handle: async (context) => {
      const [readiness, status] = await Promise.all([
        context.probes?.ready() ?? Promise.resolve(NOTHING_ASKED),
        operateOf(context).status(),
      ]);
      return json({
        ready: readiness.ready,
        checks: readiness.checks,
        version: context.version,
        commit: context.config.commit,
        upstream: runsUpstreamSource(context.config),
        // ADR 0080 D-6 (#2784): the mode a new rider meets, the database's over `.env`'s.
        registration: (await context.identity?.registrationMode()) ?? context.config.registration,
        uptimeSeconds: status.uptimeSeconds,
        disk: status.disk,
        lastBackup: status.lastBackup,
        tunnel:
          status.tunnel.state === 'ready'
            ? { state: 'ready', connections: status.tunnel.connections }
            : { state: status.tunnel.state, connections: null },
        counts: status.counts,
        keys: status.keys,
      });
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/log',
    sealed: 'only',
    operationId: 'getOperatorLog',
    reaches: 'owner',
    admin: 'read',
    summary:
      'The operator log (#2602): every action taken as the instance’s operator, from the app or the CLI on the host, NEWEST first, a page at a time — `?limit=` (1–200, default 50) and `?cursor=` from the page before. Append-only. The owner’s alone: anybody else, the deputy included, is answered as though there were no such route. `unavailable` on an instance with no `OYL_INSTANCE_SECRET_KEY`.',
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          entries: { type: 'array', items: entrySchema },
          cursor: { type: ['string', 'null'] },
        },
        required: ['entries', 'cursor'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const page = await operateOf(context).logPage(context.url.searchParams);
      if (!page.ok) {
        return errorResponse(page.code, page.fields === undefined ? {} : { fields: page.fields });
      }
      return json({
        entries: page.value.items.map((entry) => ({
          id: entry.id,
          at: new Date(entry.at * 1000).toISOString(),
          source: entry.source,
          action: entry.action,
          detail: entry.detail,
          outcome: entry.outcome,
        })),
        cursor: page.value.next,
      });
    },
  },
  {
    method: 'GET',
    path: '/v1/operate/backups',
    sealed: 'only',
    operationId: 'getOperateBackups',
    reaches: 'owner',
    admin: 'read',
    summary:
      'The instance’s backups (#2606), read from the records the `backup` service writes — the instance never reads the backup folders: the newest 50, newest first, each with when it ran and its age, whether it made a snapshot (a failed run names its error, never its message), the snapshot directory’s name, its row and blob counts and database SHA-256 from its manifest, its size, how its off-box copy went, how many old snapshots it removed, the free space where snapshots and their off-box copies go, and the backup service’s interval (`null` for a one-off run); and the “back up now” still waiting, if any. No host path. Restore is not here: it stays on the CLI. Changes nothing, so it logs nothing. The owner’s alone: anybody else, the deputy included, is answered as though there were no such route. `unavailable` on an instance with no `OYL_INSTANCE_SECRET_KEY`.',
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          backups: { type: 'array', items: backupRecordSchema },
          /** The “back up now” still waiting: when it was asked, or `null`. */
          pending: {
            type: ['object', 'null'],
            properties: { requestedAt: { type: 'string' } },
            required: ['requestedAt'],
            additionalProperties: false,
          },
        },
        required: ['backups', 'pending'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const view = await operateOf(context).backups();
      return json({
        backups: view.records.map((record) => ({
          id: record.id,
          at: isoOf(record.at),
          ageSeconds: Math.max(0, view.now - record.at),
          outcome: record.outcome,
          error: record.error,
          snapshot: record.snapshot,
          rows: record.rows,
          blobs: record.blobs,
          databaseSha256: record.databaseSha256,
          sizeBytes: record.sizeBytes,
          offBox: record.offBox,
          removed: record.removed,
          freeBytes: { backups: record.backupsFreeBytes, offBox: record.offBoxFreeBytes },
          intervalSeconds: record.intervalSeconds,
          requested: record.requested,
        })),
        pending: view.pendingSince === null ? null : { requestedAt: isoOf(view.pendingSince) },
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/operate/backups',
    sealed: 'only',
    operationId: 'requestOperateBackup',
    reaches: 'owner',
    // ADR 0069 D-2: #2647's Backups page asks for one, behind a fresh
    // passkey, logged under the channel's own source.
    admin: 'change',
    summary:
      '“Back up now” (#2606): asks the `backup` service for a snapshot, which it takes within 30 seconds; answers 202 at once — the instance itself takes none, holding neither the backup folders nor a reason to. The request and its `backup_requested` entry in the operator log are written in one transaction. Refused `too_many`, and logged `refused`, while a request already waits or a backup was made in the last 15 minutes: each extra backup with `--keep` removes an older one, and shortens how far back a restore can go. The owner’s alone: anybody else, the deputy included, is answered as though there were no such route. `unavailable` on an instance with no `OYL_INSTANCE_SECRET_KEY`.',
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated', 'too_many'],
    accepted: true,
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          /** When it was asked, ISO 8601, UTC. */
          requestedAt: { type: 'string' },
        },
        required: ['requestedAt'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const asked = await operateOf(context).requestBackup(ownerActor(context));
      if (!asked.ok) return errorResponse(asked.code);
      return json({ requestedAt: isoOf(asked.value.requestedAt) }, 202);
    },
  },
];
