// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Asking the rider's computer about a picture, with a deadline the screen
 * owns** ([#387](https://github.com/openzigs/onyourleft/issues/387)).
 *
 * ## The deadline is here and not in the port — and a late answer still wins
 *
 * `support/useShellSupport.ts` is the precedent and its argument transfers
 * whole. A model server on a laptop can take a minute over one picture the
 * first time it loads the model, so a bound in `analysis-port.ts` would either
 * be too long to be useful or would abandon a real answer at the moment it
 * arrived. So:
 *
 * 1. **A deadline**, {@link ANALYSIS_ANSWER_WITHIN}, after which the screen
 *    says `no-answer` — a named failure the rider can act on, not a spinner.
 * 2. **The request is not abandoned at the deadline.** Only the screen moves
 *    on; the answer, if it comes, replaces the message.
 * 3. **It is abandoned when the rider leaves or asks again.** Unmounting
 *    cancels it, and a second press cancels the first — so an older answer,
 *    resolving last, can never overwrite a newer one.
 *
 * ## What is kept of the answer: whether it was understood, and how long it was
 *
 * ⚠️ **Not the words.** The connection check asks the model to reply with one
 * word, and this hook reduces what came back to a boolean and a length before
 * anything renders. The reason is
 * [ADR 0030](../../../../docs/adr/0030-what-the-app-may-say-about-a-body.md):
 * every string this feature shows about a rider's body is bound by its table,
 * and a model that ignored its prompt and described the picture would have
 * this screen saying something about a body that nobody ruled on.
 * [#388](https://github.com/openzigs/onyourleft/issues/388)'s report is where
 * words are shown, under that ADR's rules; this issue *"renders no report"*.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AnalysisCall, AnalysisFailure, AnalysisQuestion } from './analysis-port';
import { answeredReady } from './analysis-response';

/**
 * How long the screen waits before saying there is no answer yet, in
 * milliseconds.
 *
 * A minute, because the first request after a model server starts loads the
 * model's weights, which on a consumer machine takes tens of seconds before a
 * picture is looked at at all. Shorter would tell a rider their working setup
 * was broken on its first run.
 */
export const ANALYSIS_ANSWER_WITHIN = 60_000;

/** What the screen shows. */
export type AnalysisState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asking' }
  | {
      readonly kind: 'answered';
      /** Whether the reply was the one word the connection check asks for. */
      readonly understood: boolean;
      /** How long it was. A count, which ADR 0029 D-8 permits. */
      readonly characters: number;
    }
  | { readonly kind: 'failed'; readonly failure: AnalysisFailure };

/** The one thing this hook needs of a controller. */
export interface PictureAsker {
  askAboutPicture(question: AnalysisQuestion): AnalysisCall;
}

/** Run `callback` after `milliseconds`; return a cancel. Injected by tests. */
export type AnalysisSchedule = (callback: () => void, milliseconds: number) => () => void;

function browserSchedule(callback: () => void, milliseconds: number): () => void {
  const handle = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(handle);
  };
}

/** @see useAnalysis */
export interface AnalysisOptions {
  readonly answerWithin?: number | undefined;
  readonly schedule?: AnalysisSchedule | undefined;
}

/** @see useAnalysis */
export interface AnalysisControls {
  readonly state: AnalysisState;
  readonly ask: (question: AnalysisQuestion) => void;
}

/** Ask, with a deadline on the screen and none on the request. */
export function useAnalysis(asker: PictureAsker, options: AnalysisOptions = {}): AnalysisControls {
  const [state, setState] = useState<AnalysisState>({ kind: 'idle' });
  const current = useRef<{ call: AnalysisCall; cancelDeadline: () => void } | undefined>(undefined);
  const settings = useRef(options);

  useEffect(() => {
    settings.current = options;
  });

  const ask = useCallback(
    (question: AnalysisQuestion) => {
      // A second press replaces the first, so the older answer can never land
      // on top of the newer one.
      current.current?.call.cancel();
      current.current?.cancelDeadline();

      setState({ kind: 'asking' });
      const call = asker.askAboutPicture(question);
      const cancelDeadline = (settings.current.schedule ?? browserSchedule)(() => {
        if (current.current?.call === call) {
          setState({ kind: 'failed', failure: 'no-answer' });
        }
      }, settings.current.answerWithin ?? ANALYSIS_ANSWER_WITHIN);
      current.current = { call, cancelDeadline };

      void call.outcome.then((outcome) => {
        // ⚠️ No check on whether the deadline already fired: a late answer is
        // still the answer, and replacing "no answer yet" with it is the point.
        // The check is on whether this is still the CURRENT call.
        if (current.current?.call !== call) {
          return;
        }
        cancelDeadline();
        if (outcome.kind === 'failed') {
          setState({ kind: 'failed', failure: outcome.failure });
          return;
        }
        // The words stop here. @see this file's header.
        setState({
          kind: 'answered',
          understood: answeredReady(outcome.description),
          characters: outcome.description.length,
        });
      });
    },
    [asker],
  );

  useEffect(
    () => () => {
      current.current?.call.cancel();
      current.current?.cancelDeadline();
      current.current = undefined;
    },
    [],
  );

  return { state, ask };
}
