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

import { BYSTANDER_SENTENCE, SCREENSHOT_SENTENCE } from '../camera/consent';
import { FRAMING_VERDICT_TEXT } from '../camera/framing';
import { CameraController } from '../camera/session';
import { LINK_LOSS_LIMIT_MILLISECONDS, LINK_LOSS_SENTENCE } from '../camera/side-camera';
import {
  CONNECT_LIMIT_MILLISECONDS,
  sidePairingPort,
  TABLET_READ_LIMIT_MILLISECONDS,
} from '../camera/side-link';
import { PAIRING_REFUSAL_TEXT } from '../camera/side-link-code';
import { pairingCodeModules } from '../camera/side-link-qr';
import type { SideCameraLinkPort } from '../camera/side-camera-link-port';
import type { SidePairingPort, TabletSidePairing } from '../camera/side-pairing-port';
import { PAIRING_READER_UNLOADED } from '../camera/usePairingScan';
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

import {
  FILMING_WORD,
  NOT_PAIRED_TEXT,
  SIDE_CAMERA_KEPT_VISIBLE,
  SIDE_PICTURES_GO_SENTENCE,
  SideCameraView,
  TABLET_DID_NOT_CONNECT,
  TABLET_READ_TIMED_OUT,
  tabletReadSentence,
} from './SideCameraView';
import { CAMERA_NO_PORT } from './CameraView';
import { browserSecureWindow } from '../camera/secure-window-testing';

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
    secureWindow: browserSecureWindow(),
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
    // #530: and where the pictures go, now that they go somewhere.
    expect(document.body.textContent).toContain(SIDE_PICTURES_GO_SENTENCE);
    // And nothing has been asked of the camera: shown BEFORE, not beside.
    expect(camera.calls).toStrictEqual([]);
  });

  it('says the tablet shows the picture and can keep a snapshot, and what a screenshot meets — #1060', async () => {
    // ADR 0044 D-1 superseded ADR 0033 D-6 on this path: the picture is SHOWN
    // on the tablet, and one press of "Save snapshot" keeps one. The sentence
    // that said the tablet throws each away at once and keeps none is false
    // from the first build that shows one, so it must not stand beside these.
    await phone();
    expect(SIDE_PICTURES_GO_SENTENCE).toContain('shows it on its screen');
    expect(SIDE_PICTURES_GO_SENTENCE).toContain('anyone who can see that screen can see it');
    expect(SIDE_PICTURES_GO_SENTENCE).toContain('“Save snapshot”');
    expect(SIDE_PICTURES_GO_SENTENCE).not.toContain('throws it away at once');
    // D-12: the phone's own framing preview is a camera picture on a screen.
    expect(document.body.textContent).toContain(SCREENSHOT_SENTENCE);
    expect(SIDE_CAMERA_KEPT_VISIBLE).toContain(SCREENSHOT_SENTENCE);
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

  async function pairingPhone(
    options: {
      readonly showAnswer?: boolean;
      readonly readerFails?: boolean;
      readonly connects?: boolean;
    } = {},
  ) {
    const network = sidePeerNetwork(options.connects === false ? { connects: false } : {});
    const time = virtualTime();
    const port = sidePairingPort({
      peer: network.peer,
      clock: time.clock,
      after: time.after,
      every: time.every,
    });
    const answers: string[] = [];
    const links: SideCameraLinkPort[] = [];
    const phonePort: SidePairingPort = {
      offerSideCamera: async () => port.offerSideCamera(),
      currentSideCamera: () => port.currentSideCamera(),
      answerSideCamera: async (offerCode) => {
        const made = await port.answerSideCamera(offerCode);
        if (typeof made === 'object') {
          answers.push(made.answerCode);
          links.push(made.link);
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
    let readerLoads = 0;
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: camera.port,
      schedule: manualSchedule().schedule,
      ...(options.readerFails === true
        ? {
            loadCodeReader: async () => {
              readerLoads += 1;
              return Promise.reject(new Error('the chunk would not load'));
            },
          }
        : {}),
    });
    mounted = await mount(
      <SideCameraView controller={controller} pairing={phonePort} timers={time} />,
    );
    await settle();
    return { tablet, camera, answers, links, time, readerLoads: () => readerLoads };
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

  it('says the tablet did not read the code in time, and offers to scan again (#1108)', async () => {
    const { answers, time } = await pairingPhone();
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    expect(answers).toHaveLength(1);
    // Fifteen seconds is a person still aiming, not a tablet that gave up.
    time.advance(CONNECT_LIMIT_MILLISECONDS);
    await settle();
    expect(document.querySelector('[data-oyl-pairing-code]')).not.toBeNull();
    // The tablet never reads the answer: the phone's end gives up.
    time.advance(TABLET_READ_LIMIT_MILLISECONDS - CONNECT_LIMIT_MILLISECONDS);
    await settle();
    expect(document.body.textContent).toContain(TABLET_READ_TIMED_OUT);
    expect(document.body.textContent).not.toContain(TABLET_DID_NOT_CONNECT);
    await press('Scan the tablet’s code again');
    expect(document.body.textContent).toContain('Looking for the tablet’s code');
  });

  it('shows how long the tablet has left to read the code, counting down (#1108)', async () => {
    const { time } = await pairingPhone();
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    const timer = (): string | null | undefined =>
      document.querySelector('[data-oyl-side-pairing] [role="timer"]')?.textContent;
    expect(timer()).toBe(tabletReadSentence(TABLET_READ_LIMIT_MILLISECONDS / 1000));
    expect(timer()).toBe('The tablet has 2:00 left to read this code.');
    time.advance(61_000);
    await settle();
    expect(timer()).toBe('The tablet has 0:59 left to read this code.');
  });

  it('lets the rider start again while the code is still waiting (#1108)', async () => {
    const { answers, links } = await pairingPhone();
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    expect(answers).toHaveLength(1);
    await press('Scan the tablet’s code again');
    // The code the rider walked away from can no longer pair.
    expect(links[0]?.sideLinkCondition()).toBe('ended');
    expect(document.querySelector('[data-oyl-pairing-code]')).toBeNull();
    expect(document.body.textContent).toContain('Looking for the tablet’s code');
    // Neither failure sentence: the rider asked for this.
    expect(document.body.textContent).not.toContain(TABLET_READ_TIMED_OUT);
    expect(document.body.textContent).not.toContain(TABLET_DID_NOT_CONNECT);
    await scanOnce();
    expect(answers).toHaveLength(2);
  });

  it('says the tablet did not connect when the link fails before the time is up (#1108)', async () => {
    const { tablet, answers } = await pairingPhone({ connects: false });
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    // The tablet reads the answer, and there is no path between the two.
    await tablet.acceptSidePhoneCode(answers[0] ?? '');
    await flushSideLink();
    await settle();
    expect(document.body.textContent).toContain(TABLET_DID_NOT_CONNECT);
    expect(document.body.textContent).not.toContain(TABLET_READ_TIMED_OUT);
  });

  it('puts the instruction and its status ABOVE the camera’s picture — #1108', async () => {
    await pairingPhone();
    await tick();
    await press('Turn the camera on');
    const pairing = document.querySelector('[data-oyl-side-pairing]');
    const picture = document.querySelector('video');
    expect(pairing?.textContent).toContain('To pair with your tablet');
    expect(pairing?.textContent).toContain('Looking for the tablet’s code');
    expect(picture).not.toBeNull();
    expect(
      (pairing?.compareDocumentPosition(picture as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await scanOnce();
    // And the code the tablet reads, with its countdown, is above it too —
    // drawn as wide as the screen allows.
    const code = document.querySelector('[data-oyl-pairing-code]');
    expect(pairing?.contains(code)).toBe(true);
    expect(code?.classList.contains('oyl-pairing-code--full')).toBe(true);
  });

  it('stops looking, and says so, when the code reader will not load — #550’s second review', async () => {
    const { camera, readerLoads } = await pairingPhone({ readerFails: true });
    await tick();
    await press('Turn the camera on');
    await scanOnce();
    await scanOnce();
    await scanOnce();
    expect(document.body.textContent).toContain(PAIRING_READER_UNLOADED);
    expect(document.body.textContent).not.toContain('Looking for the tablet’s code');
    // Asked once, not every tick with the camera running.
    expect(readerLoads()).toBe(1);
    expect(camera.calls).not.toContain('code');
  });
});
