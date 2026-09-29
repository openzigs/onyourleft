// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The press on a ride's page that asks for a write-up** —
 * [#804](https://github.com/openzigs/onyourleft/issues/804), epic #795.
 *
 * The only production caller of `ride-analysis-port.ts`
 * §`askForRideWriteUp`, and so the one place a ride's numbers can start on
 * their way to a model. It is rendered only with a port and a source set up
 * and switched on; without one, `detail/RideWriteUpSection.tsx` renders
 * #805's fallback instead.
 *
 * With a source, it offers one control per source, **the rider's own
 * computer first** (the owner's ruling 7), a Cancel while a run is going, and
 * a live region that says step *n* of *m* and then how it ended — a sentence
 * from the controller's fixed table, never a model's words. Beside the
 * controls it says what will be sent, in ADR 0035 D-9's approved words. The
 * write-up itself is shown by `detail/RideWriteUpSection.tsx` (#805), which
 * renders this and the heading above it; this says only that it was saved.
 *
 * ⚠️ **While a run goes the ask controls stay in the tab order** (#805),
 * `aria-disabled` rather than `disabled`, for `design/Button.tsx`
 * §`disabled`'s reason, and a press on one is refused here.
 *
 * ⚠️ **Leaving the page cancels the run.** A write-up nobody is waiting for is
 * work in the background, which ADR 0035 D-8 rules out.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import type { ActivityId } from '@onyourleft/store';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/MoreAbout';
import { COMPUTER_SENDS, COMPUTER_SENDS_LEAD, HOSTED_SENDS } from '../detail/write-up';
import type { AskOutcome, RideAnalysisPort, RideWriteUpSource } from './ride-analysis-port';

/** The section's heading. */
export const WRITE_UP_HEADING = 'A write-up by your model';

/** What the section says before anything is pressed. */
export const WRITE_UP_EXPLANATION =
  'Ask the model you set up to write about this ride. It is sent this ride’s numbers, never a picture, and only when you press the button. A finished write-up replaces the one this ride has; an attempt that fails leaves it as it was.';

/** The control for each source, first and as the alternative. */
export const ASK_LABEL: Readonly<Record<RideWriteUpSource, { first: string; other: string }>> = {
  computer: {
    first: 'Ask your computer for a write-up',
    other: 'Ask your computer instead',
  },
  hosted: {
    first: 'Ask your hosted model for a write-up',
    other: 'Ask your hosted model instead',
  },
};

export const CANCEL_LABEL = 'Cancel the write-up';

/** What the live region says once a write-up is saved. */
export const WRITE_UP_SAVED = 'The write-up is saved with this ride.';

/** What the live region says while a run is starting, before its first step. */
export const WRITE_UP_STARTING = 'Asking for a write-up…';

/** Step `step` of `total`, and nothing about the step. */
export function progressText(step: number, total: number): string {
  return `Step ${String(step)} of ${String(total)}.`;
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly said: string }
  | { readonly kind: 'ended'; readonly outcome: AskOutcome };

/** The id of the "what is sent" paragraph, which every ask control is described by. */
const SENDS_ID = 'oyl-write-up-sends';

export interface RideWriteUpControlProps {
  readonly port: RideAnalysisPort;
  readonly activityId: ActivityId;
  /**
   * The sources to offer, the default first — read once by the section that
   * renders this (`detail/RideWriteUpSection.tsx`), which renders the #805
   * fallback instead when there are none.
   */
  readonly sources: readonly RideWriteUpSource[];
  /** Told how every ask ended, so the section can show a new write-up or keep the old one. */
  readonly onEnded?: (outcome: AskOutcome) => void;
}

export function RideWriteUpControl({
  port,
  activityId,
  sources,
  onEnded,
}: RideWriteUpControlProps): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const running = useRef<AbortController | undefined>(undefined);

  // Leaving the page cancels whatever is running.
  useEffect(
    () => () => {
      running.current?.abort();
      running.current = undefined;
    },
    [],
  );

  const ask = (source: RideWriteUpSource): void => {
    // ⚠️ The controls stay in the tab order while a run goes (#805), marked
    // `aria-disabled` — which is a promise to a screen reader and nothing
    // more: a press still arrives here, and this is what refuses it.
    if (running.current !== undefined) {
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    setState({ kind: 'running', said: WRITE_UP_STARTING });
    void port
      .askForRideWriteUp(activityId, source, controller.signal, ({ step, total }) => {
        if (running.current === controller) {
          setState({ kind: 'running', said: progressText(step, total) });
        }
      })
      .then((outcome) => {
        if (running.current === controller) {
          running.current = undefined;
          setState({ kind: 'ended', outcome });
          onEnded?.(outcome);
        }
      });
  };

  const cancel = (): void => {
    running.current?.abort();
  };

  const busy = state.kind === 'running';
  const said =
    state.kind === 'running'
      ? state.said
      : state.kind === 'ended'
        ? state.outcome.kind === 'written'
          ? WRITE_UP_SAVED
          : state.outcome.text
        : '';

  return (
    <>
      <KeptVisible>
        <p className="oyl-muted">{WRITE_UP_EXPLANATION}</p>
      </KeptVisible>
      <div className="oyl-write-up__controls">
        {sources.map((source, index) => (
          <Button
            key={source}
            variant="secondary"
            unavailable={busy}
            describedBy={SENDS_ID}
            onClick={() => {
              ask(source);
            }}
          >
            {index === 0 ? ASK_LABEL[source].first : ASK_LABEL[source].other}
          </Button>
        ))}
        {busy ? (
          <Button variant="secondary" onClick={cancel}>
            {CANCEL_LABEL}
          </Button>
        ) : undefined}
      </div>
      {/*
        #805: what will be sent, beside the press, in the approved words
        (ADR 0035 D-9). Kept visible: it is what leaves the device, and when.
      */}
      <KeptVisible>
        <div id={SENDS_ID}>
          {sources.includes('computer') ? (
            <p>
              <strong>{COMPUTER_SENDS_LEAD}</strong> {COMPUTER_SENDS}
            </p>
          ) : undefined}
          {/*
            #803: ADR 0035 D-9 C in full but for its sentence about the switch,
            which is ON wherever this is shown (`detail/write-up.ts`
            §`HOSTED_SENDS`). Carried from #838's review, where only the
            headline stood here.
          */}
          {sources.includes('hosted')
            ? HOSTED_SENDS.map((sentence, index) => (
                <p key={sentence}>
                  {index === 0 || index === HOSTED_SENDS.length - 1 ? (
                    <strong>{sentence}</strong>
                  ) : (
                    sentence
                  )}
                </p>
              ))
            : undefined}
        </div>
      </KeptVisible>
      {/* Rendered from the start, so a screen reader is listening before it changes. */}
      <p role="status" aria-live="polite">
        {said}
      </p>
    </>
  );
}
