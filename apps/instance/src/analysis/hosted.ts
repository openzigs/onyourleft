// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Everything a hosted model is sent is masked first, here** — #1101,
 * ADR 0046 D-10.
 *
 * #839's {@link maskForHosted}, now in `@onyourleft/analysis` (#1094), runs on
 * the instance over EVERY message of EVERY request to a hosted model: the
 * system prompt, the first message built from the device's ride input, every
 * tool result (a goal, a ride summary, a retrieved note or write-up — any of
 * which can name anything, which is why the device could not mask for a
 * tool-choosing run), every rewrite instruction, and the model's own earlier
 * replies and tool arguments as they are sent back to it.
 *
 * ## One seam
 *
 * The hosted connection (`model.ts` §`createHostedModel`) is built HERE and
 * nowhere else, and only with a {@link MaskingGuard}: {@link hostedBehindMasking}
 * takes one by type, and `hosted-seam.test.ts` walks every shipped module of
 * the instance and fails if any other names `createHostedModel`. The source
 * (`source.ts` §`modelForSource`) reads the guard before it builds anything,
 * and a guard that is missing or cannot be read is a request not sent: the
 * job ends `hosted_unavailable`.
 *
 * ## Where the guard comes from (D-10)
 *
 * The owner's ruling (#1092 comment ruling 7): the masking data is **synced
 * to the instance** and stored per athlete. It is one sync item of kind
 * `masking` and key {@link MASKING_ITEM_KEY}, pushed and pulled through the
 * sealed sync routes like every item (ADR 0047 D-7, so it never crosses the
 * tunnel readable), scoped and erased with the athlete and carried in the
 * account export. Its body is {@link MaskingItemBody}. The device copy stays
 * canonical. ⚠️ This reverses the issue body's recommendation (*"held in
 * memory for that job only"*), which the issue itself defers to the owner's
 * ruling.
 *
 * ## What is NOT masked
 *
 * The rider's own instance and its local model get the full text
 * (ADR 0040 D-9): `instance-local` never comes through here. The tool specs
 * (names, descriptions and argument schemas) are this app's own constants and
 * carry nothing of the rider's. Masking reduces what a hosted service is sent
 * and guarantees nothing (`hosted-mask.ts` §"What is NOT masked").
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import {
  maskForHosted,
  parseMaskedWords,
  tidyMaskedWord,
  type MaskingGuard,
} from '@onyourleft/analysis';

import { createHostedModel } from './model.ts';
import type { AgentMessage, ModelConnection, ToolCallRequest } from './model-turn.ts';
import type { OpenedHostedKey } from './source.ts';

/** The key of the one `masking` item an athlete holds. */
export const MASKING_ITEM_KEY = 'guard';

/** The `masking` item's body, as the device writes it. */
export interface MaskingItemBody {
  /** The rider's words-to-mask list (`@onyourleft/analysis` §`parseMaskedWords`). */
  readonly words: readonly string[];
  /** Their privacy zones: a label, a centre in degrees and a radius in metres. */
  readonly zones: readonly {
    readonly label: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly radius: number;
  }[];
}

/** The one read the guard needs. `SqlStore` satisfies it as it stands. */
export interface MaskingReads {
  getSyncItem(
    athleteId: string,
    kind: 'masking',
    key: string,
  ): Promise<{ readonly body: Uint8Array | null } | undefined>;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function position(latitude: unknown, longitude: unknown): GeographicPosition | undefined {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
  try {
    return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
  } catch {
    return undefined;
  }
}

/**
 * A `masking` item's body as a guard, or `undefined` when ANY part of it is
 * not what {@link MaskingItemBody} says — a guard read in part would look
 * masked and not be, so a malformed item masks nothing and sends nothing.
 */
export function parseMaskingItem(text: string): MaskingGuard | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isObject(body) || !Array.isArray(body.words) || !Array.isArray(body.zones)) {
    return undefined;
  }
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'words' && key !== 'zones')) return undefined;
  if (!body.words.every((word) => typeof word === 'string')) return undefined;
  const zones: MaskingGuard['zones'][number][] = [];
  for (const zone of body.zones as readonly unknown[]) {
    if (!isObject(zone) || typeof zone.label !== 'string') return undefined;
    const centre = position(zone.latitude, zone.longitude);
    const radius = zone.radius;
    if (
      centre === undefined ||
      typeof radius !== 'number' ||
      !Number.isFinite(radius) ||
      radius <= 0
    ) {
      return undefined;
    }
    zones.push({ centre, radius, label: zone.label });
  }
  const words = parseMaskedWords(body.words);
  // parseMaskedWords drops an over-long word and everything past the cap; for a
  // privacy list a dropped word is sent in the clear, so refuse the whole item
  // unless only blanks and case-insensitive repeats were dropped.
  const distinct = new Set(
    (body.words as readonly string[])
      .map((word) => tidyMaskedWord(word).toLocaleLowerCase('en'))
      .filter((word) => word !== ''),
  );
  if (words.length !== distinct.size) return undefined;
  return { words, zones };
}

/**
 * `athleteId`'s guard, from their synced `masking` item, or `undefined` when
 * they have none, it is a tombstone, it is not UTF-8, or it does not parse.
 * A read that throws is the caller's to treat as `undefined` too.
 */
export async function readMaskingGuard(
  reads: MaskingReads,
  athleteId: string,
): Promise<MaskingGuard | undefined> {
  const item = await reads.getSyncItem(athleteId, 'masking', MASKING_ITEM_KEY);
  if (item?.body === null || item?.body === undefined) return undefined;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(item.body);
  } catch {
    return undefined;
  }
  return parseMaskingItem(text);
}

/** Every string inside a model's tool arguments, masked; everything else as it was. */
function maskedValue(value: unknown, guard: MaskingGuard): unknown {
  if (typeof value === 'string') return maskForHosted(value, guard);
  if (Array.isArray(value)) return value.map((each) => maskedValue(each, guard));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [key, maskedValue(each, guard)]),
    );
  }
  return value;
}

function maskedCall(call: ToolCallRequest, guard: MaskingGuard): ToolCallRequest {
  return call.invalid === true ? call : { ...call, input: maskedValue(call.input, guard) };
}

/** One message, every word of it the rider's or a model's masked. */
function maskedMessage(message: AgentMessage, guard: MaskingGuard): AgentMessage {
  switch (message.role) {
    case 'user':
      return { role: 'user', text: maskForHosted(message.text, guard) };
    case 'assistant':
      return {
        role: 'assistant',
        text: maskForHosted(message.text, guard),
        calls: message.calls.map((call) => maskedCall(call, guard)),
      };
    case 'tool':
      return {
        role: 'tool',
        results: message.results.map((result) => ({
          ...result,
          text: maskForHosted(result.text, guard),
        })),
      };
  }
}

/**
 * `inner`, with the system prompt and every message of every request masked
 * by `guard` before it is handed on. What comes back is the model's, unmasked
 * — it is screened by the agent before a word is kept.
 */
export function maskedConnection(inner: ModelConnection, guard: MaskingGuard): ModelConnection {
  return {
    turn: (request) =>
      inner.turn({
        ...request,
        system: maskForHosted(request.system, guard),
        messages: request.messages.map((message) => maskedMessage(message, guard)),
      }),
  };
}

/**
 * The hosted model on the held key, behind `guard`'s masking: the ONLY place
 * the hosted connection is built (`hosted-seam.test.ts`). It is what
 * `source.ts` §`SourceOptions.behindMasking` is.
 */
export function hostedBehindMasking(
  key: OpenedHostedKey,
  guard: MaskingGuard,
  fetch?: typeof globalThis.fetch,
): ModelConnection {
  return maskedConnection(
    createHostedModel({
      baseUrl: new URL(key.url),
      model: key.model,
      apiKey: key.key,
      ...(fetch === undefined ? {} : { fetch }),
    }),
    guard,
  );
}
