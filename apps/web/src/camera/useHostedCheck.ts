// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Asking the rider's hosted service its one question, with a deadline the
 * screen owns** ([#518](https://github.com/openzigs/onyourleft/issues/518)).
 *
 * `useAnalysis.ts`'s arrangement, for its reasons: a deadline after which the
 * screen says `no-answer`, a late answer that still replaces it, and a second
 * press or leaving the screen that cancels the first. A separate hook rather
 * than a generalised one because the two paths carry different failures, and
 * the picture path's hook is not the place to learn about a key.
 *
 * ⚠️ **What is kept of the answer is whether it was understood and how long
 * it was — not the words**, for the reason `useAnalysis.ts` gives: a model's
 * words about a rider are ADR 0030's to rule on, and this screen shows none.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { answeredReady } from './analysis-response';
import type { HostedCall, HostedFailure, HostedQuestion } from './hosted-port';
import { ANALYSIS_ANSWER_WITHIN, type AnalysisSchedule } from './useAnalysis';

/** What the screen shows. */
export type HostedCheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'answered'; readonly understood: boolean; readonly characters: number }
  | { readonly kind: 'failed'; readonly failure: HostedFailure };

/** The one thing this hook needs of a controller. */
export interface HostedAsker {
  askHostedModel(question: HostedQuestion): HostedCall;
}

/** @see useHostedCheck */
export interface HostedCheckOptions {
  readonly answerWithin?: number | undefined;
  readonly schedule?: AnalysisSchedule | undefined;
}

function browserSchedule(callback: () => void, milliseconds: number): () => void {
  const handle = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(handle);
  };
}

/** Ask, with a deadline on the screen and none on the request. */
export function useHostedCheck(
  asker: HostedAsker,
  options: HostedCheckOptions = {},
): { readonly state: HostedCheckState; readonly ask: (question: HostedQuestion) => void } {
  const [state, setState] = useState<HostedCheckState>({ kind: 'idle' });
  const current = useRef<{ call: HostedCall; cancelDeadline: () => void } | undefined>(undefined);
  const settings = useRef(options);

  useEffect(() => {
    settings.current = options;
  });

  const ask = useCallback(
    (question: HostedQuestion) => {
      current.current?.call.cancel();
      current.current?.cancelDeadline();

      setState({ kind: 'asking' });
      const call = asker.askHostedModel(question);
      const cancelDeadline = (settings.current.schedule ?? browserSchedule)(() => {
        if (current.current?.call === call) {
          setState({ kind: 'failed', failure: 'no-answer' });
        }
      }, settings.current.answerWithin ?? ANALYSIS_ANSWER_WITHIN);
      current.current = { call, cancelDeadline };

      void call.outcome.then((outcome) => {
        if (current.current?.call !== call) {
          return;
        }
        cancelDeadline();
        if (outcome.kind === 'failed') {
          setState({ kind: 'failed', failure: outcome.failure });
          return;
        }
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
