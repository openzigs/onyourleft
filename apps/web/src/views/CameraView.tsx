// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where a rider turns the camera on, having read what it does** (#382).
 *
 * The screen is the consent flow. It is a route rather than a panel on the ride
 * screen for the reason `views/SettingsView.tsx` gives about units — *"a
 * preference that is hard to find is one that gets reported as a missing
 * feature"* — and for one more that is specific to this feature: the
 * arrangement the owner chose is *"a second phone on a tripod, side-on, at
 * roughly hip height"* (ADR 0029's 2026-09-23 amendment, Q4), so the device
 * running this screen may be **not the device the rider is sitting on**. A
 * screen somebody walks over to and sets up is the right shape for that; a
 * panel inside the ride screen is not.
 *
 * Being a route also means the accessibility gate reaches it without anyone
 * remembering to add a case: `routes.a11y.test.tsx` iterates the table in
 * `shell/routes.ts`.
 *
 * ## What is on it, and what is deliberately not
 *
 * ⚠️ **No picture, ever — not a preview, not a thumbnail, not the frame just
 * taken.** That is ADR 0029 D-11 ("a kept frame is never on a screen somebody
 * could meet by accident") taken at its word plus D-8's discipline about what a
 * message may carry, and it costs the obvious useful thing: a rider cannot see
 * what the camera is pointing at. What replaces it is a **count and a size** —
 * D-8's own permitted column lists *"a count, a byte size, a format name"* —
 * which is enough to tell a camera pointing at a room from one pointing at a
 * lens cap, and carries nothing from which any part of the image is
 * recoverable.
 *
 * That is a real cost and it is worth naming rather than hiding: framing a
 * tripod without a preview is harder. The remedy is the device's own camera
 * app, which the rider already has, and `docs/validation/0002-…` Part S is
 * where somebody with a tripod records whether that is good enough.
 *
 * ⚠️ **No hosted-model control.** `camera/consent.ts` says why at length: there
 * is no hosted path, and a control granting something no code can act on is one
 * that *"looks like the way in and is not"* — #48's first criterion. Since
 * [#387](https://github.com/openzigs/onyourleft/issues/387) there IS a way for a
 * picture to leave — to the rider's OWN computer, at an address they type and
 * switch on — and {@link AnalysisSection} is where. Its address box refuses
 * anything not on the rider's own network (`camera/analysis-endpoint.ts`), which
 * is what keeps a hosted model out of it: ADR 0029's 2026-09-23 amendment leaves
 * whether the hosted path may be built to the owner.
 *
 * ⚠️ **No claim about a body anywhere on this screen.**
 * [ADR 0030](../../../../docs/adr/0030-what-the-app-may-say-about-a-body.md)
 * binds every string here, and its 2026-09-23 amendment makes the six
 * general-wellness conditions obligations rather than a framing to avoid. This
 * screen shows no analysis — #387's connection check reports whether the
 * computer answered and understood, and never its words
 * (`camera/useAnalysis.ts` says why), and the report is
 * [#388](https://github.com/openzigs/onyourleft/issues/388) — so the safest
 * thing it can do is describe the camera and say nothing about what a picture
 * of a person shows.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import {
  BYSTANDER_SENTENCE,
  CONSENT_REFUSAL_TEXT,
  CONSENT_STATEMENT,
  type ConsentRefusal,
} from '../camera/consent';
import { ANALYSIS_FAILURE_TEXT } from '../camera/analysis-port';
import {
  endpointDecision,
  ENDPOINT_REFUSAL_TEXT,
  forgetAnalysisEndpoint,
  readAnalysisEndpoint,
  writeAnalysisEndpoint,
  type EndpointRefusal,
} from '../camera/analysis-endpoint';
import { keptSummarySentence } from '../camera/keep';
import { useAnalysis, type AnalysisState } from '../camera/useAnalysis';
import { presenceSentence } from '../camera/presence';
import type { CameraController, CaptureOutcome } from '../camera/session';

/**
 * What became of the picture just taken — kept, dropped, or refused a home.
 *
 * ⚠️ The third case is not a rarity: in production the keep writes a whole JPEG
 * to IndexedDB, and a device that is full is the ordinary way that goes wrong.
 * Before this the rejection escaped the click handler with no notice at all.
 */
function captureEnding(outcome: CaptureOutcome): string {
  if (outcome.keepFailed) {
    return 'this device could not keep it. There is no room for it.';
  }
  return outcome.kept ? 'kept on this device.' : 'thrown away.';
}

/** The id the outer section is named by. @see CameraView */
const TITLE_ID = 'oyl-camera-title';

/** What a rider is told where this build could not build a camera port at all. */
export const CAMERA_NO_PORT =
  'This browser cannot use a camera here. A camera needs a secure connection, and a page opened ' +
  'from a file on disk is not one.';

export interface CameraViewProps {
  /**
   * `undefined` where `main.tsx` could not build a port — see
   * {@link CAMERA_NO_PORT}. The screen then renders an explanation and **no
   * control at all**, which is `views/DevicesView.tsx`'s rule: a disabled
   * button is removed from the tab order, so a keyboard user never reaches it
   * and never hears why.
   */
  readonly controller?: CameraController | undefined;
}

export function CameraView({ controller }: CameraViewProps): JSX.Element {
  if (controller === undefined) {
    return (
      <section aria-labelledby={TITLE_ID}>
        <h2 id={TITLE_ID}>Camera</h2>
        <StatusMessage tone="danger">{CAMERA_NO_PORT}</StatusMessage>
      </section>
    );
  }
  return <Camera controller={controller} />;
}

function Camera({ controller }: { readonly controller: CameraController }): JSX.Element {
  // ⚠️ Three booleans rather than the whole state object: `useSyncExternalStore`
  // compares snapshots with `Object.is`, so a getter returning a fresh object
  // every call renders for ever. `camera/indicator.tsx` records the same trap.
  const live = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().live,
    () => false,
  );
  const agreed = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().consent.local,
    () => false,
  );
  const captured = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().captured,
    () => 0,
  );
  /**
   * ⚠️ **The fourth snapshot, and it is here because the test found the screen
   * without it.** `notice()` is read during render, so the explanatory screen
   * only appears when React re-renders — and a refused permission changes the
   * *problem* and nothing else: `live` stays `false`, `consent.local` stays
   * `true`, `captured` stays where it was. So the three subscriptions above all
   * answered identically, nothing re-rendered, and a rider who pressed "Turn
   * the camera on" and was refused by Android saw the screen sit there saying
   * "The camera is off." with no explanation at all.
   *
   * That is #87's criterion 8 failing in a new place — a dead control rather
   * than an explanation — and it is the kind of defect a state object hides:
   * the controller was right, the notice was right, and the only thing wrong
   * was that nothing had asked again.
   */
  const problem = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().problem,
    () => undefined,
  );

  const keeping = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().keeping,
    () => false,
  );

  /**
   * ⚠️ **The sixth snapshot, and it is what makes the sentence below true.**
   * `keeping` is what the NEXT picture will do; this is how many of the ones
   * already taken are on the disk. The screen used to derive the second from
   * the first and told a rider who kept three pictures and then turned the
   * switch off that *"None of them was kept."* — on the one screen whose job is
   * to say what this device is holding. `camera/session.ts`
   * §`CameraState.keptThisSession` counts what the sink actually did.
   */
  const keptThisSession = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().keptThisSession,
    () => 0,
  );

  /** #390: whether the rider asked for the ride to pause when nobody is on the bike. */
  const watchingPresence = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().watchingPresence,
    () => false,
  );
  /** #390: the one word the ride is being given. A string, so `Object.is` holds. */
  const presence = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().presence,
    () => 'unknown' as const,
  );
  /** #516: whether the quality ladder still lets presence run, for the sentence. */
  const presenceAllowed = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state().presenceAllowed,
    () => true,
  );

  const [acknowledged, setAcknowledged] = useState(false);
  const [kept, setKept] = useState<number | undefined>(undefined);
  const [refusal, setRefusal] = useState<ConsentRefusal | undefined>(undefined);
  const [outcome, setOutcome] = useState<CaptureOutcome | undefined>(undefined);

  // Read from the controller rather than mapped from `problem` here, so the
  // words have exactly one home — `camera/notice.ts`, which is where ADR 0029
  // D-8 is enforced. `problem` above is what makes this line run again.
  void problem;
  const notice = controller.notice();

  const refreshKept = useCallback(() => {
    void controller.keptCount().then((count) => {
      setKept(count);
    });
  }, [controller]);

  useEffect(refreshKept, [refreshKept]);

  const turnOn = useCallback(() => {
    setOutcome(undefined);
    void controller.turnOn();
  }, [controller]);

  const agree = useCallback(() => {
    const decision = controller.agree({
      acknowledgedBystanders: acknowledged,
      allowLocal: true,
      // ⚠️ Hard `false`, and there is no control that changes it. See
      // `camera/consent.ts` §`CameraConsent.hosted`.
      allowHosted: false,
    });
    setRefusal(decision.refusal);
  }, [acknowledged, controller]);

  return (
    <section className="oyl-camera" aria-labelledby={TITLE_ID}>
      {/*
        ⚠️ **Named, because its children are.** A `<section>` with an accessible
        name is a `region` landmark; one without is nothing. This screen has
        three named subsections inside an outer one, and an unnamed outer
        section among named siblings is `a11y/audit.ts`'s
        `landmarks-are-distinguishable` — *"a landmark list with two identical
        entries is a list you cannot navigate by"*. The gate caught it on the
        way in, which is the gate working.
      */}
      <h2 id={TITLE_ID}>Camera</h2>

      <section aria-labelledby="oyl-camera-what">
        <h3 id="oyl-camera-what">What this does</h3>
        <ul>
          {CONSENT_STATEMENT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {/*
          ADR 0029 D-5, verbatim, and `camera/consent.ts` asserts it against the
          ADR on disk. It is a `StatusMessage` rather than a paragraph because
          it is the one sentence on this screen that is about somebody who is
          not the rider and cannot answer for themselves.
        */}
        <StatusMessage tone="warning" label="Anyone else in the room">
          {BYSTANDER_SENTENCE}
        </StatusMessage>
      </section>

      {agreed ? null : (
        <section aria-labelledby="oyl-camera-agree">
          <h3 id="oyl-camera-agree">Turning it on</h3>
          <p>
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                }}
              />{' '}
              I have read what happens to anyone else in the room.
            </label>
          </p>
          <Button onClick={agree}>Allow the camera on this device</Button>
          {refusal === undefined ? null : (
            <StatusMessage tone="warning" live>
              {CONSENT_REFUSAL_TEXT[refusal]}
            </StatusMessage>
          )}
        </section>
      )}

      {agreed ? (
        <section aria-labelledby="oyl-camera-control">
          <h3 id="oyl-camera-control">The camera</h3>
          <p>{live ? 'The camera is on.' : 'The camera is off.'}</p>
          {live ? (
            <Button
              variant="secondary"
              onClick={() => {
                controller.turnOff();
              }}
            >
              Turn the camera off
            </Button>
          ) : (
            <Button onClick={turnOn}>Turn the camera on</Button>
          )}{' '}
          <Button
            variant="secondary"
            onClick={() => {
              // ⚠️ `refreshKept` as well as `setOutcome`, because a kept picture
              // changes what "Pictures on this device" below is counting. It
              // used to run on mount and after `forgetKept` alone, so a rider
              // who kept three pictures went on reading "holding no pictures"
              // until they navigated away and back.
              //
              // ⚠️ It is a **fresh store read** rather than an increment of the
              // number already on screen: this counter is what a rider decides
              // whether to press "Delete every picture" by, and a count derived
              // from what this tab believes it wrote is the write-reports-
              // success-while-the-read-cannot-see-it shape CLAUDE.md §5 names.
              //
              // `captureOne` never rejects — see `camera/session.ts`.
              void controller.captureOne().then((result) => {
                setOutcome(result);
                refreshKept();
              });
            }}
          >
            Take a picture
          </Button>{' '}
          <Button
            variant="secondary"
            onClick={() => {
              setAcknowledged(false);
              setRefusal(undefined);
              setOutcome(undefined);
              controller.revoke();
            }}
          >
            Stop using the camera on this device
          </Button>
          {/*
            ADR 0029 D-2's per-ride keep. OFF every time the camera is turned
            on — `camera/session.ts` §`turnOn` is what makes that true rather
            than this component remembering to reset a box — and there is
            deliberately no "always keep" anywhere in this client.
          */}
          <p>
            <label>
              <input
                type="checkbox"
                checked={keeping}
                onChange={(event) => {
                  controller.setKeeping(event.target.checked);
                }}
              />{' '}
              Keep the pictures from this ride on this device
            </label>
          </p>
          {/*
            ⚠️ **Both numbers, because one of them cannot answer this.** The
            switch above says what the NEXT picture will do; this sentence is
            about the ones already taken, and a rider may turn the switch on and
            off inside one session. `camera/keep.ts` §`keptSummarySentence` is
            the one place the wording lives, and it is pure so that it is tested
            without a DOM.
          */}
          <p>{keptSummarySentence(captured, keptThisSession)}</p>
          {/*
            #390. OFF every time the camera is turned on, like the keep above.
            It needs no second consent and grants nothing new — the same
            camera, under the same agreement, with the same indicator showing
            — and it takes no picture: `camera/presence.ts` compares two tiny
            brightness grids and keeps one word.

            ⚠️ Rendered only while the camera is on, rather than disabled while
            it is off: a disabled control leaves the tab order and a keyboard
            user never hears why (`views/DevicesView.tsx`'s rule), and an
            enabled one that did nothing would be a way in that is not.
          */}
          {live ? (
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={watchingPresence}
                  onChange={(event) => {
                    controller.watchPresence(event.target.checked);
                  }}
                />{' '}
                Pause my ride when nobody is on the bike
              </label>
            </p>
          ) : null}
          {live && watchingPresence ? <p>{presenceSentence(presence, presenceAllowed)}</p> : null}
          {outcome === undefined ? null : (
            <StatusMessage tone={outcome.taken && !outcome.keepFailed ? 'success' : 'warning'} live>
              {/*
                ⚠️ A size and a count. ADR 0029 D-8 permits exactly this and
                forbids the thumbnail somebody will ask for — and the failure
                branch carries nothing of the storage error either, not its
                message and not the key it could not write.
              */}
              {outcome.taken
                ? `A picture was taken — ${String(outcome.width)} by ${String(outcome.height)}, ${String(outcome.bytes)} bytes — and ${captureEnding(outcome)}`
                : 'No picture was taken.'}
            </StatusMessage>
          )}
        </section>
      ) : null}

      {agreed ? <AnalysisSection controller={controller} live={live} /> : null}

      {/*
        ⚠️ **A COUNT, and never a picture.** ADR 0029 D-11 keeps a kept frame
        off every screen somebody who did not take it could meet by accident,
        and D-8's permitted column is *"a count, a byte size, a format name"*.
        This is how a rider finds out that this device is holding something
        without being shown what — and how they get rid of it, which is D-2's
        rider-driven expiry and the only one that works in this milestone.
      */}
      <section aria-labelledby="oyl-camera-kept">
        <h3 id="oyl-camera-kept">Pictures on this device</h3>
        <p>
          {kept === undefined
            ? 'Counting…'
            : kept === 0
              ? 'This device is holding no pictures.'
              : `This device is holding ${String(kept)} picture${kept === 1 ? '' : 's'}.`}
        </p>
        {kept === undefined || kept === 0 ? null : (
          <Button
            variant="secondary"
            onClick={() => {
              void controller.forgetKept().then(() => {
                refreshKept();
              });
            }}
          >
            Delete every picture on this device
          </Button>
        )}
      </section>

      {notice === null ? null : (
        <section aria-labelledby="oyl-camera-problem">
          <h3 id="oyl-camera-problem">{notice.title}</h3>
          {/*
            The explanation and the instruction, and never an error code — #382:
            "A test asserts the explanation renders and names no error code as
            its only content." The words come from `camera/notice.ts`'s fixed
            table, which is where D-8 is enforced.
          */}
          <p>{notice.explanation}</p>
          {notice.instruction === null ? null : <p>{notice.instruction}</p>}
        </section>
      )}
    </section>
  );
}

/**
 * What the screen says about a connection check. One sentence each, and none
 * of them carries anything the computer said — see `camera/useAnalysis.ts`.
 */
export function analysisSentence(state: AnalysisState): string | undefined {
  switch (state.kind) {
    case 'idle':
      return undefined;
    case 'asking':
      return 'A picture was sent to your computer. Waiting for its answer…';
    case 'answered':
      return state.understood
        ? 'Your computer answered, and understood the request. The picture was not kept unless this ride’s keep is on.'
        : `Your computer answered (${String(state.characters)} characters), but not with the one word it was asked for. Check that the model can read pictures. What it said is not shown.`;
    case 'failed':
      return ANALYSIS_FAILURE_TEXT[state.failure];
  }
}

/**
 * The rider's own computer — #387.
 *
 * ⚠️ **Rendered only once the camera is agreed to**, and the check control only
 * while it is running, rather than disabled otherwise — `views/DevicesView.tsx`'s
 * rule, for the reason the presence switch above gives.
 *
 * ⚠️ **Nothing is pre-filled and there is no placeholder address.** ADR 0031 D-4
 * condition 2: *"not in a placeholder, not in a dropdown"*. The boxes start
 * empty on a device that has never been set up, and hold what the rider saved
 * on one that has.
 */
function AnalysisSection({
  controller,
  live,
}: {
  readonly controller: CameraController;
  readonly live: boolean;
}): JSX.Element {
  const saved = readAnalysisEndpoint();
  const [address, setAddress] = useState(saved?.address ?? '');
  const [model, setModel] = useState(saved?.model ?? '');
  const [switchedOn, setSwitchedOn] = useState(saved?.switchedOn ?? false);
  const [refusal, setRefusal] = useState<EndpointRefusal | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [configured, setConfigured] = useState(saved?.switchedOn === true);
  const { state, ask } = useAnalysis(controller);
  const sentence = analysisSentence(state);

  const save = (): void => {
    const decision = endpointDecision({ address, model, switchedOn });
    if (decision.endpoint === undefined && !switchedOn) {
      // ⚠️ Switching off must take effect whatever the boxes hold. Clearing
      // the address is exactly how a rider stops sending, and a refused
      // address used to return before anything was written, leaving the
      // stored row switched ON — the box read off while the check was still
      // offered, to the OLD address. The privacy policy says "To stop it,
      // switch it off"; this is the line that makes that true.
      const stored = readAnalysisEndpoint();
      const kept = stored === undefined || writeAnalysisEndpoint({ ...stored, switchedOn: false });
      if (!kept) {
        forgetAnalysisEndpoint();
      }
      setRefusal(undefined);
      setConfigured(false);
      setMessage('Switched off. Nothing is sent.');
      return;
    }
    setRefusal(decision.refusal);
    if (decision.endpoint === undefined) {
      setMessage(undefined);
      return;
    }
    const kept = writeAnalysisEndpoint(decision.endpoint);
    setConfigured(kept && decision.endpoint.switchedOn);
    setMessage(
      kept
        ? decision.endpoint.switchedOn
          ? 'Saved. Pictures are sent to this computer only when you press the button below.'
          : 'Saved, and switched off. Nothing is sent.'
        : 'This device would not keep the address, so nothing is sent.',
    );
  };

  return (
    <section aria-labelledby="oyl-camera-analysis">
      <h3 id="oyl-camera-analysis">Your own computer</h3>
      <p>
        A computer of yours on the same network can look at your pictures, running a model server
        you install on it. Nothing is set up to begin with, and nothing is sent until you enter its
        address and switch it on. A picture then goes to that one address, only when you press the
        button, and is not kept here afterwards unless this ride’s keep is on. It goes over your own
        network, and is not encrypted on the way unless your computer’s address starts with
        https://.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p>
          <label htmlFor="oyl-analysis-address">Your computer’s address and port</label>{' '}
          <input
            id="oyl-analysis-address"
            className="oyl-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
        </p>
        <p>
          <label htmlFor="oyl-analysis-model">The model’s name on that computer</label>{' '}
          <input
            id="oyl-analysis-model"
            className="oyl-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          />
        </p>
        <p>
          <label className="oyl-announce__switch">
            <input
              type="checkbox"
              checked={switchedOn}
              onChange={(event) => {
                setSwitchedOn(event.target.checked);
              }}
            />{' '}
            Send pictures to this computer when I ask
          </label>
        </p>
        <Button type="submit">Save this computer</Button>{' '}
        {saved === undefined && !configured ? null : (
          <Button
            variant="secondary"
            onClick={() => {
              forgetAnalysisEndpoint();
              setAddress('');
              setModel('');
              setSwitchedOn(false);
              setConfigured(false);
              setRefusal(undefined);
              setMessage('Forgotten. Nothing is sent anywhere.');
            }}
          >
            Forget this computer
          </Button>
        )}
      </form>
      {refusal === undefined ? null : (
        <StatusMessage tone="warning" live>
          {ENDPOINT_REFUSAL_TEXT[refusal]}
        </StatusMessage>
      )}
      {message === undefined ? null : (
        <StatusMessage tone="info" live>
          {message}
        </StatusMessage>
      )}
      {live && configured ? (
        <p>
          <Button
            variant="secondary"
            onClick={() => {
              ask('connection-check');
            }}
          >
            Send one picture to check the connection
          </Button>
        </p>
      ) : null}
      {sentence === undefined ? null : (
        <StatusMessage
          tone={
            state.kind === 'failed'
              ? 'warning'
              : state.kind === 'answered' && state.understood
                ? 'success'
                : 'info'
          }
          live
        >
          {sentence}
        </StatusMessage>
      )}
    </section>
  );
}
