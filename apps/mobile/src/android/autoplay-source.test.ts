// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The autoplay plugin answers from the WebView's own setting, and the activity
 * keeps that setting off — #2357.
 *
 * CI does not build Android, so this reads the source, as
 * `secure-window-source.test.ts` does. It proves the calls are written, not
 * that a tablet plays the menus' loop with no tap: that is #2357's adb check.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');
const plugin = readFileSync(join(SOURCE, 'AutoplayPlugin.java'), 'utf8');
const activity = readFileSync(join(SOURCE, 'MainActivity.java'), 'utf8');
/** A source without its comments, which name what the code does. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

describe('AutoplayPlugin (#2357)', () => {
  it('is the plugin the web side registers, by name, with one method', () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "Autoplay")');
    expect(plugin).toMatch(/public void allowed\(PluginCall call\)/);
    expect(plugin.match(/@PluginMethod/g)).toHaveLength(1);
  });

  it('answers `allowed` as the negation of the WebView’s own setting, on the UI thread', () => {
    const body = code(plugin);
    const onUi = body.indexOf('runOnUiThread(');
    expect(onUi).toBeGreaterThan(0);
    const read = body.indexOf(
      'answer.put("allowed", !webView.getSettings().getMediaPlaybackRequiresUserGesture());',
    );
    expect(read).toBeGreaterThan(onUi);
    expect(body.indexOf('call.resolve(answer)', read)).toBeGreaterThan(read);
  });

  it('reads nothing a page sends, and changes no setting', () => {
    expect(plugin).not.toMatch(/call\.get(String|Int|Boolean|Object|Array|Data)\(/);
    expect(code(plugin)).not.toContain('.set');
  });
});

describe('MainActivity keeps media playback free of a gesture (#2357)', () => {
  it('turns the WebView’s gesture requirement off, inside the guard that has a WebView', () => {
    const body = code(activity);
    const guard = body.indexOf('if (bridge != null && bridge.getWebView() != null) {');
    expect(guard).toBeGreaterThan(0);
    const set = body.indexOf(
      'bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);',
    );
    expect(set).toBeGreaterThan(guard);
    expect(set).toBeLessThan(body.indexOf('}', guard));
    expect(body).not.toContain('setMediaPlaybackRequiresUserGesture(true)');
  });
});
