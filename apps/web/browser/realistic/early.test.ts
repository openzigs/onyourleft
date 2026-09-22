// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `realistic.html`'s first script, run against a fake window — #478.
 *
 * On the owner's tablet the page logged `Uncaught TypeError: Cannot read
 * properties of undefined (reading 'triggerEvent')`: the Android shell sends
 * its lifecycle events by evaluating `window.Capacitor.triggerEvent(…)` in the
 * page, and on this page there was no `window.Capacitor`. The script is inline
 * in the HTML because it has to run before anything else, so this reads it out
 * of the HTML rather than importing it — the file the harness build ships is
 * the file under test.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { EarlyRecord } from '../realistic-harness';

const HTML = readFileSync(fileURLToPath(new URL('../realistic.html', import.meta.url)), 'utf8');

/** The early script's source, as the page carries it. */
function earlyScript(): string {
  const found = /<script id="oyl-early">([\s\S]*?)<\/script>/.exec(HTML)?.[1];
  if (found === undefined) throw new Error('realistic.html carries no early script');
  return found;
}

/** A window with only what the script touches, and what it did with it. */
function aWindow(existing: Record<string, unknown> = {}): {
  readonly window: Record<string, unknown> & { __oylRealisticEarly?: EarlyRecord };
  readonly listeners: Map<string, (event: unknown) => void>;
  readonly dispatched: string[];
  readonly logged: string[];
} {
  const listeners = new Map<string, (event: unknown) => void>();
  const dispatched: string[] = [];
  const logged: string[] = [];
  const window: Record<string, unknown> = {
    ...existing,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    dispatchEvent: (event: { type: string }) => {
      dispatched.push(`window:${event.type}`);
      return true;
    },
  };
  const document = {
    dispatchEvent: (event: { type: string }) => {
      dispatched.push(`document:${event.type}`);
      return true;
    },
  };
  const console = { log: (line: string) => logged.push(line) };
  class FakeEvent {
    constructor(readonly type: string) {}
  }
  // The page's own text, run with these four names bound to the fakes.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('window', 'document', 'console', 'Event', earlyScript()) as (
    ...globals: readonly unknown[]
  ) => void;
  run(window, document, console, FakeEvent);
  return { window, listeners, dispatched, logged };
}

describe('realistic.html’s first script — #478', () => {
  it('is the first script on the page, before the module', () => {
    expect(HTML.indexOf('id="oyl-early"')).toBeGreaterThan(0);
    expect(HTML.indexOf('id="oyl-early"')).toBeLessThan(HTML.indexOf('type="module"'));
  });

  it('takes a lifecycle event the shell sends to a page with no bridge, instead of throwing', () => {
    const page = aWindow({ androidBridge: {} });
    const capacitor = page.window['Capacitor'] as {
      triggerEvent: (name: string, target: string) => boolean;
    };
    // What Capacitor's `MockCordovaWebViewImpl.handleResume` evaluates.
    expect(() => capacitor.triggerEvent('resume', 'document')).not.toThrow();
    const early = page.window.__oylRealisticEarly;
    expect(early?.capacitorAtStart).toBe('undefined');
    expect(early?.androidBridgeAtStart).toBe('object');
    expect(early?.standIn).toBe(true);
    expect(early?.events).toEqual([{ event: 'resume', target: 'document' }]);
    // …still delivered as the bridge would deliver it, and put where logcat reads.
    expect(page.dispatched).toEqual(['document:resume']);
    expect(page.logged).toEqual(['OYL-REALISTIC-BRIDGE {"event":"resume","target":"document"}']);
  });

  it('leaves a bridge that IS there alone, and says it was there', () => {
    const bridge = { isNativePlatform: () => true, triggerEvent: () => true };
    const page = aWindow({ Capacitor: bridge });
    expect(page.window['Capacitor']).toBe(bridge);
    expect(page.window.__oylRealisticEarly?.capacitorAtStart).toBe('object');
    expect(page.window.__oylRealisticEarly?.standIn).toBe(false);
  });

  it('stands in for triggerEvent ONLY, so the page is not mistaken for the shell', () => {
    const page = aWindow();
    const standIn = page.window['Capacitor'] as Record<string, unknown>;
    expect(Object.keys(standIn)).toEqual(['triggerEvent']);
  });

  it('buffers an error from before the module runs, and hands later ones to the module', () => {
    const page = aWindow();
    const onError = page.listeners.get('error');
    const onRejection = page.listeners.get('unhandledrejection');
    expect(onError).toBeDefined();
    expect(onRejection).toBeDefined();
    const thrown = new TypeError("Cannot read properties of undefined (reading 'x')");
    onError?.({ error: thrown, message: thrown.message });
    onRejection?.({ reason: new Error('a load') });
    const early = page.window.__oylRealisticEarly as EarlyRecord;
    expect(early.errors).toEqual([
      "TypeError: Cannot read properties of undefined (reading 'x')",
      'a load',
    ]);
    // Once the module has taken over, an error goes straight to it.
    const reported: string[] = [];
    early.report = (message) => reported.push(message);
    onError?.({ error: null, message: 'Script error.' });
    expect(reported).toEqual(['Script error.']);
  });
});
