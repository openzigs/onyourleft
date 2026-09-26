// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tablet's half of the side camera: pair a phone, start and stop it,
 * and say where it is** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md).
 *
 * A section of the Camera screen. In the order a rider meets it:
 *
 * 1. **Pair a phone** shows the offer code (D-1).
 * 2. **Read the phone's code** turns THIS tablet's camera on — only with the
 *    consent already given above it, because scanning is camera use (D-4) —
 *    reads the phone's answer, and turns the camera back off if it was off.
 * 3. Once paired: the phone's state in words (#529's *"pairing, framing,
 *    filming, stopped, or link lost"*), **Start filming**, **Stop filming**,
 *    what became of the last command, and **End pairing**.
 *
 * ⚠️ **No picture of the phone's is ever on this screen** — the owner's
 * ruling on #527, *"the tablet shows state only"* — and nothing here could
 * show one: the pairing port carries none.
 *
 * ⚠️ **The pairing is not this component's.** It is held by the port
 * (`side-pairing-port.ts` §`currentSideCamera`) so that leaving this screen to
 * ride does not end it; this component only shows and drives it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { PairingCode } from '../camera/PairingCode';
import type { CameraController } from '../camera/session';
import { PAIRING_REFUSAL_TEXT, type PairingRefusal } from '../camera/side-link-code';
import {
  SIDE_PAIRING_END_TEXT,
  SIDE_PHONE_STATE_TEXT,
  SIDE_STOP_REASON_TEXT,
  sideCommandText,
} from '../camera/side-link';
import type {
  SideCameraControlPort,
  SideControlState,
  SidePairingPort,
  TabletSidePairing,
} from '../camera/side-pairing-port';
import { PAIRING_READER_UNLOADED, usePairingScan } from '../camera/usePairingScan';

/** What the tablet is told when reading the phone's code needs a camera it has not agreed to. */
export const TABLET_SCAN_NEEDS_CONSENT =
  'Reading the phone’s code uses this tablet’s camera. Agree to the camera above first, then ' +
  'press “Read the phone’s code” again.';

const TITLE_ID = 'oyl-side-control-title';

/**
 * How many {@link Offer} sections are showing each offer right now — the count
 * the void on leaving reads, so a same-tick remount of a section showing the
 * same offer does not void it (#550's second review). Keyed weakly by the
 * pairing's control, so an offer nobody holds takes its count with it.
 */
const OFFERS_ON_SCREEN = new WeakMap<SideCameraControlPort, number>();

export interface SideCameraControlProps {
  readonly controller: CameraController;
  readonly pairing: SidePairingPort;
}

export function SideCameraControl({ controller, pairing }: SideCameraControlProps): JSX.Element {
  const [current, setCurrent] = useState<TabletSidePairing | undefined>(() => {
    // An offer this screen voided on its way out (D-4, {@link Offer}) is not
    // news on the way back in: the rider left, and "You ended the pairing"
    // would be a sentence about something they did not do. They meet "Pair a
    // phone" instead. A pairing that ended any other way is still told.
    const held = pairing.currentSideCamera();
    const state = held?.control.sideControlState();
    return state !== undefined && state.ended === 'ended-here' && !state.answered
      ? undefined
      : held;
  });
  const [refusal, setRefusal] = useState<PairingRefusal | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const pair = useCallback(() => {
    setBusy(true);
    setRefusal(undefined);
    void pairing.offerSideCamera().then((made) => {
      setBusy(false);
      if (typeof made === 'object') {
        setCurrent(made);
      } else {
        setCurrent(undefined);
        setRefusal(made);
      }
    });
  }, [pairing]);

  return (
    <section aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID}>A side camera on a tripod</h3>
      <p>
        Pair a spare phone on a tripod beside the bike, and start and stop its camera from this
        tablet. Both devices must be on the same Wi-Fi. Nothing about the pairing is remembered: you
        scan again every session.
      </p>
      {current === undefined ? (
        <>
          <Button onClick={pair} disabled={busy}>
            Pair a phone
          </Button>
          {refusal === undefined ? null : (
            <StatusMessage tone="warning" live>
              {PAIRING_REFUSAL_TEXT[refusal]}
            </StatusMessage>
          )}
        </>
      ) : (
        <Paired controller={controller} pairing={current} again={pair} busy={busy} />
      )}
    </section>
  );
}

function Paired({
  controller,
  pairing,
  again,
  busy,
}: {
  readonly controller: CameraController;
  readonly pairing: TabletSidePairing;
  readonly again: () => void;
  readonly busy: boolean;
}): JSX.Element {
  const state = useControlState(pairing.control);

  if (state.ended !== undefined) {
    return (
      <>
        <StatusMessage tone={state.ended === 'ended-here' ? 'info' : 'warning'} live>
          {SIDE_PAIRING_END_TEXT[state.ended]}
        </StatusMessage>
        <PhoneState state={state} />
        <Button onClick={again} disabled={busy}>
          Pair a phone
        </Button>
      </>
    );
  }
  if (!state.answered) {
    return <Offer controller={controller} pairing={pairing} />;
  }
  return <Controls control={pairing.control} state={state} />;
}

function useControlState(control: SideCameraControlPort): SideControlState {
  return useSyncExternalStore(
    (listener) => control.onSideControlChange(listener),
    () => control.sideControlState(),
    () => control.sideControlState(),
  );
}

function Offer({
  controller,
  pairing,
}: {
  readonly controller: CameraController;
  readonly pairing: TabletSidePairing;
}): JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  /**
   * Whether THIS section turned the camera on, so it turns it off again — and
   * only then: a camera the rider turned on above is theirs to turn off. A ref,
   * because it is read when the section goes away, not rendered.
   */
  const turnedOn = useRef(false);

  const stopScanning = useCallback(() => {
    setScanning(false);
    if (turnedOn.current) {
      turnedOn.current = false;
      controller.turnOff();
    }
  }, [controller]);

  // ADR 0033 D-4: the offer is *"void once an answer is accepted and when the
  // pairing screen closes"*. This section is the pairing screen's offer, so
  // when it goes away with the offer still unanswered, the offer goes too —
  // the five-minute expiry (`side-link.ts` §`OFFER_LIFETIME_MILLISECONDS`)
  // stays as the bound for a screen left open. An ANSWERED pairing is not
  // touched: it outlives the screen so the rider can ride.
  //
  // ⚠️ **Decided a microtask later, and only if no section showing THIS offer
  // came straight back.** React's StrictMode (which `main.tsx` renders under)
  // runs every effect's cleanup and setup a second time on mount, in one
  // synchronous pass; ending the offer in the cleanup itself would void every
  // offer the moment it was shown, in development. `SideCameraControl.test.tsx`
  // §"StrictMode" is the test that says so. ⚠️ **Counted per offer, not per
  // component instance** (#550's second review): a remount in the same tick —
  // a key change, a parent swapping its subtree — is a NEW instance showing
  // the same offer, and a per-instance flag let the old one's microtask void
  // the code the new one had just put on screen. §"a remount in the same tick"
  // is its test.
  useEffect(() => {
    const { control } = pairing;
    OFFERS_ON_SCREEN.set(control, (OFFERS_ON_SCREEN.get(control) ?? 0) + 1);
    return () => {
      OFFERS_ON_SCREEN.set(control, (OFFERS_ON_SCREEN.get(control) ?? 1) - 1);
      queueMicrotask(() => {
        if ((OFFERS_ON_SCREEN.get(control) ?? 0) === 0 && !control.sideControlState().answered) {
          control.endSidePairing();
        }
      });
    };
  }, [pairing]);

  // Leaving mid-scan leaves no camera on that this section turned on (D-4:
  // *"discarded as soon as a code is read or scanning is cancelled"*).
  //
  // ⚠️ **Including a camera still coming on when the section went** (#550's
  // second review): `turnOn` can take a few hundred milliseconds, or as long
  // as the platform's permission prompt is up, and a section that left in
  // that window found `turnedOn` false here and did nothing — then the camera
  // came on with no screen owning it. `mounted` is what `startScanning` reads
  // when the camera arrives, and it turns the camera straight back off.
  // `side-camera.ts` §`turnOnForFraming` is the phone's half of the same rule.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const ours = turnedOn;
    return () => {
      mounted.current = false;
      if (ours.current) {
        ours.current = false;
        controller.turnOff();
      }
    };
  }, [controller]);

  const startScanning = useCallback(() => {
    setProblem(undefined);
    if (controller.state().live) {
      setScanning(true);
      return;
    }
    void controller.turnOn().then((failed) => {
      if (!mounted.current) {
        // Nobody is here to scan with it or to turn it off: off it goes.
        if (failed === undefined) {
          controller.turnOff();
        }
        return;
      }
      if (failed === undefined) {
        turnedOn.current = true;
        setScanning(true);
      } else {
        setProblem(
          failed === 'no-consent'
            ? TABLET_SCAN_NEEDS_CONSENT
            : 'This tablet’s camera would not turn on. The Camera section above says why.',
        );
      }
    });
  }, [controller]);

  usePairingScan(
    controller,
    scanning,
    (code) => {
      void pairing.acceptSidePhoneCode(code).then((refused) => {
        if (refused === undefined) {
          // The control state now says `answered`, which replaces this section.
          stopScanning();
        } else if (refused !== 'wrong-code') {
          // The tablet's own offer, read off its own screen's reflection, is
          // the one refusal said nowhere: every other one is the rider's to act
          // on, and scanning stops so the sentence is not replaced.
          stopScanning();
          setProblem(PAIRING_REFUSAL_TEXT[refused]);
        }
      });
    },
    () => {
      // The reader would not load: stop, turn off a camera this section turned
      // on for the scan, and say so rather than "Looking…" for ever.
      stopScanning();
      setProblem(PAIRING_READER_UNLOADED);
    },
  );

  return (
    <>
      <ol>
        <li>
          On the phone, open <a href="#/camera/side">Side camera</a>, turn its camera on, and hold
          it so it can see this code.
        </li>
        <li>
          The phone then shows a code of its own. Press “Read the phone’s code” and hold this tablet
          so its camera can see it.
        </li>
      </ol>
      <PairingCode
        code={pairing.offerCode}
        label="Pairing code for the side-camera phone to scan"
      />
      <p>{SIDE_PHONE_STATE_TEXT.pairing}</p>
      {scanning ? (
        <>
          <p role="status">Looking for the phone’s code…</p>
          <Button variant="secondary" onClick={stopScanning}>
            Stop looking
          </Button>
        </>
      ) : (
        <Button onClick={startScanning}>Read the phone’s code</Button>
      )}
      {problem === undefined ? null : (
        <StatusMessage tone="warning" live>
          {problem}
        </StatusMessage>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          stopScanning();
          pairing.control.endSidePairing();
        }}
      >
        Cancel pairing
      </Button>
    </>
  );
}

function PhoneState({ state }: { readonly state: SideControlState }): JSX.Element {
  return (
    <p role="status" data-oyl-side-phone-state={state.phone}>
      <strong>Phone: </strong>
      {SIDE_PHONE_STATE_TEXT[state.phone]}
      {state.phone === 'stopped' && state.stopReason !== undefined
        ? ` ${SIDE_STOP_REASON_TEXT[state.stopReason]}`
        : null}
    </p>
  );
}

function Controls({
  control,
  state,
}: {
  readonly control: SideCameraControlPort;
  readonly state: SideControlState;
}): JSX.Element {
  return (
    <>
      <PhoneState state={state} />
      {/*
        Only the command that means something now is offered, rather than both
        with one disabled: a disabled button is out of the tab order and says
        nothing about why (`design/Button.tsx` §`disabled`). The phone's state
        above is the why.
      */}
      {state.phone === 'framing' ? (
        <Button
          onClick={() => {
            control.commandSideCamera('start');
          }}
        >
          Start filming
        </Button>
      ) : null}
      {state.phone === 'filming' || state.phone === 'lost' ? (
        <Button
          onClick={() => {
            control.commandSideCamera('stop');
          }}
        >
          Stop filming
        </Button>
      ) : null}
      {state.command === undefined ? null : (
        <StatusMessage tone={state.command.status === 'unacknowledged' ? 'warning' : 'info'} live>
          {sideCommandText(state.command.kind, state.command.status)}
        </StatusMessage>
      )}
      <Button
        variant="secondary"
        onClick={() => {
          control.endSidePairing();
        }}
      >
        End pairing
      </Button>
    </>
  );
}
