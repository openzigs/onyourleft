// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AUTOPLAY_CALL_DEADLINE_MILLISECONDS,
  capacitorAutoplayAllowed,
  type AutoplayPlugin,
} from './autoplay';

afterEach(() => {
  vi.useRealTimers();
});

function answering(reply: unknown): AutoplayPlugin {
  return { allowed: () => Promise.resolve(reply as { allowed: boolean }) };
}

describe('whether the shell’s WebView lets media start with no press — #2357', () => {
  it('is yes only when the plugin says exactly that', async () => {
    await expect(capacitorAutoplayAllowed(answering({ allowed: true }))).resolves.toBe(true);
    for (const reply of [{ allowed: false }, { allowed: 'true' }, { allowed: 1 }, {}, null]) {
      await expect(capacitorAutoplayAllowed(answering(reply))).resolves.toBe(false);
    }
  });

  it('is no for a refused or missing plugin', async () => {
    const missing: AutoplayPlugin = { allowed: () => Promise.reject(new Error('not implemented')) };
    await expect(capacitorAutoplayAllowed(missing)).resolves.toBe(false);
  });

  it('is no for an answer that never comes, at the deadline and not before', async () => {
    vi.useFakeTimers();
    const wedged: AutoplayPlugin = { allowed: () => new Promise(() => undefined) };
    let answer: boolean | undefined;
    void capacitorAutoplayAllowed(wedged).then((allowed) => {
      answer = allowed;
    });
    await vi.advanceTimersByTimeAsync(AUTOPLAY_CALL_DEADLINE_MILLISECONDS - 1);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBe(false);
  });
});
