// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side-camera link, paired end to end in a real engine** — #529.
 *
 * Both ends in one page, as two peer connections, through exactly what
 * production uses: `camera/side-link.ts` §`sidePairingPort` with its default
 * peer — the real `side-link-transport.ts`, and so the real
 * `RTCPeerConnection` with no ICE server of any kind — the real offer and
 * answer codes, and the SDP `side-link-sdp.ts` rebuilds from them. Then a
 * start and a stop across, each acknowledged, and the pairing ended from the
 * tablet.
 *
 * Since #530 it also takes three pictures off the synthetic camera through
 * the real side sampler (`browser-camera.ts` §`videoSidePictureSampler`) and
 * the frame tripwire, and sends them phone → tablet on the `frames` channel —
 * the one step of the link jsdom cannot do with a real engine's binary
 * messages and its own `maxMessageSize`.
 *
 * It also draws the offer as the screen does and reads it back with the real
 * reader off a real canvas, which is the one step of scanning jsdom cannot do
 * with a browser's own pixels.
 *
 * ## Why the camera is opened first
 *
 * Chromium hides a host candidate's address behind an mDNS `.local` name
 * unless the page has camera access (spike 0011). Both devices in production
 * have it — the phone films, the tablet reads a code — so the harness takes it
 * too, from the synthetic camera `playwright.config.ts` gives every page.
 *
 * ## Every wait is a step that can fail, and the run stops at the first
 *
 * #552. Each wait used to return `false` on its timeout and the run carried on
 * regardless, so a connection that took longer than the harness's own ten
 * seconds — shorter than the product's {@link CONNECT_LIMIT_MILLISECONDS} —
 * sent the phone's "framing" report down a channel that was not open yet, and
 * read the tablet's state as `pairing`: the flake #552 reported, reproduced
 * by delaying the phone's channel eleven seconds. A connection that never
 * came instead waited out every later step's bound in turn, over a minute,
 * and the spec saw only its own 45 s timeout with no reason attached — the
 * second symptom. Now the connection is waited on for as long as the product
 * waits, and a wait that does not see its state throws {@link Stalled}: the
 * step's name and what was seen instead go into `errors`, nothing after it
 * runs, and the page publishes at once.
 *
 * ⚠️ Naming the step is what found a THIRD failure, and it is not fixed here:
 * the tablet ending the pairing as `not-our-phone` because the phone's report
 * was the first message it heard, not the `hello` (#568). It reads as
 * `framing: not seen … "ended":"not-our-phone"`.
 *
 * ## What this does NOT prove
 *
 * - **Two devices.** Both ends are in one browser on one machine, so the path
 *   is the machine's own interface. Spike 0012 measured two Android WebViews
 *   on one LAN with the same configuration; this file has not run there, and
 *   the pull request says so.
 * - **No packet left for a third host.** That is #541's packet capture. What
 *   IS shown here is that the connection is built with no ICE server and that
 *   every candidate the codes carried is on a private network.
 */

import { videoCodePixelSampler, videoSidePictureSampler } from '../src/camera/browser-camera';
import { capturedFrame } from '../src/camera/frame';
import type { SidePicture } from '../src/camera/side-link-pictures';
import { pairingCodeFromPixels, pairingCodeModules } from '../src/camera/side-link-qr';
import { readPairingCode } from '../src/camera/side-link-code';
import { CONNECT_LIMIT_MILLISECONDS, sidePairingPort } from '../src/camera/side-link';
import type { SideLinkEvent } from '../src/camera/side-camera-link-port';
import type { SideControlState } from '../src/camera/side-pairing-port';

/** What the page publishes on `window.__oylSideLink`. */
export interface SideLinkMeasurement {
  readonly errors: readonly string[];
  /** The offer code survived being drawn and read back off a canvas. */
  readonly codeReadBack: boolean;
  /**
   * One read of the synthetic camera through the real pairing-code sampler:
   * its size, whether the buffer is that size, and what the reader found in a
   * picture with no code in it (nothing, or the reader is inventing codes).
   */
  readonly cameraRead:
    | {
        readonly width: number;
        readonly height: number;
        readonly whole: boolean;
        readonly found: string | undefined;
      }
    | undefined;
  /** The addresses each code carried. */
  readonly offerAddresses: readonly string[];
  readonly answerAddresses: readonly string[];
  /** Milliseconds from the tablet accepting the answer to the phone proving itself. */
  readonly connectMilliseconds: number | undefined;
  /** The tablet's view after the phone said it was framing. */
  readonly framing: SideControlState | undefined;
  /** What the phone heard, in order. */
  readonly phoneHeard: readonly SideLinkEvent[];
  /**
   * #530: three pictures off the synthetic camera through the real side
   * sampler and the frame tripwire, sent phone → tablet on the `frames`
   * channel. What the phone was told, what size each was, and what arrived.
   */
  readonly picturesSent: readonly string[];
  readonly pictureSizes: readonly { readonly width: number; readonly height: number }[];
  readonly picturesArrived: readonly {
    readonly sequence: number;
    readonly milliseconds: number;
    readonly bytes: number;
    readonly jpeg: boolean;
  }[];
  /** The command statuses the tablet reached, after start and after stop. */
  readonly afterStart: SideControlState | undefined;
  readonly afterStop: SideControlState | undefined;
  /** Both ends after the tablet ended the pairing. */
  readonly tabletEnded: SideControlState | undefined;
  readonly phoneCondition: string | undefined;
  /** How long each wait took, in order — printed, so a slow run says where. */
  readonly steps: readonly { readonly step: string; readonly milliseconds: number }[];
}

declare global {
  interface Window {
    __oylSideLink?: SideLinkMeasurement;
  }
}

/**
 * How long a step after the connection may take to be seen at the other end.
 * Loopback carries each of these messages in milliseconds; this is headroom
 * for a loaded runner, not a guess about speed.
 */
const STEP_MILLISECONDS = 10_000;

/**
 * How long the connection is waited on: the product's own limit, after which
 * both ends have ended the pairing themselves, and a second for that to land.
 * A harness that gave up sooner than the product would fail a pairing the
 * product still counts as on time — which is what #552 was.
 */
const CONNECT_WAIT_MILLISECONDS = CONNECT_LIMIT_MILLISECONDS + 1000;

/** A wait that did not see the state it waited for. Ends the run — see the header. */
class Stalled extends Error {}

/**
 * Wait until `reached` holds, recording how long that took under `step`.
 * @throws Stalled naming the step and `seen()`, when it does not within `milliseconds`.
 */
async function until(
  steps: { step: string; milliseconds: number }[],
  step: string,
  reached: () => boolean,
  seen: () => string,
  milliseconds = STEP_MILLISECONDS,
): Promise<void> {
  const started = performance.now();
  while (!reached()) {
    if (performance.now() - started > milliseconds) {
      throw new Stalled(
        `${step}: not seen within ${String(milliseconds)} ms; saw ${seen()} instead`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  steps.push({ step, milliseconds: Math.round(performance.now() - started) });
}

function drawnAndRead(code: string): boolean {
  const modules = pairingCodeModules(code);
  const scale = 4;
  const quiet = 4;
  const size = (modules.length + quiet * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) {
    return false;
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#141b1a';
  for (const [row, cells] of modules.entries()) {
    for (const [column, dark] of cells.entries()) {
      if (dark) {
        context.fillRect((column + quiet) * scale, (row + quiet) * scale, scale, scale);
      }
    }
  }
  const pixels = context.getImageData(0, 0, size, size);
  return pairingCodeFromPixels({ width: size, height: size, rgba: pixels.data }) === code;
}

function addresses(code: string, role: 'offer' | 'answer'): readonly string[] {
  const read = readPairingCode(code, role);
  return 'code' in read ? read.code.parameters.candidates.map((each) => each.address) : [];
}

async function run(): Promise<SideLinkMeasurement> {
  const errors: string[] = [];
  const phoneHeard: SideLinkEvent[] = [];
  let camera: MediaStream | undefined;
  try {
    camera = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch {
    errors.push('the synthetic camera would not open');
  }
  let cameraRead: SideLinkMeasurement['cameraRead'];
  if (camera !== undefined) {
    const sampler = videoCodePixelSampler(camera);
    try {
      const pixels = await sampler.sample();
      cameraRead = {
        width: pixels.width,
        height: pixels.height,
        whole: pixels.rgba.length === pixels.width * pixels.height * 4,
        found: pairingCodeFromPixels(pixels),
      };
    } catch (error) {
      errors.push(`the code sampler failed: ${String(error)}`);
    } finally {
      sampler.release();
    }
  }
  const port = sidePairingPort();
  const tablet = await port.offerSideCamera();
  if (typeof tablet !== 'object') {
    return { ...empty(errors), errors: [...errors, `no offer: ${tablet}`] };
  }
  const codeReadBack = drawnAndRead(tablet.offerCode);
  const phone = await port.answerSideCamera(tablet.offerCode);
  if (typeof phone !== 'object') {
    return { ...empty(errors), codeReadBack, errors: [...errors, `no answer: ${phone}`] };
  }
  phone.link.onSideLinkEvent((event) => phoneHeard.push(event));
  const steps: { step: string; milliseconds: number }[] = [];
  const tabletSaw = (): string => JSON.stringify(tablet.control.sideControlState());
  const measured: Mutable<SideLinkMeasurement> = {
    ...empty(errors),
    codeReadBack,
    cameraRead,
    offerAddresses: addresses(tablet.offerCode, 'offer'),
    answerAddresses: addresses(phone.answerCode, 'answer'),
    phoneHeard,
    steps,
  };
  try {
    const accepted = performance.now();
    const refused = await tablet.acceptSidePhoneCode(phone.answerCode);
    if (refused !== undefined) {
      throw new Stalled(`answer refused: ${refused}`);
    }
    // Until the phone has an answer either way — connected, or ended by the
    // product's own limit — and only then asks which.
    await until(
      steps,
      'connected',
      () =>
        phone.link.sideLinkCondition() !== 'connecting' ||
        tablet.control.sideControlState().ended !== undefined,
      () => `phone ${phone.link.sideLinkCondition()}, tablet ${tabletSaw()}`,
      CONNECT_WAIT_MILLISECONDS,
    );
    if (phone.link.sideLinkCondition() !== 'connected') {
      throw new Stalled(
        `never connected: phone ${phone.link.sideLinkCondition()}, tablet ${tabletSaw()}`,
      );
    }
    measured.connectMilliseconds = performance.now() - accepted;

    phone.link.reportToTablet({ state: 'framing' });
    await until(
      steps,
      'framing',
      () => tablet.control.sideControlState().phone === 'framing',
      tabletSaw,
    );
    measured.framing = tablet.control.sideControlState();

    tablet.control.commandSideCamera('start');
    await until(
      steps,
      'start acknowledged',
      () => tablet.control.sideControlState().command?.status === 'acknowledged',
      tabletSaw,
    );
    measured.afterStart = tablet.control.sideControlState();
    phone.link.reportToTablet({ state: 'filming' });
    await until(
      steps,
      'filming',
      () => tablet.control.sideControlState().phone === 'filming',
      tabletSaw,
    );

    // #530: pictures, phone → tablet, made the way the phone makes them.
    const arrived: SidePicture[] = [];
    tablet.control.onSideCameraPicture((picture) => arrived.push(picture));
    const picturesSent: string[] = [];
    const pictureSizes: { width: number; height: number }[] = [];
    measured.picturesSent = picturesSent;
    measured.pictureSizes = pictureSizes;
    if (camera !== undefined) {
      const sampler = videoSidePictureSampler(camera);
      try {
        for (let sequence = 0; sequence < 3; sequence += 1) {
          // Offered until the phone takes one, the way its own stream offers
          // every capture and drops the ones it cannot send: `no-link` until
          // the `frames` channel is open, which is its own channel and is not
          // what `connected` waits for (#552, seen in CI). `too-large` is not
          // transient and stalls at once.
          const offered = performance.now();
          let sent: string;
          for (;;) {
            let frame: ReturnType<typeof capturedFrame>;
            try {
              frame = capturedFrame(await sampler.sample());
            } catch (error) {
              throw new Stalled(`the side sampler failed: ${String(error)}`);
            }
            sent = phone.link.sendPictureToTablet({
              sequence,
              milliseconds: sequence * 200,
              bytes: frame.bytes,
            });
            if (sent === 'sent') {
              pictureSizes.push({ width: frame.width, height: frame.height });
              break;
            }
            if (sent === 'too-large' || performance.now() - offered > STEP_MILLISECONDS) {
              throw new Stalled(`picture ${String(sequence)}: the phone said ${sent}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          picturesSent.push(sent);
          steps.push({
            step: `picture ${String(sequence)} taken`,
            milliseconds: Math.round(performance.now() - offered),
          });
          await until(
            steps,
            `picture ${String(sequence)}`,
            () => arrived.length > sequence,
            () => `${String(arrived.length)} arrived`,
          );
        }
      } finally {
        sampler.release();
      }
    }
    measured.picturesArrived = arrived.map((picture) => ({
      sequence: picture.sequence,
      milliseconds: picture.milliseconds,
      bytes: picture.bytes.length,
      jpeg: picture.bytes[0] === 0xff && picture.bytes[1] === 0xd8,
    }));

    tablet.control.commandSideCamera('stop');
    await until(
      steps,
      'stop acknowledged',
      () =>
        tablet.control.sideControlState().command?.kind === 'stop' &&
        tablet.control.sideControlState().command?.status === 'acknowledged',
      tabletSaw,
    );
    measured.afterStop = tablet.control.sideControlState();

    tablet.control.endSidePairing();
    await until(
      steps,
      'ended at the phone',
      () => phone.link.sideLinkCondition() === 'ended',
      () => `phone ${phone.link.sideLinkCondition()}`,
    );
    measured.tabletEnded = tablet.control.sideControlState();
    measured.phoneCondition = phone.link.sideLinkCondition();
  } catch (error) {
    if (!(error instanceof Stalled)) {
      throw error;
    }
    errors.push(error.message);
    // Nothing after a stalled step is measured, and neither end is left open.
    tablet.control.endSidePairing();
    phone.link.endSideLink();
  } finally {
    for (const track of camera?.getTracks() ?? []) {
      track.stop();
    }
  }
  return measured;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function empty(errors: readonly string[]): SideLinkMeasurement {
  return {
    errors,
    codeReadBack: false,
    cameraRead: undefined,
    offerAddresses: [],
    answerAddresses: [],
    connectMilliseconds: undefined,
    framing: undefined,
    phoneHeard: [],
    picturesSent: [],
    pictureSizes: [],
    picturesArrived: [],
    afterStart: undefined,
    afterStop: undefined,
    tabletEnded: undefined,
    phoneCondition: undefined,
    steps: [],
  };
}

run().then(
  (measurement) => {
    window.__oylSideLink = measurement;
  },
  (error: unknown) => {
    window.__oylSideLink = { ...empty([]), errors: [String(error)] };
  },
);
