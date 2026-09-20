// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Evaluate one expression inside the shell's WebView, over adb, and print what
 * it returned ([#410](https://github.com/openzigs/onyourleft/issues/410)).
 *
 * ## What this is for
 *
 * `docs/validation/0002-android-shell-and-game.md` Part P has to answer four
 * questions that are invisible from outside the WebView: the origin the client
 * is served from, whether `crypto.subtle` is reachable, whether any service
 * worker is registered (ADR 0024 D-4 says none is), and which assets a render
 * actually fetched. A screenshot answers none of them and `adb logcat` answers
 * only the last one, and only for the requests Capacitor's own local server
 * logs.
 *
 * ⚠️ **It asks nothing. The questions live in the validation document**, as
 * expressions a reader can see and change, so that this file has no opinion to
 * go stale and nothing decidable to unit-test. It is a wire, and the reason it
 * is committed at all is that Part P's numbers are otherwise unreproducible.
 *
 * ## Why it is here rather than under `scripts/`
 *
 * `scripts/` is the bare-clone set: bash and coreutils, no install, no network,
 * no device (CLAUDE.md §2 and §4a). This needs `adb`, a physical phone with
 * developer options on, and a debuggable build — it can never be a repository
 * check, and putting it there would put something in `scripts/` that nobody can
 * run and `check:repo` does not call. It sits beside the Android project whose
 * WebView it talks to.
 *
 * ## Use
 *
 * ```bash
 * ADB=/path/to/platform-tools/adb
 * PID=$("$ADB" shell pidof dev.openzigs.onyourleft)
 * "$ADB" forward tcp:9222 localabstract:webview_devtools_remote_"$PID"
 * node apps/mobile/tools/webview-probe.mjs 'location.origin'
 * ```
 *
 * The expression may be an `async` IIFE; its promise is awaited and its value
 * is returned by value, so it has to be JSON-serialisable. `OYL_DEVTOOLS_PORT`
 * overrides the forwarded port.
 *
 * ⚠️ **This is a debugger.** It only attaches to a build whose WebView has
 * `setWebContentsDebuggingEnabled(true)`, which Capacitor sets for a debug
 * build and not for a release one — so it cannot be pointed at a shipped app,
 * and that is a property of the platform rather than a promise made here.
 */

const port = process.env.OYL_DEVTOOLS_PORT ?? '9222';
const expression = process.argv[2];

if (expression === undefined) {
  console.error('usage: node apps/mobile/tools/webview-probe.mjs <expression>');
  process.exit(2);
}

/** The DevTools targets the forwarded socket is offering. */
let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
} catch (cause) {
  console.error(
    `no DevTools endpoint on 127.0.0.1:${port}. Is the adb forward up, and is the app running?`,
    cause,
  );
  process.exit(1);
}

const page = targets.find((target) => target.type === 'page');
if (page === undefined) {
  console.error('no page target. Targets seen:', JSON.stringify(targets, undefined, 1));
  process.exit(1);
}
console.error(`probing ${page.url}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

const answer = await new Promise((resolve, reject) => {
  socket.onmessage = (message) => {
    const frame = JSON.parse(message.data);
    if (frame.id === 1) resolve(frame);
  };
  socket.onerror = reject;
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  );
});
socket.close();

// An expression that threw comes back as a successful CDP call carrying an
// exception, which is the one failure mode a caller would otherwise read as a
// result. It gets a non-zero exit of its own.
if (answer.result?.exceptionDetails !== undefined) {
  console.error(JSON.stringify(answer.result.exceptionDetails, undefined, 2));
  process.exit(1);
}

console.log(JSON.stringify(answer.result?.result?.value, undefined, 2));
