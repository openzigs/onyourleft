// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The tablet's half of the side camera — #529. Pairing, reading the phone's
 * code with THIS tablet's camera, the phone's state in words, start and stop,
 * and ending the pairing — driven through the real pairing port over
 * `testing.ts` §`sidePeerNetwork`, with the phone's end played by the same
 * port.
 */

import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CameraController } from '../camera/session';
import { SIDE_PAIRING_END_TEXT, SIDE_PHONE_STATE_TEXT, sidePairingPort } from '../camera/side-link';
import { PAIRING_REFUSAL_TEXT } from '../camera/side-link-code';
import { pairingCodeModules } from '../camera/side-link-qr';
import type { PhoneSidePairing } from '../camera/side-pairing-port';
import type { SideLinkEvent } from '../camera/side-camera-link-port';
import {
  flushSideLink,
  manualSchedule,
  photographedCode,
  scriptedCamera,
  sidePeerNetwork,
  virtualTime,
} from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { SideCameraControl, TABLET_SCAN_NEEDS_CONSENT } from './SideCameraControl';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function button(text: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').includes(text),
  );
}

async function press(text: string): Promise<void> {
  const found = button(text);
  if (found === undefined) {
    expect.unreachable(`no button "${text}"`);
    return;
  }
  await activateWithKeyboard(found);
  await settle();
  await flushSideLink();
  await settle();
}

/** Real milliseconds: the scan's own interval, which a test does not own. */
async function scanOnce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await settle();
  await flushSideLink();
  await settle();
}

async function tablet(options: { readonly agreed?: boolean } = {}) {
  const network = sidePeerNetwork();
  const time = virtualTime();
  const port = sidePairingPort({
    peer: network.peer,
    clock: time.clock,
    after: time.after,
    every: time.every,
  });
  let phone: PhoneSidePairing | undefined;
  /** A code held up to the tablet's camera instead of the phone's, when set. */
  let inView: string | undefined;
  const camera = scriptedCamera({
    codePixels: () => {
      const shown = inView ?? phone?.answerCode;
      return shown === undefined
        ? { width: 4, height: 4, rgba: new Uint8ClampedArray(64).fill(255) }
        : photographedCode(pairingCodeModules(shown));
    },
  });
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  if (options.agreed !== false) {
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  }
  mounted = await mount(<SideCameraControl controller={controller} pairing={port} />);
  await settle();
  /** The phone, somewhere else, reading the offer on this tablet's screen. */
  const phoneReads = async (): Promise<PhoneSidePairing> => {
    const offer = port.currentSideCamera()?.offerCode ?? '';
    const made = await port.answerSideCamera(offer);
    if (typeof made !== 'object') {
      throw new Error(made);
    }
    phone = made;
    return made;
  };
  const holdUp = (code: string | undefined): void => {
    inView = code;
  };
  return { port, camera, controller, phoneReads, time, holdUp };
}

describe('pairing, on the tablet', () => {
  it('shows an offer code, and reads the phone’s answer with this tablet’s camera', async () => {
    const { camera, phoneReads } = await tablet();
    await press('Pair a phone');
    expect(document.querySelector('[data-oyl-pairing-code]')?.getAttribute('aria-label')).toBe(
      'Pairing code for the side-camera phone to scan',
    );
    expect(document.body.textContent).toContain(SIDE_PHONE_STATE_TEXT.pairing);
    const phone = await phoneReads();
    await press('Read the phone’s code');
    expect(camera.calls).toContain('start');
    await scanOnce();
    // Read, and the offer is gone from the screen.
    expect(document.querySelector('[data-oyl-pairing-code]')).toBeNull();
    // The camera this section turned on to read the code is off again (D-4).
    expect(camera.calls).toContain('stop');
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(SIDE_PHONE_STATE_TEXT.framing);
  });

  it('turns the camera it opened off again when the rider stops looking', async () => {
    const { camera } = await tablet();
    await press('Pair a phone');
    await press('Read the phone’s code');
    expect(camera.calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(camera.calls).not.toContain('stop');
    await press('Stop looking');
    expect(camera.calls).toContain('stop');
  });

  it('turns the camera it opened off again when the screen goes away mid-scan', async () => {
    const { camera } = await tablet();
    await press('Pair a phone');
    await press('Read the phone’s code');
    mounted?.unmount();
    mounted = undefined;
    expect(camera.calls).toContain('stop');
  });

  it('leaves alone a camera the rider turned on themselves', async () => {
    const { camera, controller } = await tablet();
    await controller.turnOn();
    await press('Pair a phone');
    await press('Read the phone’s code');
    await press('Stop looking');
    expect(camera.calls).not.toContain('stop');
    expect(controller.state().live).toBe(true);
  });

  it('asks for consent rather than opening a camera nobody agreed to', async () => {
    const { camera } = await tablet({ agreed: false });
    await press('Pair a phone');
    await press('Read the phone’s code');
    expect(document.body.textContent).toContain(TABLET_SCAN_NEEDS_CONSENT);
    expect(camera.calls).not.toContain('start');
  });

  it('keeps looking, and says nothing, when it reads its own offer off a reflection', async () => {
    // #550's review: with `refused !== 'wrong-code'` replaced by `true`, the
    // tablet stopped scanning and put up a warning for the one refusal that
    // is nobody's to act on, and every test here stayed green.
    const { port, camera, holdUp, phoneReads } = await tablet();
    await press('Pair a phone');
    const offer = port.currentSideCamera()?.offerCode ?? '';
    holdUp(offer);
    await press('Read the phone’s code');
    await scanOnce();
    await scanOnce();
    expect(document.body.textContent).toContain('Looking for the phone’s code');
    expect(button('Stop looking')).toBeDefined();
    expect(document.body.textContent).not.toContain(PAIRING_REFUSAL_TEXT['wrong-code']);
    expect(camera.calls).not.toContain('stop');
    // Still scanning, so the phone's code is read the moment it is in view.
    await phoneReads();
    holdUp(undefined);
    await scanOnce();
    expect(port.currentSideCamera()?.control.sideControlState().answered).toBe(true);
  });

  it('voids an unanswered offer when the screen closes — ADR 0033 D-4', async () => {
    const { port } = await tablet();
    await press('Pair a phone');
    const pairing = port.currentSideCamera();
    const offer = pairing?.offerCode ?? '';
    mounted?.unmount();
    mounted = undefined;
    await settle();
    expect(pairing?.control.sideControlState().ended).toBe('ended-here');
    // The offer can no longer be answered…
    const phone = await port.answerSideCamera(offer);
    if (typeof phone !== 'object') {
      throw new Error(phone);
    }
    expect(await pairing?.acceptSidePhoneCode(phone.answerCode)).toBe('used');
  });

  it('meets the rider coming back with a fresh start, not with “you ended it”', async () => {
    const { port, controller } = await tablet();
    await press('Pair a phone');
    mounted?.unmount();
    await settle();
    mounted = await mount(<SideCameraControl controller={controller} pairing={port} />);
    await settle();
    expect(button('Pair a phone')).toBeDefined();
    expect(document.body.textContent).not.toContain(SIDE_PAIRING_END_TEXT['ended-here']);
    expect(document.querySelector('[data-oyl-pairing-code]')).toBeNull();
  });

  it('keeps the offer up under StrictMode, whose second mount is not the screen closing', async () => {
    const { port, controller } = await tablet();
    mounted?.unmount();
    mounted = await mount(
      <StrictMode>
        <SideCameraControl controller={controller} pairing={port} />
      </StrictMode>,
    );
    await settle();
    await press('Pair a phone');
    await settle();
    expect(port.currentSideCamera()?.control.sideControlState().ended).toBeUndefined();
    expect(document.querySelector('[data-oyl-pairing-code]')).not.toBeNull();
  });

  it('says why a pairing could not even start', async () => {
    const port = sidePairingPort({ peer: () => undefined });
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    mounted = await mount(<SideCameraControl controller={controller} pairing={port} />);
    await press('Pair a phone');
    expect(document.body.textContent).toContain(PAIRING_REFUSAL_TEXT.unavailable);
  });
});

describe('driving the phone, on the tablet', () => {
  async function paired() {
    const context = await tablet();
    await press('Pair a phone');
    const phone = await context.phoneReads();
    await press('Read the phone’s code');
    await scanOnce();
    const heard: SideLinkEvent[] = [];
    phone.link.onSideLinkEvent((event) => heard.push(event));
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    await settle();
    return { ...context, phone, heard };
  }

  it('offers Start only while the phone is framing, and says when it is confirmed', async () => {
    const { phone, heard } = await paired();
    expect(button('Stop filming')).toBeUndefined();
    await press('Start filming');
    expect(heard).toContainEqual({ kind: 'start' });
    expect(document.body.textContent).toContain('The phone confirmed the start.');
    phone.link.reportToTablet({ state: 'filming' });
    await flushSideLink();
    await settle();
    expect(button('Start filming')).toBeUndefined();
    await press('Stop filming');
    expect(heard).toContainEqual({ kind: 'stop' });
  });

  it('shows the phone’s stop and why, when the phone says so', async () => {
    const { phone } = await paired();
    phone.link.reportToTablet({ state: 'stopped', reason: 'link-lost' });
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(SIDE_PHONE_STATE_TEXT.stopped);
    expect(document.body.textContent).toContain('losing touch');
  });

  it('ends the pairing from here, and offers a fresh one', async () => {
    const { phone } = await paired();
    await press('End pairing');
    expect(document.body.textContent).toContain(SIDE_PAIRING_END_TEXT['ended-here']);
    await flushSideLink();
    expect(phone.link.sideLinkCondition()).toBe('ended');
    expect(button('Pair a phone')).toBeDefined();
  });

  it('keeps the pairing when the screen goes away and comes back', async () => {
    const { port, controller } = await paired();
    mounted?.unmount();
    mounted = await mount(<SideCameraControl controller={controller} pairing={port} />);
    await settle();
    expect(document.body.textContent).toContain(SIDE_PHONE_STATE_TEXT.framing);
    expect(button('Start filming')).toBeDefined();
  });
});
