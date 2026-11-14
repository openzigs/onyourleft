// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Operate routes (#2601, #2602), as entries in the one route table
 * (`routes.ts`). Every one is `sealed: 'only'` and `reaches: 'owner'`: the
 * handler answers anybody but the owner `not_found` before the route is
 * called, and every one answers `unavailable` on an instance with no keys
 * (`operate.ts`). `moderation/choke-point.test.ts` holds the table to both.
 */

import { REGISTRATION_MODES, REPOSITORY, type Config } from '../config.ts';
import { errorResponse } from '../errors.ts';
import type { Readiness } from '../readiness.ts';
import { OPERATOR_ACTIONS } from '../store/sql-store.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Operate } from './operate.ts';

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
    /** Where it was taken: the app's Operate area, or the operator's CLI on the host. */
    source: { type: 'string', enum: ['app', 'cli'] },
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
     * The newest backup's record — `null` until #2606 records snapshots, and
     * whenever none is recorded.
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

export const OPERATE_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/v1/operate/status',
    sealed: 'only',
    operationId: 'getOperateStatus',
    reaches: 'owner',
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
        registration: context.config.registration,
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
];
