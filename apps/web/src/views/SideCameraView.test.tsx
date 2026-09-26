// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The tripod phone's screen — #528. The consent that comes before the camera,
 * the framing screen, the filming sign with its one control, the countdown,
 * and *"stopped, link lost"* — rendered, and driven through the same
 * `SideCameraSession` production uses.
 *
 * What jsdom cannot say — that the sign is the dominant thing on a phone's
 * screen and that the stop control is 44 × 44 and uncovered — is
 * `browser/sidecamera.browser.spec.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BYSTANDER_SENTENCE } from '../camera/consent';
import { FRAMING_VERDICT_TEXT } from '../camera/framing';
import { CameraController } from '../camera/session';
import { LINK_LOSS_LIMIT_MILLISECONDS, LINK_LOSS_SENTENCE } from '../camera/side-camera';
import { CONNECT_LIMIT_MILLISECONDS, sidePairingPort } from '../camera/side-link';
import { PAIRING_REFUSAL_TEXT } from '../camera/side-link-code';
import { pairingCodeModules } from '../camera/side-link-qr';
import type { SidePairingPort, TabletSidePairing } from '../camera/side-pairing-port';
import {
  flushSideLink,
  manualSchedule,
  photographedCode,
  scriptedCamera,
  scriptedLink,
  sidePeerNetwork,
  virtualTime,
} from '../camera/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { FILMING_WORD, NOT_PAIRED_TEXT, SideCameraView } from './SideCameraView';
import { CAMERA_NO_PORT } from './CameraView';

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
}

async function tick(): Promise<void> {
  const box = queryAll<HTMLInputElement>(document, 'input[type="checkbox"]')[0];
  if (box === undefined) {
    expect.unreachable('no acknowledgement box');
    return;
  }
  box.click();
  await settle();
}

/** A phone on the screen, with a link and virtual time. */
async function phone(options: { readonly paired?: boolean } = {}): Promise<{
  readonly camera: ReturnType<typeof scriptedCamera>;
  readonly link: ReturnType<typeof scriptedLink>;
  readonly time: ReturnType<typeof virtualTime>;
  readonly immersive: boolean[];
}> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
  });
  const link = scriptedLink();
  const time = virtualTime();
  const immersive: boolean[] = [];
  mounted = await mount(
    <SideCameraView
      controller={controller}
      {...(options.paired === false ? {} : { link })}
      timers={time}
      onImmersive={(value) => {
        immersive.push(value);
      }}
    />,
  );
  await settle();
  return { camera, link, time, immersive };
}

/** Consent given, the camera on, and the tablet's start received. */
async function filming(): Promise<Awaited<ReturnType<typeof phone>>> {
  const screen = await phone();
  await tick();
  await press('Turn the camera on');
  screen.link.emit({ kind: 'start' });
  await settle();
  return screen;
}

describe('before the camera is ever on', () => {
  it('explains rather than offering a control, with no camera port', async () => {
    mounted = await mount(<SideCameraView />);
    expect(document.body.textContent).toContain(CAMERA_NO_PORT);
    expect(queryAll(document, 'button')).toHaveLength(0);
  });

  it('shows the bystander sentence AND the 30-second sentence on this device first', async () => {
    const { camera } = await phone();
    expect(document.body.textContent).toContain(BYSTANDER_SENTENCE);
    expect(document.body.textContent).toContain(LINK_LOSS_SENTENCE);
    // And nothing has been asked of the camera: shown BEFORE, not beside.
    expect(camera.calls).toStrictEqual([]);
  });

  it('refuses to turn the camera on until both are acknowledged', async () => {
    const { camera } = await phone();
    await press('Turn the camera on');
    expect(document.body.textContent).toContain('Tick the box');
    expect(camera.calls).toStrictEqual([]);
  });

  it('turns it on once they are', async () => {
    const { camera } = await phone();
    await tick();
    await press('Turn the camera on');
    expect(camera.calls).toContain('start');
  });
});

describe('framing', () => {
  it('shows the live picture with the guide over it', async () => {
    const { camera } = await phone();
    await tick();
    await press('Turn the camera on');
    expect(document.querySelector('video')).not.toBeNull();
    expect(document.querySelectorAll('.oyl-framing__guide circle').length).toBeGreaterThan(0);
    expect(camera.calls).toContain('preview');
  });

  it('draws last time’s outline and says what the tablet’s check found', async () => {
    const { link } = await phone();
    await tick();
    await press('Turn the camera on');
    link.emit({
      kind: 'reference',
      reference: {
        aspect: 16 / 9,
        landmarks: [
          { name: 'shoulder', x: 0.5, y: 0.3 },
          { name: 'hip', x: 0.42, y: 0.45 },
          { name: 'knee', x: 0.5, y: 0.62 },
        ],
      },
    });
    link.emit({ kind: 'verdict', verdict: 'differs' });
    await settle();
    expect(document.querySelectorAll('.oyl-framing__ghost line').length).toBe(2);
    expect(document.body.textContent).toContain(FRAMING_VERDICT_TEXT.differs);
  });

  it('says an unpaired phone cannot film, rather than offering a start', async () => {
    await phone({ paired: false });
    await tick();
    await press('Turn the camera on');
    expect(document.body.textContent).toContain(NOT_PAIRED_TEXT);
    expect(button('Start')).toBeUndefined();
  });

  it('turns the camera off from here too', async () => {
    const { camera } = await phone();
    await tick();
    await press('Turn the camera on');
    await press('Turn the camera off');
    expect(camera.calls).toContain('stop');
    expect(camera.calls).toContain('preview-detached');
  });
});

describe('filming', () => {
  it('is the sign and ONE control, and nothing else', async () => {
    const { immersive } = await filming();
    expect(document.querySelector('[data-oyl-side-camera-stage]')).not.toBeNull();
    expect(document.body.textContent).toContain(FILMING_WORD);
    const controls = queryAll(document, 'button, a[href], input, select, textarea');
    expect(controls.map((each) => each.textContent)).toStrictEqual(['Stop filming']);
    // No preview while filming: the picture is not on the sign.
    expect(document.querySelector('video')).toBeNull();
    // And the shell was told, so its chrome goes too.
    expect(immersive).toStrictEqual([true]);
  });

  it('counts down when the link is lost, and says "stopped, link lost" at 30 s', async () => {
    const { link, time, camera, immersive } = await filming();
    link.emit({ kind: 'condition', condition: 'lost' });
    await settle();
    expect(document.querySelector('[role="timer"]')?.textContent).toContain('30 seconds');

    time.advance(10_000);
    await settle();
    expect(document.querySelector('[role="timer"]')?.textContent).toContain('20 seconds');

    time.advance(LINK_LOSS_LIMIT_MILLISECONDS - 10_000);
    await settle();
    expect(camera.calls.filter((call) => call === 'stop')).toHaveLength(1);
    expect(document.body.textContent).toContain('Stopped, link lost.');
    // The sign has gone and the shell has its chrome back.
    expect(document.querySelector('[data-oyl-side-camera-stage]')).toBeNull();
    expect(immersive).toStrictEqual([true, false]);
  });

  it('stops on the one control', async () => {
    const { camera, link } = await filming();
    await press('Stop filming');
    expect(camera.calls.filter((call) => call === 'stop')).toHaveLength(1);
    expect(link.reports.at(-1)).toStrictEqual({ state: 'stopped', reason: 'rider' });
  });

  it('starts a fresh session on "Set up again", with the consent shown again', async () => {
    await filming();
    await press('Stop filming');
    await press('Set up again');
    expect(document.body.textContent).toContain(LINK_LOSS_SENTENCE);
    expect(button('Turn the camera on')).toBeDefined();
  });

  it('stops the camera when the rider leaves the screen mid-session', async () => {
    const { camera } = await filming();
    mounted?.unmount();
    mounted = undefined;
    expect(camera.calls.filter((call) => call === 'stop')).toHaveLength(1);
  });
});

describe('a pairing lasts one session — #529, from #536’s review', () => {
  it('"Set up again" does not reuse the link the last session ended', async () => {
    // The finding: the old screen handed the ended link to the new session,
    // which then said "Paired with your tablet" over a pairing that was over.
    await filming();
    await press('Stop filming');
    await press('Set up again');
    await tick();
    await press('Turn the camera on');
    expect(document.body.textContent).not.toContain('Paired with your tablet');
    expect(document.body.textContent).toContain(NOT_PAIRED_TEXT);
    expect(button('Start')).toBeUndefined();
  });
});

describe('pairing the phone with the tablet — #529', () => {
  /** Real milliseconds: the scan's own interval, which a test does not own. */
  async function scanOnce(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    await flushSideLink();
    await settle();
  }

  async function pairingPhone(options: { readonly showAnswer?: boolean } = {}) {
    const network = sidePeerNetwork();
    const time = virtualTime();
    const port = sidePairingPort({
      peer: network.peer,
      clock: time.clock,
      after: time.after,
      every: time.every,
    });
    const answers: string[] = [];
    const phonePort: SidePairingPort = {
      offerSideCamera: async () => port.offerSideCamera(),
      currentSideCamera: () => port.currentSideCamera(),
      answerSideCamera: async (offerCode) => {
        const made = await port.answerSideCamera(offerCode);
        if (typeof made === 'object') {
          answers.push(made.answerCode);
        }
        return made;
      },
    };
    // The tablet is another device on the same network; its offer is what
    // the phone's camera sees.
    const tablet = (await port.offerSideCamera()) as TabletSidePairing;
    // `showAnswer`: the phone's camera is pointed at an ANSWER code — the
    // wrong step's — which it must refuse and go on looking.
    const shown =
      options.showAnswer === true
        ? tablet.offerCode.replace('"r":"o"', '"r":"a"').replace(/,"k":"[^"]+"/, '')
        : tablet.offerCode;
    const camera = scriptedCamera({
      codePixels: () => photographedCode(pairingCodeModules(shown)),
    });
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    mounted = await mount(
      <SideCameraView controller={controller} pairing={phonePort} timers={time} />,
    );
    await settle();
    return { tablet, camera, answers, time };
  }

  it('reads the tablet’s code, shows its own, and is paired once the tablet reads it', async () => {
    const { tablet, answers } = await pairingPhone();
    await tick();
    await press('Turn the camera on');
    expect(document.body.textContent).toContain('Looking for the tablet’s code');
    await scanOnce();
    expect(answers).toHaveLength(1);
    expect(document.querySelector('[data-oyl-pairing-code]')?.getAttribute('aria-label')).toBe(
      'Pairing code for your tablet to scan',
    );
    expect(await tablet.acceptSidePhoneCode(answers[0] ?? '')).toBeUndefined();
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain('Paired with your tablet');
    expect(document.querySelector('[data-oyl-pairing-code]')).toBeNull();
    // And the tablet now drives it.
    await flushSideLink();
    expect(tablet.control.sideControlState().phone).toBe('framing');
    tablet.control.commandSideCamera('start');
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(FILMING_WORD);
    expect(tablet.control.sideControlState().command?.status).toBe('acknowledged');
  });

  it('ends a link nobody connected when the rider leaves', async () => {
    const { tablet, answers, time } = await pairingPhone();
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    expect(answers).toHaveLength(1);
    mounted?.unmount();
    mounted = undefined;
    await flushSideLink();
    // The phone's end is gone, so the tablet reading its answer now finds
    // nobody to prove the secret — and gives up, rather than pairing with a
    // phone that left.
    await tablet.acceptSidePhoneCode(answers[0] ?? '');
    await flushSideLink();
    time.advance(CONNECT_LIMIT_MILLISECONDS);
    expect(tablet.control.sideControlState().ended).toBe('no-path');
  });

  it('refuses the other step’s code in words, and goes on looking', async () => {
    const { answers } = await pairingPhone({ showAnswer: true });
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    expect(answers).toHaveLength(0);
    expect(document.body.textContent).toContain(PAIRING_REFUSAL_TEXT['wrong-code']);
    expect(document.body.textContent).toContain('Looking for the tablet’s code');
  });

  it('says the tablet did not connect, and offers to scan again', async () => {
    const { answers, time } = await pairingPhone();
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    expect(answers).toHaveLength(1);
    // The tablet never reads the answer: the phone's end gives up.
    time.advance(CONNECT_LIMIT_MILLISECONDS);
    await settle();
    expect(document.body.textContent).toContain('The tablet did not connect');
    await press('Scan the tablet’s code again');
    expect(document.body.textContent).toContain('Looking for the tablet’s code');
  });
});
