// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import { SHELL_ANSWER_TIMEOUT, UNANSWERED_SHELL_SUPPORT } from './shell-support';
import type { ShellSupport, ShellSupportPort } from './shell-support-port';
import {
  useShellSupport,
  type Schedule,
  type ScreenReturn,
  type ShellSupportOptions,
} from './useShellSupport';

/**
 * Do something that updates state, inside an asynchronous `act` scope.
 *
 * The same shape `testing/mount.tsx` uses internally and for the same reason:
 * only the asynchronous scope drains the microtask queue before it closes, so
 * the synchronous form would return with the update still queued and every
 * assertion below would read the render before it.
 */
async function inAct(work: () => void): Promise<void> {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const AVAILABLE: ShellSupport = { kind: 'available', canPair: true, notice: null };

const RADIO_OFF: ShellSupport = {
  kind: 'adapter-unavailable',
  canPair: false,
  notice: {
    title: 'Bluetooth is switched off',
    explanation: 'Turn Bluetooth on and your sensors will appear.',
    instruction: 'Switch Bluetooth on.',
    recoverable: true,
  },
};

function deferred(): { promise: Promise<ShellSupport>; resolve: (value: ShellSupport) => void } {
  let resolve: (value: ShellSupport) => void = () => undefined;
  const promise = new Promise<ShellSupport>((settlePromise) => {
    resolve = settlePromise;
  });
  return { promise, resolve };
}

describe('useShellSupport', () => {
  it('reports undefined until the plugin answers, then the answer', async () => {
    const { promise, resolve } = deferred();
    const port: ShellSupportPort = { readShellSupport: async () => promise };

    function Probe(): JSX.Element {
      const { support } = useShellSupport(port);
      return <output>{support?.kind ?? 'asking'}</output>;
    }

    mounted = await mount(<Probe />);
    expect(mounted.container.textContent).toBe('asking');

    resolve(AVAILABLE);
    await settle();
    expect(mounted.container.textContent).toBe('available');
  });

  it('re-reads on recheck rather than replaying a cached answer', async () => {
    // The whole point of the control: a rider granted the permission in
    // Android's Settings and came back. An answer served from the first read
    // would leave them on the screen that told them to go there.
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      .mockResolvedValueOnce(RADIO_OFF)
      .mockResolvedValue(AVAILABLE);

    function Harness(): JSX.Element {
      // ⚠️ Rebuilt on EVERY render, on purpose. It is the shape a caller
      // writing the port inline would produce, and if the effect depended on
      // the port object this would not merely be slow — it would read, set
      // state, re-render and never stop. The call count below is what says it
      // does not.
      const { support, recheck } = useShellSupport({ readShellSupport });
      return (
        <>
          <output>{support?.kind ?? 'asking'}</output>
          <button type="button" onClick={recheck}>
            Check again
          </button>
        </>
      );
    }

    mounted = await mount(<Harness />);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('adapter-unavailable');
    expect(readShellSupport).toHaveBeenCalledTimes(1);

    mounted.container.querySelector('button')?.click();
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
    expect(readShellSupport).toHaveBeenCalledTimes(2);
  });

  it('does not let a superseded read overwrite the answer that replaced it', async () => {
    // On Android the first read is the one that raises the permission dialog,
    // so it can be outstanding for as long as a rider takes to read it. Here
    // the first read resolves **after** the second, with the opposite answer.
    // Without the guard the screen ends on "switched off" moments after the
    // rider switched it on.
    const first = deferred();
    const second = deferred();
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementation(async () => second.promise);
    const port: ShellSupportPort = { readShellSupport };

    function Harness(): JSX.Element {
      const { support, recheck } = useShellSupport(port);
      return (
        <>
          <output>{support?.kind ?? 'asking'}</output>
          <button type="button" onClick={recheck}>
            Check again
          </button>
        </>
      );
    }

    mounted = await mount(<Harness />);
    mounted.container.querySelector('button')?.click();
    await settle();

    second.resolve(AVAILABLE);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');

    first.resolve(RADIO_OFF);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
    expect(readShellSupport).toHaveBeenCalledTimes(2);
  });
});

/**
 * The bound, and the two things that make it more than a timer (#322).
 *
 * On a Pixel Tablet that had slept, `BluetoothLe.initialize` was called and
 * never called back, so this hook's `support` stayed `undefined` and the screen
 * held "Checking" at 45 s. Every test below is driven by a port that **never
 * resolves** — the shape `packages/sensors` uses for the same rule, where "Web
 * Bluetooth also specifies no timeout for any operation" is answered by
 * bounding every operation at the caller.
 */
describe('the read is bounded', () => {
  /** A port that receives the read and never answers, with a way to answer late. */
  function hangingPort(): {
    readonly port: ShellSupportPort;
    readonly answer: (value: ShellSupport) => void;
    readonly reads: () => number;
  } {
    let count = 0;
    let resolveLatest: (value: ShellSupport) => void = () => undefined;
    return {
      port: {
        readShellSupport: async () => {
          count += 1;
          return new Promise<ShellSupport>((settlePromise) => {
            resolveLatest = settlePromise;
          });
        },
      },
      answer: (value) => {
        resolveLatest(value);
      },
      reads: () => count,
    };
  }

  /** A scheduler the test fires by hand. @see useShellSupport §Schedule */
  function handScheduler(): { readonly schedule: Schedule; readonly miss: () => void } {
    const deadlines: (() => void)[] = [];
    return {
      schedule: (callback) => {
        deadlines.push(callback);
        return () => {
          const index = deadlines.indexOf(callback);
          if (index >= 0) {
            deadlines.splice(index, 1);
          }
        };
      },
      miss: () => {
        // A copy, because firing a deadline starts a read that arms another.
        for (const deadline of [...deadlines]) {
          deadline();
        }
      },
    };
  }

  function Probe({
    port,
    options,
  }: {
    readonly port: ShellSupportPort;
    readonly options: ShellSupportOptions;
  }): JSX.Element {
    const { support, recheck } = useShellSupport(port, options);
    return (
      <>
        <output>{support?.kind ?? 'asking'}</output>
        <p>{support?.notice?.title ?? ''}</p>
        <button type="button" onClick={recheck}>
          Check again
        </button>
      </>
    );
  }

  it('says the phone did not answer, rather than holding "Checking" for ever', async () => {
    const hanging = hangingPort();
    const clock = handScheduler();

    mounted = await mount(<Probe port={hanging.port} options={{ schedule: clock.schedule }} />);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('asking');

    await inAct(() => {
      clock.miss();
    });
    expect(mounted.container.querySelector('output')?.textContent).toBe('unanswered');
  });

  it('tells "did not answer" apart from "said no", in the words a rider reads', async () => {
    // #322's fourth criterion. A denial and a silence must not read the same:
    // the first is a verdict the rider has to act on outside the app, the
    // second is a failure to ask that a retry can fix.
    const hanging = hangingPort();
    const clock = handScheduler();
    mounted = await mount(<Probe port={hanging.port} options={{ schedule: clock.schedule }} />);
    await inAct(() => {
      clock.miss();
    });

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('has not answered');
    // The accusation the wording exists to refuse.
    expect(text).not.toMatch(/permission|refused by|switched off/i);
    expect(UNANSWERED_SHELL_SUPPORT.notice?.explanation).toContain('Nothing has been refused');
    // Recoverable, so the screen keeps the control that is the whole recovery.
    expect(UNANSWERED_SHELL_SUPPORT.notice?.recoverable).toBe(true);
    expect(UNANSWERED_SHELL_SUPPORT.canPair).toBe(false);
  });

  it('names the deadline in the sentence, rather than a number that can drift from it', () => {
    expect(UNANSWERED_SHELL_SUPPORT.notice?.explanation).toContain(
      `${String(SHELL_ANSWER_TIMEOUT)} seconds`,
    );
  });

  it('adopts an answer that arrives after the deadline', async () => {
    // The permission dialog case, and the reason the deadline can be short. The
    // first `initialize()` on Android is the call that raises Android's own
    // prompt and it does not resolve until the rider answers it -- a rider
    // reading that dialog is not a hang, and must not be left on a screen that
    // says their phone is unresponsive.
    const hanging = hangingPort();
    const clock = handScheduler();
    mounted = await mount(<Probe port={hanging.port} options={{ schedule: clock.schedule }} />);
    await inAct(() => {
      clock.miss();
    });
    expect(mounted.container.querySelector('output')?.textContent).toBe('unanswered');

    hanging.answer(AVAILABLE);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
    // And without asking the plugin a second time: the original read was never
    // abandoned, only overtaken.
    expect(hanging.reads()).toBe(1);
  });

  it('cancels the deadline once a real answer has arrived', async () => {
    // Otherwise a read that answered in a second would be overwritten by its
    // own deadline nine seconds later, and a rider watching a working screen
    // would see it turn into "this phone has not answered".
    const clock = handScheduler();
    const port: ShellSupportPort = { readShellSupport: async () => Promise.resolve(AVAILABLE) };
    mounted = await mount(<Probe port={port} options={{ schedule: clock.schedule }} />);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');

    await inAct(() => {
      clock.miss();
    });
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
  });

  it('re-asks the plugin when the rider presses the control the deadline offered', async () => {
    const hanging = hangingPort();
    const clock = handScheduler();
    mounted = await mount(<Probe port={hanging.port} options={{ schedule: clock.schedule }} />);
    await inAct(() => {
      clock.miss();
    });
    expect(hanging.reads()).toBe(1);

    mounted.container.querySelector('button')?.click();
    await settle();
    expect(hanging.reads()).toBe(2);
    expect(mounted.container.querySelector('output')?.textContent).toBe('asking');

    hanging.answer(AVAILABLE);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
  });
});

/**
 * The bound has to survive the LIFECYCLE, not only the call (#322).
 *
 * A `setTimeout` armed before the Android activity stops is throttled or
 * suspended while the device sleeps, so the deadline meant to rescue the screen
 * is asleep beside it. The answer is not a longer timer: the check is re-run on
 * an **event** — the screen coming back — which no amount of stopped clock can
 * delay.
 */
describe('the check is re-evaluated when the screen comes back', () => {
  function screenReturns(): {
    readonly onScreenReturn: ScreenReturn;
    readonly returnToApp: () => void;
    readonly listening: () => number;
  } {
    const listeners = new Set<() => void>();
    return {
      onScreenReturn: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      returnToApp: () => {
        for (const listener of [...listeners]) {
          listener();
        }
      },
      listening: () => listeners.size,
    };
  }

  function Probe({
    port,
    options,
  }: {
    readonly port: ShellSupportPort;
    readonly options: ShellSupportOptions;
  }): JSX.Element {
    const { support } = useShellSupport(port, options);
    return <output>{support?.kind ?? 'asking'}</output>;
  }

  it('re-reads a check that never finished, without waiting for a suspended timer', async () => {
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      // The read that was in flight when the device went to sleep, and which
      // the plugin's NPE orphaned. Nothing will ever settle it.
      .mockImplementationOnce(async () => new Promise<ShellSupport>(() => undefined))
      .mockResolvedValue(AVAILABLE);
    const screen = screenReturns();

    mounted = await mount(
      <Probe
        port={{ readShellSupport }}
        // No scheduler is fired at all: the timer is the thing that cannot be
        // trusted here, so this test must pass without one.
        options={{ schedule: () => () => undefined, onScreenReturn: screen.onScreenReturn }}
      />,
    );
    await settle();
    expect(mounted.container.textContent).toBe('asking');

    await inAct(() => {
      screen.returnToApp();
    });
    await settle();

    expect(readShellSupport).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).toBe('available');
  });

  it('re-reads after the deadline gave up, so a stale "did not answer" is not what greets a rider', async () => {
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      .mockImplementationOnce(async () => new Promise<ShellSupport>(() => undefined))
      .mockResolvedValue(AVAILABLE);
    const screen = screenReturns();
    const deadlines: (() => void)[] = [];

    mounted = await mount(
      <Probe
        port={{ readShellSupport }}
        options={{
          schedule: (callback) => {
            deadlines.push(callback);
            return () => undefined;
          },
          onScreenReturn: screen.onScreenReturn,
        }}
      />,
    );
    await inAct(() => {
      deadlines[0]?.();
    });
    expect(mounted.container.textContent).toBe('unanswered');

    await inAct(() => {
      screen.returnToApp();
    });
    await settle();
    expect(mounted.container.textContent).toBe('available');
  });

  it('does NOT re-ask when the plugin has already given a real answer', async () => {
    // On Android the read is the call that can raise the permission dialog. A
    // rider who has been told their radio is off must not be re-asked every
    // time they glance at their phone, and a rider whose sensors work must not
    // pay a plugin round trip for switching apps.
    const readShellSupport = vi.fn<() => Promise<ShellSupport>>().mockResolvedValue(RADIO_OFF);
    const screen = screenReturns();

    mounted = await mount(
      <Probe
        port={{ readShellSupport }}
        options={{ schedule: () => () => undefined, onScreenReturn: screen.onScreenReturn }}
      />,
    );
    await settle();
    expect(mounted.container.textContent).toBe('adapter-unavailable');

    await inAct(() => {
      screen.returnToApp();
    });
    await settle();
    expect(readShellSupport).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from the screen when the tree goes', async () => {
    // ⚠️ Asserted on the SUBSCRIPTION, not on the read count. Counting reads
    // after an unmount is a test that cannot fail: React discards a state
    // update on a gone tree, so the effect would not re-run whether the
    // listener was removed or not — and in production this listener is on
    // `document`, which outlives every screen and would hold the component's
    // closure for the life of the page.
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      .mockImplementation(async () => new Promise<ShellSupport>(() => undefined));
    const screen = screenReturns();
    const local = await mount(
      <Probe
        port={{ readShellSupport }}
        options={{ schedule: () => () => undefined, onScreenReturn: screen.onScreenReturn }}
      />,
    );
    await settle();
    expect(screen.listening(), 'nothing subscribed to the screen coming back').toBe(1);

    local.unmount();
    expect(screen.listening()).toBe(0);
  });
});

/**
 * The default subscription, which is the one that actually ships.
 *
 * Every test above injects `onScreenReturn`, so none of them says whether the
 * hook subscribes to anything at all on a real page. These two do, through
 * jsdom's own `document`.
 */
describe('the default screen-return subscription', () => {
  function Probe({ port }: { readonly port: ShellSupportPort }): JSX.Element {
    const { support } = useShellSupport(port, { schedule: () => () => undefined });
    return <output>{support?.kind ?? 'asking'}</output>;
  }

  async function withVisibility(state: DocumentVisibilityState): Promise<void> {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    await inAct(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('re-reads on the document’s own visibilitychange', async () => {
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      .mockImplementationOnce(async () => new Promise<ShellSupport>(() => undefined))
      .mockResolvedValue(AVAILABLE);
    mounted = await mount(<Probe port={{ readShellSupport }} />);
    await settle();

    await withVisibility('visible');
    await settle();
    expect(readShellSupport).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).toBe('available');
  });

  it('ignores the same event on the way OUT', async () => {
    // `visibilitychange` fires in both directions. Re-reading as the rider
    // leaves is a plugin call nobody asked for and an answer nobody will see.
    const readShellSupport = vi
      .fn<() => Promise<ShellSupport>>()
      .mockImplementation(async () => new Promise<ShellSupport>(() => undefined));
    mounted = await mount(<Probe port={{ readShellSupport }} />);
    await settle();

    await withVisibility('hidden');
    await settle();
    expect(readShellSupport).toHaveBeenCalledTimes(1);
  });
});
