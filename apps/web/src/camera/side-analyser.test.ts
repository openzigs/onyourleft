// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which device looks at the side camera's pictures — #553, ADR 0033 D-11: its
 * own switch, off by default, and the computer only when there is one.
 */

import { describe, expect, it } from 'vitest';

import { endpointDecision, type EndpointStorage } from './analysis-endpoint';
import { ANALYSIS_PROMPTS } from './analysis-port';
import { riderAnalysisPort, type AnalysisSend } from './analysis-transport';
import {
  chooseSideAnalyser,
  readSideAnalyserOnComputer,
  SIDE_ANALYSER_CONSENT,
  SIDE_ANALYSER_STORAGE_KEY,
  writeSideAnalyserOnComputer,
} from './side-analyser';
import type { SidePoseEstimator } from './side-analysis-port';
import { sizedFrameBytes } from './testing';

function memoryStorage(): EndpointStorage & { readonly rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

const TABLET: SidePoseEstimator = {
  estimateSidePose: async () => Promise.resolve({ kind: 'no-rider' }),
  closeSidePoseModel: () => undefined,
};

function computerOn(send: AnalysisSend): ReturnType<typeof riderAnalysisPort> {
  const decision = endpointDecision({
    address: 'http://192.168.1.20:8080',
    model: 'pose',
    switchedOn: true,
  });
  return riderAnalysisPort(decision.endpoint, { send });
}

describe('the switch is off by default and is its own', () => {
  it('reads off on an empty device, a device that refuses storage, and a row that is not exactly on', () => {
    expect(readSideAnalyserOnComputer(memoryStorage())).toBe(false);
    expect(readSideAnalyserOnComputer(undefined)).toBe(false);
    const storage = memoryStorage();
    storage.rows.set(SIDE_ANALYSER_STORAGE_KEY, 'true');
    expect(readSideAnalyserOnComputer(storage)).toBe(false);
    const throwing: EndpointStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readSideAnalyserOnComputer(throwing)).toBe(false);
  });

  it('round-trips on, and switching off leaves nothing behind', () => {
    const storage = memoryStorage();
    expect(writeSideAnalyserOnComputer(true, storage)).toBe(true);
    expect(readSideAnalyserOnComputer(storage)).toBe(true);
    expect(writeSideAnalyserOnComputer(false, storage)).toBe(true);
    expect(storage.rows.size).toBe(0);
    expect(readSideAnalyserOnComputer(storage)).toBe(false);
  });

  it('says it could not keep an answer on a device that will not', () => {
    expect(writeSideAnalyserOnComputer(true, undefined)).toBe(false);
    const full: EndpointStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(writeSideAnalyserOnComputer(true, full)).toBe(false);
  });

  it('is ADR 0033 D-11’s sentence, word for word', () => {
    expect(SIDE_ANALYSER_CONSENT).toBe(
      'While the side camera is filming, every picture it takes — about five a second — goes to ' +
        'your computer, instead of being looked at on this tablet. What your computer does with ' +
        'them is up to your computer.',
    );
  });
});

describe('chooseSideAnalyser', () => {
  it('is the tablet when the switch is off, whatever computer there is', () => {
    const choice = chooseSideAnalyser({
      onComputer: () => false,
      computer: () => computerOn(async () => Promise.resolve(new Response('{}'))),
      tablet: () => TABLET,
    });
    expect(choice.place).toBe('tablet');
    expect(choice.estimator()).toBe(TABLET);
  });

  it('is the tablet when the switch is on and there is no computer to use', () => {
    const choice = chooseSideAnalyser({
      onComputer: () => true,
      computer: () => undefined,
      tablet: () => TABLET,
    });
    expect(choice.place).toBe('tablet');
    expect(choice.estimator()).toBe(TABLET);
  });

  it('is the computer when both, and each picture then goes through the one transport', async () => {
    const bodies: string[] = [];
    const send: AnalysisSend = async (_url, init) => {
      bodies.push(typeof init.body === 'string' ? init.body : '');
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"rider":false}' } }] })),
      );
    };
    const choice = chooseSideAnalyser({
      onComputer: () => true,
      computer: () => computerOn(send),
      tablet: () => TABLET,
    });
    expect(choice.place).toBe('computer');
    const estimator = choice.estimator();
    expect(estimator).not.toBe(TABLET);
    expect(await estimator.estimateSidePose(sizedFrameBytes(640, 480))).toEqual({
      kind: 'no-rider',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(JSON.stringify(ANALYSIS_PROMPTS['side-pose']).slice(1, 40));
  });

  it('stops sending the next picture when the rider switches the side camera off mid-session', async () => {
    let bodies = 0;
    const send: AnalysisSend = async () => {
      bodies += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"rider":false}' } }] })),
      );
    };
    let on = true;
    const choice = chooseSideAnalyser({
      onComputer: () => on,
      computer: () => computerOn(send),
      tablet: () => TABLET,
    });
    const estimator = choice.estimator();
    await estimator.estimateSidePose(sizedFrameBytes(640, 480));
    on = false;
    expect(await estimator.estimateSidePose(sizedFrameBytes(640, 480))).toEqual({
      kind: 'unavailable',
    });
    expect(bodies).toBe(1);
  });
});
