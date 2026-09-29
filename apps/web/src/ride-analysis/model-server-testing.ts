// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A model server on the rider's computer, as a `fetch` double — test support
 * for the post-ride ask (#804). It answers every step of the analysis
 * template by what the request asks for: a section's note for a
 * `section_notes` step, a note for a `position_notes` step, and the summary
 * text it was given for anything else.
 *
 * Every reply carries {@link REPLY_MARKER} OUTSIDE the field the runner reads
 * (`choices[0].message.content`) — in the envelope, and in a reasoning field
 * beside the content — so a test can prove nothing of a raw reply but its
 * validated field reaches a saved row or the page.
 */

import type { AnalysisSend } from '../camera/http-body';
import type { RunnerClock } from './runner';

/** Planted in every reply, outside the field the runner reads. */
export const REPLY_MARKER = 'RAW-REPLY-MARKER-804';

/** One request the server was sent, as parsed JSON. */
export type ModelServerRequest = Readonly<Record<string, unknown>>;

export interface ModelServer {
  readonly send: AnalysisSend;
  /** Every request, in order. */
  readonly requests: ModelServerRequest[];
  /** What the summary step answers from now on. */
  summary: string;
}

function contentOf(request: ModelServerRequest): string {
  const messages = request.messages as readonly { readonly content: string }[] | undefined;
  return messages?.[1]?.content ?? '';
}

function schemaNameOf(request: ModelServerRequest): string | undefined {
  const format = request.response_format as
    { readonly json_schema?: { readonly name?: string } } | undefined;
  return format?.json_schema?.name;
}

/** A server answering every step. `summary` is the summary step's reply. */
export function modelServer(
  summary = 'A steady ride, evenly paced from start to finish.',
): ModelServer {
  const requests: ModelServerRequest[] = [];
  const server: ModelServer = {
    requests,
    summary,
    send: async (_url, init) => {
      const request = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as ModelServerRequest;
      requests.push(request);
      const name = schemaNameOf(request);
      let content: string;
      if (name === 'section_notes') {
        const section = Number(/"section":(\d+)/.exec(contentOf(request))?.[1] ?? '0');
        content = JSON.stringify({ section, notes: `Section ${String(section)} was steady.` });
      } else if (name === 'position_notes') {
        content = JSON.stringify({ notes: 'Posture held steady.' });
      } else {
        content = server.summary;
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: REPLY_MARKER,
            choices: [
              {
                message: { content, reasoning_content: REPLY_MARKER },
                finish_reason: 'stop',
              },
            ],
            system_fingerprint: REPLY_MARKER,
          }),
          { status: 200 },
        ),
      );
    },
  };
  return server;
}

/** A clock whose waits never elapse: every step here is settled by the server. */
export const STILL_CLOCK: RunnerClock = {
  now: () => 0,
  delay: () => ({ elapsed: new Promise<void>(() => undefined), cancel: () => undefined }),
};
