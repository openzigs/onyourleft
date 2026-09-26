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

import { videoCodePixelSampler } from '../src/camera/browser-camera';
import { pairingCodeFromPixels, pairingCodeModules } from '../src/camera/side-link-qr';
import { readPairingCode } from '../src/camera/side-link-code';
import { sidePairingPort } from '../src/camera/side-link';
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
  /** The command statuses the tablet reached, after start and after stop. */
  readonly afterStart: SideControlState | undefined;
  readonly afterStop: SideControlState | undefined;
  /** Both ends after the tablet ended the pairing. */
  readonly tabletEnded: SideControlState | undefined;
  readonly phoneCondition: string | undefined;
}

declare global {
  interface Window {
    __oylSideLink?: SideLinkMeasurement;
  }
}

async function until(test: () => boolean, milliseconds = 10_000): Promise<boolean> {
  const started = performance.now();
  while (!test()) {
    if (performance.now() - started > milliseconds) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
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
  const accepted = performance.now();
  const refused = await tablet.acceptSidePhoneCode(phone.answerCode);
  if (refused !== undefined) {
    errors.push(`answer refused: ${refused}`);
  }
  const connected = await until(() => phone.link.sideLinkCondition() === 'connected');
  const connectMilliseconds = connected ? performance.now() - accepted : undefined;
  if (!connected) {
    errors.push(`never connected: tablet ${JSON.stringify(tablet.control.sideControlState())}`);
  }
  phone.link.reportToTablet({ state: 'framing' });
  await until(() => tablet.control.sideControlState().phone === 'framing');
  const framing = tablet.control.sideControlState();

  tablet.control.commandSideCamera('start');
  await until(() => tablet.control.sideControlState().command?.status === 'acknowledged');
  const afterStart = tablet.control.sideControlState();
  phone.link.reportToTablet({ state: 'filming' });
  await until(() => tablet.control.sideControlState().phone === 'filming');

  tablet.control.commandSideCamera('stop');
  await until(
    () =>
      tablet.control.sideControlState().command?.kind === 'stop' &&
      tablet.control.sideControlState().command?.status === 'acknowledged',
  );
  const afterStop = tablet.control.sideControlState();

  tablet.control.endSidePairing();
  await until(() => phone.link.sideLinkCondition() === 'ended');
  for (const track of camera?.getTracks() ?? []) {
    track.stop();
  }
  return {
    errors,
    codeReadBack,
    cameraRead,
    offerAddresses: addresses(tablet.offerCode, 'offer'),
    answerAddresses: addresses(phone.answerCode, 'answer'),
    connectMilliseconds,
    framing,
    phoneHeard,
    afterStart,
    afterStop,
    tabletEnded: tablet.control.sideControlState(),
    phoneCondition: phone.link.sideLinkCondition(),
  };
}

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
    afterStart: undefined,
    afterStop: undefined,
    tabletEnded: undefined,
    phoneCondition: undefined,
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
