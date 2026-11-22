// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world street graph's worker** — #2990. `graph-build.ts` says
 * what it does and why it is here: this file only hands each message to that
 * module's {@link graphWorkerCore} and posts the reply. Nothing is fetched,
 * stored or logged.
 *
 * @unwired A dedicated worker is a **second entry point**: Vite bundles it
 * from the `new Worker(new URL('./graph-worker.ts', import.meta.url))` in
 * `graph-build.ts` §`realGraphWorker`, and the page reaches it through that
 * URL rather than an import, so `check:wiring`'s walk from `index.html` can
 * never reach it (`docs/agents/wiring-gate.md` on `offline/sw.ts`). What it
 * runs is `graphWorkerCore`, which the page's own fallback runs too, so that
 * is wired; `graph-worker.test.ts` drives this file.
 */

import { graphWorkerCore, type GraphReply } from './graph-build';

/** The slice of a dedicated worker's scope this file uses. */
interface GraphWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: GraphReply): void;
}

const scope = globalThis as unknown as GraphWorkerScope;
const core = graphWorkerCore();

scope.onmessage = ({ data }) => {
  const reply = core.handle(data);
  if (reply !== undefined) scope.postMessage(reply);
};
