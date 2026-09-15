// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import type { ShellSupport, ShellSupportPort } from './shell-support-port';
import { useShellSupport } from './useShellSupport';

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
