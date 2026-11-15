// SPDX-License-Identifier: Apache-2.0

/**
 * **Recent problems**' words (#2614, ADR 0069 D-7): a sentence for each
 * problem line `GET /v1/operate/logs` returns, taken from the tables in
 * `docs/operating-an-instance.md`, and what the section is. The instance's
 * admin page for it (#2651) says the same.
 *
 * A line has been through the instance's one redaction (`log.ts`
 * §`redacted`) before it got here, so its values are closed words, counts,
 * route patterns and error NAMES. A sentence uses only those, and says a
 * value it does not know by the line's own event name.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** What the section keeps, and what it does not: behind its ⓘ. */
export const PROBLEMS_HELD_TEXT =
  'These are held in the instance’s memory only: they are gone when it restarts, and are never ' +
  'in its database or a backup. A room worker’s own lines stay on the host’s standard output ' +
  '(docker compose logs instance).';

/** The one line above the list: since when. */
export function problemsSinceText(moment: string): string {
  return `Problems since the instance last started, ${moment}, newest first.`;
}

/** Said when there are none. */
export function noProblemsText(moment: string): string {
  return `No problem since the instance last started, ${moment}.`;
}

/** Said in place of the list when the owner's read of it did not come. */
export const PROBLEMS_UNREADABLE_TEXT =
  'The recent problems could not be read from the instance, so they are not shown here.';

/** What opens a line as it was logged. */
export const RAW_LINE_LABEL = 'The line as logged';

const KEYS_STATE_TEXT: Readonly<Record<string, string>> = {
  'no-secret': 'no secret key is set',
  'no-origin': 'no origin is set',
  'no-keys': 'no keys are made yet',
  unreadable: 'the secret key set does not open them',
  busy: 'an operator command holds them',
};

/** A value of the line as a word, or `undefined` when it is not a short plain string or a count. */
function word(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value !== '' && value !== '[redacted]' ? value : undefined;
}

/** `(code)`, or nothing. */
function inBrackets(value: unknown): string {
  const said = word(value);
  return said === undefined ? '' : ` (${said})`;
}

/**
 * One problem line in words, from `docs/operating-an-instance.md`'s tables
 * where it has one; else its event's own name.
 */
export function problemSentence(line: Readonly<Record<string, unknown>>): string {
  const event = word(line.event) ?? 'unknown';
  const where = word(line.route) ?? 'an address with no route';
  switch (event) {
    case 'request':
      return `A request to ${where} was answered ${word(line.status) ?? 'with an error'}.`;
    case 'unhandled':
      return `A request to ${where} failed inside the instance${inBrackets(line.error)}.`;
    case 'room-worker-died': {
      const lost = line.roomsLost;
      if (typeof lost !== 'number') return 'A room worker stopped, and the rooms on it were lost.';
      return lost === 1
        ? 'A room worker stopped, and the 1 room on it was lost.'
        : `A room worker stopped, and the ${String(lost)} rooms on it were lost.`;
    }
    case 'room-write-failed':
      return 'A room’s result or flag could not be written to the database.';
    case 'rooms-sweep-failed':
      return `Ending the rooms that are over failed${inBrackets(line.error)}. The next sweep tries again.`;
    case 'history-index-failed':
      return `Indexing ride history failed${inBrackets(line.error)}.`;
    case 'voice-failed':
      return `A request to Discord failed${inBrackets(line.code)}.`;
    case 'refusing':
      return 'The instance refused to serve: its database needs migrating.';
    case 'analysis-job':
      return `An analysis job failed${inBrackets(line.code)}.`;
    case 'analysis-model':
      return `The analysis model is off${inBrackets(line.code)}.`;
    case 'picture-model':
      return `The picture model is off${inBrackets(line.code)}.`;
    case 'history-index':
      return `The history index is off${inBrackets(line.code)}.`;
    case 'instance-keys': {
      const state = word(line.state);
      return `The instance’s keys are not ready: ${(state === undefined ? undefined : KEYS_STATE_TEXT[state]) ?? 'not known'}.`;
    }
    case 'hosted-model-key':
      return line.state === 'no-secret'
        ? 'A hosted model key is held, but OYL_INSTANCE_SECRET_KEY is not set.'
        : 'A hosted model key is held, but the secret key set does not open it.';
    case 'voice':
      return `Voice is off${inBrackets(line.code)}.`;
    case 'room-socket-closed':
      return 'A room’s riders were dropped: the worker holding it was lost.';
    default:
      return `${event}.`;
  }
}
