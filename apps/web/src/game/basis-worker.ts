// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A transcoder that cannot start fails the load instead of hanging it** —
 * [#1683](https://github.com/openzigs/onyourleft/issues/1683) §3.
 *
 * three's `KTX2Loader` writes its worker's source out of
 * `KTX2Loader.BasisWorker.toString()`: the body of that function, after the
 * transcoder's own script, in one `blob:` worker. That body answers each
 * `transcode` message inside `transcoderPending.then(…)`, with no rejection
 * path — and `transcoderPending` only settles when Emscripten calls
 * `onRuntimeInitialized`. A transcoder that fails to start (#1683 found one
 * refused `new Function` by the demo page's policy; a corrupt `.wasm` is the
 * same shape) never calls it, so no texture is ever answered, the
 * all-or-none load in `three-renderer.ts` §`loadRealisticWorld` never
 * settles, and ADR 0026 D-7's "falls back to the stylised world and says so"
 * is never reached: the view draws the stylised world forever and says nothing.
 *
 * {@link settlingBasisWorker} appends {@link START_FAILURE_ANSWERED} to that
 * body. It answers every `transcode` the start left unanswered with the
 * `{ type: 'error' }` message three's own failed transcode sends, which
 * `KTX2Loader` turns into a rejected texture — so the load fails, and says
 * why. It wraps `BASIS`, the transcoder script's own global, so it sees the
 * start from the inside: `onRuntimeInitialized` is the start succeeding, and
 * `BASIS` throwing or the promise it returns rejecting (Emscripten's
 * `readyPromiseReject`, which nobody else holds) is it failing. An error or an
 * unhandled rejection that reaches the worker before the start is a failure
 * too. Once the transcoder has started it says nothing more, so a worker
 * never answers a message twice.
 *
 * ⚠️ **It reads none of three's worker's own names**, because the product's
 * bundle minifies them: #1683's first version read `transcoderPending`, which
 * a minified build calls something else, and the demo's browser gate went red
 * on `ReferenceError: transcoderPending is not defined`. What it reads is what
 * a minifier leaves alone — the globals `self` and `BASIS`, Emscripten's
 * `onRuntimeInitialized`, and the message shapes `transcode` and `error`.
 * `basis-worker.test.ts` runs the installed `three`'s own body with it
 * appended, and `browser/demo-world.browser.spec.ts` the built page.
 */

/**
 * Appended to three's worker body. Plain script, in a worker — no module, no
 * `import`, and every name `oyl`-prefixed so none meets one of three's.
 */
export const START_FAILURE_ANSWERED = `
/* #1683: a transcoder that cannot start answers every transcode with an error. */
let oylStarted = false;
let oylStartFailure;
// One entry per message, not a set: three's messages carry no id.
let oylWaiting = [];
const oylAnswer = (id) => {
  self.postMessage({ type: 'error', id, error: oylStartFailure, data: {} });
};
const oylFailed = (reason) => {
  if (oylStarted || oylStartFailure !== undefined) return;
  oylStartFailure =
    'The texture transcoder could not start: ' + String((reason && reason.message) || reason);
  for (const id of oylWaiting) oylAnswer(id);
  oylWaiting = [];
};
const oylBasis = BASIS;
BASIS = (module) => {
  const started = module.onRuntimeInitialized;
  module.onRuntimeInitialized = () => {
    oylStarted = oylStartFailure === undefined;
    oylWaiting = [];
    started();
  };
  let ready;
  try {
    ready = oylBasis(module);
  } catch (error) {
    oylFailed(error);
    return undefined;
  }
  if (ready && typeof ready.then === 'function') ready.then(undefined, oylFailed);
  return ready;
};
self.addEventListener('error', (event) => {
  oylFailed(event.error || event.message);
});
self.addEventListener('unhandledrejection', (event) => {
  oylFailed(event.reason);
});
self.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type !== 'transcode' || oylStarted) return;
  if (oylStartFailure === undefined) oylWaiting.push(message.id);
  else oylAnswer(message.id);
});
`;

/** Marks a worker function this module has already wrapped. */
const SETTLES = Symbol('oyl.basis-worker-settles');

type WorkerFunction = (() => void) & { [SETTLES]?: true };

/**
 * `worker`, whose `toString` is its own source with
 * {@link START_FAILURE_ANSWERED} as the last thing in its body — the shape
 * `KTX2Loader` slices between the first `{` and the last `}`. Never called:
 * three only ever reads its source. Wrapping it twice returns it unchanged.
 */
export function settlingBasisWorker(worker: () => void): () => void {
  if ((worker as WorkerFunction)[SETTLES] === true) return worker;
  const source = worker.toString();
  const end = source.lastIndexOf('}');
  const text = `${source.slice(0, end)}\n${START_FAILURE_ANSWERED}\n${source.slice(end)}`;
  const wrapped: WorkerFunction = () => {
    throw new Error('the Basis worker is a source for a blob: worker, never called (#1683)');
  };
  wrapped.toString = () => text;
  wrapped[SETTLES] = true;
  return wrapped;
}
