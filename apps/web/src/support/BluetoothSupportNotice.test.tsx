// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #48's first acceptance criterion, asserted as *copy* rather than as
 * structure.
 *
 * > Loading the app in a context where `navigator.bluetooth` is absent shows an
 * > explicit explanation naming the limitation and the supported browsers …
 * > A silently non-functional pairing control fails this criterion.
 *
 * Every structural rule in `a11y/audit.ts` would pass over a notice that read
 * "Bluetooth unavailable" and stopped there, and that is precisely the message
 * ADR 0003 decision D-7 rejects. So these tests read the rendered words: does
 * it name a browser that works, does it say whose limitation it is, and does it
 * say what — if anything — can be done.
 */

import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { accessibleName } from '../a11y/audit';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { BluetoothSupportNotice } from './BluetoothSupportNotice';
import {
  readBluetoothSupport,
  type BluetoothSupport,
  type CapabilityProbe,
} from './bluetooth-support';
import { useBluetoothSupport } from './useBluetoothSupport';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function noticeFor(probe: CapabilityProbe): Promise<string> {
  const support = await readBluetoothSupport(probe);
  mounted = await mount(<BluetoothSupportNotice support={support} onRecheck={() => undefined} />);
  await settle();
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function port(overrides: Partial<BluetoothPort> = {}): BluetoothPort {
  return {
    getAvailability: async () => Promise.resolve(true),
    requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    ...overrides,
  };
}

describe('the Safari and Firefox path', () => {
  it('names browsers that do work rather than only saying "not supported"', async () => {
    const text = await noticeFor({ bluetooth: undefined, secureContext: true });
    expect(text).toContain('Chrome');
    expect(text).toContain('Edge');
    // The platform matters as much as the browser: Chrome on iOS is WKWebView
    // and cannot work, so naming Chrome without naming a platform would be
    // wrong for every iPhone reader.
    expect(text).toMatch(/Android|Windows|macOS|Chrome OS/);
  });

  it('says the limitation is the browser vendor’s, not the reader’s', async () => {
    const text = await noticeFor({ bluetooth: undefined, secureContext: true });
    expect(text).toContain('Safari and Firefox');
    expect(text).toContain('no Web Bluetooth implementation at all');
    expect(text).toContain('Nothing you have done is wrong');
  });

  it('says the iPhone case is the operating system, not a browser preference', async () => {
    const text = await noticeFor({ bluetooth: undefined, secureContext: true });
    expect(text).toMatch(/iPhone/);
    expect(text).toContain('Safari underneath');
  });

  it('offers no retry, because there is nothing to retry', async () => {
    await noticeFor({ bluetooth: undefined, secureContext: true });
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('quotes no share-of-users percentage, which drifts monthly', async () => {
    // ADR 0003's own closing note. A figure baked into shipped copy is a figure
    // nobody re-reads.
    const text = await noticeFor({ bluetooth: undefined, secureContext: true });
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});

describe('the Chrome-on-Linux path', () => {
  const partial = { requestDevice: async () => port().requestDevice() } as unknown as BluetoothPort;

  it('gives the three actionable requirements rather than the permanent message', async () => {
    const text = await noticeFor({ bluetooth: partial, secureContext: true });
    expect(text).toContain('enable-experimental-web-platform-features');
    expect(text).toContain('kernel 3.19');
    expect(text).toContain('BlueZ 5.41');
  });

  it('does not tell a Linux user their browser will never support it', async () => {
    // The distinction ADR 0003 D-7 rule 4 asks for: permanent versus pending.
    // Collapsing the two is what a single "unsupported" message does.
    const text = await noticeFor({ bluetooth: partial, secureContext: true });
    expect(text).not.toContain('no Web Bluetooth implementation at all');
  });

  it('offers a way to check again once the flag is set', async () => {
    await noticeFor({ bluetooth: partial, secureContext: true });
    const button = document.querySelector('button');
    expect(button).not.toBeNull();
    // The visible label is short; the accessible name completes it for anyone
    // reading the page's buttons out of context. WCAG 2.2 SC 2.5.3 requires the
    // visible words to be a part of the accessible name, so the two are checked
    // together rather than one standing in for the other.
    expect(accessibleName(button as Element)).toBe('Check again for Bluetooth support');
    const visible = (button as HTMLElement).cloneNode(true) as HTMLElement;
    visible.querySelector('.oyl-visually-hidden')?.remove();
    expect(visible.textContent).toBe('Check again');
  });
});

describe('the recoverable paths each say what to change', () => {
  it('adapter off: switch Bluetooth on', async () => {
    const text = await noticeFor({
      bluetooth: port({ getAvailability: async () => Promise.resolve(false) }),
      secureContext: true,
    });
    expect(text).toContain('Switch Bluetooth on');
    expect(text).not.toContain('Chrome OS');
  });

  it('insecure context: it is the address, not the browser', async () => {
    const text = await noticeFor({ bluetooth: undefined, secureContext: false });
    expect(text).toContain('plain HTTP');
    expect(text).toContain('localhost');
    expect(text).toContain('it is the address that is the problem');
  });
});

describe('the working path is not silent either', () => {
  it('states the four constraints that survive a supported browser', async () => {
    const text = await noticeFor({ bluetooth: port(), secureContext: true });
    expect(text).toContain('one press per device');
    expect(text).toContain('no silent reconnect');
    expect(text).toContain('Recording stops if the browser suspends this tab');
    expect(text).toContain('about three sensors at once');
  });

  it('never claims a limit of seven concurrent connections', async () => {
    const text = await noticeFor({ bluetooth: port(), secureContext: true });
    expect(text).not.toContain('seven');
  });
});

describe('while the probe is in flight', () => {
  it('says it is checking, in a region a screen reader will announce', async () => {
    mounted = await mount(
      <BluetoothSupportNotice support={undefined} onRecheck={() => undefined} />,
    );
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'Looking for Bluetooth',
    );
  });
});

describe('rechecking actually re-probes', () => {
  function Harness({ probe }: { readonly probe: CapabilityProbe }): JSX.Element {
    const { support, recheck } = useBluetoothSupport(probe);
    return <BluetoothSupportNotice support={support} onRecheck={recheck} />;
  }

  it('turns "switch Bluetooth on" into "Bluetooth is available" after the radio comes up', async () => {
    // The whole point of the retry: the state it reports is recoverable, and
    // the recovery happens outside the page. A button that re-rendered the same
    // cached answer would look identical and be useless.
    const getAvailability = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const probe: CapabilityProbe = { bluetooth: port({ getAvailability }), secureContext: true };

    mounted = await mount(<Harness probe={probe} />);
    await settle();
    expect(document.body.textContent).toContain('Bluetooth is switched off');

    const button = document.querySelector('button');
    await activateWithKeyboard(button as HTMLButtonElement);

    expect(document.body.textContent).toContain('Bluetooth is available');
    expect(getAvailability).toHaveBeenCalledTimes(2);
  });
});

describe('the notice covers every state the classifier can return', () => {
  it('renders something for all six', async () => {
    const kinds: BluetoothSupport['kind'][] = [
      'available',
      'adapter-unavailable',
      'not-permitted',
      'insecure-context',
      'absent',
      'incomplete',
    ];
    for (const kind of kinds) {
      const support: BluetoothSupport = { kind, canPair: kind === 'available', recoverable: true };
      const local = await mount(
        <BluetoothSupportNotice support={support} onRecheck={() => undefined} />,
      );
      expect((document.body.textContent ?? '').length, `${kind} rendered nothing`).toBeGreaterThan(
        40,
      );
      local.unmount();
    }
  });
});
