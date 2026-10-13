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
 * 3. **The privacy policy says it word for word**, so the screen and the
 *    policy cannot say two things.
 *
 * 4. **What the text says of this DEVICE is true of its code** (#1244, which
 *    merged this file in): §"what the text says of this device, held to its
 *    code" builds a request with `workout/replan-job.ts` and reads the
 *    session's own constants. No effort check-in ({@link NOT_SENT}), no
 *    time-in-range goal ({@link GOAL_NAMED_BY}), only the instance's own
 *    model, the 3 minutes, and a long workout's most recent summaries. Three
 *    more are held where the behaviour is: nothing before the switch is on,
 *    while paused or after the ride (`ride/controller.test.ts` §"what the
 *    disclosure says of this device"), and the record not synced
 *    (`instance/sync.test.ts` §"a ride's re-plan record is not synced").
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  beatsPerMinute,
  REPLAN_MOVE_INTERVAL_SECONDS,
  seconds,
  thresholdShare,
  type WorkoutBlock,
  type WorkoutGoals,
} from '@onyourleft/domain';

import { bannedWordIn } from '../privacy/no-medical-wording';

import {
  goalsToSend,
  replanInput,
  replanInputWithin,
  replanRequest,
  REPLAN_SOURCE,
  type BlockSummary,
} from './replan-job';
import { REPLAN_ASK_INTERVAL_SECONDS } from './replan-session';
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

const disclosure = replanDisclosure();
const SENTENCES = replanDisclosureSentences(disclosure);
const TEXT = SENTENCES.join(' ');
const EVERY_SENTENCE = [REPLAN_SWITCH_LABEL, REPLAN_KEEP_BUTTON, HOLD_SENDS_NOTHING, ...SENTENCES];

describe('the wording rules (ADR 0048 D-12)', () => {
  it('carries none of D-12’s banned words', () => {
    expect(EVERY_SENTENCE.length).toBeGreaterThan(10);
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
    expect(disclosure.paragraphs.join(' ')).toContain("press 'Keep the plan'");
    expect(disclosure.notNeeded).toContain('a heart-rate hold');
    const others =
      /adaptive training|progression levels?|workout levels?|trainnow|smart workouts?|\bMPA\b|maximum power available|activepulse|HR\+|\bFTP\b/i;
    expect(EVERY_SENTENCE.filter((sentence) => others.test(sentence))).toStrictEqual([]);
  });

  it('speaks of a heart rate only as the range the rider chose', () => {
    expect(TEXT).toContain('inside the range you chose');
    expect(TEXT).toContain('for a heart-rate hold, the range you chose in beats per minute');
    expect(TEXT).toContain('the heart-rate range you chose and the heart rate you chose not to go');
  });
});

describe('what the disclosure says: what, when, to whom, and off per ride', () => {
  it('is a headline, six paragraphs and the two closing sentences', () => {
    expect(SENTENCES).toHaveLength(9);
    expect(disclosure.paragraphs).toHaveLength(6);
  });

  it('says when it is sent, and that it is off unless switched on for the ride', () => {
    expect(disclosure.headline).toContain('during the ride');
    expect(disclosure.paragraphs[0]).toContain('While it is on');
    // A request leaves as a block begins, and no sooner after the last than the domain's interval.
    expect(disclosure.paragraphs[0]).toContain(
      `as each block of the workout begins, and never more often than every ${String(REPLAN_MOVE_INTERVAL_SECONDS / 60)} minutes`,
    );
    expect(disclosure.offUntilOn).toBe(
      'This is off. It is off at the start of every ride, and stays off until you switch it on for that ride.',
    );
    expect(disclosure.notNeeded).toContain('without an instance');
  });

  it('says to whom: the rider’s instance, sealed, and its own model', () => {
    expect(disclosure.headline).toBe(
      'This sends a summary of each block you ride to your instance, during the ride.',
    );
    expect(disclosure.paragraphs[2]).toContain('sealed on this device so that only your instance');
    expect(TEXT).toContain('a model on its own machine');
  });

  it('says no hosted service is sent it, and has no hosted form (#1244 asks instance-local only)', () => {
    expect(TEXT).toContain(
      "None of it is sent on to a hosted service: this app asks only for the model on your instance's own machine, whatever key you stored there.",
    );
    // The one mention of a service is the sentence that says it is sent to none.
    expect(
      SENTENCES.filter((sentence) => /service|your own key|address/.test(sentence)),
    ).toStrictEqual([disclosure.paragraphs[3]]);
    // No source to choose: the disclosure is one text.
    expect(replanDisclosure).toHaveLength(0);
  });

  it('says what is never sent, who decides, and what is kept', () => {
    expect(TEXT).toContain(
      "It never sends a second-by-second recording, where you are, the date, your name, the workout's name, the labels of its blocks or a number of watts.",
    );
    expect(TEXT).toContain('never with words, and never with a number of watts');
    expect(TEXT).toContain('works out every target itself');
    expect(TEXT).toContain('starts at the next block, never in the one you are riding');
    expect(TEXT).toContain('Your instance keeps each request and its answer for 7 days.');
    // P9's record: with the ride and in the export, and not synced (#1315).
    expect(TEXT).toContain(
      'This device keeps each change it accepted or refused with the ride, and puts them in your account export. They are not sent to your instance when you sync.',
    );
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
};

/**
 * The keys of a summary the instance would read and this app does not write
 * (#1244's `replan-job.ts` §`summaryToSend` has no `effort`). Each is a key
 * the text must NOT claim; one moved out of this list needs a phrase above.
 */
const NOT_SENT: Readonly<Record<string, RegExp>> = {
  effort: /effort check-in|how hard it felt/i,
};

/**
 * Each typed goal (`@onyourleft/domain` §`WorkoutGoals`) and the phrase that
 * names it. The type makes a goal added there with no phrase here a compile
 * error. `timeInRangeMinutes` is the one withheld (spike 0022's rule R1), and
 * its phrase says so.
 */
const GOAL_NAMED_BY: Readonly<Record<keyof WorkoutGoals, string>> = {
  sessionType: 'the kind of session',
  durationMinutes: 'its length',
  holdRange: 'the heart-rate range you chose',
  heartRateAbove: 'the heart rate you chose not to go above, both in beats per minute',
  powerCeiling: 'the most power as a share of your threshold power',
  effortCheckIns: 'whether you want to be asked how hard it feels',
  timeInRangeMinutes: 'The time you want to spend in your range is not sent.',
};

/**
 * Each key a block of the plan may carry (`replan-input.ts` §`BLOCK_FIGURES`,
 * and a hold's `range`), and the phrase that names it.
 */
const BLOCK_NAMED_BY: Readonly<Record<string, string>> = {
  kind: 'the kind of each block',
  seconds: 'how long it lasts',
  hardSeconds: 'how long it lasts',
  easySeconds: 'how long it lasts',
  repeats: 'how many times an interval repeats',
  target: 'its power targets as shares of your threshold power',
  from: 'its power targets as shares of your threshold power',
  to: 'its power targets as shares of your threshold power',
  hardTarget: 'its power targets as shares of your threshold power',
  easyTarget: 'its power targets as shares of your threshold power',
  startShare: 'its power targets as shares of your threshold power',
  ceilingShare: 'its power targets as shares of your threshold power',
  range: 'for a heart-rate hold, the range you chose in beats per minute',
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
  currentBlock: 'which one you are riding',
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

/** A block of each kind, with every key the instance reads for it and a figure it accepts. */
const ONE_OF_EACH_KIND: readonly Readonly<Record<string, unknown>>[] = [
  { kind: 'steady', seconds: 300, target: 0.5 },
  { kind: 'ramp', seconds: 300, from: 0.5, to: 0.7 },
  {
    kind: 'intervals',
    repeats: 2,
    hardSeconds: 60,
    hardTarget: 0.9,
    easySeconds: 60,
    easyTarget: 0.5,
  },
  { kind: 'free-ride', seconds: 300 },
  {
    kind: 'heart-rate-hold',
    seconds: 600,
    startShare: 0.5,
    ceilingShare: 0.7,
    range: { low: 120, high: 135 },
  },
];

describe('the disclosure names everything the instance can be sent, from the instance’s own lists', () => {
  it('names every key of a block summary but the one this app does not send, and every key of a request', async () => {
    const input = (await import(INSTANCE('analysis/replan-input.ts'))) as {
      readonly BLOCK_SUMMARY_KEYS: readonly string[];
      readonly REPLAN_INPUT_KEYS: readonly string[];
    };
    expect(input.BLOCK_SUMMARY_KEYS.length).toBeGreaterThan(5);
    expect(input.REPLAN_INPUT_KEYS.length).toBeGreaterThan(3);
    const sent = input.BLOCK_SUMMARY_KEYS.filter((key) => !Object.hasOwn(NOT_SENT, key));
    expect(unnamed(sent, SUMMARY_NAMED_BY, TEXT)).toStrictEqual([]);
    expect(unnamed(input.REPLAN_INPUT_KEYS, INPUT_NAMED_BY, TEXT)).toStrictEqual([]);
    // What is not sent is a key the instance has, and the text does not claim it.
    expect(Object.keys(NOT_SENT)).toStrictEqual(['effort']);
    for (const [key, claim] of Object.entries(NOT_SENT)) {
      expect(input.BLOCK_SUMMARY_KEYS).toContain(key);
      expect(SENTENCES.filter((sentence) => claim.test(sentence))).toStrictEqual([]);
    }
  });

  it('names every key of a block of the plan, a hold’s range in beats per minute included', async () => {
    const input = (await import(INSTANCE('analysis/replan-input.ts'))) as {
      readonly readReplanInput: (value: unknown) => { readonly ok: boolean };
    };
    const request = (blocks: readonly unknown[]): unknown => ({
      revision: 0,
      summarySeq: 1,
      currentBlock: 1,
      goals: {},
      blocks,
      summaries: [{ block: 0, seconds: 300, rescues: 0 }],
    });
    // The instance reads these blocks, so their keys are keys a request can carry...
    expect(input.readReplanInput(request(ONE_OF_EACH_KIND))).toMatchObject({ ok: true });
    const keys = [...new Set(ONE_OF_EACH_KIND.flatMap((block) => Object.keys(block)))];
    expect(keys).toHaveLength(Object.keys(BLOCK_NAMED_BY).length);
    expect(unnamed(keys, BLOCK_NAMED_BY, TEXT)).toStrictEqual([]);
    // ...and it has no other: a label, which is the rider's own text, is refused.
    expect(
      input.readReplanInput(request([{ kind: 'steady', seconds: 300, target: 0.5, label: 'x' }])),
    ).toMatchObject({ ok: false });
  });

  it('names every typed goal, and says the time-in-range goal is not sent', () => {
    expect(unnamed(Object.keys(GOAL_NAMED_BY), GOAL_NAMED_BY, TEXT)).toStrictEqual([]);
    expect(TEXT).toContain(
      'whether you want to be asked how hard it feels. The time you want to spend in your range is not sent.',
    );
  });

  it('names every tool the re-plan’s model may call', async () => {
    const tools = (await import(INSTANCE('analysis/tools/replan-tools.ts'))) as {
      readonly REPLAN_TOOLS: readonly { readonly spec: { readonly name: string } }[];
    };
    const names = tools.REPLAN_TOOLS.map((tool) => tool.spec.name);
    expect(names.length).toBeGreaterThan(2);
    expect(unnamed(names, TOOL_NAMED_BY, TEXT)).toStrictEqual([]);
  });

  it('would find a key or a tool with no phrase, or a phrase the text lost — the control', () => {
    expect(unnamed(['seconds', 'position'], SUMMARY_NAMED_BY, TEXT)).toStrictEqual(['position']);
    expect(unnamed(['recent_rides'], TOOL_NAMED_BY, TEXT)).toStrictEqual(['recent_rides']);
    expect(unnamed(['label'], BLOCK_NAMED_BY, TEXT)).toStrictEqual(['label']);
    expect(
      unnamed(['meanCadence'], SUMMARY_NAMED_BY, TEXT.replace('your mean cadence, ', '')),
    ).toStrictEqual(['meanCadence']);
  });

  it('states the retention the instance has: 7 days', async () => {
    const jobs = (await import(INSTANCE('analysis/jobs.ts'))) as {
      readonly DEFAULT_RETENTION_MS: number;
    };
    const days = jobs.DEFAULT_RETENTION_MS / (24 * 60 * 60 * 1000);
    expect(TEXT).toContain(`for ${String(days)} days`);
  });
});

describe('what the text says of this device, held to its code (#1244)', () => {
  /** Every typed goal set: `GOAL_NAMED_BY`'s keys, so a goal added to the type is set here too. */
  const EVERY_GOAL: Required<WorkoutGoals> = {
    sessionType: 'endurance',
    durationMinutes: 60,
    holdRange: { low: beatsPerMinute(130), high: beatsPerMinute(142) },
    heartRateAbove: beatsPerMinute(150),
    powerCeiling: thresholdShare(0.8),
    timeInRangeMinutes: 30,
    effortCheckIns: true,
  };
  const BLOCKS: readonly WorkoutBlock[] = [
    { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.5), label: 'Warm up' },
    { kind: 'ramp', seconds: seconds(300), from: thresholdShare(0.5), to: thresholdShare(0.7) },
    {
      kind: 'intervals',
      repeats: 2,
      hardSeconds: seconds(60),
      hardTarget: thresholdShare(0.9),
      easySeconds: seconds(60),
      easyTarget: thresholdShare(0.5),
    },
    { kind: 'free-ride', seconds: seconds(300) },
    {
      kind: 'heart-rate-hold',
      seconds: seconds(600),
      range: { low: beatsPerMinute(120), high: beatsPerMinute(135) },
      startShare: thresholdShare(0.5),
      ceilingShare: thresholdShare(0.7),
    },
  ];
  /** A summary with every figure, and an effort check-in a later build might hold. */
  const FULL_SUMMARY = {
    block: 0,
    seconds: 300,
    meanHeartRate: 131,
    highestHeartRate: 140,
    secondsInRange: 250,
    meanPowerShare: 0.52,
    meanCadence: 88,
    rescues: 1,
    effort: 3,
  } as BlockSummary;
  const built = replanRequest(
    replanInput({
      revision: 0,
      summarySeq: 1,
      currentBlock: 1,
      goals: EVERY_GOAL,
      blocks: BLOCKS,
      summaries: [FULL_SUMMARY],
    }),
  );

  it('"No effort check-in is sent": the builder writes none, even when handed one', () => {
    const [sent] = built.input.summaries;
    expect(sent).toBeDefined();
    expect(Object.keys(sent ?? {})).not.toContain('effort');
    expect(JSON.stringify(built)).not.toContain('"effort"');
    // And every key it does write is one the text names.
    expect(unnamed(Object.keys(sent ?? {}), SUMMARY_NAMED_BY, TEXT)).toStrictEqual([]);
    expect(Object.keys(sent ?? {}).sort()).toStrictEqual(Object.keys(SUMMARY_NAMED_BY).sort());
    expect(POLICY).toContain('No effort check-in is sent.');
  });

  it('"The time you want to spend in your range is not sent": the builder sends every goal the text names but that one', () => {
    const sent = Object.keys(goalsToSend(EVERY_GOAL)).sort();
    const named = Object.keys(GOAL_NAMED_BY)
      .filter((goal) => goal !== 'timeInRangeMinutes')
      .sort();
    expect(sent).toStrictEqual(named);
    expect(sent).not.toContain('timeInRangeMinutes');
    expect(JSON.stringify(built)).not.toContain('timeInRange');
    expect(TEXT).toContain(GOAL_NAMED_BY.timeInRangeMinutes);
  });

  it('"this app asks only for the model on your instance’s own machine": the one source it can name', () => {
    expect(REPLAN_SOURCE).toBe('instance-local');
    expect(built.source).toBe('instance-local');
    expect(JSON.stringify(built)).not.toContain('hosted');
    expect(TEXT).toContain("this app asks only for the model on your instance's own machine");
  });

  it('"never more often than every 3 minutes": the session’s own interval', () => {
    expect(REPLAN_ASK_INTERVAL_SECONDS).toBe(REPLAN_MOVE_INTERVAL_SECONDS);
    expect(REPLAN_ASK_INTERVAL_SECONDS).toBe(180);
    expect(TEXT).toContain(
      `never more often than every ${String(REPLAN_ASK_INTERVAL_SECONDS / 60)} minutes`,
    );
    expect(POLICY).toContain(
      `as a block begins, and never less than ${String(REPLAN_ASK_INTERVAL_SECONDS / 60)} minutes after the last time`,
    );
  });

  it('names every key of a block and of a request that the builder writes, and "two fixed words"', () => {
    const blockKeys = [...new Set(built.input.blocks.flatMap((block) => Object.keys(block)))];
    expect(unnamed(blockKeys, BLOCK_NAMED_BY, TEXT)).toStrictEqual([]);
    expect(JSON.stringify(built.input.blocks)).not.toContain('Warm up');
    expect(unnamed(Object.keys(built.input), INPUT_NAMED_BY, TEXT)).toStrictEqual([]);
    // The request around it: the input, and the two fixed words the policy speaks of.
    expect(Object.keys(built).sort()).toStrictEqual(['input', 'source', 'templateVersion']);
    expect(POLICY).toContain(
      "two fixed words that say it is a re-plan and that the model on your instance's own machine is to answer it",
    );
  });

  it('"In a long workout … only the most recent are sent": the builder leaves out the oldest', () => {
    const blocks = Array.from({ length: 64 }, (_, index) => BLOCKS[index % 5] as WorkoutBlock);
    const summaries = Array.from({ length: 63 }, (_, index) => ({ ...FULL_SUMMARY, block: index }));
    const long = replanInputWithin({
      revision: 0,
      summarySeq: 1,
      currentBlock: 63,
      goals: EVERY_GOAL,
      blocks,
      summaries,
    });
    const sent = long?.summaries.map((each) => each.block) ?? [];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(63);
    expect(sent.at(-1)).toBe(62);
    expect(disclosure.paragraphs[0]).toContain(
      'In a long workout with more blocks than fit in one request, only the most recent are sent.',
    );
    expect(POLICY).toContain(
      'or, in a long workout with more blocks than fit in one request, for the most recent of them',
    );
  });

  it('says where the switch is offered: signed in, with the rider’s own two thresholds', () => {
    // `views/RideView.test.tsx` §"#1244" holds the screen to both thresholds
    // and the sign-in; `ride/WorkoutPanel.test.tsx` to a controlled trainer.
    expect(POLICY).toContain(
      'If you are signed in to an instance and have set your own threshold power and threshold heart rate, the workout panel on the Ride screen has a switch',
    );
    expect(POLICY).toContain(
      'If you are signed in to an instance, have set your own threshold power and threshold heart rate, and choose a workout on the Ride screen, you can switch on',
    );
    expect(POLICY).toContain('when you choose a workout with a trainer this app controls');
  });
});

describe('the re-plan disclosure in the privacy policy (#1245)', () => {
  it('is there word for word, in the order the screen shows it', () => {
    expect(POLICY).toContain(TEXT);
  });

  it('goes red on a policy that drops something a summary carries — the control', () => {
    const drifted = POLICY.replaceAll('your mean cadence, ', '');
    expect(drifted).not.toBe(POLICY);
    expect(drifted).not.toContain(disclosure.paragraphs[0]);
  });

  it('says the hold on its own sends nothing, in the screen’s own sentence', () => {
    expect(POLICY).toContain(HOLD_SENDS_NOTHING);
  });

  it('names the switch as the screen labels it, and where it is', () => {
    expect(POLICY).toContain(
      `the workout panel on the Ride screen has a switch, ${REPLAN_SWITCH_LABEL}, when you choose a workout`,
    );
  });

  it('says of no re-plan that it goes to a hosted service, so the hosted-key sentences stay true', () => {
    // The hosted form, drafted and removed: none of its sentences is in the policy.
    for (const gone of [
      'during the ride, and from there to',
      'whether to suggest one change to the blocks you have not ridden yet. It sends that service',
      'If your instance would ask a hosted service',
    ]) {
      expect(POLICY).not.toContain(gone);
    }
    // What a key stored on an instance is used for, which a hosted re-plan would have made false.
    expect(POLICY).toContain(
      "used only for what you asked it to send that service: your own analyses and, if you separately agreed to that, your side camera's pictures",
    );
    expect(POLICY).toContain('used only for what you asked your instance to send that service');
    expect(POLICY).toContain(
      "Your instance then sends a ride's numbers there when you ask it for a write-up by that service",
    );
    // And every place that speaks of a re-plan and a service together says it is sent to none.
    const together = POLICY.split(/(?<=[.:]) /).filter(
      (sentence) => /re-plan/i.test(sentence) && /hosted|service/.test(sentence),
    );
    expect(together.length).toBeGreaterThan(0);
    expect(together.filter((sentence) => !/\b(no|never|not|none)\b/i.test(sentence))).toStrictEqual(
      [],
    );
  });
});
