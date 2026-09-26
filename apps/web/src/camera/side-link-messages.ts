// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every message the side-camera link's `control` channel carries, and the
 * refusal of every other** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3 and D-4.
 *
 * D-3's two columns, and nothing else:
 *
 * | Tablet → phone | Phone → tablet |
 * |---|---|
 * | `start`, `stop` (each numbered, each acknowledged) | `hello` — D-4's one-time secret, the first message and only then |
 * | `reference`, `verdict` — the framing numbers and the check's result (D-7) | `state` — framing, filming or stopped, and why |
 * | `ping` | `ack` of a numbered command, and `ping` |
 *
 * `ping` is the heartbeat `side-link.ts` §`SILENCE_IS_LOST_MILLISECONDS`
 * reads; it carries nothing.
 *
 * ## ⚠️ Untrusted input, both ways (D-4)
 *
 * *"Each is untrusted input, bounded in size and checked for type before it is
 * used. An unknown message type closes the session."* So each decoder returns
 * `undefined` for anything that is not exactly one of its own column's
 * messages — a message from the OTHER column included, because a tablet that
 * receives a `start` is being driven by something that is not a phone — and
 * `side-link.ts` ends the pairing on `undefined`.
 *
 * `reference` and `verdict` stay `unknown` past this module on purpose: the
 * phone decodes both itself (`framing.ts` §`framingReferenceFrom`,
 * §`framingVerdictFrom`), as `side-camera-link-port.ts` §`SideLinkEvent`
 * already requires.
 *
 * **Never across, in either direction** (D-3): an athlete, an activity, a
 * signed record, a key, a name, a ride reading, a position or a wall-clock
 * time. No message here has a field that could hold one, and an unknown field
 * is refused.
 */

import type { PhoneReport, SideCameraStopReason } from './side-camera-link-port';

/**
 * The longest message this build reads: 4 KiB. The largest honest message is
 * a framing reference — a few dozen landmark positions — and a command is a
 * few dozen bytes. A picture never travels on `control` (D-3).
 */
export const MAXIMUM_CONTROL_MESSAGE_LENGTH = 4096;

/** A numbered command the tablet sends and the phone acknowledges. */
export type PhoneCommand = 'start' | 'stop';

/** What the tablet sends. */
export type TabletMessage =
  | { readonly t: 'start'; readonly n: number }
  | { readonly t: 'stop'; readonly n: number }
  | { readonly t: 'reference'; readonly reference: unknown }
  | { readonly t: 'verdict'; readonly verdict: unknown }
  | { readonly t: 'ping' };

/** What the phone sends. */
export type PhoneMessage =
  | { readonly t: 'hello'; readonly k: string }
  | { readonly t: 'state'; readonly report: PhoneReport }
  | { readonly t: 'ack'; readonly n: number }
  | { readonly t: 'ping' };

/** A message as it goes on the wire. */
export function controlMessageText(message: TabletMessage | PhoneMessage): string {
  if (message.t === 'state') {
    const { report } = message;
    return JSON.stringify(
      report.state === 'stopped'
        ? { t: 'state', s: report.state, why: report.reason }
        : { t: 'state', s: report.state },
    );
  }
  return JSON.stringify(message);
}

/** A command number: a non-negative safe integer. */
function isCommandNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The object on the wire, or `undefined` for anything that is not one. */
function objectFrom(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== 'string' || data.length > MAXIMUM_CONTROL_MESSAGE_LENGTH) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/** Whether `fields` has exactly these keys. */
function exactly(fields: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(fields);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(fields, key));
}

/** What the phone received, or `undefined` — and then the pairing ends. */
export function tabletMessageFrom(data: unknown): TabletMessage | undefined {
  const fields = objectFrom(data);
  if (fields === undefined) {
    return undefined;
  }
  switch (fields['t']) {
    case 'start':
    case 'stop':
      return exactly(fields, ['t', 'n']) && isCommandNumber(fields['n'])
        ? { t: fields['t'], n: fields['n'] }
        : undefined;
    case 'reference':
      return exactly(fields, ['t', 'reference'])
        ? { t: 'reference', reference: fields['reference'] }
        : undefined;
    case 'verdict':
      return exactly(fields, ['t', 'verdict'])
        ? { t: 'verdict', verdict: fields['verdict'] }
        : undefined;
    case 'ping':
      return exactly(fields, ['t']) ? { t: 'ping' } : undefined;
    default:
      return undefined;
  }
}

const STOP_REASONS: ReadonlySet<string> = new Set<SideCameraStopReason>([
  'rider',
  'tablet',
  'link-lost',
  'camera',
]);

/** What the tablet received, or `undefined` — and then the pairing ends. */
export function phoneMessageFrom(data: unknown): PhoneMessage | undefined {
  const fields = objectFrom(data);
  if (fields === undefined) {
    return undefined;
  }
  switch (fields['t']) {
    case 'hello':
      return exactly(fields, ['t', 'k']) &&
        typeof fields['k'] === 'string' &&
        fields['k'].length <= 64
        ? { t: 'hello', k: fields['k'] }
        : undefined;
    case 'state': {
      const state = fields['s'];
      if (state === 'framing' || state === 'filming') {
        return exactly(fields, ['t', 's']) ? { t: 'state', report: { state } } : undefined;
      }
      const why = fields['why'];
      if (
        state === 'stopped' &&
        exactly(fields, ['t', 's', 'why']) &&
        typeof why === 'string' &&
        STOP_REASONS.has(why)
      ) {
        return { t: 'state', report: { state, reason: why as SideCameraStopReason } };
      }
      return undefined;
    }
    case 'ack':
      return exactly(fields, ['t', 'n']) && isCommandNumber(fields['n'])
        ? { t: 'ack', n: fields['n'] }
        : undefined;
    case 'ping':
      return exactly(fields, ['t']) ? { t: 'ping' } : undefined;
    default:
      return undefined;
  }
}
