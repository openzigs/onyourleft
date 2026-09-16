// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Devices screen's shell branch, audited (#284, #48 criterion 4).
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it. `routes.a11y.test.tsx`
 * audits every route by rendering `AppShell`, and `AppShell` is never handed a
 * shell port there — nothing in that file could be, since building one needs
 * the Capacitor plugin. So the markup a rider on Android actually reads would
 * sit outside the one gate #48 built to check it, which is the shape #142
 * records: a selector that looks complete over a population it never reached.
 */

import type { TransportAvailability } from '@onyourleft/sensors';
import { mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { capacitorShellSupport, UNANSWERED_SHELL_SUPPORT } from '../support/shell-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { DevicesView } from './DevicesView';

/** A WebView that answers about the wrong stack. @see DevicesView.shell.test.tsx */
const WEBVIEW: CapabilityProbe = {
  bluetooth: {
    getAvailability: async () => Promise.resolve(false),
    requestDevice: async () => Promise.reject(new Error('no chooser in a WebView')),
  },
  secureContext: true,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * The view inside the landmark it actually ships in.
 *
 * `auditAccessibility` walks the whole document, and a landmark or a heading
 * rule cannot be checked against a fragment. Mounting the view bare would
 * report a missing `main` and a heading order starting at `h2` — both false,
 * both fixed by rendering the shell around it, and both the kind of false
 * failure that trains the next person to loosen the audit.
 */
async function open(availability: TransportAvailability): Promise<void> {
  const port = capacitorShellSupport({
    availability: async () => Promise.resolve(availability),
    notice: permissionNotice,
    mayShowDeviceList,
  });
  mounted = await mount(
    <main>
      <h1>Devices</h1>
      <DevicesView capabilities={WEBVIEW} shell={port} />
    </main>,
  );
  await settle();
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

describe('every state of the Android shell’s Devices screen passes the audit', () => {
  const ALL: readonly TransportAvailability[] = [
    { kind: 'available' },
    { kind: 'not-permitted' },
    { kind: 'adapter-unavailable' },
    { kind: 'unsupported' },
  ];

  for (const availability of ALL) {
    it(`has no accessibility violations when the plugin says ${availability.kind}`, async () => {
      await open(availability);
      expectClean(`devices in the shell, ${availability.kind}`);
    });
  }

  it('passes while the plugin has not answered yet', async () => {
    // A real state, and the one that carries a live region: on Android this
    // read is the permission dialog, so it lasts as long as a rider takes to
    // answer it. Held open with a promise that never settles, because `mount`
    // already flushes microtasks.
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={WEBVIEW}
          shell={{ readShellSupport: () => new Promise(() => undefined) }}
        />
      </main>,
    );
    expect(document.body.textContent).toContain('Asking this phone about Bluetooth');
    expectClean('devices in the shell, still asking');
  });

  it('passes once the deadline has said the plugin did not answer', async () => {
    // #322's state, and the one most likely to be built out of loose markup:
    // it is the only notice on this screen whose wording is not
    // `permissionNotice`'s, so it is the only one not already covered by
    // `apps/mobile`'s own tests. Rendered from the value the hook delivers
    // rather than by waiting out a real deadline.
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={WEBVIEW}
          shell={{ readShellSupport: async () => Promise.resolve(UNANSWERED_SHELL_SUPPORT) }}
        />
      </main>,
    );
    await settle();
    expect(document.body.textContent).toContain('This phone has not answered about Bluetooth');
    expectClean('devices in the shell, unanswered');
  });
});
