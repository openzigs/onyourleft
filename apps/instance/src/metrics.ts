// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /metrics` (#791): a small set of numbers in the Prometheus text format,
 * served only when the operator turns it on (`OYL_INSTANCE_METRICS=on`).
 *
 * | Metric | Labels |
 * |---|---|
 * | `oyl_room_connected_riders` | `worker` |
 * | `oyl_rooms` | `worker` |
 * | `oyl_room_tick_lateness_ms` | `worker`, `quantile` (0.5, 0.99) — spike 0013's first thing to fail at saturation |
 * | `oyl_room_worker_resident_bytes` | `worker` |
 * | `oyl_room_refusals_total` | `worker`, `reason` (`close-codes.ts`'s reasons) |
 * | `oyl_http_requests_total` | `route` (the PATTERN, `/v1/rooms/{roomId}/ticket`), `status` |
 * | `oyl_http_refusals_total` | `route`, `reason` (the error code, `errors.ts`) |
 *
 * ⚠️ **No label is ever an athlete id, a display name, a room id or a
 * coordinate.** A label value is only ever one of: a route PATTERN from the
 * route table, a status number, an error code or close reason from a fixed
 * list, a worker's index, or a quantile. {@link labelValue} refuses anything
 * else outright rather than escaping it, and `instance.test.ts` scrapes the
 * endpoint after a populated fixture and greps for each. "Sync requests" are
 * `oyl_http_requests_total` over the `/v1/` routes: the sync API itself is
 * #776's, and its routes will be counted here by pattern with no edit.
 */

export interface WorkerNumbers {
  readonly index: number;
  readonly connectedRiders: number;
  readonly rooms: number;
  readonly tickLatenessP50Ms: number | null;
  readonly tickLatenessP99Ms: number | null;
  readonly rssBytes: number;
  readonly refusals: Readonly<Record<string, number>>;
}

/** A label value this module is willing to write: a pattern, a code, a number. */
const SAFE_LABEL = /^[A-Za-z0-9_./{}-]{1,80}$/;

export function labelValue(value: string | number): string {
  const text = String(value);
  if (!SAFE_LABEL.test(text)) throw new RangeError('not a label value this endpoint writes');
  return text;
}

/** The HTTP side's counters, fed by the handler as each response goes out. */
export class HttpCounters {
  readonly #requests = new Map<string, number>();
  readonly #refusals = new Map<string, number>();

  /** `route` is the matched PATTERN, or `null` for no route (counted as `none`). */
  observe(route: string | null, status: number, code: string | undefined): void {
    const pattern = route ?? 'none';
    const key = `${pattern} ${String(status)}`;
    this.#requests.set(key, (this.#requests.get(key) ?? 0) + 1);
    if (code !== undefined) {
      const refusal = `${pattern} ${code}`;
      this.#refusals.set(refusal, (this.#refusals.get(refusal) ?? 0) + 1);
    }
  }

  requests(): ReadonlyMap<string, number> {
    return this.#requests;
  }

  refusals(): ReadonlyMap<string, number> {
    return this.#refusals;
  }
}

function line(name: string, labels: Readonly<Record<string, string | number>>, value: number) {
  const rendered = Object.entries(labels)
    .map(([key, v]) => `${key}="${labelValue(v)}"`)
    .join(',');
  return `${name}{${rendered}} ${String(value)}`;
}

/** The whole document. A label value that is not safe throws, and the endpoint answers 500. */
export function renderMetrics(workers: readonly WorkerNumbers[], http: HttpCounters): string {
  const out: string[] = [];
  const gauge = (name: string, help: string) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
  };
  const counter = (name: string, help: string) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
  };

  gauge('oyl_room_connected_riders', 'Riders with a connected socket, per room worker.');
  for (const w of workers)
    out.push(line('oyl_room_connected_riders', { worker: w.index }, w.connectedRiders));
  gauge('oyl_rooms', 'Rooms open, per room worker.');
  for (const w of workers) out.push(line('oyl_rooms', { worker: w.index }, w.rooms));
  gauge('oyl_room_tick_lateness_ms', 'How late a room tick ran, per room worker.');
  for (const w of workers) {
    for (const [quantile, value] of [
      ['0.5', w.tickLatenessP50Ms],
      ['0.99', w.tickLatenessP99Ms],
    ] as const) {
      if (value !== null) {
        out.push(line('oyl_room_tick_lateness_ms', { worker: w.index, quantile }, value));
      }
    }
  }
  gauge('oyl_room_worker_resident_bytes', 'Resident memory of each room worker process.');
  for (const w of workers)
    out.push(line('oyl_room_worker_resident_bytes', { worker: w.index }, w.rssBytes));
  counter('oyl_room_refusals_total', 'Room sockets refused or let go, by reason.');
  for (const w of workers) {
    for (const [reason, count] of Object.entries(w.refusals)) {
      out.push(line('oyl_room_refusals_total', { worker: w.index, reason }, count));
    }
  }
  counter('oyl_http_requests_total', 'HTTP requests, by route pattern and status.');
  for (const [key, count] of http.requests()) {
    const [route = 'none', status = '0'] = key.split(' ');
    out.push(line('oyl_http_requests_total', { route, status }, count));
  }
  counter('oyl_http_refusals_total', 'HTTP requests refused, by route pattern and error code.');
  for (const [key, count] of http.refusals()) {
    const [route = 'none', reason = 'unknown'] = key.split(' ');
    out.push(line('oyl_http_refusals_total', { route, reason }, count));
  }
  return `${out.join('\n')}\n`;
}
