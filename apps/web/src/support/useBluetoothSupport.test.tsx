// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { mount, settle, type Mounted } from '../testing/mount';

import type { CapabilityProbe } from './bluetooth-support';
import { useBluetoothSupport } from './useBluetoothSupport';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function Probe({ probe }: { readonly probe: CapabilityProbe }): JSX.Element {
  const { support } = useBluetoothSupport(probe);
  return <output>{support?.kind ?? 'probing'}</output>;
}

function deferredPort(): { port: BluetoothPort; resolve: (value: boolean) => void } {
  let resolve: (value: boolean) => void = () => undefined;
  const pending = new Promise<boolean>((settlePromise) => {
    resolve = settlePromise;
  });
  return {
    port: {
      getAvailability: async () => pending,
      requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    },
    resolve,
  };
}

describe('useBluetoothSupport', () => {
  it('reports undefined until the probe resolves, then the answer', async () => {
    const { port, resolve } = deferredPort();
    mounted = await mount(<Probe probe={{ bluetooth: port, secureContext: true }} />);
    expect(mounted.container.textContent).toBe('probing');

    resolve(true);
    await settle();
    expect(mounted.container.textContent).toBe('available');
  });

  it('does not let a superseded probe overwrite the answer that replaced it', async () => {
    // The race the `cancelled` flag exists for, and the only way to see that it
    // does anything at all: React tolerates a state update on an unmounted
    // tree, so "does not warn on unmount" would have been a test that cannot
    // fail. Here the first probe resolves **after** the second, with the
    // opposite answer. Without the guard the page ends on "switched off"
    // moments after the athlete switched it on.
    const first = deferredPort();
    const second = deferredPort();
    const getAvailability = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(async () => first.port.getAvailability())
      .mockImplementation(async () => second.port.getAvailability());

    const port: BluetoothPort = {
      getAvailability,
      requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    };

    function Harness(): JSX.Element {
      const { support, recheck } = useBluetoothSupport({ bluetooth: port, secureContext: true });
      return (
        <>
          <output>{support?.kind ?? 'probing'}</output>
          <button type="button" onClick={recheck}>
            Check again
          </button>
        </>
      );
    }

    mounted = await mount(<Harness />);
    mounted.container.querySelector('button')?.click();
    await settle();

    second.resolve(true);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');

    first.resolve(false);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
    expect(getAvailability).toHaveBeenCalledTimes(2);
  });

  it('re-probes on recheck rather than replaying a cached answer', async () => {
    const getAvailability = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    // Stable, exactly as `navigator.bluetooth` is: the browser hands back the
    // same object on every read. What is *not* stable is the probe wrapper
    // built around it on each render, below.
    const port: BluetoothPort = {
      getAvailability,
      requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    };

    function Harness(): JSX.Element {
      const { support, recheck } = useBluetoothSupport({
        bluetooth: port,
        secureContext: true,
      });
      return (
        <>
          <output>{support?.kind ?? 'probing'}</output>
          <button type="button" onClick={recheck}>
            Check again
          </button>
        </>
      );
    }

    // ⚠️ The probe object above is rebuilt on every render, on purpose. It is
    // the shape a caller writing `probeBrowser()` inline would produce, and if
    // the effect depended on the object rather than on its fields this would
    // not merely be slow — it would re-probe, set state, re-render and never
    // stop. The call count is the assertion that says it does not: exactly one
    // probe on mount, exactly one more on recheck.
    mounted = await mount(<Harness />);
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('adapter-unavailable');
    expect(getAvailability).toHaveBeenCalledTimes(1);

    mounted.container.querySelector('button')?.click();
    await settle();
    expect(mounted.container.querySelector('output')?.textContent).toBe('available');
    expect(getAvailability).toHaveBeenCalledTimes(2);
  });
});
