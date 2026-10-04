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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIMARY_BUTTON_SELECTOR } from '../a11y/button-hierarchy';
import { CameraController } from '../camera/session';
import {
  SIDE_PAIRING_END_TEXT,
  SIDE_PHONE_STATE_TEXT,
  SILENCE_IS_LOST_MILLISECONDS,
  sidePairingPort,
  type SidePairingOptions,
} from '../camera/side-link';
import { FRAMING_CHECK_POSES, SideAnalysis } from '../camera/side-analysis';
import type { SidePoseOutcome } from '../camera/side-analysis-port';
import { FRAMING_VERDICT_TEXT } from '../camera/framing';
import { PAIRING_REFUSAL_TEXT } from '../camera/side-link-code';
import { pairingCodeModules } from '../camera/side-link-qr';
import type { PhoneSidePairing } from '../camera/side-pairing-port';
import type { SideLinkEvent } from '../camera/side-camera-link-port';
import { PAIRING_READER_UNLOADED } from '../camera/usePairingScan';
import {
  cleanFrameBytes,
  flushSideLink,
  manualSchedule,
  photographedCode,
  scriptedCamera,
  sidePeerNetwork,
  type ScriptedCameraOptions,
  virtualTime,
} from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { SecureWindow } from '../camera/secure-window';
import { SIDE_LIVE_PICTURE_LABEL } from '../camera/SideLiveView';
import type { SideLiveEstimator, SideShownLook } from '../camera/side-live-view-port';

import {
  SIDE_FRAMING_TEXT,
  SideCameraControl,
  sidePicturesText,
  TABLET_NEXT_STEP,
  TABLET_SCAN_NEEDS_CONSENT,
} from './SideCameraControl';

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

async function tablet(
  options: {
    readonly agreed?: boolean;
    readonly readerFails?: boolean;
    readonly analyse?: SidePairingOptions['analyse'];
    readonly camera?: Pick<ScriptedCameraOptions, 'startFails' | 'startFailsFacing' | 'holdStarts'>;
    readonly secureWindow?: SecureWindow;
  } = {},
) {
  const network = sidePeerNetwork();
  const time = virtualTime();
  const port = sidePairingPort({
    peer: network.peer,
    clock: time.clock,
    after: time.after,
    every: time.every,
    analyse: options.analyse,
  });
  let phone: PhoneSidePairing | undefined;
  /** A code held up to the tablet's camera instead of the phone's, when set. */
  let inView: string | undefined;
  const camera = scriptedCamera({
    ...options.camera,
    codePixels: () => {
      const shown = inView ?? phone?.answerCode;
      return shown === undefined
        ? { width: 4, height: 4, rgba: new Uint8ClampedArray(64).fill(255) }
        : photographedCode(pairingCodeModules(shown));
    },
  });
  let readerLoads = 0;
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
    ...(options.secureWindow === undefined ? {} : { secureWindow: options.secureWindow }),
    ...(options.readerFails === true
      ? {
          loadCodeReader: async () => {
            readerLoads += 1;
            return Promise.reject(new Error('the chunk would not load'));
          },
        }
      : {}),
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
  return {
    port,
    camera,
    controller,
    phoneReads,
    time,
    network,
    holdUp,
    readerLoads: () => readerLoads,
  };
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

  it('reads with the FRONT camera, and shows what it sees while, and only while, it reads — #557', async () => {
    const { camera, phoneReads } = await tablet();
    await press('Pair a phone');
    expect(document.querySelector('[data-oyl-scan-viewfinder]')).toBeNull();
    await phoneReads();
    await press('Read the phone’s code');
    expect(camera.facings).toStrictEqual(['user']);
    expect(document.querySelector('[data-oyl-scan-viewfinder] video')).not.toBeNull();
    expect(camera.calls).toContain('preview');
    await scanOnce();
    // Paired: the viewfinder is gone and the stream is off it.
    expect(document.querySelector('[data-oyl-scan-viewfinder]')).toBeNull();
    expect(camera.calls).toContain('preview-detached');
  });

  it('takes the viewfinder down when the rider stops looking — #557', async () => {
    const { camera } = await tablet();
    await press('Pair a phone');
    await press('Read the phone’s code');
    expect(document.querySelector('[data-oyl-scan-viewfinder]')).not.toBeNull();
    await press('Stop looking');
    expect(document.querySelector('[data-oyl-scan-viewfinder]')).toBeNull();
    expect(camera.calls).toContain('preview-detached');
  });

  it('puts the tablet’s own next step in front of the rider, focused, as soon as the offer is up — #557', async () => {
    await tablet();
    await press('Pair a phone');
    const read = button('Read the phone’s code');
    expect(read).toBeDefined();
    expect(document.activeElement).toBe(read);
    const described = read?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toContain(TABLET_NEXT_STEP);
    await press('Read the phone’s code');
    // The pressed button is gone; focus is not left on the page.
    expect(document.activeElement).toBe(button('Stop looking'));
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

  it('turns a camera still coming on off again when the screen went away first — #550’s second review', async () => {
    // The review's probe: `turnOn` held behind a promise, the screen closed
    // while it was pending, then released. Before the fix the camera came on
    // with no screen owning it and `live` stayed true.
    const { camera, controller } = await tablet();
    const realTurnOn = controller.turnOn.bind(controller);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    controller.turnOn = async () => {
      await gate;
      return realTurnOn();
    };
    await press('Pair a phone');
    await press('Read the phone’s code');
    expect(camera.calls).not.toContain('start');
    mounted?.unmount();
    mounted = undefined;
    release();
    await settle();
    await settle();
    expect(camera.calls).toContain('start');
    expect(controller.state().live).toBe(false);
    expect(camera.calls).toContain('stop');
  });

  it('stops looking, turns its camera off and says so when the code reader will not load', async () => {
    const { camera, controller, readerLoads } = await tablet({ readerFails: true });
    await press('Pair a phone');
    await press('Read the phone’s code');
    expect(controller.state().live).toBe(true);
    await scanOnce();
    await scanOnce();
    await scanOnce();
    expect(document.body.textContent).toContain(PAIRING_READER_UNLOADED);
    expect(document.body.textContent).not.toContain('Looking for the phone’s code');
    expect(button('Read the phone’s code')).toBeDefined();
    // The camera this section turned on for the scan is off again, and the
    // chunk was asked for once rather than every tick.
    expect(controller.state().live).toBe(false);
    expect(camera.calls).toContain('stop');
    expect(readerLoads()).toBe(1);
  });

  it('leaves alone a FRONT camera the rider turned on themselves', async () => {
    const { camera, controller } = await tablet();
    await controller.turnOn('user');
    await press('Pair a phone');
    await press('Read the phone’s code');
    await press('Stop looking');
    expect(camera.calls).not.toContain('stop');
    expect(camera.facings).toStrictEqual(['user']);
    expect(controller.state().live).toBe(true);
  });

  it('turns a back camera the rider left on round to read, and back again afterwards — #557', async () => {
    // The owner's own route in: "Turn the camera on" above, then pairing. The
    // scan used to read with that back camera, blind.
    const { camera, controller } = await tablet();
    await controller.turnOn();
    await press('Pair a phone');
    await press('Read the phone’s code');
    expect(controller.state()).toMatchObject({ live: true, facing: 'user' });
    await press('Stop looking');
    await settle();
    expect(camera.facings).toStrictEqual(['environment', 'user', 'environment']);
    expect(controller.state()).toMatchObject({ live: true, facing: 'environment' });
  });

  it('turns the rider’s own back camera on again when the front one will not come on — #566’s review', async () => {
    // The back camera goes off to be turned round, the front one fails: the
    // rider's camera is theirs again rather than left off unasked.
    const { camera, controller } = await tablet({
      camera: { startFails: 'unavailable', startFailsFacing: 'user' },
    });
    await controller.turnOn();
    await press('Pair a phone');
    await press('Read the phone’s code');
    await settle();
    expect(camera.facings).toStrictEqual(['environment', 'user', 'environment']);
    expect(controller.state()).toMatchObject({ live: true, facing: 'environment' });
    expect(document.body.textContent).toContain('This tablet’s camera would not turn on.');
  });

  it('starts nothing for a press while the rider’s own camera is being turned back on — #566’s re-review', async () => {
    // The front camera fails, and the back one is on its way back. A press
    // then used to find no live camera and start a second `turnOn` alongside
    // the restore: the two-`startCamera` race the double-press guard closes.
    const { camera, controller } = await tablet({
      camera: { startFails: 'unavailable', startFailsFacing: 'user', holdStarts: true },
    });
    const on = controller.turnOn();
    await settle();
    camera.releaseStarts();
    await on;
    await press('Pair a phone');
    await press('Read the phone’s code');
    // The front camera is asked for and fails; the restore is now held.
    camera.releaseStarts();
    await settle();
    await settle();
    expect(camera.facings).toStrictEqual(['environment', 'user', 'environment']);
    await press('Read the phone’s code');
    camera.releaseStarts();
    await settle();
    await settle();
    camera.releaseStarts();
    await settle();
    expect(camera.facings).toStrictEqual(['environment', 'user', 'environment']);
    expect(camera.liveStreams()).toBe(1);
    expect(controller.state()).toMatchObject({ live: true, facing: 'environment' });
    // And once the restore has settled, a press is a press again.
    await press('Read the phone’s code');
    expect(camera.facings).toStrictEqual(['environment', 'user', 'environment', 'user']);
  });

  it('starts one camera for a double press, and leaves none running after Stop looking — #566’s review', async () => {
    const { camera } = await tablet({ camera: { holdStarts: true } });
    await press('Pair a phone');
    await press('Read the phone’s code');
    await press('Read the phone’s code');
    camera.releaseStarts();
    await settle();
    await settle();
    expect(camera.calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(camera.liveStreams()).toBe(1);
    await press('Stop looking');
    expect(camera.liveStreams()).toBe(0);
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

  it('keeps the offer when a section showing it is remounted in the same tick', async () => {
    // #550's second review: a per-instance flag let the OLD section's
    // microtask void the offer the NEW one had already put on screen.
    const { port, controller } = await tablet();
    mounted?.unmount();
    mounted = await mount(<SideCameraControl key="a" controller={controller} pairing={port} />);
    await settle();
    await press('Pair a phone');
    await mounted.rerender(<SideCameraControl key="b" controller={controller} pairing={port} />);
    await settle();
    expect(port.currentSideCamera()?.control.sideControlState().ended).toBeUndefined();
    expect(document.querySelector('[data-oyl-pairing-code]')).not.toBeNull();
    expect(document.body.textContent).not.toContain(SIDE_PAIRING_END_TEXT['ended-here']);
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

  it('draws no primary of its own in any state, because the Camera screen’s is its way in (#668)', async () => {
    // `CameraView` puts this section under its one primary, the link to the
    // phone's screen (#557). Every button here is therefore secondary, and a
    // primary appearing in any state would be the view's second.
    const primaries = (): string[] =>
      queryAll(document, PRIMARY_BUTTON_SELECTOR).map((each) => each.textContent?.trim() ?? '');
    const context = await tablet();
    expect(button('Pair a phone')).toBeDefined();
    expect(primaries(), 'not paired').toEqual([]);
    await press('Pair a phone');
    const phone = await context.phoneReads();
    expect(button('Read the phone’s code')).toBeDefined();
    expect(primaries(), 'offer up').toEqual([]);
    await press('Read the phone’s code');
    expect(button('Stop looking')).toBeDefined();
    expect(primaries(), 'reading the code').toEqual([]);
    await scanOnce();
    phone.link.reportToTablet({ state: 'framing' });
    await flushSideLink();
    await settle();
    expect(button('Start filming')).toBeDefined();
    expect(primaries(), 'framing').toEqual([]);
    await press('Start filming');
    phone.link.reportToTablet({ state: 'filming' });
    await flushSideLink();
    await settle();
    expect(button('Stop filming')).toBeDefined();
    expect(primaries(), 'filming').toEqual([]);
    await press('End pairing');
    expect(button('Pair a phone')).toBeDefined();
    expect(primaries(), 'ended').toEqual([]);
  });

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

  it('agrees with the phone about who ended it, after Stop filming on this tablet — #557', async () => {
    // The owner's fifth finding: the phone said "Your tablet ended the
    // session" and this tablet said the phone had ended it.
    const { phone } = await paired();
    phone.link.reportToTablet({ state: 'stopped', reason: 'tablet' });
    await flushSideLink();
    phone.link.endSideLink();
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(SIDE_PAIRING_END_TEXT['ended-here']);
    expect(document.body.textContent).not.toContain(SIDE_PAIRING_END_TEXT['phone-ended']);
  });

  it('still says the phone ended it when the rider stopped it on the phone', async () => {
    const { phone } = await paired();
    phone.link.reportToTablet({ state: 'stopped', reason: 'rider' });
    await flushSideLink();
    phone.link.endSideLink();
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(SIDE_PAIRING_END_TEXT['phone-ended']);
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

describe('what the tablet says about the pictures — #530', () => {
  /** A pairing whose tablet looks at pictures with a model that answers `outcome`. */
  async function analysing(
    outcome: SidePoseOutcome = { kind: 'no-rider', cause: 'said-nobody' },
    place?: 'tablet' | 'computer',
  ) {
    const context = await tablet({
      analyse: (control) =>
        new SideAnalysis({
          control,
          estimator: () => ({
            estimateSidePose: async () => Promise.resolve(outcome),
            closeSidePoseModel: () => undefined,
          }),
          place,
        }),
    });
    await press('Pair a phone');
    const phone = await context.phoneReads();
    await press('Read the phone’s code');
    await scanOnce();
    phone.link.reportToTablet({ state: 'filming' });
    await flushSideLink();
    await settle();
    let sequence = 0;
    const send = async (count: number): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        phone.link.sendPictureToTablet({
          sequence,
          milliseconds: sequence * 200,
          bytes: cleanFrameBytes(),
        });
        sequence += 1;
        await flushSideLink();
        await settle();
      }
    };
    return { ...context, phone, send };
  }

  it('says none has arrived before the first picture, and that they are thrown away', async () => {
    await analysing();
    expect(document.body.textContent).toContain('None has arrived yet');
    // #1061: shown until the next replaces it, so no longer "at once".
    expect(document.body.textContent).toContain(
      'shown here until the next one replaces them, and then thrown away',
    );
    expect(document.body.textContent).not.toContain('thrown away at once');
  });

  it('counts the pictures looked at, and says nothing about what the model found in them', async () => {
    const { send } = await analysing();
    await send(3);
    const shown = document.querySelector('[data-oyl-side-pictures]');
    expect(shown?.getAttribute('data-oyl-side-pictures')).toBe('ready');
    expect(shown?.textContent).toBe(
      sidePicturesText({
        place: 'tablet',
        model: 'ready',
        posed: 0,
        noRider: 3,
        noRiderBecause: { 'said-nobody': 3, 'too-few-points': 0, implausible: 0 },
        unreadable: 0,
        skipped: 0,
        framing: 'no-reference',
        finished: false,
      }),
    );
    // Not a live region: a count that changes five times a second is not announced.
    expect(shown?.closest('[aria-live],[role="status"]')).toBeNull();
    // No picture, of any kind, on the screen.
    expect(document.querySelector('img, video, canvas[data-oyl-side-picture]')).toBeNull();
  });

  it('says the pictures go to the rider’s computer when that is where they go — #553', async () => {
    const { send } = await analysing({ kind: 'no-rider', cause: 'said-nobody' }, 'computer');
    const shown = (): string =>
      document.querySelector('[data-oyl-side-pictures]')?.textContent ?? '';
    expect(shown()).toContain('sent on to your computer');
    expect(shown()).not.toContain('on this tablet as they arrive');
    await send(2);
    expect(shown()).toBe(
      sidePicturesText({
        place: 'computer',
        model: 'ready',
        posed: 0,
        noRider: 2,
        noRiderBecause: { 'said-nobody': 2, 'too-few-points': 0, implausible: 0 },
        unreadable: 0,
        skipped: 0,
        framing: 'no-reference',
        finished: false,
      }),
    );
    expect(shown()).toContain('Pictures sent to your computer');
    expect(shown()).toContain('Your computer said nobody was there in 2,');
  });

  it('says why the computer’s answers came to nobody, cause by cause — #761', async () => {
    const { send } = await analysing({ kind: 'no-rider', cause: 'implausible' }, 'computer');
    const shown = (): string =>
      document.querySelector('[data-oyl-side-pictures]')?.textContent ?? '';
    await send(3);
    expect(shown()).toContain(
      'Your computer said nobody was there in 0, found too little of you to use in 0, ' +
        'and placed points no one on a bicycle could have in 3. This tablet uses none of those answers.',
    );
  });

  it('says nothing about causes on the tablet, or before the computer has said nobody', () => {
    const base = {
      model: 'ready',
      posed: 1,
      noRider: 0,
      noRiderBecause: { 'said-nobody': 0, 'too-few-points': 0, implausible: 0 },
      unreadable: 0,
      skipped: 0,
      framing: 'no-reference',
      finished: false,
    } as const;
    expect(sidePicturesText({ ...base, place: 'computer' })).not.toContain('Your computer said');
    expect(
      sidePicturesText({
        ...base,
        place: 'tablet',
        noRider: 1,
        noRiderBecause: { 'said-nobody': 1, 'too-few-points': 0, implausible: 0 },
      }),
    ).not.toContain('said nobody');
  });

  it('says the computer stopped being sent pictures when it could not be reached — #553', async () => {
    const { send } = await analysing({ kind: 'unavailable' }, 'computer');
    await send(1);
    expect(document.querySelector('[data-oyl-side-pictures]')?.textContent).toContain(
      'no more pictures are being sent to it',
    );
  });

  it('says there is no earlier session to line up with, when there is none', async () => {
    await analysing();
    expect(document.body.textContent).toContain(SIDE_FRAMING_TEXT['no-reference']);
    expect(SIDE_FRAMING_TEXT['no-reference']).toBe(FRAMING_VERDICT_TEXT['no-reference']);
  });

  it('says so when the model will not load, and that pictures are still thrown away', async () => {
    const { send } = await analysing({ kind: 'unavailable' });
    await send(1);
    expect(document.querySelector('[data-oyl-side-pictures]')?.textContent).toContain(
      'could not load its pose model',
    );
  });

  it('still shows the counts once the pairing has ended', async () => {
    const { send } = await analysing({
      kind: 'pose',
      pose: { aspect: 1, nearSide: 'left', landmarks: [] },
    });
    await send(FRAMING_CHECK_POSES - 1);
    await press('End pairing');
    expect(document.body.textContent).toContain(SIDE_PAIRING_END_TEXT['ended-here']);
    expect(document.querySelector('[data-oyl-side-pictures]')?.textContent).toContain(
      `with you in ${String(FRAMING_CHECK_POSES - 1)} of them`,
    );
  });
});

/** A decoded picture, as the worker hands one back: a size, and a close that is counted. */
function fakePixels(closed: { count: number }, width = 640, height = 360): ImageBitmap {
  return {
    width,
    height,
    close: () => {
      closed.count += 1;
    },
  };
}

/** A pose at one point, so a test can tell one picture's outline from another's. */
function poseAt(x: number): SidePoseOutcome {
  return {
    kind: 'pose',
    pose: {
      aspect: 16 / 9,
      nearSide: 'left',
      landmarks: [
        { name: 'shoulder', x, y: 0.3, visibility: 0.9 },
        { name: 'hip', x, y: 0.5, visibility: 0.9 },
        { name: 'knee', x: x + 0.05, y: 0.7, visibility: 0.9 },
      ],
    },
  };
}

describe('the live view: the side camera’s picture with its outline — #1061, ADR 0044', () => {
  /** Every picture the canvas was asked to draw, in order. jsdom draws nothing itself. */
  let drawn: unknown[] = [];
  beforeEach(() => {
    drawn = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: (source: unknown) => {
        drawn.push(source);
      },
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Each picture's answer, settled by the test when it chooses. */
  interface Pending {
    readonly settle: (look: SideShownLook) => void;
  }

  async function watching(options: { readonly secureWindow?: SecureWindow } = {}) {
    const pending: Pending[] = [];
    const shownAsked: boolean[] = [];
    const estimator: SideLiveEstimator = {
      estimateSidePose: async () => {
        shownAsked.push(false);
        return new Promise((resolve) => {
          pending.push({ settle: (look) => resolve(look.outcome) });
        });
      },
      estimateSidePoseShowingPicture: async () => {
        shownAsked.push(true);
        return new Promise((resolve) => {
          pending.push({ settle: resolve });
        });
      },
      closeSidePoseModel: () => undefined,
    };
    const context = await tablet({
      analyse: (control) => new SideAnalysis({ control, estimator: () => estimator }),
      ...options,
    });
    await press('Pair a phone');
    const phone = await context.phoneReads();
    await press('Read the phone’s code');
    await scanOnce();
    phone.link.reportToTablet({ state: 'filming' });
    await flushSideLink();
    await settle();
    let sequence = 0;
    const send = async (): Promise<void> => {
      phone.link.sendPictureToTablet({
        sequence,
        milliseconds: sequence * 200,
        bytes: cleanFrameBytes(),
      });
      sequence += 1;
      await flushSideLink();
      await settle();
    };
    const answer = async (index: number, look: SideShownLook): Promise<void> => {
      pending[index]?.settle(look);
      await settle();
      await settle();
    };
    return { ...context, phone, send, answer, shownAsked };
  }

  const picture = (): Element | null => document.querySelector('[data-oyl-live-sequence]');
  const outline = (): Element | null => document.querySelector('[data-oyl-live-outline-sequence]');
  const jointX = (name: string): number =>
    Number(document.querySelector(`[data-oyl-live-joint="${name}"]`)?.getAttribute('cx'));

  it('asks the model for its picture back only while the view is on screen', async () => {
    const { send, shownAsked } = await watching();
    await send();
    expect(shownAsked).toStrictEqual([true]);
  });

  it('never draws a picture with another picture’s outline — frame 1’s answer arriving after frame 2', async () => {
    const closed = { count: 0 };
    const { send, answer } = await watching();
    // Frame 0 goes to the model; frame 1 arrives while it is busy and waits.
    await send();
    await send();
    expect(picture()).toBeNull();
    // Frame 0's landmarks arrive AFTER frame 1's picture did.
    const first = fakePixels(closed);
    await answer(0, { outcome: poseAt(0.4), pixels: first });
    expect(picture()?.getAttribute('data-oyl-live-sequence')).toBe('0');
    expect(outline()?.getAttribute('data-oyl-live-outline-sequence')).toBe('0');
    expect(jointX('hip')).toBeCloseTo(0.4 * (640 / 360));
    expect(drawn.at(-1)).toBe(first);
    // Frame 1: the model found nobody. Its picture is drawn with NO outline,
    // never with frame 0's.
    const second = fakePixels(closed);
    await answer(1, {
      outcome: { kind: 'no-rider', cause: 'said-nobody' },
      pixels: second,
    });
    expect(drawn.at(-1)).toBe(second);
    expect(picture()?.getAttribute('data-oyl-live-sequence')).toBe('1');
    expect(outline()).toBeNull();
    expect(document.body.textContent).toContain('did not find you in this picture');
    // And the picture it replaced was let go: one held, never two (D-1).
    expect(closed.count).toBe(1);
  });

  it('draws each picture with its own outline as the pictures go on', async () => {
    const closed = { count: 0 };
    const { send, answer } = await watching();
    await send();
    await answer(0, { outcome: poseAt(0.3), pixels: fakePixels(closed) });
    await send();
    await answer(1, { outcome: poseAt(0.6), pixels: fakePixels(closed) });
    expect(picture()?.getAttribute('data-oyl-live-sequence')).toBe('1');
    expect(outline()?.getAttribute('data-oyl-live-outline-sequence')).toBe('1');
    expect(jointX('hip')).toBeCloseTo(0.6 * (640 / 360));
  });

  it('says what the picture is, and draws the guide solid and the outline dotted', async () => {
    const { send, answer } = await watching();
    await send();
    await answer(0, { outcome: poseAt(0.4), pixels: fakePixels({ count: 0 }) });
    const shown = picture();
    expect(shown?.getAttribute('role')).toBe('img');
    expect(shown?.getAttribute('aria-label')).toBe(SIDE_LIVE_PICTURE_LABEL);
    expect(shown?.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(shown?.querySelector('.oyl-framing__guide')).not.toBeNull();
    expect(shown?.querySelector('.oyl-framing__outline')).not.toBeNull();
    expect(document.body.textContent).toContain('The solid outline is where to stand the bike.');
    expect(document.body.textContent).toContain('The dotted line, with a dot at each point');
    // The framing check stays the primary signal, in words, ABOVE the picture.
    const words = document.querySelector('[data-oyl-side-pictures]');
    expect(words).not.toBeNull();
    expect(
      (words?.compareDocumentPosition(shown as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('removes the picture — not hides it — when the phone stops', async () => {
    const closed = { count: 0 };
    const { send, answer, phone } = await watching();
    await send();
    await answer(0, { outcome: poseAt(0.4), pixels: fakePixels(closed) });
    expect(document.querySelector('canvas')).not.toBeNull();
    phone.link.reportToTablet({ state: 'stopped', reason: 'rider' });
    await flushSideLink();
    await settle();
    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('[data-oyl-side-live]')).toBeNull();
    expect(document.body.textContent).toContain(SIDE_PHONE_STATE_TEXT.stopped);
    expect(closed.count).toBe(1);
  });

  it('removes the picture when the link is lost, and says so in words', async () => {
    const closed = { count: 0 };
    const { send, answer, network, time } = await watching();
    await send();
    await answer(0, { outcome: poseAt(0.4), pixels: fakePixels(closed) });
    expect(document.querySelector('canvas')).not.toBeNull();
    network.drop();
    time.advance(SILENCE_IS_LOST_MILLISECONDS + 1000);
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(SIDE_PHONE_STATE_TEXT.lost);
    expect(document.querySelector('canvas')).toBeNull();
    expect(closed.count).toBe(1);
  });

  it('holds Android’s secure window flag while the picture is shown, and lets it go after — D-12', async () => {
    const asked: boolean[] = [];
    const secureWindow = new SecureWindow(
      {
        setSecureWindow: async (secure) => {
          asked.push(secure);
          return Promise.resolve();
        },
      },
      { inForeground: () => true, onForeground: () => () => undefined },
    );
    const { send, answer, phone } = await watching({ secureWindow });
    // The scan's viewfinder held it, and gave it back once the code was read.
    expect(asked).toStrictEqual([true, false]);
    await send();
    await answer(0, { outcome: poseAt(0.4), pixels: fakePixels({ count: 0 }) });
    await settle();
    expect(secureWindow.holds).toBe(1);
    expect(asked.at(-1)).toBe(true);
    phone.link.reportToTablet({ state: 'stopped', reason: 'rider' });
    await flushSideLink();
    await settle();
    await settle();
    expect(secureWindow.holds).toBe(0);
    expect(asked.at(-1)).toBe(false);
  });

  it('makes no object URL and leaves no picture in storage — ADR 0029 D-10', async () => {
    const made: unknown[] = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (thing: Blob | MediaSource) => {
      made.push(thing);
      return original(thing);
    };
    try {
      const { send, answer } = await watching();
      for (let index = 0; index < 3; index += 1) {
        await send();
        await answer(index, { outcome: poseAt(0.4), pixels: fakePixels({ count: 0 }) });
      }
      expect(made).toStrictEqual([]);
      expect(await storedPictureBytes()).toStrictEqual([]);
    } finally {
      URL.createObjectURL = original;
    }
  });
});

/**
 * Every place a page can keep bytes, read afresh, for anything that looks like
 * a picture: a JPEG's start-of-image marker in `localStorage` or
 * `sessionStorage` (as text or base64), Cache Storage when the environment has
 * it, and every value in every IndexedDB database, through a fresh open.
 */
async function storedPictureBytes(): Promise<string[]> {
  const found: string[] = [];
  const looksLikeJpeg = (value: unknown): boolean => {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      return bytes[0] === 0xff && bytes[1] === 0xd8;
    }
    if (typeof value === 'string') {
      return (
        value.includes('/9j/') || value.startsWith('\u00ff\u00d8') || value.includes('data:image')
      );
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(looksLikeJpeg);
    }
    return false;
  };
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) ?? '';
      if (looksLikeJpeg(storage.getItem(key))) {
        found.push(`storage:${key}`);
      }
    }
  }
  if ('caches' in globalThis) {
    const names = await globalThis.caches.keys();
    found.push(...names.map((name) => `cache:${name}`));
  }
  for (const { name } of await indexedDB.databases()) {
    if (name === undefined) {
      continue;
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('could not open'));
      };
    });
    for (const store of Array.from(database.objectStoreNames)) {
      const values = await new Promise<unknown[]>((resolve) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => {
          resolve(request.result as unknown[]);
        };
      });
      if (values.some(looksLikeJpeg)) {
        found.push(`indexeddb:${name}/${store}`);
      }
    }
    database.close();
  }
  return found;
}
