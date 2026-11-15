// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The music player plugin sends the four media keys it is named for, and
 * reads nothing of what is playing — #2073, spike 0034 and the owner's rulings
 * of 2026-11-05 (controls only; no Notification access, no title).
 *
 * CI does not build Android, so this reads the source, as
 * `secure-window-source.test.ts` does. It proves the calls are written, not
 * that a player obeys them: that is spike 0034 §7's device rows, proposed for
 * the owner's list (#733).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { OtherPlayerKey } from '../other-player/other-player';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');
const plugin = readFileSync(join(SOURCE, 'OtherPlayerPlugin.java'), 'utf8');
/** The source without its comments, which name what the plugin does NOT use. */
const code = plugin.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

/** Each key the TypeScript side sends, and the explicit key code it must become. */
const KEYS: readonly (readonly [OtherPlayerKey, string])[] = [
  ['play', 'KEYCODE_MEDIA_PLAY'],
  ['pause', 'KEYCODE_MEDIA_PAUSE'],
  ['next', 'KEYCODE_MEDIA_NEXT'],
  ['previous', 'KEYCODE_MEDIA_PREVIOUS'],
];

/** The body of `keyCodeFor`, the one place a name becomes a key code. */
function keyCodeFor(): string {
  const start = plugin.indexOf('static int keyCodeFor(String key)');
  expect(start).toBeGreaterThan(0);
  return plugin.slice(start, plugin.indexOf('\n    }\n', start));
}

describe('OtherPlayerPlugin (#2073)', () => {
  it('is the plugin the web side registers, by name', () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "OtherPlayer")');
  });

  it('has the two methods the TypeScript side calls, and no other', () => {
    expect(plugin).toMatch(/@PluginMethod\s+public void sendKey\(PluginCall call\)/);
    expect(plugin).toMatch(/@PluginMethod\s+public void otherAudioActive\(PluginCall call\)/);
    expect(plugin.match(/@PluginMethod/g)).toHaveLength(2);
  });

  it.each(KEYS)('maps %s to %s, the explicit key rather than the toggle', (key, keyCode) => {
    expect(keyCodeFor()).toContain(
      `if ("${key}".equals(key)) {\n            return KeyEvent.${keyCode};`,
    );
  });

  it('maps no other name, and refuses one before any key is sent', () => {
    const body = keyCodeFor();
    expect(body.match(/return KeyEvent\./g)).toHaveLength(KEYS.length);
    expect(body).not.toContain('KEYCODE_MEDIA_PLAY_PAUSE');
    expect(body.trimEnd().endsWith('return 0;')).toBe(true);
    const refused = plugin.indexOf('call.reject("unknown media key")');
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(plugin.indexOf('dispatchMediaKeyEvent('));
  });

  it('sends the key down and then up, through dispatchMediaKeyEvent', () => {
    const down = plugin.indexOf(
      'dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode))',
    );
    const up = plugin.indexOf('dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode))');
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down);
    expect(plugin.indexOf('call.resolve()', up)).toBeGreaterThan(up);
  });

  it('answers whether music is active, as one boolean and nothing else', () => {
    expect(plugin).toContain('reply.put("active", audio != null && audio.isMusicActive())');
    expect(plugin.match(/reply\.put\(/g)).toHaveLength(1);
  });

  it('reads one argument, the key, and nothing of what another app is playing', () => {
    expect(plugin.match(/call\.get(String|Int|Boolean|Object|Array|Data)\(/g)).toStrictEqual([
      'call.getString(',
    ]);
    expect(plugin).toContain('call.getString("key")');
    // Non-vacuity: the comment-stripped source still holds the code.
    expect(code).toContain('dispatchMediaKeyEvent(');
    for (const reader of [
      'MediaSessionManager',
      'MediaController',
      'NotificationListenerService',
      'MediaMetadata',
      'getActiveSessions',
      'getPackageName',
    ]) {
      expect(code).not.toContain(reader);
    }
  });
});
