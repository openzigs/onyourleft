// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The press on a ride's page that asks for a write-up** —
 * [#804](https://github.com/openzigs/onyourleft/issues/804), epic #795.
 *
 * The only production caller of `ride-analysis-port.ts`
 * §`askForRideWriteUp`, and so the one place a ride's numbers can start on
 * their way to a model. It renders nothing without a port or with no source
 * set up and switched on (#805's fallback is what a rider sees instead).
 *
 * With a source, it offers one control per source, **the rider's own
 * computer first** (the owner's ruling 7), a Cancel while a run is going, and
 * a live region that says step *n* of *m* and then how it ended — a sentence
 * from the controller's fixed table, never a model's words. The write-up
 * itself is shown by #805; this says only that it was saved.
 *
 * ⚠️ **Leaving the page cancels the run.** A write-up nobody is waiting for is
 * work in the background, which ADR 0035 D-8 rules out.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import type { ActivityId } from '@onyourleft/store';

import { Button } from '../design/Button';
import type { AskOutcome, RideAnalysisPort, RideWriteUpSource } from './ride-analysis-port';

/** The section's heading. */
export const WRITE_UP_HEADING = 'A write-up by your model';

/** What the section says before anything is pressed. */
export const WRITE_UP_EXPLANATION =
  'Ask the model you set up to write about this ride. It is sent this ride’s numbers, never a picture, and only when you press the button. A new write-up replaces the one this ride has.';

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

const HEADING_ID = 'oyl-write-up-heading';

export interface RideWriteUpControlProps {
  readonly port?: RideAnalysisPort | undefined;
  readonly activityId: ActivityId;
}

export function RideWriteUpControl({
  port,
  activityId,
}: RideWriteUpControlProps): JSX.Element | null {
  // Read when the page opens: it asks only whether a port COULD be built, and
  // sends nothing.
  const [sources] = useState<readonly RideWriteUpSource[]>(() => port?.availableSources() ?? []);
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

  if (port === undefined || sources.length === 0) {
    return null;
  }

  const ask = (source: RideWriteUpSource): void => {
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
        }
      });
  };

  const cancel = (): void => {
    running.current?.abort();
  };

  const said =
    state.kind === 'running'
      ? state.said
      : state.kind === 'ended'
        ? state.outcome.kind === 'written'
          ? WRITE_UP_SAVED
          : state.outcome.text
        : '';

  return (
    <section aria-labelledby={HEADING_ID}>
      <h3 id={HEADING_ID}>{WRITE_UP_HEADING}</h3>
      <p className="oyl-muted">{WRITE_UP_EXPLANATION}</p>
      {state.kind === 'running' ? (
        <Button variant="secondary" onClick={cancel}>
          {CANCEL_LABEL}
        </Button>
      ) : (
        sources.map((source, index) => (
          <Button
            key={source}
            variant="secondary"
            onClick={() => {
              ask(source);
            }}
          >
            {index === 0 ? ASK_LABEL[source].first : ASK_LABEL[source].other}
          </Button>
        ))
      )}
      {/* Rendered from the start, so a screen reader is listening before it changes. */}
      <p role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
