// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **the scripted AI-pacer ride, ridden.**
 *
 * The ride is the shipped director's (`src/game/model-pacer.ts` §`ModelPacer`),
 * a frame at a time: it decides when to ask, what the state is
 * (§`modelPacerInput`, with the rider's sensors), how the gap moved, **what
 * the pacer rides** (since #2835, ADR 0083: `@onyourleft/domain`
 * §`pacerRuleDecision`, on the device, whatever the model then says), and
 * what becomes of each line. The harness stands where the instance and the
 * pacer port do: it sends the instance's own request (`production.ts`) to the
 * model and reads the answer with `@onyourleft/domain` §`readModelPacerAnswer`.
 * No rule about what the pacer rides is here; what the gap called for is
 * `pacer-score.ts`'s.
 *
 * ## The script ({@link PACER_SCRIPT})
 *
 * #2762's scripted ride, kept as a tool and widened to every place a rider
 * can be. Five minutes, a rider of 75 kg with a threshold of 250 W and 172
 * bpm, a 2.5 W/kg pacer, on 3.6 km to a finish: level to 2 000 m, **300 m
 * up at 6 %**, **600 m down at 5 %**, and level to the line.
 *
 * | Seconds | The rider | What it exercises |
 * |---|---|---|
 * | 0–30 | on the wheel, steady | level, in the draft |
 * | 30–60 | drops back to 60 m | behind, the gap opening |
 * | 60–95 | comes back to the wheel | behind, the gap closing |
 * | 95–120 | goes past and away to 60 m, over threshold | ahead, the gap opening |
 * | 120–150 | holds 60 m ahead | ahead, steady: ADR 0078's floor applies |
 * | 150–180 | drifts back to the wheel | ahead, the gap closing |
 * | 180–211 | on the wheel, the climb inside 300 m | before a climb |
 * | 211–261 | on the wheel up the climb, cadence falling from 62 to 54, heart rate rising from 140 to 160 | a climb, low cadence |
 * | 261–300 | on the wheel down the descent, power fading | a descent |
 *
 * Every number is the script's: no rider, no place. The pacer's own place is
 * scripted too (9 m/s on the level, 6 up, 12 down), because the score is of
 * the intent decided at each place, not of where the decision would have taken it.
 *
 * ## The ride never waits, and neither does this
 *
 * As `bot-races.ts`: the harness waits for each answer, then hands it to the
 * director at the ride time it would have arrived, its ask plus its measured
 * latency, so an answer past the pacer's 5 s limit is late here too.
 */

import {
  botPacerPlan,
  distanceOnRoute,
  gapTrendOf,
  gradeAt,
  gradePercent,
  metres,
  metresPerSecond,
  readModelPacerAnswer,
  readModelPacerInput,
  seconds,
  watts,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerGapReading,
  type PacerLineOutcome,
  type RouteProfile,
} from '@onyourleft/domain';

import type { TraceSample } from '../../../src/game/hud/recent-trace';
import {
  ModelPacer,
  modelPacerInput,
  modelPacerTerrain,
  type ModelPacerSensors,
} from '../../../src/game/model-pacer';
import { northRoute } from '../../../src/game/route-fixtures-testing';
import type { PacerReply } from '../../../src/instance/pacer-port';

import { seeded, type Ask, type ModelCall } from './model-call';
import type { PacerGround, PacerLine, PacerRun, PacerStep } from './pacer-score';
import type { PacerPromptModule } from './production';

/** A value against the seconds ridden, joined by straight lines. */
export type Keyframes = readonly (readonly [atS: number, value: number])[];

/** `frames` at `atS`: the line between the two keyframes it lies between, and the end values outside them. */
export function keyframed(frames: Keyframes, atS: number): number {
  const first = frames[0] as Keyframes[number];
  if (atS <= first[0]) return first[1];
  for (let index = 1; index < frames.length; index += 1) {
    const [toS, to] = frames[index] as Keyframes[number];
    const [fromS, from] = frames[index - 1] as Keyframes[number];
    if (atS <= toS) return from + ((to - from) * (atS - fromS)) / (toS - fromS);
  }
  return (frames.at(-1) as Keyframes[number])[1];
}

/** Where the pacer starts, metres along the route: up the road, so a rider behind it is still on it. */
const PACER_STARTS_AT_METRES = 100;
const CLIMB_FROM_METRES = 2_000;
const CLIMB_TO_METRES = 2_300;
const DESCENT_TO_METRES = 2_900;

/** The script's shape. */
export interface PacerScript {
  /** How long the ride is, seconds. */
  readonly seconds: number;
  /** The seed every call of the ride is counted from. */
  readonly seed: number;
  readonly pacerWattsPerKilogram: number;
  readonly riderKilograms: number;
  readonly thresholdPower: number;
  readonly thresholdHeartRate: number;
  readonly profile: RouteProfile;
  /** Metres the rider is ahead of the pacer; below 0, behind. */
  readonly riderGapMetres: Keyframes;
  readonly riderWatts: Keyframes;
  readonly cadenceRpm: Keyframes;
  readonly heartRateBpm: Keyframes;
}

/** The script. See the file comment's table. */
export const PACER_SCRIPT: PacerScript = {
  seconds: 300,
  seed: 21,
  pacerWattsPerKilogram: 2.5,
  riderKilograms: 75,
  thresholdPower: 250,
  thresholdHeartRate: 172,
  // Level, 300 m up at 6 %, 600 m down at 5 %, level to the finish.
  profile: northRoute(3_600, (along) => {
    if (along <= CLIMB_FROM_METRES) return 30;
    if (along <= CLIMB_TO_METRES) return 30 + (along - CLIMB_FROM_METRES) * 0.06;
    if (along <= DESCENT_TO_METRES) return 48 - (along - CLIMB_TO_METRES) * 0.05;
    return 18;
  }),
  riderGapMetres: [
    [0, -3],
    [30, -3],
    [60, -60],
    [95, -3],
    [120, 60],
    [150, 60],
    [180, -3],
    [300, -3],
  ],
  riderWatts: [
    [0, 190],
    [30, 190],
    [35, 150],
    [60, 150],
    [65, 230],
    [95, 230],
    [100, 270],
    [120, 270],
    [125, 200],
    [150, 200],
    [155, 170],
    [180, 170],
    [185, 190],
    [211, 190],
    [216, 240],
    [261, 240],
    [300, 170],
  ],
  cadenceRpm: [
    [0, 88],
    [211, 88],
    [216, 62],
    [261, 54],
    [266, 92],
    [300, 92],
  ],
  heartRateBpm: [
    [0, 132],
    [95, 138],
    [120, 158],
    [180, 142],
    [211, 140],
    [261, 160],
    [300, 146],
  ],
};

/** How far behind the pacer a rider still drafts, metres: the script's own reading of "on the wheel". */
const DRAFT_METRES = 10;

/** The pacer's scripted speed where the road has `grade`, m/s. */
const pacerSpeed = (grade: number): number => (grade >= 3 ? 6 : grade <= -3 ? 12 : 9);

/** How long one frame is, seconds: fine enough that an answer arrives within a tenth of when it would. */
const FRAME_SECONDS = 0.1;

/** What a harness run needs to ride the script: the model, its name, and the instance's request. */
export interface PacerRider {
  readonly ask: Ask;
  readonly model: string;
  readonly prompt: Pick<PacerPromptModule, 'pacerRequest'>;
}

/** An ask the director has made, and how the harness answers it. */
interface Outstanding {
  readonly input: ModelPacerInput;
  readonly settle: (reply: PacerReply) => void;
  /** Settled once the director has the reply. */
  readonly settled: Promise<void>;
}

/** What the model's answer is, as the device is handed it. */
interface Answered {
  readonly reply: PacerReply;
  /** Whether the answer was void: a key it may not carry, or a line the screen stops. */
  readonly voided: boolean;
}

/** An answer on its way: when it arrives, and the ask it answers. */
interface Arriving extends Answered {
  readonly atS: number;
  readonly out: Outstanding;
  /** The ask, as its step is written once the director has logged it. */
  readonly step: Pick<PacerStep, 'askedAtS' | 'ground'>;
}

/**
 * What the device is handed for `call`, standing where the instance and the
 * pacer port do: the answer read field by field and its line screened, a
 * text that is no line as `invalid`, and none as `failed`. An answer that
 * names a plan, an intent or a power has a key `{"say"}` does not, and is
 * void (#2835).
 */
function answered(call: ModelCall): Answered {
  if (call.text === undefined) return { reply: { kind: 'failed' }, voided: false };
  const read = readModelPacerAnswer(call.text);
  if (read.ok) return { reply: { kind: 'answer', say: read.say }, voided: false };
  return {
    reply: { kind: 'invalid' },
    voided: read.reason === 'unknown-key' || read.reason === 'bad-say',
  };
}

/** The director's word for a line as the scores read it: `none` for a void answer is `voided`. */
function lineOf(logged: PacerLineOutcome, due: Answered): PacerLine {
  if (logged === 'none') return due.voided ? 'voided' : 'none';
  return logged;
}

/** Something a callback puts and the ride's loop takes, once. */
function slot<T>(): { readonly put: (value: T) => void; readonly take: () => T | undefined } {
  let held: T | undefined;
  return {
    put: (value) => {
      held = value;
    },
    take: () => {
      const value = held;
      held = undefined;
      return value;
    },
  };
}

/**
 * Ride `script` with the pacer's lines from the model and its decisions from
 * the device, and return it as the scores read it. An ask still out when the ride ends is not a step.
 *
 * @throws {Error} when the script builds a pacer state the instance would
 * refuse: a fault in the script, not an answer to score.
 */
export async function ridePacerScript(
  rider: PacerRider,
  script: PacerScript = PACER_SCRIPT,
): Promise<PacerRun> {
  const { profile } = script;
  const plan = botPacerPlan(script.pacerWattsPerKilogram);
  const calls: ModelCall[] = [];
  const steps: PacerStep[] = [];
  const trace: TraceSample[] = [];
  const asked = slot<Outstanding>();
  // Every record the director logs: since the owner's rulings of 2026-11-20
  // most decisions ask for no line (`unasked`), and a decision made while an
  // ask is out is logged after it, so the ask's record is found by its time.
  const logged: PacerDecisionRecord[] = [];
  let arriving: Arriving | undefined;
  // What each decision was made on, read as the director read it, for the
  // decisions that ask for no line (#2864): the gap's trend since the decision before.
  const grounds = new Map<number, PacerGround>();
  const asks = new Map<number, PacerStep>();
  let lastGap: PacerGapReading | undefined;
  const director = new ModelPacer(
    {
      startPacerRide: () => Promise.resolve(true),
      endPacerRide: () => Promise.resolve(),
      decidePacer: (input) => {
        let settle: (reply: PacerReply) => void = () => undefined;
        const reply = new Promise<PacerReply>((resolve) => {
          settle = resolve;
        });
        asked.put({ input, settle, settled: reply.then(() => undefined) });
        return reply;
      },
    },
    (record) => logged.push(record),
  );
  let pacerAt = PACER_STARTS_AT_METRES;
  const frames = Math.round(script.seconds / FRAME_SECONDS);
  for (let frame = 0; frame < frames; frame += 1) {
    const atS = Math.round(frame * FRAME_SECONDS * 10) / 10;
    const grade = gradeAt(profile, distanceOnRoute(profile, metres(pacerAt)));
    const speed = pacerSpeed(grade);
    const gap = keyframed(script.riderGapMetres, atS);
    const power = keyframed(script.riderWatts, atS);
    const heartRate = keyframed(script.heartRateBpm, atS);
    // One sample a second, as the HUD's trace keeps them.
    if (Number.isInteger(atS)) trace.push({ power, heartRate });
    const sensors: ModelPacerSensors = {
      power3s: power,
      trace,
      cadenceRpm: keyframed(script.cadenceRpm, atS),
      heartRateBpm: heartRate,
      thresholdPower: script.thresholdPower,
      thresholdHeartRate: script.thresholdHeartRate,
    };
    const state = {
      ride: {
        // The rider's speed is the pacer's and the rate the gap is moving at.
        speed: metresPerSecond(
          Math.max(0, speed + gap - keyframed(script.riderGapMetres, atS - 1)),
        ),
        distance: metres(pacerAt + gap),
      },
      bot: {
        state: { speed: metresPerSecond(speed), distance: metres(pacerAt) },
        distanceOnRoute: metres(pacerAt),
        grade: gradePercent(grade),
        power: watts(script.pacerWattsPerKilogram * script.riderKilograms),
      },
      ridden: seconds(atS),
      input: { power: watts(power), live: true },
      soloDraft: {
        k: 1,
        inDraft: gap < 0 && gap >= -DRAFT_METRES,
        inDraftMetres: 0,
        riddenMetres: pacerAt,
      },
    };
    const due = arriving !== undefined && atS >= arriving.atS ? arriving : undefined;
    if (due !== undefined) {
      due.out.settle(due.reply);
      await due.out.settled;
    }
    director.frame({
      riddenSeconds: atS,
      ride: () => {
        const seen = modelPacerInput({
          state,
          plan,
          profile,
          riderMassKilograms: script.riderKilograms,
          sensors,
        });
        const now: PacerGapReading = { atS, riderGapM: seen.riderGapM };
        grounds.set(atS, {
          riderPlace: seen.riderPlace,
          gapTrend: lastGap === undefined ? undefined : gapTrendOf(lastGap, now),
          riderInDraft: seen.riderInDraft,
          terrain: modelPacerTerrain(state, profile),
        });
        lastGap = now;
        return { seen, riderSpeed: state.ride.speed };
      },
      terrain: () => modelPacerTerrain(state, profile),
      // The pacer's place is the script's: the decision is scored, not ridden.
      direct: () => undefined,
    });
    const record =
      due === undefined
        ? undefined
        : logged.find((each) => each.askedAtS === due.step.askedAtS && each.outcome !== 'unasked');
    if (record !== undefined && due !== undefined) {
      if (!('reason' in record)) throw new Error('the director logged a record of the model’s');
      const line = lineOf(record.line, due);
      asks.set(record.askedAtS, {
        ...due.step,
        outcome: record.outcome,
        ridden: record.intent,
        reason: record.reason,
        line,
        ...((line === 'shown' || line === 'repeat') && due.reply.kind === 'answer'
          ? { said: due.reply.say }
          : {}),
      });
      arriving = undefined;
    }
    const out = asked.take();
    if (out !== undefined) {
      const { input } = out;
      if (!readModelPacerInput(input).ok) {
        throw new Error('the scripted ride built a pacer state the instance would refuse');
      }
      const call = await rider.ask(
        seeded(rider.prompt.pacerRequest(rider.model, input), script.seed * 1_000 + calls.length),
      );
      calls.push(call);
      arriving = {
        atS: atS + call.latencyMs / 1_000,
        ...answered(call),
        out,
        step: {
          askedAtS: atS,
          ground: {
            riderPlace: input.riderPlace,
            gapTrend: input.gapTrend,
            riderInDraft: input.riderInDraft,
            // Read as the director read it, on the frame that asked.
            terrain: modelPacerTerrain(state, profile),
          },
        },
      };
    }
    pacerAt += speed * FRAME_SECONDS;
  }
  director.end();
  // Every decision, oldest first: an ask as its answer came back, and one
  // that asked for nothing as the device rode it.
  for (const record of logged) {
    if (!('reason' in record)) throw new Error('the director logged a record of the model’s');
    if (record.outcome !== 'unasked') {
      const step = asks.get(record.askedAtS);
      if (step !== undefined) steps.push(step);
      continue;
    }
    const ground = grounds.get(record.askedAtS);
    if (ground === undefined) throw new Error('a decision the harness did not see made');
    steps.push({
      askedAtS: record.askedAtS,
      ground,
      outcome: 'unasked',
      ridden: record.intent,
      reason: record.reason,
      line: 'none',
    });
  }
  return { steps, calls };
}
