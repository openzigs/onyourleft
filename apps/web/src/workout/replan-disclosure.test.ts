// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The re-plan disclosure: its rules, the instance it describes, and the
 * privacy policy** — #1245, ADR 0048 D-10, D-11 and D-12.
 *
 * Three things are held here:
 *
 * 1. **The wording rules** (D-12): none of the banned words, no number called
 *    a limit, no claim to prevent, treat or reduce the risk of anything, and
 *    the owner's names (Q10).
 * 2. **What is true of the software**: every key a re-plan's request can
 *    carry, and every tool the re-plan's model may call, is read from
 *    `apps/instance`'s own lists and has to be named by a phrase the
 *    disclosure contains. A key added there with no phrase here is red.
 * 3. **The privacy policy says it word for word**, both forms, so the screen
 *    and the policy cannot say two things.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MASKING_LIMIT } from '../camera/hosted-model';
import { bannedWordIn } from '../privacy/no-medical-wording';

import {
  HOLD_SENDS_NOTHING,
  REPLAN_KEEP_BUTTON,
  REPLAN_SWITCH_LABEL,
  replanDisclosure,
  replanDisclosureSentences,
} from './replan-disclosure';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;

/** Markdown as one line of words: no emphasis marks, no quote marks, one space. */
function asProse(markdown: string): string {
  return markdown.replaceAll(/^> ?/gm, '').replaceAll('*', '').replaceAll(/\s+/g, ' ').trim();
}

const POLICY = asProse(read('docs/privacy-policy.md'));
/** What the policy says where the screen says the service's address. */
const AS_THE_POLICY_NAMES_IT = 'the address you agreed to';
const ENDPOINT = 'https://models.example';

const local = replanDisclosure({ source: 'instance-local' });
const hosted = replanDisclosure({ source: 'instance-hosted', endpoint: ENDPOINT });
const LOCAL = replanDisclosureSentences(local);
const HOSTED = replanDisclosureSentences(hosted);
const EVERY_SENTENCE = [
  REPLAN_SWITCH_LABEL,
  REPLAN_KEEP_BUTTON,
  HOLD_SENDS_NOTHING,
  ...LOCAL,
  ...HOSTED,
];

describe('the wording rules (ADR 0048 D-12)', () => {
  it('carries none of D-12’s banned words', () => {
    expect(EVERY_SENTENCE.length).toBeGreaterThan(15);
    expect(EVERY_SENTENCE.filter((sentence) => bannedWordIn(sentence) !== undefined)).toStrictEqual(
      [],
    );
  });

  it('calls no number a limit, and claims to prevent, treat or lower the risk of nothing', () => {
    const forbidden =
      /\b(limits?|safe|safely|safety|health|healthy|prevents?|treats?|treatment|risks?|protects?|diagnos\w*|injur\w*|illness)\b/i;
    expect(EVERY_SENTENCE.filter((sentence) => forbidden.test(sentence))).toStrictEqual([]);
  });

  it('uses the owner’s names, and none of the names D-13 lists', () => {
    expect(REPLAN_SWITCH_LABEL).toBe('Re-plan during the ride');
    expect(REPLAN_KEEP_BUTTON).toBe('Keep the plan');
    expect(local.paragraphs.join(' ')).toContain("press 'Keep the plan'");
    expect(local.notNeeded).toContain('a heart-rate hold');
    const others =
      /adaptive training|progression levels?|workout levels?|trainnow|smart workouts?|\bMPA\b|maximum power available|activepulse|HR\+|\bFTP\b/i;
    expect(EVERY_SENTENCE.filter((sentence) => others.test(sentence))).toStrictEqual([]);
  });

  it('speaks of a heart rate only as the range the rider chose', () => {
    for (const sentences of [LOCAL, HOSTED]) {
      expect(sentences.join(' ')).toContain('inside the range you chose');
    }
  });
});

describe('what the disclosure says: what, when, to whom, and off per ride', () => {
  it('is the same but for who answers, and the hosted one adds who else is sent it', () => {
    expect(LOCAL).toHaveLength(8);
    expect(HOSTED).toHaveLength(10);
    const shared = LOCAL.filter((sentence) => HOSTED.includes(sentence));
    // Everything but the headline and the paragraph about who is asked.
    expect(shared).toHaveLength(6);
    expect(HOSTED.filter((sentence) => !LOCAL.includes(sentence))).toHaveLength(4);
  });

  it('says when it is sent, and that it is off unless switched on for the ride', () => {
    for (const disclosure of [local, hosted]) {
      expect(disclosure.headline).toContain('during the ride');
      expect(disclosure.paragraphs[0]).toContain('While it is on');
      expect(disclosure.paragraphs[0]).toContain(
        'at the end of a block, or every few minutes in a long one',
      );
      expect(disclosure.offUntilOn).toBe(
        'This is off. It is off at the start of every ride, and stays off until you switch it on for that ride.',
      );
      expect(disclosure.notNeeded).toContain('without an instance');
    }
  });

  it('says to whom: the rider’s instance, sealed, and the hosted one names the address each time', () => {
    expect(local.headline).toBe(
      'This sends a summary of each block you ride to your instance, during the ride.',
    );
    expect(local.paragraphs[1]).toContain('sealed on this device so that only your instance');
    expect(LOCAL.join(' ')).toContain('a model on its own machine');
    expect(LOCAL.join(' ')).not.toContain('service');

    expect(hosted.headline).toBe(
      `This sends a summary of each block you ride to your instance, during the ride, and from there to ${ENDPOINT}.`,
    );
    expect(hosted.paragraphs[2]).toContain(`the service at ${ENDPOINT}, on your own key`);
    expect(HOSTED.join(' ')).toContain('a company or a computer that is not yours and not ours');
    expect(HOSTED.join(' ')).toContain('agreed to it by its address');
    expect(HOSTED.join(' ')).toContain(MASKING_LIMIT);
    expect(HOSTED.join(' ')).not.toContain('a model on its own machine');
  });

  it('says what is never sent, who decides, and what is kept', () => {
    for (const sentences of [LOCAL, HOSTED]) {
      const text = sentences.join(' ');
      expect(text).toContain(
        "It never sends a second-by-second recording, where you are, the date, your name or the workout's name.",
      );
      expect(text).toContain('never with words, and never with a number of watts');
      expect(text).toContain('works out every target itself');
      expect(text).toContain('starts at the next block, never in the one you are riding');
      expect(text).toContain('Your instance keeps each request and its answer for 7 days.');
      expect(text).toContain('each change it accepted or refused with the ride');
    }
  });
});

/**
 * Each key of one block's summary (`replan-input.ts` §`BLOCK_SUMMARY_KEYS`),
 * and the phrase of the disclosure that names it.
 */
const SUMMARY_NAMED_BY: Readonly<Record<string, string>> = {
  block: 'a summary of each block you have ridden',
  seconds: 'how long the block lasted',
  meanHeartRate: 'your mean and highest heart rate',
  highestHeartRate: 'your mean and highest heart rate',
  secondsInRange: 'how long your heart rate was inside the range you chose',
  meanPowerShare: 'your mean power as a share of your threshold power',
  meanCadence: 'your mean cadence',
  rescues: 'how many times the target had to be eased',
  effort: 'your effort check-in if you gave one',
};

/**
 * Each key of a request (`REPLAN_INPUT_KEYS`), and the phrase that names it.
 * `revision` and `summarySeq` are two counters the device made up for this
 * ride, and `currentBlock` is a position in the blocks: each is part of the
 * thing its phrase names, not a further fact about the rider.
 */
const INPUT_NAMED_BY: Readonly<Record<string, string>> = {
  revision: 'the blocks of the workout as it stands',
  summarySeq: 'a summary of each block you have ridden',
  currentBlock: 'the blocks of the workout as it stands',
  goals: 'your workout goals',
  blocks: 'the blocks of the workout as it stands',
  summaries: 'a summary of each block you have ridden',
};

/** Each tool the re-plan's model may call (`replan-tools.ts` §`REPLAN_TOOLS`), and its phrase. */
const TOOL_NAMED_BY: Readonly<Record<string, string>> = {
  ride_so_far: 'a summary of each block you have ridden',
  goals: 'what you wrote about your goals',
  saved_workouts: 'the blocks of your saved workouts',
};

/** The keys of `names` that `text` does not name. */
function unnamed(
  names: readonly string[],
  namedBy: Readonly<Record<string, string>>,
  text: string,
): readonly string[] {
  return names.filter((name) => {
    const phrase = namedBy[name];
    return phrase === undefined || !text.includes(phrase);
  });
}

describe('the disclosure names everything the instance can be sent, from the instance’s own lists', () => {
  it('names every key of a block summary and of a request, in both forms', async () => {
    const input = (await import(INSTANCE('analysis/replan-input.ts'))) as {
      readonly BLOCK_SUMMARY_KEYS: readonly string[];
      readonly REPLAN_INPUT_KEYS: readonly string[];
    };
    expect(input.BLOCK_SUMMARY_KEYS.length).toBeGreaterThan(5);
    expect(input.REPLAN_INPUT_KEYS.length).toBeGreaterThan(3);
    for (const sentences of [LOCAL, HOSTED]) {
      const text = sentences.join(' ');
      expect(unnamed(input.BLOCK_SUMMARY_KEYS, SUMMARY_NAMED_BY, text)).toStrictEqual([]);
      expect(unnamed(input.REPLAN_INPUT_KEYS, INPUT_NAMED_BY, text)).toStrictEqual([]);
    }
  });

  it('names every tool the re-plan’s model may call, in both forms', async () => {
    const tools = (await import(INSTANCE('analysis/tools/replan-tools.ts'))) as {
      readonly REPLAN_TOOLS: readonly { readonly spec: { readonly name: string } }[];
    };
    const names = tools.REPLAN_TOOLS.map((tool) => tool.spec.name);
    expect(names.length).toBeGreaterThan(2);
    for (const sentences of [LOCAL, HOSTED]) {
      expect(unnamed(names, TOOL_NAMED_BY, sentences.join(' '))).toStrictEqual([]);
    }
  });

  it('would find a key or a tool with no phrase, or a phrase the text lost — the control', () => {
    const text = LOCAL.join(' ');
    expect(unnamed(['seconds', 'position'], SUMMARY_NAMED_BY, text)).toStrictEqual(['position']);
    expect(unnamed(['recent_rides'], TOOL_NAMED_BY, text)).toStrictEqual(['recent_rides']);
    expect(
      unnamed(['meanCadence'], SUMMARY_NAMED_BY, text.replace('your mean cadence, ', '')),
    ).toStrictEqual(['meanCadence']);
  });

  it('states the retention the instance has: 7 days', async () => {
    const jobs = (await import(INSTANCE('analysis/jobs.ts'))) as {
      readonly DEFAULT_RETENTION_MS: number;
    };
    const days = jobs.DEFAULT_RETENTION_MS / (24 * 60 * 60 * 1000);
    expect(LOCAL.join(' ')).toContain(`for ${String(days)} days`);
  });
});

describe('the re-plan disclosure in the privacy policy (#1245)', () => {
  const hostedAsThePolicyNamesIt = replanDisclosureSentences(
    replanDisclosure({ source: 'instance-hosted', endpoint: AS_THE_POLICY_NAMES_IT }),
  );

  it('is there word for word, in the order the screen shows it, in both forms', () => {
    expect(POLICY).toContain(LOCAL.join(' '));
    expect(POLICY).toContain(hostedAsThePolicyNamesIt.join(' '));
  });

  it('goes red on a policy that drops something a summary carries — the control', () => {
    const drifted = POLICY.replaceAll('your mean cadence, ', '');
    expect(drifted).not.toBe(POLICY);
    expect(drifted).not.toContain(local.paragraphs[0]);
    expect(drifted).not.toContain(hosted.paragraphs[0]);
  });

  it('says the hold on its own sends nothing, in the screen’s own sentence', () => {
    expect(POLICY).toContain(HOLD_SENDS_NOTHING);
  });

  it('names the switch as the screen labels it', () => {
    expect(POLICY).toContain(`a switch, ${REPLAN_SWITCH_LABEL}, when you ride a workout`);
  });
});
