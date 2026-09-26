// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The pose worker's network fence, as a module of its own** — #530.
 *
 * Imported FIRST by `pose-worker.ts`, and for that reason alone a separate
 * file: a module's imports are evaluated before its own statements, so a call
 * at the top of the worker would run after MediaPipe had already been
 * evaluated. An import placed before MediaPipe's runs before it.
 *
 * `pose-runtime.ts` §`fenceWorkerNetwork` is the rule and says why it exists:
 * the runtime posts usage logs to a Google host every sixty seconds unless it
 * is stopped.
 */

import { fenceWorkerNetwork, type FencedRequestPrototype, type FencedScope } from './pose-runtime';

/** The two globals the fence narrows, read as members of the worker's own scope. */
const scope = globalThis as unknown as FencedScope & {
  readonly XMLHttpRequest?: { readonly prototype: FencedRequestPrototype };
};

fenceWorkerNetwork(scope, scope.XMLHttpRequest?.prototype);
