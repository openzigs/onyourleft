// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `triggerEvent` `TypeError` at app launch, and why it is harmless — #480.
 *
 * On the Pixel Tablet (2026-09-22, main `89a5d9b`, debug APK) the WebView
 * logged `Uncaught TypeError: Cannot read properties of undefined (reading
 * 'triggerEvent')` twice within the first second of launching the app, before
 * anything navigated to a harness page. #478 had blamed the realistic harness
 * page for it, and the page then reported Capacitor's bridge present.
 *
 * ## Where the call comes from — read out of Capacitor 8.5.2's own source
 *
 * The only code in the shell that evaluates `window.Capacitor.triggerEvent` in
 * a page is `MockCordovaWebViewImpl.triggerDocumentEvent`, and its only callers
 * are `handlePause` (`"pause"`) and `handleResume` (`"resume"`, and only once
 * the activity has paused). `Bridge.triggerJSEvent` and its four wrappers are
 * public API that nothing inside Capacitor calls, and no plugin this app
 * installs calls them either. So two errors are a PAUSE and a RESUME.
 *
 * `eval` posts `webView.evaluateJavascript(…)` to the main looper, to run
 * against whatever document the WebView holds when it gets there. The bridge
 * is injected with `addDocumentStartJavaScript` for the app's origin only, and
 * the harness page shows that injection working on a same-origin page. So a
 * `window` with no `Capacitor` on it, in the first second, is a document that
 * is NOT the app's: the WebView's initial blank document, before `loadUrl`'s
 * navigation has committed. The activity paused and resumed at launch — a
 * keyguard, a configuration change, a system dialog — before the app's page
 * existed.
 *
 * ## Why it is harmless
 *
 * The event is dispatched at a document that is thrown away when the app's page
 * commits, and nothing in this client listens for Capacitor's `pause` or
 * `resume` document events in any case: the one screen that cares about being
 * backgrounded reads `visibilitychange` (`support/useShellSupport.ts`), which
 * the WebView fires on the page it actually has. Lost at launch, the two
 * events would have reached nobody on the app's page either. The Cordova
 * plugin manager's own `onPause`/`onResume` run in Java before the `eval` and
 * are unaffected.
 *
 * ⚠️ **Both halves are asserted, because each is a premise that can move.** A
 * Capacitor bump that sent a lifecycle event some OTHER way, or a screen here
 * that started listening for `pause`/`resume`, would turn "harmless" into "a
 * rider's event is lost at launch", and nothing else here would notice.
 *
 * ⚠️ **What only the device can confirm**: that the two errors sit beside an
 * `onPause`/`onResume` of `MainActivity` in `adb logcat -b events` (the
 * `wm_on_paused_called` and `wm_on_resume_called` lines), and that the console
 * line's `source:` is not `https://localhost/…`. Validation 0002 Part Z says
 * how to read both.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const CAPACITOR_JAVA = join(
  dirname(require.resolve('@capacitor/android/package.json')),
  'capacitor',
  'src',
  'main',
  'java',
);
const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every file under `root` whose name satisfies `keep`. */
function filesUnder(root: string, keep: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') found.push(...filesUnder(path, keep));
    } else if (keep(name)) {
      found.push(path);
    }
  }
  return found;
}

/** Every line in `files` matching `pattern`, as `file: line`. */
function linesMatching(files: readonly string[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (pattern.test(line)) hits.push(`${file.slice(file.lastIndexOf('/') + 1)}: ${line.trim()}`);
    }
  }
  return hits;
}

describe('the lifecycle events the shell sends a page — #480', () => {
  const java = filesUnder(CAPACITOR_JAVA, (name) => name.endsWith('.java'));

  it('reads Capacitor’s own Android sources, not an empty directory', () => {
    // Without this, every assertion below passes over a renamed tree.
    expect(java.length).toBeGreaterThan(50);
  });

  it('evaluates triggerEvent in two places, and only one of them is ever called', () => {
    expect(linesMatching(java, /Capacitor\.triggerEvent\(/)).toEqual([
      'Bridge.java: eval("window.Capacitor.triggerEvent(\\"" + eventName + "\\", \\"" + target + "\\")", (s) -> {});',
      'Bridge.java: eval("window.Capacitor.triggerEvent(\\"" + eventName + "\\", \\"" + target + "\\", " + data + ")", (s) -> {});',
      'MockCordovaWebViewImpl.java: eval("window.Capacitor.triggerEvent(\'" + eventName + "\', \'document\');", (s) -> {});',
    ]);
    // `Bridge`'s are public API with no caller but each other.
    const bridgeCallers = linesMatching(java, /trigger(JS|WindowJS|DocumentJS)Event\(/).filter(
      (line) => !/public void/.test(line),
    );
    expect(bridgeCallers).toEqual([
      'Bridge.java: this.triggerJSEvent(eventName, "window");',
      'Bridge.java: this.triggerJSEvent(eventName, "window", data);',
      'Bridge.java: this.triggerJSEvent(eventName, "document");',
      'Bridge.java: this.triggerJSEvent(eventName, "document", data);',
    ]);
  });

  it('is called by no plugin this app installs, and not by the app’s own Java', () => {
    const others = [
      join(
        dirname(require.resolve('@capacitor-community/bluetooth-le/package.json')),
        'android',
        'src',
        'main',
      ),
      join(REPOSITORY, 'apps/mobile/android/app/src/main/java'),
    ].flatMap((root) => filesUnder(root, (name) => /\.(java|kt)$/.test(name)));
    expect(others.length).toBeGreaterThan(3);
    expect(
      linesMatching(others, /triggerEvent|trigger(JS|WindowJS|DocumentJS)Event|evaluateJavascript/),
    ).toEqual([]);
  });

  it('sends a page "pause" and "resume" and nothing else', () => {
    expect(
      linesMatching(java, /triggerDocumentEvent\(/).filter((line) => !/public void/.test(line)),
    ).toEqual([
      'MockCordovaWebViewImpl.java: triggerDocumentEvent("pause");',
      'MockCordovaWebViewImpl.java: triggerDocumentEvent("resume");',
    ]);
  });

  it('is sent to nobody in this client: no screen listens for pause or resume', () => {
    const sources = [join(REPOSITORY, 'apps/web/src'), join(REPOSITORY, 'apps/mobile/src')].flatMap(
      (root) => filesUnder(root, (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)),
    );
    expect(sources.length).toBeGreaterThan(100);
    expect(linesMatching(sources, /addEventListener\(\s*['"`](pause|resume)['"`]/)).toEqual([]);
  });
});
