// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world tile plans' worker** — #2901. `tile-planner.ts` says what
 * it does and why it is here: this file only hands each message to that
 * module's {@link tilePlanWorkerCore} and posts the reply, transferring the
 * plan's buffers. Nothing is fetched, stored or logged.
 *
 * @unwired A dedicated worker is a **second entry point**: Vite bundles it
 * from the `new Worker(new URL('./tile-plan-worker.ts', import.meta.url))` in
 * `tile-planner.ts` §`realTilePlanWorker`, and the page reaches it through
 * that URL rather than an import, so `check:wiring`'s walk from `index.html`
 * can never reach it (`docs/agents/wiring-gate.md` on `offline/sw.ts`). What
 * it runs is `tilePlanWorkerCore`, which the page's own fallback runs too, so
 * that is wired; `tile-planner.test.ts` drives this file.
 */

import { tilePlanWorkerCore, type TilePlanReply } from './tile-planner';

/** The slice of a dedicated worker's scope this file uses. */
interface TilePlanWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: TilePlanReply, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as TilePlanWorkerScope;
const core = tilePlanWorkerCore();

scope.onmessage = ({ data }) => {
  const answer = core.handle(data);
  if (answer !== undefined) scope.postMessage(answer.reply, answer.transfer);
};
