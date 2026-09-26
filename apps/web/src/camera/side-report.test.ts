// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's post-ride report** — #388. Sessions built from
 * arithmetic: a rider seen side-on, pedalling a circle, whose posture changes
 * half-way through in exactly one respect, so each observation is shown to
 * fire on its own change and on nothing else.
 */

import { describe, expect, it } from 'vitest';

import type { SidePose, SidePoseLandmark } from './side-analysis-port';
import {
  MEASURED_SPREAD_DEGREES,
  MINIMUM_SESSION_MILLISECONDS,
  observedChanges,
  renderableChanges,
  sideReportFrom,
  type SideReportLooked,
  type SideReportSample,
} from './side-report';
import {
  isReportSentence,
  isReportSummary,
  SIDE_OBSERVATION_KINDS,
  SIDE_OBSERVATION_SENTENCES,
  SIDE_OBSERVATION_VOCABULARY,
  SIDE_REPORT_NO_MODEL,
  SIDE_REPORT_OBSERVED,
  SIDE_REPORT_SUMMARIES,
  SIDE_REPORT_TOO_SHORT,
  SIDE_REPORT_UNCHANGED,
  SIDE_REPORT_UNREADABLE,
} from './side-report-wording';

/** How the rider sits, as the camera sees them. Lengths are shares of the picture. */
interface Posture {
  /** Hip-to-shoulder line above the horizontal, degrees. */
  readonly torso: number;
  /** Interior elbow angle, degrees. */
  readonly elbow: number;
  /** Ear ahead of the shoulder, as a share of the torso. */
  readonly head: number;
  /** The hip's position in the picture. */
  readonly hipX: number;
  readonly hipY: number;
}

const BASE: Posture = { torso: 45, elbow: 150, head: 0.1, hipX: 0.44, hipY: 0.47 };
const THIGH = 0.21;
const SHIN = 0.21;
const TORSO = 0.2;
const ARM = 0.1;
/** The pedals' axle and the ankle's circle round it. */
const CENTRE = { x: 0.45, y: 0.8 };
const CIRCLE = 0.07;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** One picture's pose, facing right (or mirrored to face left), at crank phase `phase`. */
function poseAt(posture: Posture, phase: number, mirrored = false): SidePose {
  const hip = { x: posture.hipX, y: posture.hipY };
  const ankle = { x: CENTRE.x + CIRCLE * Math.cos(phase), y: CENTRE.y + CIRCLE * Math.sin(phase) };
  // Two-bone knee, forward of the line from hip to ankle.
  const reach = Math.min(Math.hypot(ankle.x - hip.x, ankle.y - hip.y), THIGH + SHIN - 1e-6);
  const toAnkle = Math.atan2(ankle.y - hip.y, ankle.x - hip.x);
  const atHip = Math.acos((THIGH ** 2 + reach ** 2 - SHIN ** 2) / (2 * THIGH * reach));
  const knee = {
    x: hip.x + THIGH * Math.cos(toAnkle - atHip),
    y: hip.y + THIGH * Math.sin(toAnkle - atHip),
  };
  const shoulder = {
    x: hip.x + TORSO * Math.cos(radians(posture.torso)),
    y: hip.y - TORSO * Math.sin(radians(posture.torso)),
  };
  const ear = { x: shoulder.x + posture.head * TORSO, y: shoulder.y - 0.06 };
  const upper = radians(60);
  const elbow = { x: shoulder.x + ARM * Math.cos(upper), y: shoulder.y + ARM * Math.sin(upper) };
  const fore = upper - radians(180 - posture.elbow);
  const wrist = { x: elbow.x + ARM * Math.cos(fore), y: elbow.y + ARM * Math.sin(fore) };
  const points: [SidePoseLandmark, { x: number; y: number }][] = [
    ['ear', ear],
    ['shoulder', shoulder],
    ['elbow', elbow],
    ['wrist', wrist],
    ['hip', hip],
    ['knee', knee],
    ['ankle', ankle],
  ];
  return {
    aspect: 1,
    nearSide: mirrored ? 'right' : 'left',
    landmarks: points.map(([name, point]) => ({
      name,
      x: mirrored ? 1 - point.x : point.x,
      y: point.y,
      visibility: 0.9,
    })),
  };
}

/** A session: `early` posture for the first half, `late` for the second, five pictures a second. */
function session(
  early: Posture,
  late: Posture = early,
  minutes = 9,
  mirrored = false,
): SideReportSample[] {
  const count = minutes * 60 * 5;
  return Array.from({ length: count }, (_, index) => ({
    milliseconds: index * 200,
    // About 80 rpm at five pictures a second, so the crank lands everywhere.
    pose: poseAt(index < count / 2 ? early : late, index * 1.7, mirrored),
  }));
}

function lookedAt(samples: readonly SideReportSample[]): SideReportLooked {
  return { model: 'ready', posed: samples.length, noRider: 0, unreadable: 0 };
}

function report(samples: readonly SideReportSample[]) {
  return sideReportFrom(samples, lookedAt(samples));
}

describe('one change at a time, and nothing else', () => {
  it('says nothing changed when nothing did — and says it in a sentence, not with an empty list alone', () => {
    const samples = session(BASE);
    expect(report(samples)).toStrictEqual({ summary: SIDE_REPORT_UNCHANGED, observations: [] });
  });

  const changes: readonly [string, Posture, string][] = [
    [
      'a more upright upper body',
      { ...BASE, torso: 55 },
      SIDE_OBSERVATION_SENTENCES.torso.increased,
    ],
    ['a lower upper body', { ...BASE, torso: 35 }, SIDE_OBSERVATION_SENTENCES.torso.decreased],
    [
      'a straighter knee at the bottom of the stroke',
      { ...BASE, hipY: 0.46 },
      SIDE_OBSERVATION_SENTENCES.knee.increased,
    ],
    [
      'a more bent knee at the bottom of the stroke',
      { ...BASE, hipY: 0.49 },
      SIDE_OBSERVATION_SENTENCES.knee.decreased,
    ],
    ['a straighter elbow', { ...BASE, elbow: 165 }, SIDE_OBSERVATION_SENTENCES.elbow.increased],
    ['a more bent elbow', { ...BASE, elbow: 130 }, SIDE_OBSERVATION_SENTENCES.elbow.decreased],
    ['the head further forward', { ...BASE, head: 0.2 }, SIDE_OBSERVATION_SENTENCES.head.increased],
    ['the head further back', { ...BASE, head: 0 }, SIDE_OBSERVATION_SENTENCES.head.decreased],
    [
      'sitting further forward',
      { ...BASE, hipX: 0.46 },
      SIDE_OBSERVATION_SENTENCES.saddle.increased,
    ],
    ['sitting further back', { ...BASE, hipX: 0.42 }, SIDE_OBSERVATION_SENTENCES.saddle.decreased],
  ];

  it.each(changes)('%s, and only that', (_what, late, sentence) => {
    expect(report(session(BASE, late))).toStrictEqual({
      summary: SIDE_REPORT_OBSERVED,
      observations: [sentence],
    });
  });

  it.each(changes)('%s, facing the other way round', (_what, late, sentence) => {
    // Mirrored: the rider faces left, so "forward" is towards smaller x. A
    // report that read direction off the picture rather than off the rider
    // would say the opposite here.
    expect(report(session(BASE, late, 9, true))?.observations).toStrictEqual([sentence]);
  });

  it('does not mention a change smaller than its threshold', () => {
    // Two degrees of torso: a real change, below what the report mentions.
    expect(report(session(BASE, { ...BASE, torso: 47 }))?.summary).toBe(SIDE_REPORT_UNCHANGED);
  });

  it('reports several changes at once, in a fixed order', () => {
    const late = { ...BASE, torso: 35, elbow: 130 };
    expect(report(session(BASE, late))?.observations).toStrictEqual([
      SIDE_OBSERVATION_SENTENCES.torso.decreased,
      SIDE_OBSERVATION_SENTENCES.elbow.decreased,
    ]);
  });
});

describe('when there is too little to compare', () => {
  it('says the session was too short, below six minutes', () => {
    const samples = session(BASE, { ...BASE, torso: 60 }, 5);
    expect(report(samples)).toStrictEqual({ summary: SIDE_REPORT_TOO_SHORT, observations: [] });
  });

  it('holds the "about six minutes" in the sentence to the constant', () => {
    expect(MINIMUM_SESSION_MILLISECONDS).toBe(6 * 60 * 1000);
    expect(SIDE_REPORT_TOO_SHORT).toContain('six minutes');
  });

  it('says the pictures could not be read when most of them had nobody usable in them', () => {
    const samples = session(BASE, { ...BASE, torso: 60 });
    const looked = { model: 'ready' as const, posed: samples.length, noRider: 0, unreadable: 0 };
    expect(sideReportFrom(samples, { ...looked, noRider: samples.length + 1 })?.summary).toBe(
      SIDE_REPORT_UNREADABLE,
    );
    expect(sideReportFrom(samples, { ...looked, unreadable: samples.length + 1 })?.summary).toBe(
      SIDE_REPORT_UNREADABLE,
    );
  });

  it('says the pictures could not be read when no kind had the landmarks it needs', () => {
    // No wrist anywhere: the rider's facing cannot be told, so nothing is compared.
    const samples = session(BASE, { ...BASE, torso: 60 }).map((sample) => ({
      ...sample,
      pose: {
        ...sample.pose,
        landmarks: sample.pose.landmarks.filter((mark) => mark.name !== 'wrist'),
      },
    }));
    expect(report(samples)).toStrictEqual({ summary: SIDE_REPORT_UNREADABLE, observations: [] });
  });

  it('says the model could not be loaded, when it could not', () => {
    expect(
      sideReportFrom([], { model: 'unavailable', posed: 0, noRider: 0, unreadable: 0 }),
    ).toStrictEqual({ summary: SIDE_REPORT_NO_MODEL, observations: [] });
  });

  it('has nothing to report for a pairing that never filmed', () => {
    expect(
      sideReportFrom([], { model: 'waiting', posed: 0, noRider: 0, unreadable: 0 }),
    ).toBeUndefined();
  });
});

describe('what a report may say (ADR 0030)', () => {
  const scenarios = [
    session(BASE),
    session(BASE, { ...BASE, torso: 60, elbow: 130, head: 0.25, hipX: 0.47, hipY: 0.46 }),
    session(BASE, { ...BASE, torso: 30 }, 5),
  ];

  it('says only sentences the vocabulary file holds', () => {
    for (const samples of scenarios) {
      const said = report(samples);
      expect(said).toBeDefined();
      expect(isReportSummary(said?.summary ?? '')).toBe(true);
      for (const observation of said?.observations ?? []) {
        expect(isReportSentence(observation)).toBe(true);
      }
    }
  });

  it('writes no number in any sentence it can say — the owner’s "words only"', () => {
    for (const sentence of [...SIDE_REPORT_SUMMARIES, ...SIDE_OBSERVATION_VOCABULARY]) {
      expect(sentence).not.toMatch(/\d/);
    }
  });

  it('words every observation as a possibility, in the same sentence', () => {
    for (const sentence of SIDE_OBSERVATION_VOCABULARY) {
      expect(sentence).toContain('possibly');
    }
    expect(SIDE_OBSERVATION_VOCABULARY).toHaveLength(SIDE_OBSERVATION_KINDS.length * 2);
  });

  it('names both sides of the comparison in every observation (R2)', () => {
    for (const sentence of SIDE_OBSERVATION_VOCABULARY) {
      expect(sentence).toMatch(/late in the session than early in it/);
    }
  });
});

describe('degrees are computed and never rendered (the owner’s gate on #385)', () => {
  it('has no measured spread today — #385 is what sets one, and changes this line', () => {
    expect(MEASURED_SPREAD_DEGREES).toBeUndefined();
  });

  it('computes a knee change as a difference, with its direction', () => {
    const changes = observedChanges(session(BASE, { ...BASE, hipY: 0.46 }), 3);
    const knee = changes.find((change) => change.what === 'knee');
    expect(knee?.deltaDegrees).toBeGreaterThan(5);
    expect(knee?.spreadDegrees).toBe(3);
    expect(changes.every((change) => !('absoluteDegrees' in change))).toBe(true);
  });

  it('renders none of them while the spread is absent, and all of them once there is one', () => {
    const changes = observedChanges(session(BASE, { ...BASE, hipY: 0.46 }), 3);
    expect(changes.length).toBeGreaterThan(0);
    expect(renderableChanges(changes)).toStrictEqual([]);
    expect(renderableChanges(changes, 3)).toStrictEqual(changes);
  });

  it('computes nothing for a session too short to have thirds', () => {
    expect(observedChanges(session(BASE, BASE, 5), 3)).toStrictEqual([]);
  });
});
