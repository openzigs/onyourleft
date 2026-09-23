// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the rider's computer said, read as untrusted input**
 * ([#387](https://github.com/openzigs/onyourleft/issues/387),
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-8).
 *
 * A vision model's output is attacker-influenceable **through the image**: a
 * sheet of paper held up behind the rider is a prompt, and so is a poster on
 * the wall the tripod faces. So nothing here believes anything it is given.
 * The rules, in the order they are applied:
 *
 * 1. **A status is read before a body.** A server's own error text is
 *    discarded, not shown and not logged: it is written by a program this
 *    project does not control and may quote what it was sent — D-8 forbids a
 *    message carrying the picture, and a server echoing a request would carry
 *    the picture's `data:` URL.
 * 2. **The body is bounded before it is parsed.** `analysis-transport.ts`
 *    stops reading at {@link MAXIMUM_RESPONSE_BYTES}; this refuses anything
 *    that arrives longer anyway, so a transport that forgot would still not
 *    hand `JSON.parse` a gigabyte.
 * 3. **The shape is checked, not assumed.** The one field read is the first
 *    choice's message content, and only a string (or a list of text parts) is
 *    accepted. Every other field — including a `tool_calls` a hostile server
 *    might volunteer — is never looked at, so there is nothing for it to
 *    trigger.
 * 4. **The text is cleaned and bounded.** Control characters and the Unicode
 *    bidirectional overrides are removed, the text is normalised, and anything
 *    longer than {@link MAXIMUM_DESCRIPTION_CHARACTERS} is refused rather than
 *    truncated — a truncation would be this client editing what a model said,
 *    and a report built on half a sentence is worse than none.
 *
 * What comes out is an {@link UntrustedText}: plain text, rendered only as a
 * React text node, never markup, never a path, never a URL, never a command,
 * and never anything a trainer reads. `analysis-safety.test.ts` holds each of
 * those.
 */

import type { AnalysisOutcome, UntrustedText } from './analysis-port';

/**
 * The most this client reads of an answer, in bytes.
 *
 * A description of one picture is a few hundred bytes of text in a JSON
 * envelope of a few hundred more. 64 KiB is more than a hundred times that,
 * and small enough that a hostile server cannot make a phone allocate anything
 * worth noticing.
 */
export const MAXIMUM_RESPONSE_BYTES = 64 * 1024;

/**
 * The longest description accepted, in characters.
 *
 * Refused, not truncated, above this. #388's report reads a few sentences; a
 * reply this long is a model that ignored its prompt, and a model that ignored
 * its prompt is not one whose words should be shown.
 */
export const MAXIMUM_DESCRIPTION_CHARACTERS = 4000;

/** What the transport hands this module: a status and a body it has already bounded. */
export interface AnalysisReply {
  readonly status: number;
  readonly body: string;
}

/**
 * Characters removed from a description.
 *
 * C0 and C1 controls except the tab and the line feed, and the bidirectional
 * embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069) — the
 * characters that make a string read differently from how it is stored, which
 * is the one property text that nobody trusts must not have.
 */
// eslint-disable-next-line no-control-regex -- the control characters ARE the target
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

function failed(failure: Extract<AnalysisOutcome, { kind: 'failed' }>['failure']): AnalysisOutcome {
  return { kind: 'failed', failure };
}

/** The first choice's message content, or `undefined` when the shape is wrong. */
function contentOf(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) {
    return undefined;
  }
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  // A list of parts, which some servers answer with. Only `text` parts are
  // read, and only their `text`; a part of any other type is skipped rather
  // than stringified.
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content as unknown[]) {
      if (typeof part !== 'object' || part === null) {
        return undefined;
      }
      const { type, text } = part as { type?: unknown; text?: unknown };
      if (type === 'text' && typeof text === 'string') {
        texts.push(text);
      }
    }
    return texts.length === 0 ? undefined : texts.join('\n');
  }
  return undefined;
}

/**
 * Plain text, cleaned — or `undefined` when nothing readable is left, or when
 * it is longer than {@link MAXIMUM_DESCRIPTION_CHARACTERS}.
 */
export function cleanedDescription(raw: string): UntrustedText | 'too-long' | undefined {
  const text = raw.normalize('NFC').replace(UNSAFE_CHARACTERS, '').trim();
  if (text === '') {
    return undefined;
  }
  if (text.length > MAXIMUM_DESCRIPTION_CHARACTERS) {
    return 'too-long';
  }
  return text as UntrustedText;
}

/**
 * The outcome a reply means.
 *
 * Never throws, whatever it is handed — a transport can pass it anything a
 * network produced and get a named outcome back.
 */
export function readAnalysisReply(reply: AnalysisReply): AnalysisOutcome {
  if (reply.status === 401 || reply.status === 403) {
    return failed('refused');
  }
  if (reply.status === 404 || reply.status === 405) {
    return failed('not-a-model-server');
  }
  if (reply.status === 413) {
    return failed('picture-too-large');
  }
  if (reply.status < 200 || reply.status > 299) {
    return failed(reply.status >= 500 ? 'failed-on-machine' : 'not-a-model-server');
  }
  if (reply.body.length > MAXIMUM_RESPONSE_BYTES) {
    return failed('too-large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.body) as unknown;
  } catch {
    return failed('not-a-model-server');
  }
  const content = contentOf(parsed);
  if (content === undefined) {
    return failed('malformed');
  }
  const description = cleanedDescription(content);
  if (description === undefined) {
    return failed('malformed');
  }
  if (description === 'too-long') {
    return failed('too-large');
  }
  return { kind: 'described', description };
}

/**
 * Whether a connection check was understood: the reply is the one word asked
 * for, give or take case and punctuation.
 *
 * ⚠️ **A comparison, and the only thing this client does with the words.** The
 * text itself goes nowhere — not onto the screen, not into storage — for the
 * reason `useAnalysis.ts` gives.
 */
export function answeredReady(description: UntrustedText): boolean {
  return description.toLowerCase().replace(/[^a-z]/g, '') === 'ready';
}
