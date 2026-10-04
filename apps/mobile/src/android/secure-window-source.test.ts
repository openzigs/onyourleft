// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The secure window plugin sets and clears the flag it is named for, on the
 * UI thread, and nothing else — #1061, ADR 0044 D-12.
 *
 * CI does not build Android, so this reads the source, as
 * `recording-service-source.test.ts` and `plugin-registration.test.ts` do. It
 * proves the calls are written, not that a device's recents thumbnail is
 * blank: that is a check on the owner's device list (#733).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');
const plugin = readFileSync(join(SOURCE, 'SecureWindowPlugin.java'), 'utf8');

describe('SecureWindowPlugin (#1061, ADR 0044 D-12)', () => {
  it('is the plugin the web side registers, by name', () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "SecureWindow")');
  });

  it('adds FLAG_SECURE in `secure` and clears it in `clear`, and has no other method', () => {
    expect(plugin).toMatch(/public void secure\(PluginCall call\)\s*\{\s*change\(call, true\)/);
    expect(plugin).toMatch(/public void clear\(PluginCall call\)\s*\{\s*change\(call, false\)/);
    expect(plugin).toContain('getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE)');
    expect(plugin).toContain('getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE)');
    expect(plugin.match(/@PluginMethod/g)).toHaveLength(2);
  });

  it('changes the window on the UI thread, and answers only once it has', () => {
    const onUi = plugin.indexOf('runOnUiThread(');
    expect(onUi).toBeGreaterThan(0);
    expect(plugin.indexOf('addFlags(', onUi)).toBeGreaterThan(onUi);
    expect(plugin.indexOf('call.resolve()', onUi)).toBeGreaterThan(
      plugin.indexOf('clearFlags(', onUi),
    );
  });

  it('reads nothing a page sends', () => {
    expect(plugin).not.toMatch(/call\.get(String|Int|Boolean|Object|Array|Data)\(/);
  });
});
