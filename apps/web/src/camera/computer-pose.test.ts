// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's pictures looked at by the rider's computer — #553, ADR 0033
 * D-11: the answer's shape, read as untrusted input, and the estimator that
 * sends each picture through the one transport.
 */

import { describe, expect, it } from 'vitest';

import { ANALYSIS_PROMPTS, type AnalysisPort, type AnalysisRequest } from './analysis-port';
import type { AnalysisCall, AnalysisOutcome, UntrustedText } from '@onyourleft/analysis';
import {
  COMPUTER_POSE_DEADLINE_MILLISECONDS,
  computerPoseEstimator,
  MAXIMUM_CONSECUTIVE_DEADLINES,
  jpegDimensions,
  sidePoseFromAnswer,
  type ComputerPoseTimers,
} from './computer-pose';
import { MINIMUM_SHARED_LANDMARKS } from './framing';
import { SIDE_POSE_LANDMARKS } from './side-analysis-port';
import { sizedFrameBytes } from './testing';

/** A clean JPEG of `width` × `height`, with `extra` segments before its frame header. */
function jpeg(width: number, height: number, extra: readonly number[] = []): Uint8Array {
  return sizedFrameBytes(width, height, extra);
}

function answer(value: unknown): UntrustedText {
  return (typeof value === 'string' ? value : JSON.stringify(value)) as UntrustedText;
}

/**
 * Every landmark placed, on a rider who could be one: spike 0016's drawn
 * rider, rounded (#761 — a pose now has to pass `pose-plausibility.ts`, and
 * the straight diagonal line this used to be does not).
 */
const ALL_SEEN: Readonly<Record<string, readonly [number, number]>> = {
  ear: [0.1, 0.2],
  shoulder: [0.62, 0.29],
  elbow: [0.67, 0.39],
  wrist: [0.73, 0.47],
  hip: [0.41, 0.44],
  knee: [0.53, 0.57],
  ankle: [0.5, 0.78],
  heel: [0.48, 0.79],
  toe: [0.55, 0.79],
};

describe('the question — #553', () => {
  it('names every landmark the tablet keeps, in order, and asks for no angle or length', () => {
    const prompt = ANALYSIS_PROMPTS['side-pose'];
    let from = 0;
    for (const name of SIDE_POSE_LANDMARKS) {
      const at = prompt.indexOf(`"${name}":[x,y]`, from);
      expect(at, name).toBeGreaterThanOrEqual(from);
      from = at;
    }
    expect(prompt.match(/":\[x,y\]/g)).toHaveLength(SIDE_POSE_LANDMARKS.length);
    expect(prompt).not.toMatch(/angle|degree|length|°/i);
  });

  it('does not say a rider is there, and asks whether one is before asking where — #761', () => {
    const prompt = ANALYSIS_PROMPTS['side-pose'];
    // #553's question opened "This picture shows a person riding a bicycle".
    expect(prompt).not.toMatch(/^this picture shows/i);
    expect(prompt).toMatch(/^First decide whether/);
    // The answer for nobody comes before the form for somebody, and covers "not sure".
    const nobody = prompt.indexOf('{"rider":false}');
    expect(nobody).toBeGreaterThan(0);
    expect(nobody).toBeLessThan(prompt.indexOf('{"rider":true'));
    expect(prompt).toMatch(/not sure/);
  });
});

describe('jpegDimensions', () => {
  it('reads the frame header after other segments', () => {
    expect(jpegDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(jpegDimensions(jpeg(1920, 1080, [0xff, 0xff]))).toEqual({ width: 1920, height: 1080 });
  });

  it('steps over a marker that carries no length', () => {
    // A restart marker and TEM: two bytes each, no length after them.
    expect(jpegDimensions(jpeg(320, 240, [0xff, 0xd0, 0xff, 0x01]))).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('refuses a segment length too short to be one, and a frame header too short to hold sizes', () => {
    expect(
      jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0, 0])),
    ).toBeUndefined();
    expect(
      jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x05, 0x08, 0, 1, 0, 1, 0])),
    ).toBeUndefined();
    expect(
      jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])),
    ).toBeUndefined();
  });

  it('answers nothing for what is not a JPEG, or one with no frame header before the scan', () => {
    expect(jpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeUndefined();
    expect(jpegDimensions(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]))).toBeUndefined();
    expect(jpegDimensions(jpeg(0, 480))).toBeUndefined();
    // A frame header cut off before its numbers.
    expect(jpegDimensions(jpeg(640, 480).subarray(0, 24))).toBeUndefined();
  });
});

describe('sidePoseFromAnswer — the answer is untrusted input', () => {
  it('reads a whole answer into the same pose the tablet’s model produces', () => {
    const outcome = sidePoseFromAnswer(
      answer({ rider: true, nearSide: 'right', landmarks: ALL_SEEN }),
      4 / 3,
    );
    expect(outcome.kind).toBe('pose');
    if (outcome.kind !== 'pose') {
      return;
    }
    expect(outcome.pose.aspect).toBeCloseTo(4 / 3);
    expect(outcome.pose.nearSide).toBe('right');
    expect(outcome.pose.landmarks.map((mark) => mark.name)).toEqual([...SIDE_POSE_LANDMARKS]);
    expect(outcome.pose.landmarks[0]).toEqual({ name: 'ear', x: 0.1, y: 0.2, visibility: 1 });
    expect(outcome.pose.landmarks[4]).toEqual({ name: 'hip', x: 0.41, y: 0.44, visibility: 1 });
  });

  it('unwraps one fenced block, as a model commonly writes it', () => {
    const body = JSON.stringify({ rider: true, nearSide: 'left', landmarks: ALL_SEEN });
    expect(sidePoseFromAnswer(answer(`\`\`\`json\n${body}\n\`\`\``), 1).kind).toBe('pose');
    expect(sidePoseFromAnswer(answer(`  \`\`\`\n${body}\n\`\`\`  `), 1).kind).toBe('pose');
  });

  it('leaves out a point answered null, and calls too few points nobody', () => {
    const some = { ...ALL_SEEN, ear: null, heel: null };
    const outcome = sidePoseFromAnswer(
      answer({ rider: true, nearSide: 'left', landmarks: some }),
      1,
    );
    expect(outcome.kind === 'pose' ? outcome.pose.landmarks.length : 0).toBe(
      SIDE_POSE_LANDMARKS.length - 2,
    );
    const few = Object.fromEntries(
      SIDE_POSE_LANDMARKS.map((name, index) => [
        name,
        index < MINIMUM_SHARED_LANDMARKS - 1 ? [0.5, 0.5] : null,
      ]),
    );
    expect(
      sidePoseFromAnswer(answer({ rider: true, nearSide: 'left', landmarks: few }), 1),
    ).toEqual({ kind: 'no-rider', cause: 'too-few-points' });
  });

  it('calls a pose missing a point the check needs too few points, not a rider — #761', () => {
    // Eight points, more than enough to be a pose before #761, and no hip.
    const noHip = { ...ALL_SEEN, hip: null };
    expect(
      sidePoseFromAnswer(answer({ rider: true, nearSide: 'left', landmarks: noHip }), 4 / 3),
    ).toEqual({ kind: 'no-rider', cause: 'too-few-points' });
  });

  it('calls a whole pose that could not be a rider implausible, and keeps none of it — #761', () => {
    // Every landmark in range and in shape; the hip above the shoulder.
    const upsideDown = { ...ALL_SEEN, ear: null, shoulder: [0.62, 0.6], hip: [0.41, 0.3] };
    expect(
      sidePoseFromAnswer(answer({ rider: true, nearSide: 'left', landmarks: upsideDown }), 4 / 3),
    ).toEqual({ kind: 'no-rider', cause: 'implausible' });
  });

  it('reads {"rider":false} as nobody, and nothing beside it', () => {
    expect(sidePoseFromAnswer(answer({ rider: false }), 1)).toEqual({
      kind: 'no-rider',
      cause: 'said-nobody',
    });
    expect(sidePoseFromAnswer(answer({ rider: false, note: 'x' }), 1)).toEqual({
      kind: 'unreadable',
    });
  });

  it.each([
    ['prose', 'The rider is leaning forward.'],
    ['a list', [1, 2]],
    ['no rider key', { nearSide: 'left', landmarks: ALL_SEEN }],
    ['rider as a string', { rider: 'yes', nearSide: 'left', landmarks: ALL_SEEN }],
    ['an unknown top-level key', { rider: true, nearSide: 'left', landmarks: ALL_SEEN, url: 'x' }],
    ['a side that is neither', { rider: true, nearSide: 'front', landmarks: ALL_SEEN }],
    ['landmarks not an object', { rider: true, nearSide: 'left', landmarks: [] }],
    [
      'a landmark missing',
      { rider: true, nearSide: 'left', landmarks: { ...ALL_SEEN, toe: undefined } },
    ],
    [
      'an unknown landmark',
      { rider: true, nearSide: 'left', landmarks: { ...ALL_SEEN, nose: [0.5, 0.5] } },
    ],
    [
      'a point outside the picture',
      { rider: true, nearSide: 'left', landmarks: { ...ALL_SEEN, knee: [1.2, 0.5] } },
    ],
    [
      'a negative point',
      { rider: true, nearSide: 'left', landmarks: { ...ALL_SEEN, knee: [0.5, -0.1] } },
    ],
    [
      'a point that is text',
      { rider: true, nearSide: 'left', landmarks: { ...ALL_SEEN, knee: ['0.5', 0.5] } },
    ],
    [
      'a point with three numbers',
      { rider: true, nearSide: 'left', landmarks: { ...ALL_SEEN, knee: [0.5, 0.5, 1] } },
    ],
    ['two fenced blocks', '```\n{"rider":false}\n```\n```\n{"rider":false}\n```'],
  ])('refuses %s as unreadable', (_what, value) => {
    expect(sidePoseFromAnswer(answer(value), 1)).toEqual({ kind: 'unreadable' });
  });

  it('refuses a picture shape that is not one', () => {
    const whole = answer({ rider: true, nearSide: 'left', landmarks: ALL_SEEN });
    expect(sidePoseFromAnswer(whole, 0)).toEqual({ kind: 'unreadable' });
    expect(sidePoseFromAnswer(whole, Number.NaN)).toEqual({ kind: 'unreadable' });
  });
});

/** A port that records each request and answers from `script`, one per call. */
function scriptedPort(script: (AnalysisOutcome | 'hang')[]): {
  readonly port: AnalysisPort;
  readonly asked: AnalysisRequest[];
  readonly cancelled: number[];
} {
  const asked: AnalysisRequest[] = [];
  const cancelled: number[] = [];
  const port: AnalysisPort = {
    askAboutFrame(request): AnalysisCall {
      const index = asked.length;
      asked.push(request);
      const next = script[index] ?? 'hang';
      let settle: (outcome: AnalysisOutcome) => void = () => undefined;
      const outcome =
        next === 'hang'
          ? new Promise<AnalysisOutcome>((resolve) => {
              settle = resolve;
            })
          : Promise.resolve(next);
      return {
        outcome,
        cancel: () => {
          cancelled.push(index);
          settle({ kind: 'failed', failure: 'cancelled' });
        },
      };
    },
  };
  return { port, asked, cancelled };
}

function manualTimers(): { timers: ComputerPoseTimers; fire: () => void; pending: () => number } {
  const tasks: { task: () => void; ms: number; live: boolean }[] = [];
  return {
    timers: {
      after: (task, ms) => {
        const entry = { task, ms, live: true };
        tasks.push(entry);
        return () => {
          entry.live = false;
        };
      },
    },
    fire: () => {
      for (const entry of tasks) {
        if (entry.live && entry.ms === COMPUTER_POSE_DEADLINE_MILLISECONDS) {
          entry.live = false;
          entry.task();
        }
      }
    },
    pending: () => tasks.filter((entry) => entry.live).length,
  };
}

const POSE_ANSWER: AnalysisOutcome = {
  kind: 'described',
  description: answer({ rider: true, nearSide: 'left', landmarks: ALL_SEEN }),
};

describe('computerPoseEstimator — each picture through the one transport', () => {
  it('asks the side-pose question about the picture as it came, and reads the answer', async () => {
    const { port, asked } = scriptedPort([POSE_ANSWER]);
    const picture = jpeg(640, 480);
    const outcome = await computerPoseEstimator(() => port).estimateSidePose(picture);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.question).toBe('side-pose');
    expect(asked[0]?.frame).toMatchObject({ mediaType: 'image/jpeg', width: 640, height: 480 });
    expect(asked[0]?.frame.bytes).toBe(picture);
    expect(outcome.kind === 'pose' ? outcome.pose.aspect : 0).toBeCloseTo(640 / 480);
  });

  it('sends nothing that is not a clean JPEG — one carrying Exif included', async () => {
    const { port, asked } = scriptedPort([POSE_ANSWER]);
    const estimator = computerPoseEstimator(() => port);
    expect(await estimator.estimateSidePose(new Uint8Array([1, 2, 3, 4]))).toEqual({
      kind: 'unreadable',
    });
    const withExif = jpeg(640, 480, [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
    expect(jpegDimensions(withExif)).toEqual({ width: 640, height: 480 });
    expect(await estimator.estimateSidePose(withExif)).toEqual({ kind: 'unreadable' });
    expect(asked).toHaveLength(0);
  });

  it.each([
    'not-configured',
    'unreachable',
    'refused',
    'not-a-model-server',
    'failed-on-machine',
    'address-not-numeric',
  ] as const)('stops sending for the rest of the session after %s', async (failure) => {
    const { port, asked } = scriptedPort([{ kind: 'failed', failure }, POSE_ANSWER]);
    const estimator = computerPoseEstimator(() => port);
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unavailable' });
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unavailable' });
    expect(asked).toHaveLength(1);
  });

  it.each(['malformed', 'too-large', 'picture-too-large', 'no-answer'] as const)(
    'counts %s as one unreadable picture and tries the next',
    async (failure) => {
      const { port, asked } = scriptedPort([{ kind: 'failed', failure }, POSE_ANSWER]);
      const estimator = computerPoseEstimator(() => port);
      expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unreadable' });
      expect((await estimator.estimateSidePose(jpeg(640, 480))).kind).toBe('pose');
      expect(asked).toHaveLength(2);
    },
  );

  it('sends nothing more once the computer is switched off or forgotten, mid-session', async () => {
    const { port, asked } = scriptedPort([POSE_ANSWER, POSE_ANSWER, POSE_ANSWER]);
    let there = true;
    const estimator = computerPoseEstimator(() => (there ? port : undefined));
    expect((await estimator.estimateSidePose(jpeg(640, 480))).kind).toBe('pose');
    there = false;
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unavailable' });
    there = true;
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unavailable' });
    expect(asked).toHaveLength(1);
  });

  it('gives up one picture that is not answered in time, and tries the next', async () => {
    const { port, asked, cancelled } = scriptedPort(['hang', POSE_ANSWER]);
    const { timers, fire, pending } = manualTimers();
    const estimator = computerPoseEstimator(() => port, timers);
    const first = estimator.estimateSidePose(jpeg(640, 480));
    fire();
    expect(await first).toEqual({ kind: 'unreadable' });
    expect(cancelled).toEqual([0]);
    expect((await estimator.estimateSidePose(jpeg(640, 480))).kind).toBe('pose');
    expect(asked).toHaveLength(2);
    expect(pending()).toBe(0);
  });

  it('stops sending once the computer runs out the deadline too many times in a row — #553 review', async () => {
    expect(MAXIMUM_CONSECUTIVE_DEADLINES).toBe(2);
    const { port, asked, cancelled } = scriptedPort(['hang', 'hang', POSE_ANSWER]);
    const { timers, fire } = manualTimers();
    const estimator = computerPoseEstimator(() => port, timers);
    const first = estimator.estimateSidePose(jpeg(640, 480));
    fire();
    expect(await first).toEqual({ kind: 'unreadable' });
    const second = estimator.estimateSidePose(jpeg(640, 480));
    fire();
    expect(await second).toEqual({ kind: 'unavailable' });
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unavailable' });
    expect(cancelled).toEqual([0, 1]);
    expect(asked).toHaveLength(2);
  });

  it('counts only deadlines IN A ROW: any answer in time resets the count', async () => {
    const { port, asked } = scriptedPort([
      'hang',
      { kind: 'failed', failure: 'malformed' },
      'hang',
      POSE_ANSWER,
    ]);
    const { timers, fire } = manualTimers();
    const estimator = computerPoseEstimator(() => port, timers);
    const first = estimator.estimateSidePose(jpeg(640, 480));
    fire();
    expect(await first).toEqual({ kind: 'unreadable' });
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unreadable' });
    const third = estimator.estimateSidePose(jpeg(640, 480));
    fire();
    expect(await third).toEqual({ kind: 'unreadable' });
    expect((await estimator.estimateSidePose(jpeg(640, 480))).kind).toBe('pose');
    expect(asked).toHaveLength(4);
  });

  it('cancels what is in flight when closed, and sends nothing afterwards', async () => {
    const { port, asked, cancelled } = scriptedPort(['hang', POSE_ANSWER]);
    const estimator = computerPoseEstimator(() => port, manualTimers().timers);
    const first = estimator.estimateSidePose(jpeg(640, 480));
    estimator.closeSidePoseModel();
    expect(await first).toEqual({ kind: 'unavailable' });
    expect(cancelled).toEqual([0]);
    expect(await estimator.estimateSidePose(jpeg(640, 480))).toEqual({ kind: 'unavailable' });
    expect(asked).toHaveLength(1);
  });
});
