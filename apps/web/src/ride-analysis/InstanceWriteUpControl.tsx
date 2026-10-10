// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The press on a ride's page that asks the rider's instance for a
 * write-up, and the write-up as it is written** —
 * [#1102](https://github.com/openzigs/onyourleft/issues/1102),
 * [ADR 0046](../../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
 * D-11.
 *
 * The only production caller of `instance-analysis-port.ts` §`ask`, so the one
 * place a ride's numbers start on their way to an instance for a write-up.
 * Rendered by `detail/RideWriteUpSection.tsx` when this device holds a sign-in
 * to an instance; without one that section says so in one sentence instead.
 *
 * ## What it renders, and what it never does
 *
 * - **The press**, and while a job goes, **Cancel**. The press stays in the tab
 *   order while a job goes (`aria-disabled`, #805), and a press then is
 *   refused here.
 * - **A live region**, polite, rendered from the start, saying the phase and
 *   the step — the page's own pattern (`RideWriteUpControl.tsx`), never the
 *   HUD's announcer — and then how it ended, from the controller's fixed
 *   tables. Never a model's words.
 * - **Each section as it arrives, only after this device screened it**, under
 *   the framing (ADR 0035 D-9 A), one React text node each. A withdrawal takes
 *   every one of them off the page and says so.
 *
 * ## Leaving, and riding
 *
 * Leaving the page lets go of the job without cancelling it: the instance
 * carries on, and opening the ride again picks it up (`followAgain`). While a ride
 * is being recorded the page lets go the same way and shows nothing of the job
 * — no progress, no sound, no announcement (ADR 0035 D-8) — and picks it up
 * once the recording ends.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import type { ActivityId } from '@onyourleft/store';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import {
  INSTANCE_SENDS,
  INSTANCE_SENDS_LEAD,
  WRITE_UP_FRAMING_LEAD,
  WRITE_UP_FRAMING_REST,
} from '../detail/write-up';
import type { InstanceJobSource } from './instance-job';
import type {
  InstanceAnalysisPort,
  InstanceAskOutcome,
  InstanceJobView,
} from './instance-analysis-port';
import type { AskOutcome } from './ride-analysis-port';
import { WRITE_UP_SAVED } from './RideWriteUpControl';

/** The press, by source. */
export const INSTANCE_ASK_LABEL: Readonly<Record<InstanceJobSource, string>> = {
  'instance-local': 'Write up this ride on your instance',
  'instance-hosted': 'Write up this ride with your instance’s service',
};

export const INSTANCE_CANCEL_LABEL = 'Cancel the write-up on your instance';

/** What the live region says while a job is asked for, before it is queued. */
export const INSTANCE_STARTING = 'Asking your instance for a write-up…';

/** While the instance works, before its first step. */
export const INSTANCE_QUEUED = 'Your instance has the request and is starting on it.';

/** Step `step` of the instance's run, and nothing about the step. */
export function instanceProgressText(step: number): string {
  return `Your instance is writing it up: step ${String(step)}.`;
}

/** While a dropped stream is followed again. */
export const INSTANCE_RECONNECTING =
  'The connection to your instance dropped. Picking the write-up up again…';

/** While the finished write-up is screened and saved on this device. */
export const INSTANCE_SAVING = 'Saving the write-up on this device…';

/** Everything streamed so far was taken back. */
export const INSTANCE_WITHDRAWN =
  'What your instance had written so far has been taken back: part of it did not pass the checks on what may be shown. None of it is shown.';

/** Above the sections as they arrive. */
export const INSTANCE_SO_FAR = 'The write-up so far, as your instance writes it:';

/** The id of the instance paragraph's lead, which describes the press. */
export const INSTANCE_SENDS_LEAD_ID = 'oyl-write-up-sends-instance';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'following'; readonly view: InstanceJobView }
  | { readonly kind: 'ended'; readonly outcome: AskOutcome };

export interface InstanceWriteUpControlProps {
  readonly port: InstanceAnalysisPort;
  readonly activityId: ActivityId;
  /** Told how every job ended, so the section can show a new write-up or keep the old one. */
  readonly onEnded?: (outcome: AskOutcome) => void;
}

/** What the live region says for `state`. */
function said(state: State): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'ended':
      return state.outcome.kind === 'written' ? WRITE_UP_SAVED : state.outcome.text;
    case 'following': {
      const { view } = state;
      if (view.withdrawn) return INSTANCE_WITHDRAWN;
      switch (view.phase) {
        case 'starting':
          return INSTANCE_STARTING;
        case 'reconnecting':
          return INSTANCE_RECONNECTING;
        case 'saving':
          return INSTANCE_SAVING;
        case 'streaming':
          return view.step === undefined ? INSTANCE_QUEUED : instanceProgressText(view.step);
      }
    }
  }
}

export function InstanceWriteUpControl({
  port,
  activityId,
  onEnded,
}: InstanceWriteUpControlProps): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [sources] = useState(() => port.availableSources());
  const [riding, setRiding] = useState(() => port.ride?.inProgress() ?? false);
  const following = useRef<AbortController | undefined>(undefined);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  /** Follow a job — a new one or this ride's pending one — until it ends or the page lets go. */
  const run = (
    start: (
      view: (view: InstanceJobView) => void,
      signal: AbortSignal,
    ) => Promise<InstanceAskOutcome>,
  ): void => {
    const controller = new AbortController();
    following.current = controller;
    void start((view) => {
      if (following.current === controller) setState({ kind: 'following', view });
    }, controller.signal).then((outcome) => {
      if (following.current !== controller) return;
      following.current = undefined;
      if (outcome.kind === 'detached') {
        setState({ kind: 'idle' });
        return;
      }
      setState({ kind: 'ended', outcome });
      onEndedRef.current?.(outcome);
    });
  };

  const letGo = (): void => {
    following.current?.abort();
    following.current = undefined;
  };

  // The recording: let go while a ride is recorded, and pick the job up after.
  useEffect(() => {
    const ride = port.ride;
    if (ride === undefined) return undefined;
    return ride.subscribe(() => {
      setRiding(ride.inProgress());
    });
  }, [port]);

  // A pending job is followed whenever the page is open and no ride is recorded.
  useEffect(() => {
    if (riding) {
      if (following.current !== undefined) {
        letGo();
        setState({ kind: 'idle' });
      }
      return undefined;
    }
    if (following.current === undefined && port.pendingJob(activityId)) {
      run((view, signal) => port.followAgain(activityId, view, signal));
    }
    return undefined;
    // `run` is rebuilt each render and reads only refs and the port.
  }, [riding, port, activityId]);

  // Leaving the page lets go; the job carries on on the instance.
  useEffect(() => letGo, []);

  const ask = (source: InstanceJobSource): void => {
    if (following.current !== undefined || riding) return;
    run((view, signal) => port.ask(activityId, source, view, signal));
  };

  const busy = state.kind === 'following';
  const view = state.kind === 'following' && !riding ? state.view : undefined;
  const sections = view?.sections ?? [];

  return (
    <>
      <div className="oyl-write-up__controls">
        {sources.map((source) => (
          <Button
            key={source}
            variant="secondary"
            unavailable={busy || riding}
            describedBy={INSTANCE_SENDS_LEAD_ID}
            onClick={() => {
              ask(source);
            }}
          >
            {INSTANCE_ASK_LABEL[source]}
          </Button>
        ))}
        {busy && !riding ? (
          <Button
            variant="secondary"
            onClick={() => {
              void port.cancel(activityId);
            }}
          >
            {INSTANCE_CANCEL_LABEL}
          </Button>
        ) : undefined}
      </div>
      {/* #1104 B3: what will be sent, beside the press. Kept visible: it is what leaves the device. */}
      <KeptVisible>
        <p>
          <strong id={INSTANCE_SENDS_LEAD_ID}>{INSTANCE_SENDS_LEAD}</strong> {INSTANCE_SENDS}
        </p>
      </KeptVisible>
      {/* Rendered from the start, so a screen reader is listening before it changes. */}
      <p role="status" aria-live="polite">
        {riding ? '' : said(state)}
      </p>
      {sections.length === 0 ? undefined : (
        <div className="oyl-write-up" data-oyl-streaming="">
          <p data-oyl-kept-visible="">
            <strong>{WRITE_UP_FRAMING_LEAD}</strong> {WRITE_UP_FRAMING_REST}
          </p>
          <p className="oyl-muted">{INSTANCE_SO_FAR}</p>
          {sections.map((text, index) => (
            // Screened on this device (`instance-analysis.ts`), and one text node.
            <p key={index} className="oyl-write-up__section">
              {text}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
