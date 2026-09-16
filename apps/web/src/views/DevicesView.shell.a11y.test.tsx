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

import { act } from 'react';
import type { TransportAvailability } from '@onyourleft/sensors';
import { mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { CapabilityProbe } from '../support/bluetooth-support';
import {
  capacitorShellSupport,
  SHELL_ANSWER_TIMEOUT,
  UNANSWERED_SHELL_SUPPORT,
} from '../support/shell-support';
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

/**
 * The one state on this screen that arrives without the rider doing anything.
 *
 * ⚠️ **This is a TRANSITION, and that is the whole reason the file gains a
 * second `describe` rather than a sixth case above.** Every test in this file
 * until now renders a state and audits the markup, which is what `test:a11y`
 * does everywhere in this repository — and a rendered state cannot answer the
 * question a live region exists for, because the question is about what
 * *changed*. So the announcement on an auto-advancing screen sat outside every
 * gate here: `audit.ts` has no live-region rule to fail, `routes.a11y.test.tsx`
 * never reaches the shell branch, and the transition itself happens ten seconds
 * after anything a test asserted on.
 *
 * The rest of #322's transitions are in `DevicesView.shell.test.tsx`. This one
 * is here so that the accessibility gate is what fails when it regresses.
 */
describe('the state the deadline delivers is announced (#322)', () => {
  beforeEach(() => {
    // `shouldAdvanceTime` keeps `mount`'s and `settle`'s own zero-length timers
    // working, so the helpers above are reusable unchanged.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('changes the text INSIDE the live region rather than mounting a second one', async () => {
    // ⚠️ **Node identity is the assertion, not the attribute.** `role="status"`
    // on a `<p>` that React has just inserted is announced by some assistive
    // technologies and not by others; the behaviour every one of them
    // implements is an update to a region that was already there. Reading the
    // attribute off whatever is on screen at the end would pass either way,
    // which is the false pass this test exists to avoid — and it is the state
    // of this file before #322's review, where the deadline replaced a live
    // region with a plain paragraph and every gate stayed green.
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={WEBVIEW}
          shell={{ readShellSupport: () => new Promise(() => undefined) }}
        />
      </main>,
    );

    const region = document.querySelector('[role="status"]');
    expect(region?.textContent, 'the in-flight check is not in a live region').toContain(
      'Asking this phone about Bluetooth',
    );

    // The real constant, on a clock nothing injects into `DevicesView`.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SHELL_ANSWER_TIMEOUT * 1000);
    });

    const announced = document.querySelector('[role="status"]');
    expect(announced, 'the deadline fired and said so outside any live region').not.toBeNull();
    expect(announced?.textContent).toContain('This phone has not answered about Bluetooth');
    expect(announced, 'the live region was replaced rather than updated').toBe(region);
    expectClean('devices in the shell, unanswered by the deadline');
  });
});
