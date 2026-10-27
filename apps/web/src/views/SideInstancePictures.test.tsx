// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Camera screen's section for the rider's instance (#1106): two switches
 * off by default, each beside the sentence it is consent to; the hosted
 * service asked for only on a press and named in its consent; and one place
 * at a time between the instance and the rider's computer. Mounted through
 * `CameraView`, which is where a rider meets it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ANALYSIS_ENDPOINT_STORAGE_KEY } from '../camera/analysis-endpoint';
import {
  readSideInstanceChoice,
  SIDE_INSTANCE_CONSENT,
  SIDE_INSTANCE_HOSTED_STORAGE_KEY,
  SIDE_INSTANCE_STORAGE_KEY,
  SIDE_INSTANCE_WHAT_IS_SENT,
  sideInstanceHostedConsent,
  writeSideInstanceHostedConsent,
  writeSideInstanceSwitch,
} from '../camera/instance-pose';
import { browserSecureWindow } from '../camera/secure-window-testing';
import { CameraController } from '../camera/session';
import {
  readSideAnalyserOnComputer,
  SIDE_ANALYSER_STORAGE_KEY,
  writeSideAnalyserOnComputer,
} from '../camera/side-analyser';
import type { HostedPictureService } from '../camera/side-instance-port';
import { manualSchedule, scriptedCamera } from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { CameraView } from './CameraView';
import {
  SIDE_INSTANCE_NO_KEY,
  SIDE_INSTANCE_NOT_SIGNED_IN,
  SIDE_INSTANCE_OFF_TEXT,
  SIDE_INSTANCE_ON_TEXT,
  sideInstanceConsentMoved,
} from './SideInstancePictures';

const ORIGIN = 'https://models.example';
/** The instance the device is signed in to, in these tests. */
const INSTANCE_AT = 'https://rides.example';
const HELD: HostedPictureService = { kind: 'held', origin: ORIGIN, host: 'models.example' };

let mounted: Mounted | undefined;
const KEYS = [
  SIDE_INSTANCE_STORAGE_KEY,
  SIDE_INSTANCE_HOSTED_STORAGE_KEY,
  SIDE_ANALYSER_STORAGE_KEY,
  ANALYSIS_ENDPOINT_STORAGE_KEY,
];
beforeEach(() => {
  for (const key of KEYS) localStorage.removeItem(key);
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  for (const key of KEYS) localStorage.removeItem(key);
});

/** The Camera screen, agreed to, with an instance that answers `service` when asked. */
async function screen(
  options: {
    signedIn?: boolean;
    instance?: string;
    service?: HostedPictureService;
    port?: false;
  } = {},
): Promise<{ asked: () => number; answer: (next: HostedPictureService) => void }> {
  const controller = new CameraController({
    secureWindow: browserSecureWindow(),
    port: scriptedCamera().port,
    schedule: manualSchedule().schedule,
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true });
  let asked = 0;
  let service = options.service ?? { kind: 'none' };
  mounted = await mount(
    options.port === false ? (
      <CameraView controller={controller} />
    ) : (
      <CameraView
        controller={controller}
        sidePictures={{
          sideInstanceOrigin: () =>
            options.signedIn === false ? undefined : (options.instance ?? INSTANCE_AT),
          askHostedPictureService: () => {
            asked += 1;
            return Promise.resolve(service);
          },
        }}
      />
    ),
  );
  await settle();
  return {
    asked: () => asked,
    answer: (next) => {
      service = next;
    },
  };
}

function boxLabelled(text: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document, 'input[type="checkbox"]').find((box) =>
    (box.closest('label')?.textContent ?? '').includes(text),
  );
}
const instanceBox = (): HTMLInputElement | undefined => boxLabelled('pictures to my instance');
const hostedBox = (host = 'models.example'): HTMLInputElement | undefined =>
  boxLabelled(`pictures on to ${host}`);
const section = (): string =>
  document.querySelector('[aria-labelledby="oyl-camera-instance"]')?.textContent ?? '';

async function tick(box: HTMLInputElement | undefined): Promise<void> {
  if (box === undefined) throw new Error('no such switch on the screen');
  box.click();
  await settle();
}

async function ask(): Promise<void> {
  const button = queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').includes('Ask my instance which service my key is for'),
  );
  if (button === undefined) throw new Error('no ask button on the screen');
  await activateWithKeyboard(button);
  await settle();
}

describe('the instance’s section on the Camera screen (#1106)', () => {
  it('is not there at all where no port was built', async () => {
    await screen({ port: false });
    expect(document.querySelector('[aria-labelledby="oyl-camera-instance"]')).toBeNull();
    expect(document.body.textContent).not.toContain(SIDE_INSTANCE_WHAT_IS_SENT);
  });

  it('says what is sent, and offers no switch, on a device signed in to no instance', async () => {
    await screen({ signedIn: false });
    expect(section()).toContain(SIDE_INSTANCE_WHAT_IS_SENT);
    expect(section()).toContain(SIDE_INSTANCE_NOT_SIGNED_IN);
    expect(instanceBox()).toBeUndefined();
    expect(section()).not.toContain(SIDE_INSTANCE_CONSENT);
  });

  it('starts OFF beside its consent sentence, and asks the instance nothing by being opened', async () => {
    const { asked } = await screen();
    const box = instanceBox();
    expect(box?.checked).toBe(false);
    expect(readSideInstanceChoice(INSTANCE_AT)).toBeUndefined();
    expect(document.getElementById(box?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      SIDE_INSTANCE_CONSENT,
    );
    expect(section()).toContain(SIDE_INSTANCE_OFF_TEXT);
    // The hosted service is not offered, or asked about, under a switch that is off.
    expect(section()).not.toContain('A hosted service, on your own key');
    expect(asked()).toBe(0);
  });

  it('names the instance beside the switch, and is agreement for that instance alone', async () => {
    await screen();
    expect(instanceBox()?.closest('label')?.textContent).toContain(
      'pictures to my instance, rides.example',
    );
    await tick(instanceBox());
    expect(localStorage.getItem(SIDE_INSTANCE_STORAGE_KEY)).toBe(INSTANCE_AT);
    mounted?.unmount();
    // The same device, now signed in to another instance: the switch is off there.
    await screen({ instance: 'https://project.example' });
    expect(instanceBox()?.checked).toBe(false);
    expect(instanceBox()?.closest('label')?.textContent).toContain('project.example');
    expect(readSideInstanceChoice('https://project.example')).toBeUndefined();
  });

  it('is stored when ticked and gone when unticked', async () => {
    await screen();
    await tick(instanceBox());
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({ source: 'instance-local' });
    expect(instanceBox()?.checked).toBe(true);
    expect(section()).toContain(SIDE_INSTANCE_ON_TEXT);
    await tick(instanceBox());
    expect(localStorage.getItem(SIDE_INSTANCE_STORAGE_KEY)).toBeNull();
    expect(section()).toContain(SIDE_INSTANCE_OFF_TEXT);
  });
});

describe('sending them on to a hosted service, by name (#1106, ruling 3)', () => {
  it('asks the instance only on a press, and names the service in a consent that starts OFF', async () => {
    const { asked } = await screen({ service: HELD });
    await tick(instanceBox());
    expect(asked()).toBe(0);
    expect(hostedBox()).toBeUndefined();
    await ask();
    expect(asked()).toBe(1);
    const box = hostedBox();
    expect(box?.checked).toBe(false);
    const consent = document.getElementById(box?.getAttribute('aria-describedby') ?? '');
    expect(consent?.textContent).toBe(sideInstanceHostedConsent('models.example').join(''));
    expect(consent?.querySelector('strong')?.textContent).toBe(
      'This sends pictures of you to models.example.',
    );
    // Asking changed nothing: pictures still go to the instance's own model.
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({ source: 'instance-local' });
    expect(section()).toContain('Off. No picture is sent on to models.example.');
  });

  it('stores the consent as the origin it named, and removes it alone when unticked', async () => {
    await screen({ service: HELD });
    await tick(instanceBox());
    await ask();
    await tick(hostedBox());
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({
      source: 'instance-hosted',
      endpoint: ORIGIN,
    });
    expect(section()).toContain(
      'On. The next picture your instance is sent goes on to models.example.',
    );
    await tick(hostedBox());
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({ source: 'instance-local' });
    expect(instanceBox()?.checked).toBe(true);
  });

  it('takes the hosted consent away with the first switch', async () => {
    await screen({ service: HELD });
    await tick(instanceBox());
    await ask();
    await tick(hostedBox());
    await tick(instanceBox());
    expect(localStorage.getItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SIDE_INSTANCE_STORAGE_KEY)).toBeNull();
    // Switched on again: nothing is sent on, and the service is not shown until asked for again.
    await tick(instanceBox());
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({ source: 'instance-local' });
    expect(hostedBox()).toBeUndefined();
  });

  it('shows a consent already given, on, before the instance is asked again', async () => {
    writeSideInstanceSwitch(INSTANCE_AT);
    writeSideInstanceHostedConsent(ORIGIN);
    const { asked } = await screen({ service: HELD });
    expect(hostedBox()?.checked).toBe(true);
    expect(asked()).toBe(0);
  });

  it('says so, and shows the new service OFF, when the key is now for another service', async () => {
    writeSideInstanceSwitch(INSTANCE_AT);
    writeSideInstanceHostedConsent(ORIGIN);
    await screen({
      service: { kind: 'held', origin: 'https://other.example', host: 'other.example' },
    });
    await ask();
    expect(section()).toContain(sideInstanceConsentMoved('models.example', 'other.example'));
    expect(hostedBox('other.example')?.checked).toBe(false);
    expect(hostedBox('models.example')).toBeUndefined();
    // Nothing was agreed to for the new one by showing it.
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({
      source: 'instance-hosted',
      endpoint: ORIGIN,
    });
    await tick(hostedBox('other.example'));
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({
      source: 'instance-hosted',
      endpoint: 'https://other.example',
    });
  });

  it('says there is no key, offers no consent, and lets an old consent be withdrawn', async () => {
    writeSideInstanceSwitch(INSTANCE_AT);
    writeSideInstanceHostedConsent(ORIGIN);
    await screen({ service: { kind: 'none' } });
    await ask();
    expect(section()).toContain(SIDE_INSTANCE_NO_KEY);
    expect(hostedBox()).toBeUndefined();
    const withdraw = queryAll<HTMLButtonElement>(document, 'button').find((each) =>
      (each.textContent ?? '').includes('Withdraw what I agreed to for models.example'),
    );
    if (withdraw === undefined) throw new Error('no withdraw control');
    await activateWithKeyboard(withdraw);
    await settle();
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({ source: 'instance-local' });
  });

  it('shows the instance’s own sentence when it could not be asked, and offers no consent', async () => {
    await screen({
      service: { kind: 'unavailable', text: 'Sealed requests are not offered here.' },
    });
    await tick(instanceBox());
    await ask();
    expect(section()).toContain('Sealed requests are not offered here.');
    expect(hostedBox()).toBeUndefined();
  });
});

describe('one place at a time: the instance or the rider’s computer (#1106)', () => {
  function storedComputerOn(): void {
    localStorage.setItem(
      ANALYSIS_ENDPOINT_STORAGE_KEY,
      JSON.stringify({ address: 'http://192.168.1.20:8080', model: 'm', switchedOn: true }),
    );
  }
  const computerBox = (): HTMLInputElement | undefined =>
    boxLabelled('side camera’s pictures to this computer');

  it('switches the computer’s side switch off when the instance’s goes on, and shows it off', async () => {
    storedComputerOn();
    writeSideAnalyserOnComputer(true);
    await screen();
    expect(computerBox()?.checked).toBe(true);
    await tick(instanceBox());
    expect(readSideAnalyserOnComputer()).toBe(false);
    expect(computerBox()?.checked).toBe(false);
    expect(readSideInstanceChoice(INSTANCE_AT)).toStrictEqual({ source: 'instance-local' });
  });

  it('switches the instance’s off, and its hosted consent with it, when the computer’s goes on', async () => {
    storedComputerOn();
    writeSideInstanceSwitch(INSTANCE_AT);
    writeSideInstanceHostedConsent(ORIGIN);
    await screen();
    expect(instanceBox()?.checked).toBe(true);
    await tick(computerBox());
    expect(readSideAnalyserOnComputer()).toBe(true);
    expect(readSideInstanceChoice(INSTANCE_AT)).toBeUndefined();
    expect(instanceBox()?.checked).toBe(false);
    expect(localStorage.getItem(SIDE_INSTANCE_HOSTED_STORAGE_KEY)).toBeNull();
  });

  it('leaves the other alone when one is switched OFF', async () => {
    storedComputerOn();
    writeSideInstanceSwitch(INSTANCE_AT);
    await screen();
    // The computer's side switch is off; unticking the instance's does not turn it on.
    await tick(instanceBox());
    expect(readSideAnalyserOnComputer()).toBe(false);
    expect(readSideInstanceChoice(INSTANCE_AT)).toBeUndefined();
  });

  it('does not say the pictures go nowhere else when only the computer’s switch is off', async () => {
    storedComputerOn();
    writeSideInstanceSwitch(INSTANCE_AT);
    await screen();
    expect(computerBox()?.checked).toBe(false);
    expect(document.body.textContent).not.toContain('go nowhere else');
    expect(document.body.textContent).toContain(
      'Off. No picture is sent to your computer from the side camera.',
    );
  });
});
