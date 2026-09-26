// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The side camera's pairing, on both devices, in the accessibility gate —
 * #529.
 *
 * `routes.a11y.test.tsx` renders every route with no pairing port, so neither
 * pairing screen is in it. This file renders each state a rider meets: the
 * tablet's offer, the tablet paired and driving the phone, the tablet after
 * the pairing ended, the phone looking for the tablet's code, and the phone
 * showing its own.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { CameraController } from '../camera/session';
import { sidePairingPort } from '../camera/side-link';
import { pairingCodeModules } from '../camera/side-link-qr';
import type { TabletSidePairing } from '../camera/side-pairing-port';
import {
  flushSideLink,
  manualSchedule,
  photographedCode,
  scriptedCamera,
  sidePeerNetwork,
  virtualTime,
} from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { SideCameraControl } from './SideCameraControl';
import { SideCameraView } from './SideCameraView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function expectNoViolations(what: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : formatViolations(violations), what).toBe('');
}

async function press(text: string): Promise<void> {
  const found = queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').includes(text),
  );
  if (found === undefined) {
    expect.unreachable(`no button "${text}"`);
    return;
  }
  await activateWithKeyboard(found);
  await settle();
  await flushSideLink();
  await settle();
}

function setUp() {
  const network = sidePeerNetwork();
  const time = virtualTime();
  const port = sidePairingPort({
    peer: network.peer,
    clock: time.clock,
    after: time.after,
    every: time.every,
  });
  return { port, time };
}

function agreedController(codePixels?: () => ReturnType<typeof photographedCode>) {
  const camera = scriptedCamera(codePixels === undefined ? {} : { codePixels });
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  return controller;
}

/** The section inside a page with a `main`, an `h1` and an `h2`, as the Camera screen frames it. */
async function onTheCameraScreen(port: ReturnType<typeof setUp>['port']): Promise<void> {
  mounted = await mount(
    <main aria-labelledby="title">
      <h1 id="title">Camera</h1>
      <section aria-labelledby="camera">
        <h2 id="camera">Camera</h2>
        <SideCameraControl controller={agreedController()} pairing={port} />
      </section>
    </main>,
  );
  await settle();
}

describe('the tablet', () => {
  it('before pairing', async () => {
    const { port } = setUp();
    await onTheCameraScreen(port);
    expectNoViolations('the tablet before pairing');
  });

  it('showing its offer', async () => {
    const { port } = setUp();
    await onTheCameraScreen(port);
    await press('Pair a phone');
    expect(document.querySelector('[data-oyl-pairing-code]')).not.toBeNull();
    expectNoViolations('the tablet showing its offer');
  });

  it('paired, with the phone framing', async () => {
    const { port } = setUp();
    const tablet = (await port.offerSideCamera()) as TabletSidePairing;
    const phone = await port.answerSideCamera(tablet.offerCode);
    if (typeof phone !== 'object') {
      throw new Error(phone);
    }
    await tablet.acceptSidePhoneCode(phone.answerCode);
    await flushSideLink();
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    await onTheCameraScreen(port);
    expect(queryAll(document, 'button').map((each) => each.textContent)).toContain('Start filming');
    expectNoViolations('the tablet paired');
    await press('End pairing');
    expectNoViolations('the tablet after ending the pairing');
  });
});

describe('the phone', () => {
  it('looking for the tablet’s code, then showing its own', async () => {
    const { port } = setUp();
    const tablet = (await port.offerSideCamera()) as TabletSidePairing;
    const controller = agreedController(() =>
      photographedCode(pairingCodeModules(tablet.offerCode)),
    );
    mounted = await mount(
      <main aria-labelledby="title">
        <h1 id="title">Side camera</h1>
        <SideCameraView controller={controller} pairing={port} timers={virtualTime()} />
      </main>,
    );
    await settle();
    queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0]?.click();
    await settle();
    await press('Turn the camera on');
    expectNoViolations('the phone looking for the tablet’s code');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    await flushSideLink();
    await settle();
    expect(document.querySelector('[data-oyl-pairing-code]')).not.toBeNull();
    expectNoViolations('the phone showing its own code');
  });
});
