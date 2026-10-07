// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { setCapacitorSecureWindow, type SecureWindowPlugin } from './secure-window';

function scripted(): { readonly plugin: SecureWindowPlugin; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    plugin: {
      secure: () => {
        calls.push('secure');
        return Promise.resolve();
      },
      clear: () => {
        calls.push('clear');
        return Promise.resolve();
      },
    },
  };
}

describe('the secure window flag through the shell’s plugin — #1061, ADR 0044 D-12', () => {
  it('sets the flag when asked for a secure window', async () => {
    const { plugin, calls } = scripted();
    await setCapacitorSecureWindow(plugin, true);
    expect(calls).toStrictEqual(['secure']);
  });

  it('clears it when asked for an ordinary one', async () => {
    const { plugin, calls } = scripted();
    await setCapacitorSecureWindow(plugin, false);
    expect(calls).toStrictEqual(['clear']);
  });

  it('passes a plugin that is not there on, for the web side to swallow', async () => {
    const missing: SecureWindowPlugin = {
      secure: () => Promise.reject(new Error('not implemented')),
      clear: () => Promise.reject(new Error('not implemented')),
    };
    await expect(setCapacitorSecureWindow(missing, true)).rejects.toThrow('not implemented');
  });
});
