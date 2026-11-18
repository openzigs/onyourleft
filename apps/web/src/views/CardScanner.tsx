// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { CameraFacing } from '../camera/camera-port';
import { ScanViewfinder } from '../camera/ScanViewfinder';
import type { CameraController } from '../camera/session';
import { usePairingScan } from '../camera/usePairingScan';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

/**
 * **Scan the instance's card with this device's camera, inside the app** —
 * #2785, ADR 0047 D-6.
 *
 * A rider points the device at a card's QR code (another device's *Add
 * another device*, or the instance's own loopback page) instead of pasting 52
 * characters. What the code says is handed to `onScanned` as text, and the
 * screen puts it in the same box a paste goes into: the card is then read by
 * the same function a pasted one is (`instance-port.ts`), so a scan can pin
 * nothing a paste could not. Paste stays beside it as the way that always works.
 *
 * - **Inside the app, never as a link** (D-6): the code is read from the
 *   camera's pixels here, and `oyl-instance:` is no URL scheme this app
 *   registers (`instance/no-url-handler.test.ts`).
 * - **The one camera pipeline and its one consent** (`camera/boundary.test.ts`,
 *   ADR 0033 D-4: *"scanning counts as camera use"*): the reads are
 *   `session.ts` §`readPairingCode`'s, through `usePairingScan`, which keep no
 *   frame. A device whose rider has not agreed to the camera is told where to.
 * - **No frame outlives the scanner** (ADR 0033 D-4, as the side camera): a
 *   camera this scanner turned on is turned off when it closes, when a code is
 *   read and when the screen goes away — one the rider already had on is
 *   theirs, and is left as it was found.
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve** (D-14
 * Q6, #880).
 */

/** What the scanner says. Draft wording. */
export const CARD_SCAN_TEXT = {
  start: 'Scan the card with the camera',
  close: 'Close the scanner',
  looking: 'Looking for the card’s code…',
  caption:
    'What this device’s camera sees. Hold the card’s code inside it. Nothing here is kept, and it ' +
    'goes away once the code is read or the scanner is closed.',
  'no-consent':
    'Scanning uses this device’s camera, which you have not agreed to yet. Agree to it on the ' +
    'Camera screen and come back, or paste the code instead.',
  camera:
    'This device’s camera could not be used, so the card cannot be scanned. Paste the card in ' +
    'the box instead.',
  stopped: 'The camera stopped, so the scanner closed. Paste the code instead, or scan again.',
  reader:
    'This device could not load what reads the code, so it has stopped looking. Paste the code ' +
    'instead, or reload the page and try again.',
} as const;

/**
 * The camera a card is read with: the BACK one, which a rider points at the
 * other screen while watching this one. `facingMode` is an ideal
 * (`browser-camera.ts` §`cameraConstraints`), so a laptop's one camera is used.
 */
const SCAN_FACING: CameraFacing = 'environment';

/**
 * A large button the width of its column (#2828): the Connect screen's *Scan a
 * code* and its three answers to where a code came from. Layout only
 * (`theme.css` §`.oyl-connect__choice`).
 */
export const CONNECT_CHOICE_CLASS = 'oyl-connect__choice';

export function CardScanner({
  controller,
  onScanned,
  every,
  startLabel = CARD_SCAN_TEXT.start,
  primary = false,
  focusOnMount = false,
  disabled = false,
}: {
  readonly controller: CameraController;
  /**
   * The start button as the screen's one primary action (#2828: the Connect
   * screen opens on *Scan a code*). Secondary otherwise, beside a paste box.
   */
  readonly primary?: boolean;
  /** The start button is held while something else on the screen is being sent. */
  readonly disabled?: boolean;
  /** Focus the start button as it first appears: it replaced the control just pressed (#557). */
  readonly focusOnMount?: boolean;
  /**
   * The start button's name, where a screen scans for something other than
   * the card (#2828: the Connect screen's *Scan a code*).
   */
  readonly startLabel?: string;
  /** The text of the code read, once: the scanner has already closed. */
  readonly onScanned: (text: string) => void;
  /** How the reads are timed: `usePairingScan`'s own timer unless a test owns it. */
  readonly every?: ((tick: () => void, milliseconds: number) => () => void) | undefined;
}): JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  /** Whether THIS scanner turned the camera on, so it gives it back — and only then. */
  const turnedOn = useRef(false);
  /** Which way the rider's own camera faced when it was turned round for the scan. */
  const restore = useRef<CameraFacing | undefined>(undefined);
  /** One start at a time: a second press while the camera comes on is the same press. */
  const starting = useRef(false);
  const mounted = useRef(false);
  /** Whether a scan is on, read where a render's value would be stale: the camera's listener. */
  const looking = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const wasScanning = useRef(false);

  /** Give the camera back as this scanner found it: off, or facing the way it was. */
  const giveBack = useCallback(() => {
    if (!turnedOn.current) return;
    turnedOn.current = false;
    const facing = restore.current;
    restore.current = undefined;
    if (facing === undefined) controller.turnOff();
    else void controller.turnOn(facing);
  }, [controller]);

  const close = useCallback(() => {
    looking.current = false;
    setScanning(false);
    giveBack();
  }, [giveBack]);

  // A camera that stops under the scan — the track ended, or the camera was
  // turned off or its agreement taken back on another screen — closes the
  // scanner and says so, rather than "Looking…" over a camera that is gone.
  useEffect(() => {
    if (!scanning) return undefined;
    return controller.subscribe(() => {
      if (looking.current && !controller.state().live) {
        // The camera is already off, and the rider (or the OS) turned it
        // off: nothing is given back, so no earlier camera is asked for again.
        turnedOn.current = false;
        restore.current = undefined;
        close();
        setProblem(CARD_SCAN_TEXT.stopped);
      }
    });
  }, [scanning, controller, close]);

  // Leaving mid-scan leaves no camera on that this scanner turned on, and one
  // still coming on when it went is given back the moment it arrives
  // (`start` reads `mounted`), as `SideCameraControl.tsx` §`Offer` does.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      giveBack();
    };
  }, [giveBack]);

  // The close button replaced the start button, and goes when the scan does:
  // focus comes back to the control that started it (WCAG 2.2 SC 2.4.3).
  useEffect(() => {
    if (wasScanning.current && !scanning) startButton.current?.focus();
    wasScanning.current = scanning;
  }, [scanning]);

  const start = useCallback(() => {
    if (starting.current) return;
    setProblem(undefined);
    // A camera the rider already had on is given back facing the way it was:
    // left on, or turned back round.
    const before = controller.state();
    const facing = before.live ? before.facing : undefined;
    starting.current = true;
    void controller.turnOn(SCAN_FACING).then((failed) => {
      if (failed === undefined) {
        starting.current = false;
        turnedOn.current = true;
        restore.current = facing;
      } else if (facing !== undefined) {
        // The rider's own camera went off to be turned round and the back one
        // would not come on: theirs comes back.
        void controller.turnOn(facing).finally(() => {
          starting.current = false;
        });
      } else {
        starting.current = false;
      }
      if (!mounted.current) {
        giveBack();
        return;
      }
      if (failed === undefined) {
        looking.current = true;
        setScanning(true);
      } else {
        setProblem(failed === 'no-consent' ? CARD_SCAN_TEXT['no-consent'] : CARD_SCAN_TEXT.camera);
      }
    });
  }, [controller, giveBack]);

  usePairingScan(
    controller,
    scanning,
    (text) => {
      close();
      onScanned(text);
    },
    () => {
      close();
      setProblem(CARD_SCAN_TEXT.reader);
    },
    every,
  );

  return (
    <div className="oyl-card-scan" data-oyl-card-scan="">
      {scanning ? (
        <>
          <p role="status">{CARD_SCAN_TEXT.looking}</p>
          <ScanViewfinder
            controller={controller}
            caption={CARD_SCAN_TEXT.caption}
            mirrored={false}
          />
          <Button variant="secondary" onClick={close} focusOnMount>
            {CARD_SCAN_TEXT.close}
          </Button>
        </>
      ) : (
        <Button
          variant={primary ? 'primary' : 'secondary'}
          {...(primary ? { className: CONNECT_CHOICE_CLASS } : {})}
          disabled={disabled}
          onClick={start}
          ref={startButton}
          focusOnMount={focusOnMount}
        >
          {startLabel}
        </Button>
      )}
      {problem === undefined ? null : (
        <StatusMessage tone="warning" label="Not scanned" live>
          {problem}
        </StatusMessage>
      )}
    </div>
  );
}
