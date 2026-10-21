// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `MainActivity` takes Android's back and asks the page first — #1512.
 *
 * CI does not build Android, so this reads the source, as
 * `secure-window-source.test.ts` and `plugin-registration.test.ts` do. It
 * proves the callback is written, registered and calls the function the page
 * installs, by the name `apps/web/src/shell/android-back.ts` exports —
 * imported by a relative path, app to app, for `night-colours.test.ts`'
 * reason. Whether a device's back behaves is a check on the owner's list
 * (#733); `apps/web/src/shell/android-back.test.tsx` holds what the page does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ANDROID_BACK_GLOBAL } from '../../../web/src/shell/android-back';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');
const activity = readFileSync(join(SOURCE, 'MainActivity.java'), 'utf8');

describe('MainActivity asks the page about back (#1512)', () => {
  it('registers a back callback with the dispatcher, after the bridge is built', () => {
    const registered = activity.indexOf(
      'getOnBackPressedDispatcher().addCallback(this, new AskThePage(',
    );
    expect(registered).toBeGreaterThan(activity.indexOf('super.onCreate('));
    expect(activity).toMatch(/class AskThePage extends OnBackPressedCallback/);
    expect(activity).toMatch(/AskThePage\(WebView webView\)\s*\{\s*super\(true\);/);
  });

  it('calls the function the page installs, with the WebView’s own canGoBack', () => {
    expect(activity).toContain(`window.${ANDROID_BACK_GLOBAL}`);
    expect(activity).toContain('webView.canGoBack() ? "true" : "false"');
    expect(activity).toContain('webView.evaluateJavascript(');
  });

  it('stays only on a literal true, and otherwise reaches Android’s default', () => {
    expect(activity).toContain(')===true;}catch(e){return false;}');
    expect(activity).toMatch(/if \(!"true"\.equals\(answer\)\)\s*\{\s*leave\(\);/);
    expect(activity).toMatch(
      /setEnabled\(false\);\s*getOnBackPressedDispatcher\(\)\.onBackPressed\(\);\s*setEnabled\(true\);/,
    );
  });
});
