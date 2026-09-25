// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tripod phone's side-camera screen** — #528,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md).
 *
 * The screen a second phone shows while it films the rider side-on at hip
 * height, which is the arrangement the owner chose (#386). Four states, in the
 * order a rider meets them, and each is one of #528's criteria:
 *
 * 1. **Before the camera is ever on**: what it does, ADR 0029 D-5's bystander
 *    sentence, and ADR 0033 D-5's 30-second sentence beside it — shown on
 *    THIS device, because consent is per device (ADR 0033 D-4) and this is the
 *    one that films.
 * 2. **Framing**: the live picture, the outline of where to stand the bike,
 *    the ghost of last time, and what the tablet's check said (D-7).
 * 3. **Filming**: a full-screen sign readable from across the room, one stop
 *    control, and nothing else — the shell's chrome is absent, as it is on the
 *    ride stage (#423). If the link to the tablet is lost, a countdown.
 * 4. **Stopped**, and why.
 *
 * Everything that decides WHEN is `camera/side-camera.ts`, which is tested
 * without a DOM; this component renders what it says.
 *
 * ⚠️ **Nothing on this screen names a body.** ADR 0030 binds every string
 * near a camera, and a framing check is a statement about where a tripod
 * stands: `framing.ts` §`FRAMING_VERDICT_TEXT` is worded about the camera for
 * that reason.
 *
 * ⚠️ **Pairing is not here yet.** The link is
 * [#529](https://github.com/openzigs/onyourleft/issues/529), gated on
 * [#532](https://github.com/openzigs/onyourleft/issues/532) (ADR 0033 D-0), so
 * the shell hands this screen no link and it says so in words: the framing
 * setup works, and filming — which only the tablet can start — cannot.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { BYSTANDER_SENTENCE, CONSENT_REFUSAL_TEXT } from '../camera/consent';
import { FRAMING_VERDICT_TEXT } from '../camera/framing';
import { FramingPreview } from '../camera/FramingPreview';
import type { CameraController } from '../camera/session';
import {
  LINK_LOSS_SENTENCE,
  SideCameraSession,
  STOPPED_TEXT,
  type SideCameraSessionOptions,
  type SideCameraState,
} from '../camera/side-camera';
import type { SideCameraLinkPort } from '../camera/side-camera-link-port';
import { CAMERA_NO_PORT } from './CameraView';

/** The id the section is named by. */
const TITLE_ID = 'oyl-side-camera-title';

/**
 * The one big word the filming sign carries.
 *
 * ⚠️ **A word, and the word is the carrier** — #48's sixth criterion and
 * #528's *"it must not depend on colour alone"*. `Filming` rather than the
 * shell indicator's `Camera on` because it has to be read from the doorway at
 * the size of a phone's screen, and one short word can be drawn larger than
 * two: `browser/sidecamera.browser.spec.ts` holds it to one line inside the
 * screen at every phone size it measures, at the size `theme.css`
 * §"THE SIDE CAMERA" gives it. `Camera on` is still said, in the line under it.
 */
export const FILMING_WORD = 'Filming';

/** The line under it, for anyone close enough to read a sentence. */
export const FILMING_DETAIL =
  'Camera on. This phone is taking pictures of whoever is in front of it.';

/** What an unpaired phone is told, while framing. */
export const NOT_PAIRED_TEXT =
  'This phone is not paired with a tablet, and pairing is not in this version of the app yet. ' +
  'Filming starts from the tablet, so it cannot start here — but you can use this screen to ' +
  'stand the tripod in the right place.';

/** What the phone says about the link while framing. */
function linkSentence(state: SideCameraState): string {
  if (!state.paired) {
    return NOT_PAIRED_TEXT;
  }
  return state.linkCondition === 'lost'
    ? 'This phone cannot reach your tablet.'
    : 'Paired with your tablet. Filming starts when you press start on the tablet.';
}

/** The countdown, in words. */
function countdownSentence(seconds: number): string {
  return `Lost touch with your tablet. Stopping in ${String(seconds)} second${seconds === 1 ? '' : 's'}.`;
}

export interface SideCameraViewProps {
  /** `undefined` where `main.tsx` could not build a camera — see `CameraView`. */
  readonly controller?: CameraController | undefined;
  /**
   * The link to the tablet. `undefined` in this build — see the file header —
   * and supplied by tests and by the browser gate's harness.
   */
  readonly link?: SideCameraLinkPort | undefined;
  /**
   * Tells the shell the filming sign has the screen — #423's mechanism, as the
   * trainer game uses it. @see GameViewProps.onImmersive
   */
  readonly onImmersive?: ((immersive: boolean) => void) | undefined;
  /**
   * The session's clock and timers, for tests. Must be a stable object: a new
   * one each render would build a new session each render.
   */
  readonly timers?: Pick<SideCameraSessionOptions, 'clock' | 'after' | 'every'> | undefined;
}

export function SideCameraView(props: SideCameraViewProps): JSX.Element {
  const { controller } = props;
  if (controller === undefined) {
    return (
      <section aria-labelledby={TITLE_ID}>
        <h2 id={TITLE_ID}>Side camera</h2>
        <StatusMessage tone="danger">{CAMERA_NO_PORT}</StatusMessage>
      </section>
    );
  }
  return <SideCamera {...props} controller={controller} />;
}

function SideCamera({
  controller,
  link,
  onImmersive,
  timers,
}: SideCameraViewProps & { readonly controller: CameraController }): JSX.Element {
  // A new session per visit AND per "start again": a pairing lasts one session
  // (ADR 0033 D-4), so a stopped session is never revived.
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<SideCameraSession | undefined>(undefined);

  useEffect(() => {
    // Built in an effect rather than in state, so the cleanup that disposes it
    // is paired with the construction — under StrictMode's double effect the
    // first session is disposed before it has turned anything on.
    const created = new SideCameraSession({
      camera: controller,
      link,
      ...(timers ?? {}),
    });
    setSession(created);
    return () => {
      created.dispose();
    };
  }, [controller, link, timers, generation]);

  if (session === undefined) {
    return (
      <section aria-labelledby={TITLE_ID}>
        <h2 id={TITLE_ID}>Side camera</h2>
      </section>
    );
  }
  return (
    <SessionScreen
      key={generation}
      controller={controller}
      session={session}
      onImmersive={onImmersive}
      again={() => {
        setGeneration((value) => value + 1);
      }}
    />
  );
}

function SessionScreen({
  controller,
  session,
  onImmersive,
  again,
}: {
  readonly controller: CameraController;
  readonly session: SideCameraSession;
  readonly onImmersive: ((immersive: boolean) => void) | undefined;
  readonly again: () => void;
}): JSX.Element {
  const state = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.state(),
    () => session.state(),
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [refused, setRefused] = useState(false);

  const filming = state.phase === 'filming';
  useEffect(() => {
    if (!filming || onImmersive === undefined) {
      return;
    }
    onImmersive(true);
    return () => {
      onImmersive(false);
    };
  }, [filming, onImmersive]);

  const turnOn = useCallback(() => {
    const decision = controller.agree({
      acknowledgedBystanders: acknowledged,
      allowLocal: true,
      // ⚠️ Hard `false`: `camera/consent.ts` §`CameraConsent.hosted`.
      allowHosted: false,
    });
    if (decision.consent === undefined) {
      setRefused(true);
      return;
    }
    setRefused(false);
    void session.turnOnForFraming();
  }, [acknowledged, controller, session]);

  if (filming) {
    return (
      <section
        className="oyl-side-camera__stage"
        aria-labelledby={TITLE_ID}
        data-oyl-side-camera-stage="true"
      >
        {/*
          The sign. ⚠️ Not a live region: the shell's own indicator
          (`camera/indicator.tsx`) is the `role="status"` that announced the
          camera, and a second region saying the same thing would be heard
          twice. The heading is what names the stage.
        */}
        <h2 id={TITLE_ID} className="oyl-side-camera__sign" data-oyl-side-camera-indicator="true">
          <span className="oyl-side-camera__word">{FILMING_WORD}</span>
          <span className="oyl-side-camera__detail">{FILMING_DETAIL}</span>
        </h2>
        {state.secondsLeft === undefined ? null : (
          // `timer`, whose implicit live setting is off: a number announced
          // every second would drown everything else. The sentence says it
          // once, visibly, and goes on counting.
          <p className="oyl-side-camera__countdown" role="timer">
            {countdownSentence(state.secondsLeft)}
          </p>
        )}
        <div className="oyl-side-camera__stop">
          <Button
            onClick={() => {
              session.stopHere();
            }}
          >
            Stop filming
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="oyl-side-camera" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID}>Side camera</h2>

      {state.phase === 'off' ? (
        <section aria-labelledby="oyl-side-camera-what">
          <h3 id="oyl-side-camera-what">Before the camera is on</h3>
          <ul>
            <li>
              This phone stands on a tripod beside the bike and takes pictures of you from the side
              while you ride, only while the &ldquo;Camera on&rdquo; sign is showing.
            </li>
            <li>
              While you set it up, it shows you its own picture so you can line the bike up. That
              picture is not kept.
            </li>
            <li>
              This phone keeps nothing about you once the session ends — no picture, no outline, no
              record of the session.
            </li>
          </ul>
          <StatusMessage tone="warning" label="Anyone else in the room">
            {BYSTANDER_SENTENCE}
          </StatusMessage>
          <StatusMessage tone="warning" label="If the tablet loses touch">
            {LINK_LOSS_SENTENCE}
          </StatusMessage>
          <p>
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                }}
              />{' '}
              I have read what happens to anyone else in the room, and what this phone does if it
              loses touch with my tablet.
            </label>
          </p>
          <Button onClick={turnOn}>Turn the camera on to set it up</Button>
          {refused ? (
            <StatusMessage tone="warning" live>
              {CONSENT_REFUSAL_TEXT['not-acknowledged']}
            </StatusMessage>
          ) : null}
          {state.problem === undefined || state.problem === 'no-consent' ? null : (
            <CameraProblem controller={controller} />
          )}
        </section>
      ) : null}

      {state.phase === 'framing' ? (
        <section aria-labelledby="oyl-side-camera-framing">
          <h3 id="oyl-side-camera-framing">Line up the bike</h3>
          <FramingPreview controller={controller} reference={state.reference} />
          <p>
            {state.verdict !== undefined
              ? FRAMING_VERDICT_TEXT[state.verdict]
              : state.paired && state.reference === undefined
                ? FRAMING_VERDICT_TEXT['no-reference']
                : null}
          </p>
          <p>{linkSentence(state)}</p>
          {state.secondsLeft === undefined ? null : (
            <p role="timer">{countdownSentence(state.secondsLeft)}</p>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              session.stopHere();
            }}
          >
            Turn the camera off
          </Button>
        </section>
      ) : null}

      {state.phase === 'stopped' && state.stopReason !== undefined ? (
        <section aria-labelledby="oyl-side-camera-stopped">
          <h3 id="oyl-side-camera-stopped">Stopped</h3>
          <StatusMessage tone={state.stopReason === 'link-lost' ? 'warning' : 'info'} live>
            {STOPPED_TEXT[state.stopReason]}
          </StatusMessage>
          <Button onClick={again}>Set up again</Button>
        </section>
      ) : null}
    </section>
  );
}

/** The camera's own explanation, from the one table that words it (ADR 0029 D-8). */
function CameraProblem({
  controller,
}: {
  readonly controller: CameraController;
}): JSX.Element | null {
  const notice = controller.notice();
  if (notice === null) {
    return null;
  }
  return (
    <StatusMessage tone="warning" label={notice.title}>
      {notice.explanation}
      {notice.instruction === null ? null : ` ${notice.instruction}`}
    </StatusMessage>
  );
}
