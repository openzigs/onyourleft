// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The live-camera indicator, in the accessibility gate (#382, ADR 0029 D-5).
 *
 * Named `*.a11y.test.tsx` because **the filename is the gate** — CLAUDE.md §4e:
 * `test:a11y` is `vitest run --project web .a11y.test.`, and #142 is what
 * happens when a gate selects on a directory instead.
 *
 * Three things are asserted here that `routes.a11y.test.tsx` cannot: it renders
 * the indicator **live**, which no route does on its own; it asserts the word
 * rather than the colour is the carrier; and it asserts the region announces
 * itself when it appears, which is the only way a rider who cannot see the
 * screen learns that a camera has just been switched on.
 *
 * ⚠️ **It mounts the whole `AppShell` rather than the component alone**, and
 * that is not ceremony: `a11y/audit.ts` audits a *document*, and half its rules
 * — `page-has-one-main`, `page-has-one-h1`, `heading-order`,
 * `landmarks-are-distinguishable` — are about the page a component lands in. A
 * bare mount fails `page-has-one-main` before it has said anything about the
 * indicator, and "passes in isolation" would be the wrong claim anyway: the
 * indicator is rendered by the shell, over whatever route is open.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { CAMERA_LIVE_LABEL, CameraIndicator } from './indicator';
import { CameraController } from './session';
import { manualSchedule, scriptedCamera } from './testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function liveController(): Promise<CameraController> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  await controller.turnOn();
  return controller;
}

/** A browser with no Bluetooth, which changes nothing this file measures. */
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

describe('the live indicator', () => {
  it('passes the audit while a camera is running, in the page it is rendered in', async () => {
    const controller = await liveController();
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} camera={controller} />);
    await settle();
    expect(document.querySelector('[data-oyl-camera-indicator]')).not.toBeNull();
    const violations = auditAccessibility(document);
    expect(
      violations.length === 0 ? '' : formatViolations(violations),
      'the live camera indicator has accessibility violations',
    ).toBe('');
  });

  it('announces itself politely when it appears', async () => {
    const controller = await liveController();
    mounted = await mount(<CameraIndicator controller={controller} />);
    await settle();
    const region = document.querySelector('[data-oyl-camera-indicator]');
    // `status`, not `alert`: the rider has just pressed something, and an
    // interruption would talk over whatever the ride was saying.
    expect(region?.getAttribute('role')).toBe('status');
  });

  it('says it in words, so removing the colour removes nothing', async () => {
    const controller = await liveController();
    mounted = await mount(<CameraIndicator controller={controller} />);
    await settle();
    const region = document.querySelector('[data-oyl-camera-indicator]');
    // #48's sixth criterion. The dot is the redundant signal and is
    // `aria-hidden`; the text is what survives greyscale, a colour-vision
    // deficiency and a screen reader.
    expect(region?.textContent?.trim()).toBe(CAMERA_LIVE_LABEL);
    expect(document.querySelector('.oyl-camera-indicator__dot')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});
