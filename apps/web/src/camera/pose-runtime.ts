// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the pose model's files are, what the worker may reach, and what it
 * says back** — [#530](https://github.com/openzigs/onyourleft/issues/530).
 *
 * Pure, so every rule the pose worker (`pose-worker.ts`) runs under is tested
 * in jsdom; the worker itself is a few lines that call these and MediaPipe,
 * and its only gate is `browser/pose.browser.spec.ts`, in a real engine.
 *
 * ## Where the files are: this app's own origin, and nowhere else
 *
 * Spike 0010 §7: *"The runtime and the weights must be served from the app's
 * own origin. They must never be fetched from a CDN […] or from the guide's
 * `storage.googleapis.com/…/latest/` model URLs."* So:
 *
 * - the weights are committed at `apps/web/public/pose/` with a pinned digest
 *   in `ASSETS.toml` (ADR 0031 D-1), and Vite copies them to `dist/pose/`;
 * - the WebAssembly runtime is copied out of the pinned `@mediapipe/tasks-vision`
 *   into `dist/pose/` by `tools/pose/pose-runtime-plugin.ts`, and served from
 *   the same place by the development server;
 * - `tools/precache/precache.ts` excludes `pose/` from the precache, so a rider
 *   who never pairs a side camera never downloads about 17 MB of model and
 *   runtime (spike 0010 §7's warning, and ADR 0026 D-7's trade).
 *
 * ## ⚠️ The runtime reports usage to Google unless it is stopped, and it is stopped here
 *
 * **Found while building #530, and not in spike 0010.** `@mediapipe/tasks-vision`
 * 1.0.1 constructs a usage logger with every task (`vision_bundle.mjs`, the
 * class that posts to `https://odml.pa.googleapis.com/v1/log` with an
 * `x-goog-api-key` read out of the WebAssembly module). It records the task,
 * the running mode, the platform and per-inference timings, and flushes them
 * by `fetch` every sixty seconds and when the task is closed. The package's own
 * description says *"See the privacy notice at https://goo.gle/mediapipe-privacy"*.
 * That request carries no picture, but it is a request to a third party that
 * the privacy policy's first sentence says this app never makes.
 *
 * {@link fenceWorkerNetwork} is the answer: before MediaPipe is imported, the
 * worker's own `fetch` and `XMLHttpRequest` are replaced by ones that refuse
 * every URL whose origin is not the worker's own. The model file and the
 * runtime are same-origin, so they load; the logger's first flush is refused,
 * which MediaPipe records as a failed send and stops trying. It is a fence
 * rather than a configuration because the package offers no switch to turn
 * the logger off — only `enableLogging`.
 *
 * `browser/pose.browser.spec.ts` holds this in a real engine: it loads the
 * model, analyses a picture, closes the task (which flushes the log) and
 * asserts that no request left the page's own origin.
 */

import type { SidePoseOutcome } from './side-analysis-port';
import { POSE_DIRECTORY } from './pose-files';
import { sidePoseFromModel } from './pose-landmarks';

export { POSE_DIRECTORY, POSE_MODEL_FILE, POSE_RUNTIME_WASM_FILE } from './pose-files';

/** A pose file's URL, under `base` — `import.meta.env.BASE_URL` in production. */
export function poseAssetUrl(file: string, base: string, origin: string): string {
  return new URL(`${base}${POSE_DIRECTORY}${file}`, origin).href;
}

/** Whether `url`, read against `origin`, is on `origin`. Anything unparsable is not. */
export function onOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

/** The slice of a worker's global scope {@link fenceWorkerNetwork} replaces. */
export interface FencedScope {
  /**
   * The scope's own `fetch`, typed without the platform's HTTP types —
   * `analysis-boundary.test.ts` keeps those in the one transport, and a fence
   * is not a transport: it only ever refuses.
   */
  fetch: (input: unknown, init?: unknown) => Promise<unknown>;
  readonly location: { readonly origin: string };
}

/**
 * The older request object's prototype, whose `open` the fence replaces —
 * passed rather than read off the scope, so this module names no network
 * primitive (`privacy/no-network.test.ts`); `pose-fence.ts` hands it over.
 */
export interface FencedRequestPrototype {
  open: (...args: never[]) => void;
}

/** What a refused request rejects or throws with. Names the rule, never the URL (ADR 0029 D-8). */
export const FENCED_REQUEST_MESSAGE =
  'The pose model tried to reach somewhere other than this app’s own origin, and was refused.';

/**
 * Replace `scope`'s `fetch` and `XMLHttpRequest.open` with ones that refuse
 * every URL not on `scope`'s own origin.
 *
 * Called once, first, in the worker — before MediaPipe is evaluated, so there
 * is no window in which the library holds the original. Idempotent in effect:
 * fencing twice refuses the same URLs.
 */
export function fenceWorkerNetwork(
  scope: FencedScope,
  requestPrototype: FencedRequestPrototype | undefined,
): void {
  const { origin } = scope.location;
  const original = scope.fetch.bind(scope);
  scope.fetch = async (input, init) => {
    if (!onOrigin(urlOf(input), origin)) {
      throw new TypeError(FENCED_REQUEST_MESSAGE);
    }
    return original(input, init);
  };
  const prototype = requestPrototype;
  if (prototype !== undefined) {
    const open = prototype.open as (this: unknown, method: string, url: string | URL) => void;
    prototype.open = function fencedOpen(this: unknown, ...args: never[]): void {
      const [method, url] = args as unknown as [string, string | URL];
      if (!onOrigin(String(url), origin)) {
        throw new TypeError(FENCED_REQUEST_MESSAGE);
      }
      // Every argument, so a synchronous flag and credentials go through as given.
      Reflect.apply(open, this, [method, url, ...(args as unknown[]).slice(2)]);
    };
  }
}

/**
 * The URL a `fetch` was asked for: a string, a `URL`, or a request object's
 * `url`. Anything else is `about:invalid`, which is on no origin, so the
 * fence refuses it.
 */
function urlOf(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (typeof input === 'object' && input !== null && 'url' in input) {
    const { url } = input as { readonly url: unknown };
    return typeof url === 'string' ? url : 'about:invalid';
  }
  return 'about:invalid';
}

/** What the page sends the worker: one picture, numbered. */
export interface PoseRequest {
  readonly id: number;
  readonly picture: ArrayBuffer;
}

/**
 * What the worker sends back.
 *
 * - `landmarks` — the model's 33 points as flat `x, y, visibility` triples, or
 *   an empty list when it found nobody, with the decoded picture's size.
 * - `unreadable` — the picture would not decode, or the model failed on it.
 * - `unavailable` — the model would not load.
 */
export type PoseReply =
  | {
      readonly id: number;
      readonly kind: 'landmarks';
      readonly width: number;
      readonly height: number;
      readonly values: readonly number[];
    }
  | { readonly id: number; readonly kind: 'unreadable' | 'unavailable' };

/**
 * A reply from the worker, checked, or `undefined`.
 *
 * The worker is this program's own, so a malformed reply is a fault rather
 * than an attack; it is still checked, because the alternative is a `NaN`
 * three modules later.
 */
export function poseReplyFrom(data: unknown): PoseReply | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const reply = data as Record<string, unknown>;
  const { id, kind } = reply;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
    return undefined;
  }
  if (kind === 'unreadable' || kind === 'unavailable') {
    return { id, kind };
  }
  const { width, height, values } = reply;
  if (
    kind === 'landmarks' &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    Array.isArray(values) &&
    values.every((value) => typeof value === 'number')
  ) {
    return { id, kind, width, height, values: values };
  }
  return undefined;
}

/** What a reply comes to. */
export function poseOutcomeOf(reply: PoseReply): SidePoseOutcome {
  switch (reply.kind) {
    case 'landmarks':
      return sidePoseFromModel(reply.width, reply.height, reply.values);
    case 'unreadable':
      return { kind: 'unreadable' };
    case 'unavailable':
      return { kind: 'unavailable' };
  }
}
