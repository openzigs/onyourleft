// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One test question to a rider's hosted service, carrying none of their
 * data** — #1251, the owner's ruling on #1104 B1 question 2 (2026-10-09):
 * *"keep a test question, sent by the instance with none of the rider's
 * data"*.
 *
 * A rider who stored a key and recorded their consent has no way to learn
 * whether the service answers short of sending it a ride. This sends it
 * {@link HOSTED_TEST_SYSTEM} and {@link HOSTED_TEST_QUESTION} — two constants
 * of this repository — and says, in a closed enumeration, how that went.
 *
 * ## The same gate as a job
 *
 * The connection comes from `source.ts` §`modelForSource`, asked for
 * `instance-hosted` exactly as the job engine asks it. So the test is refused
 * `not-ready`, and NOTHING is sent, wherever a job would end
 * `hosted_unavailable`: no recorded consent, a consent naming another origin
 * than the key goes to, no key of the rider's own, a key this secret cannot
 * open, or no masking guard that can be read. A test that answers therefore
 * means a job would be let through, and a rider is never told "it works"
 * about a service their jobs cannot reach.
 *
 * It follows that the hosted connection is still built in one place, behind
 * the masking (`hosted-seam.test.ts`): this module names no constructor.
 *
 * ## What is sent, and what comes back
 *
 * Sent, in full: the two constants, the model's name, a token bound, and the
 * rider's key as the bearer token — to the origin their consent names. No
 * athlete id, no ride, no tool, and nothing the rider typed.
 *
 * ⚠️ **Nothing the service says crosses this module.** Its answer is read for
 * being there and dropped; its error text never leaves `model.ts`
 * (`model-turn.ts` §`ModelFailure`). A rider is shown one of
 * {@link HostedTestResult}'s words and whether the model reasoned.
 */

import type { ModelFailure } from './model-turn.ts';
import { modelForSource, type SourceOptions } from './source.ts';

/** The system prompt of the test: a constant, with nothing of a rider's in it. */
export const HOSTED_TEST_SYSTEM =
  'This is a connection test from a cycling app. No ride and no personal data is included.';

/** The one question the test asks: a constant, with nothing of a rider's in it. */
export const HOSTED_TEST_QUESTION = 'Reply with the one word: ready';

/**
 * The answer's bound: 64 tokens, for one word. A model the rider said reasons
 * is given its allowance on top (#1268), as a job's turn is.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const HOSTED_TEST_ANSWER_TOKENS = 64;

/**
 * How long the service is given: 30 s. Inside the app's own longest wait for
 * a sealed call, so the rider is told this rather than "no answer".
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const HOSTED_TEST_MILLISECONDS = 30_000;

/** How the test went. Closed: no word of the service's is in it. */
export type HostedTestResult =
  /** The service answered with some text. */
  | 'answered'
  /** It replied with no answer: cut off by the bound, or reasoning and nothing after it. */
  | 'no-answer'
  /** A job would be refused `hosted_unavailable`, so nothing was sent. */
  | 'not-ready'
  /** The service refused the request: any 4xx — most often the key or the model's name. */
  | 'refused'
  /** No answer: unresolved, refused connection, reset. */
  | 'unreachable'
  /** Longer than {@link HOSTED_TEST_MILLISECONDS}. */
  | 'timed-out'
  /** A 5xx, or a reply that is not a chat completion. */
  | 'failed';

export interface HostedTestOutcome {
  readonly result: HostedTestResult;
  /** Whether the reply showed the model reasoning before it answered (#1268). */
  readonly reasoned: boolean;
}

function resultOf(failure: ModelFailure): HostedTestResult {
  switch (failure) {
    case 'unreachable':
    case 'unresolved':
      return 'unreachable';
    case 'timed-out':
      return 'timed-out';
    case 'refused':
    case 'model-without-tools':
      return 'refused';
    case 'server-error':
    case 'malformed':
    case 'aborted':
    case 'not-local':
      return 'failed';
  }
}

/** Ask `athleteId`'s hosted service the test question, through the job's own gate. */
export async function askHostedTestQuestion(
  athleteId: string,
  sources: SourceOptions,
  signal: AbortSignal = new AbortController().signal,
): Promise<HostedTestOutcome> {
  const chosen = await modelForSource('instance-hosted', athleteId, sources);
  if (!chosen.ok) return { result: 'not-ready', reasoned: false };
  const turn = await chosen.model.turn({
    system: HOSTED_TEST_SYSTEM,
    messages: [{ role: 'user', text: HOSTED_TEST_QUESTION }],
    tools: [],
    maxOutputTokens: HOSTED_TEST_ANSWER_TOKENS + (chosen.model.reasoningTokens ?? 0),
    timeoutMilliseconds: HOSTED_TEST_MILLISECONDS,
    signal,
  });
  if (!turn.ok) return { result: resultOf(turn.failure), reasoned: false };
  return {
    result: turn.text.trim() === '' ? 'no-answer' : 'answered',
    reasoned: turn.reasoning !== undefined,
  };
}
