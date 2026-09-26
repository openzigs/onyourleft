// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tablet's analysis of the side camera** — #530, ADR 0033 D-3, D-6 and
 * D-7. A scripted link and a scripted model, so every rule is driven one
 * picture at a time; `side-link.test.ts` §"pictures" drives the same class
 * through the real link.
 */

import { describe, expect, it, vi } from 'vitest';

import { athleteId, type FramingReferenceRecord } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import type { FramingReference, FramingVerdict } from './framing';
import {
  FRAMING_CHECK_POSES,
  placementOf,
  SideAnalysis,
  type FramingReferenceKeeping,
  type SidePoseSample,
} from './side-analysis';
import type { SidePose, SidePoseEstimator, SidePoseOutcome } from './side-analysis-port';
import type { SidePicture } from './side-link-pictures';
import type { SideCameraControlPort, SideControlState } from './side-pairing-port';
import type { SideReport } from './side-report';
import { SIDE_REPORT_TOO_SHORT } from './side-report-wording';
import { cleanFrameBytes } from './testing';

const ATHLETE = athleteId('athlete-side');

/** A pose at a placement: every framing landmark, shifted by `dx`, scaled by `scale`. */
function pose(dx = 0, scale = 1, aspect = 16 / 9): SidePose {
  const base: [SidePose['landmarks'][number]['name'], number, number][] = [
    ['ear', 0.5, 0.2],
    ['shoulder', 0.45, 0.3],
    ['elbow', 0.55, 0.4],
    ['wrist', 0.65, 0.42],
    ['hip', 0.4, 0.5],
    ['knee', 0.5, 0.65],
    ['ankle', 0.45, 0.85],
    ['toe', 0.5, 0.88],
  ];
  return {
    aspect,
    nearSide: 'left',
    landmarks: base.map(([name, x, y]) => ({
      name,
      x: 0.5 + (x - 0.5) * scale + dx,
      y: 0.5 + (y - 0.5) * scale,
      visibility: 0.9,
    })),
  };
}

function referenceOf(p: SidePose): FramingReference {
  const placement = placementOf([{ sequence: 0, milliseconds: 0, pose: p }]);
  if (placement === undefined) {
    throw new Error('no placement');
  }
  return placement;
}

function scriptedControl() {
  let state: SideControlState = {
    phone: 'pairing',
    answered: true,
    stopReason: undefined,
    command: undefined,
    ended: undefined,
  };
  const listeners = new Set<() => void>();
  const pictureListeners = new Set<(picture: SidePicture) => void>();
  const references: FramingReference[] = [];
  const verdicts: FramingVerdict[] = [];
  const control: SideCameraControlPort = {
    sideControlState: () => state,
    onSideControlChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    commandSideCamera: () => undefined,
    endSidePairing: () => undefined,
    onSideCameraPicture: (listener) => {
      pictureListeners.add(listener);
      return () => pictureListeners.delete(listener);
    },
    shareFramingReference: (reference) => references.push(reference),
    shareFramingVerdict: (verdict) => verdicts.push(verdict),
  };
  let sequence = 0;
  return {
    control,
    references,
    verdicts,
    listening: () => pictureListeners.size,
    set(change: Partial<SideControlState>) {
      state = { ...state, ...change };
      for (const listener of [...listeners]) {
        listener();
      }
    },
    picture(): SidePicture {
      const picture = { sequence, milliseconds: sequence * 200, bytes: cleanFrameBytes(64) };
      sequence += 1;
      for (const listener of [...pictureListeners]) {
        listener(picture);
      }
      return picture;
    },
  };
}

/** A model whose answers the test hands out one at a time. */
function scriptedModel() {
  const pending: { picture: Uint8Array; answer: (outcome: SidePoseOutcome) => void }[] = [];
  let closed = 0;
  let made = 0;
  const estimator: SidePoseEstimator = {
    estimateSidePose: async (picture) =>
      new Promise<SidePoseOutcome>((answer) => {
        pending.push({ picture, answer });
      }),
    closeSidePoseModel: () => {
      closed += 1;
    },
  };
  return {
    make: () => {
      made += 1;
      return estimator;
    },
    pending,
    made: () => made,
    closed: () => closed,
    /** Answer the oldest picture waiting and let the analysis move on. */
    async answer(outcome: SidePoseOutcome = { kind: 'pose', pose: pose() }): Promise<void> {
      pending.shift()?.answer(outcome);
      for (let round = 0; round < 5; round += 1) {
        await Promise.resolve();
      }
    },
  };
}

function scriptedStore(stored?: FramingReferenceRecord) {
  const puts: FramingReferenceRecord[] = [];
  const keeping: FramingReferenceKeeping & { readonly puts: FramingReferenceRecord[] } = {
    athleteId: ATHLETE,
    puts,
    store: {
      getFramingReference: async (owner) => Promise.resolve(owner === ATHLETE ? stored : undefined),
      putFramingReference: async (record) => {
        puts.push(record);
        return Promise.resolve();
      },
    },
  };
  return keeping;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await Promise.resolve();
  }
}

function setUp(stored?: FramingReferenceRecord) {
  const link = scriptedControl();
  const model = scriptedModel();
  const keeping = scriptedStore(stored);
  const analysis = new SideAnalysis({
    control: link.control,
    estimator: model.make,
    references: keeping,
  });
  return { link, model, keeping, analysis };
}

describe('each picture, as it arrives', () => {
  it('loads no model until the first picture, and hands the picture’s bytes to it', async () => {
    const { link, model, analysis } = setUp();
    expect(model.made()).toBe(0);
    expect(analysis.sideAnalysisState().model).toBe('waiting');
    const picture = link.picture();
    expect(model.made()).toBe(1);
    expect(analysis.sideAnalysisState().model).toBe('loading');
    expect(model.pending[0]?.picture).toBe(picture.bytes);
    await model.answer();
    expect(analysis.sideAnalysisState()).toMatchObject({ model: 'ready', posed: 1 });
  });

  it('keeps the pose keyed by the picture’s sequence number and milliseconds, and nothing else (D-3)', async () => {
    const { link, model, analysis } = setUp();
    link.picture();
    link.picture();
    await model.answer({ kind: 'pose', pose: pose(0.01) });
    await model.answer({ kind: 'pose', pose: pose(0.02) });
    const samples = analysis.poseSamples();
    expect(samples.map((sample) => [sample.sequence, sample.milliseconds])).toEqual([
      [0, 0],
      [1, 200],
    ]);
    for (const sample of samples) {
      expect(Object.keys(sample).sort()).toEqual(['milliseconds', 'pose', 'sequence']);
    }
    // No picture is held, in any form, anywhere a sample can reach.
    expect(JSON.stringify(samples)).not.toContain('bytes');
  });

  it('counts a picture with nobody in it, and one that would not read, apart', async () => {
    const { link, model, analysis } = setUp();
    link.picture();
    await model.answer({ kind: 'no-rider' });
    link.picture();
    await model.answer({ kind: 'unreadable' });
    expect(analysis.sideAnalysisState()).toMatchObject({ posed: 0, noRider: 1, unreadable: 1 });
    expect(analysis.poseSamples()).toEqual([]);
  });
});

describe('when the tablet cannot keep up (D-6)', () => {
  it('keeps one picture waiting, replaces it with a newer one, and counts each replaced', async () => {
    const { link, model, analysis } = setUp();
    link.picture(); // looked at now
    link.picture(); // waits
    link.picture(); // replaces it
    const newest = link.picture(); // replaces that
    expect(model.pending).toHaveLength(1);
    expect(analysis.sideAnalysisState().skipped).toBe(2);
    await model.answer();
    // The newest was looked at next; the two in between never reached the model.
    expect(model.pending).toHaveLength(1);
    expect(model.pending[0]?.picture).toBe(newest.bytes);
    await model.answer();
    expect(model.pending).toHaveLength(0);
    expect(analysis.poseSamples().map((sample) => sample.sequence)).toEqual([0, 3]);
  });
});

describe('when the model will not load', () => {
  it('says so, drops the waiting picture, and looks at nothing more', async () => {
    const { link, model, analysis } = setUp();
    link.picture();
    link.picture();
    await model.answer({ kind: 'unavailable' });
    expect(analysis.sideAnalysisState().model).toBe('unavailable');
    expect(model.pending).toHaveLength(0);
    link.picture();
    expect(model.pending).toHaveLength(0);
  });
});

describe('the framing check (D-7)', () => {
  const STORED: FramingReferenceRecord = { athleteId: ATHLETE, ...referenceOf(pose()) };

  it('sends the phone the stored reference once its camera is on, and nothing before', async () => {
    const { link } = setUp(STORED);
    link.set({ phone: 'pairing' });
    await settle();
    expect(link.references).toEqual([]);
    link.set({ phone: 'framing' });
    await settle();
    link.set({ phone: 'filming' });
    await settle();
    expect(link.references).toEqual([referenceOf(pose())]);
  });

  it('checks after enough pictures with a rider in them, and tells the phone it matches', async () => {
    const { link, model, analysis } = setUp(STORED);
    link.set({ phone: 'framing' });
    await settle();
    for (let index = 0; index < FRAMING_CHECK_POSES - 1; index += 1) {
      link.picture();
      await model.answer();
    }
    expect(link.verdicts).toEqual([]);
    expect(analysis.sideAnalysisState().framing).toBe('checking');
    link.picture();
    await model.answer();
    expect(link.verdicts).toEqual(['matches']);
    expect(analysis.sideAnalysisState().framing).toBe('matches');
    // Once: later pictures do not check again.
    link.picture();
    await model.answer();
    expect(link.verdicts).toEqual(['matches']);
  });

  it('says it differs when the camera has moved', async () => {
    const { link, model, analysis } = setUp(STORED);
    link.set({ phone: 'framing' });
    await settle();
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer({ kind: 'pose', pose: pose(0.2) });
    }
    expect(link.verdicts).toEqual(['differs']);
    expect(analysis.sideAnalysisState().framing).toBe('differs');
  });

  it('checks as soon as the reference arrives, when enough pictures came first', async () => {
    const { link, model } = setUp(STORED);
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer();
    }
    expect(link.verdicts).toEqual([]);
    link.set({ phone: 'filming' });
    await settle();
    expect(link.verdicts).toEqual(['matches']);
  });

  it('with no stored reference, says there is none and sends no verdict', async () => {
    const { link, model, analysis } = setUp();
    link.set({ phone: 'framing' });
    await settle();
    expect(analysis.sideAnalysisState().framing).toBe('no-reference');
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer();
    }
    expect(link.references).toEqual([]);
    expect(link.verdicts).toEqual([]);
  });

  it('reads a store that fails as no reference, rather than failing the session', async () => {
    const link = scriptedControl();
    const model = scriptedModel();
    const analysis = new SideAnalysis({
      control: link.control,
      estimator: model.make,
      references: {
        athleteId: ATHLETE,
        store: {
          getFramingReference: async () => Promise.reject(new Error('QuotaExceededError: key')),
          putFramingReference: async () => Promise.resolve(),
        },
      },
    });
    link.set({ phone: 'framing' });
    await settle();
    expect(analysis.sideAnalysisState().framing).toBe('no-reference');
  });
});

describe('when the session ends', () => {
  it('lets the model go, stops listening, and keeps a first session’s placement as the next reference', async () => {
    const { link, model, keeping, analysis } = setUp();
    // No stored reference: the first session, which is the one case besides a
    // passing check whose placement moves the reference forward (#388).
    link.set({ phone: 'framing' });
    await settle();
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer({ kind: 'pose', pose: pose(0.05) });
    }
    link.set({ phone: 'stopped' });
    await settle();
    expect(model.closed()).toBe(1);
    expect(link.listening()).toBe(0);
    expect(analysis.sideAnalysisState().finished).toBe(true);
    expect(keeping.puts).toEqual([
      { athleteId: ATHLETE, ...referenceOf(pose(0.05)), check: 'no-reference' },
    ]);
    // The numbers are still there for the report.
    expect(analysis.poseSamples()).toHaveLength(FRAMING_CHECK_POSES);
  });

  it('keeps the PREVIOUS reference when the check said the camera had moved — the owner’s ruling on #388', async () => {
    // ⚠️ #555 moved the reference forward after every session, so a tripod
    // that crept a little each time reset the baseline it was being checked
    // against and never failed. The owner's ruling of 2026-09-26: only a
    // passing check (or a first session) moves it.
    const stored: FramingReferenceRecord = { athleteId: ATHLETE, ...referenceOf(pose()) };
    const { link, model, keeping, analysis } = setUp(stored);
    link.set({ phone: 'framing' });
    await settle();
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer({ kind: 'pose', pose: pose(0.2) });
    }
    link.set({ ended: 'ended-here' });
    await settle();
    expect(analysis.sideAnalysisState().framing).toBe('differs');
    expect(keeping.puts).toEqual([]);
  });

  it('moves the reference forward when the check passed', async () => {
    const stored: FramingReferenceRecord = { athleteId: ATHLETE, ...referenceOf(pose()) };
    const { link, model, keeping } = setUp(stored);
    link.set({ phone: 'framing' });
    await settle();
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer({ kind: 'pose', pose: pose(0.01) });
    }
    link.set({ ended: 'ended-here' });
    await settle();
    expect(keeping.puts).toEqual([
      { athleteId: ATHLETE, ...referenceOf(pose(0.01)), check: 'matches' },
    ]);
  });

  it('keeps the previous reference when the check was never made, however much was filmed', async () => {
    // A stored reference that the session never got to check against — here
    // because the phone never said its camera was on, so it was never asked
    // for. `not-checked` is not a pass, so the stored one stays.
    const stored: FramingReferenceRecord = { athleteId: ATHLETE, ...referenceOf(pose()) };
    const { link, model, keeping, analysis } = setUp(stored);
    for (let index = 0; index < FRAMING_CHECK_POSES * 2; index += 1) {
      link.picture();
      await model.answer({ kind: 'pose', pose: pose(0.2) });
    }
    link.set({ phone: 'stopped' });
    await settle();
    expect(analysis.sideAnalysisState().framing).toBe('not-checked');
    expect(keeping.puts).toEqual([]);
  });

  it('records whether the check passed with the session’s numbers, read back through the store (D-7)', async () => {
    const harness = createStoreHarness();
    try {
      await seedAthletes(harness);
      await harness.write(async (store) =>
        store.putFramingReference({ athleteId: ATHLETE_A, ...referenceOf(pose()) }),
      );
      const link = scriptedControl();
      const model = scriptedModel();
      const puts: Promise<void>[] = [];
      new SideAnalysis({
        control: link.control,
        estimator: model.make,
        references: {
          athleteId: ATHLETE_A,
          store: {
            getFramingReference: async (owner) =>
              harness.write(async (store) => store.getFramingReference(owner)),
            putFramingReference: async (record) => {
              const put = harness.write(async (store) => store.putFramingReference(record));
              puts.push(put);
              return put;
            },
          },
        },
      });
      link.set({ phone: 'framing' });
      await vi.waitFor(() => {
        expect(link.references).toHaveLength(1);
      });
      for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
        link.picture();
        await model.answer({ kind: 'pose', pose: pose(0.01) });
      }
      expect(link.verdicts).toEqual(['matches']);
      link.set({ phone: 'stopped' });
      expect(puts).toHaveLength(1);
      await Promise.all(puts);
      // A fresh connection, through the public read (CLAUDE.md §5).
      const kept = await harness.read(async (store) => store.getFramingReference(ATHLETE_A));
      expect(kept?.check).toBe('matches');
      // The verdict is about THIS session's placement, on the same row.
      expect(kept?.landmarks).toEqual(referenceOf(pose(0.01)).landmarks);
    } finally {
      await harness.destroy();
    }
  });

  it('keeps nothing, and says the check was not made, when it saw too little of the rider', async () => {
    const { link, model, keeping, analysis } = setUp({
      athleteId: ATHLETE,
      ...referenceOf(pose()),
    });
    link.set({ phone: 'framing' });
    await settle();
    link.picture();
    await model.answer();
    link.set({ ended: 'link-lost' });
    await settle();
    expect(keeping.puts).toEqual([]);
    expect(analysis.sideAnalysisState().framing).toBe('not-checked');
  });

  it('discards a picture that was with the model when it ended, and looks at nothing after', async () => {
    const { link, model, analysis } = setUp();
    link.picture();
    link.picture();
    link.set({ phone: 'stopped' });
    await model.answer();
    expect(analysis.poseSamples()).toEqual([]);
    expect(model.pending).toHaveLength(0);
  });

  it('survives a store that will not keep the reference', async () => {
    const link = scriptedControl();
    const model = scriptedModel();
    const analysis = new SideAnalysis({
      control: link.control,
      estimator: model.make,
      references: {
        athleteId: ATHLETE,
        store: {
          getFramingReference: async () => Promise.resolve(undefined),
          putFramingReference: async () => Promise.reject(new Error('QuotaExceededError')),
        },
      },
    });
    for (let index = 0; index < FRAMING_CHECK_POSES; index += 1) {
      link.picture();
      await model.answer();
    }
    link.set({ phone: 'stopped' });
    await settle();
    expect(analysis.sideAnalysisState().finished).toBe(true);
  });
});

describe('a placement from many pictures', () => {
  const sample = (p: SidePose): SidePoseSample => ({ sequence: 0, milliseconds: 0, pose: p });

  it('is the median of each landmark, so one wild picture does not move it', () => {
    const placement = placementOf([sample(pose()), sample(pose()), sample(pose(0.3))]);
    expect(placement).toEqual(referenceOf(pose()));
  });

  it('keeps only landmarks seen in at least half the pictures, and only framing landmarks', () => {
    const withoutEar: SidePose = {
      ...pose(),
      landmarks: pose().landmarks.filter((mark) => mark.name !== 'ear'),
    };
    const placement = placementOf([sample(withoutEar), sample(withoutEar), sample(pose())]);
    expect(placement?.landmarks.map((mark) => mark.name)).not.toContain('ear');
    expect(placement?.landmarks.map((mark) => mark.name)).not.toContain('toe');
    const half = placementOf([sample(withoutEar), sample(pose())]);
    expect(half?.landmarks.map((mark) => mark.name)).toContain('ear');
  });

  it('is nothing for no pictures', () => {
    expect(placementOf([])).toBeUndefined();
  });
});

describe('the post-ride report (#388)', () => {
  function withReports() {
    const link = scriptedControl();
    const model = scriptedModel();
    const ended: (SideReport | undefined)[] = [];
    let begun = 0;
    const analysis = new SideAnalysis({
      control: link.control,
      estimator: model.make,
      reports: {
        beginSideReportSession: () => {
          begun += 1;
          return {
            endSideReportSession: (report) => {
              ended.push(report);
            },
          };
        },
      },
    });
    return { link, model, analysis, ended, begun: () => begun };
  }

  it('opens a report session with the pairing and hands it the report when the pairing ends', async () => {
    const { link, model, ended, begun } = withReports();
    expect(begun()).toBe(1);
    link.picture();
    await model.answer();
    expect(ended).toStrictEqual([]);
    link.set({ phone: 'stopped' });
    await settle();
    // One picture is far too short a session to compare: the report says so,
    // in words — and it IS a report, handed over, rather than nothing.
    expect(ended).toStrictEqual([{ summary: SIDE_REPORT_TOO_SHORT, observations: [] }]);
  });

  it('hands over sentences and nothing they were made from', async () => {
    const { link, model, ended } = withReports();
    link.picture();
    await model.answer();
    link.set({ ended: 'ended-here' });
    await settle();
    expect(Object.keys(ended[0] ?? {}).sort()).toStrictEqual(['observations', 'summary']);
    expect(JSON.stringify(ended)).not.toMatch(/landmarks|"x"|milliseconds|bytes/);
  });

  it('hands over "nothing to report" for a pairing that never filmed, once', async () => {
    const { link, ended } = withReports();
    link.set({ phone: 'stopped' });
    link.set({ ended: 'ended-here' });
    await settle();
    expect(ended).toStrictEqual([undefined]);
  });
});
