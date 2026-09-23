// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The deadline is the screen's, a late answer still wins, and a newer question
 * is never overwritten by an older answer — #387, the precedent being
 * `support/useShellSupport.ts`.
 */

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import type { AnalysisCall, AnalysisOutcome, UntrustedText } from './analysis-port';
import { useAnalysis, type AnalysisSchedule, type PictureAsker } from './useAnalysis';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function inAct(work: () => void): Promise<void> {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

/** An asker whose answers a test settles by hand, recording cancellations. */
function manualAsker(): {
  readonly asker: PictureAsker;
  readonly answer: (index: number, outcome: AnalysisOutcome) => void;
  readonly cancelled: number[];
} {
  const settles: ((outcome: AnalysisOutcome) => void)[] = [];
  const cancelled: number[] = [];
  return {
    cancelled,
    answer: (index, outcome) => {
      settles[index]?.(outcome);
    },
    asker: {
      askAboutPicture: (): AnalysisCall => {
        const index = settles.length;
        const outcome = new Promise<AnalysisOutcome>((resolve) => {
          settles.push(resolve);
        });
        return {
          outcome,
          cancel: () => {
            cancelled.push(index);
          },
        };
      },
    },
  };
}

/** A schedule whose deadlines a test fires by hand. */
function manualDeadline(): { readonly schedule: AnalysisSchedule; fire: () => void } {
  const pending = new Set<() => void>();
  return {
    schedule: (callback) => {
      pending.add(callback);
      return () => {
        pending.delete(callback);
      };
    },
    fire: () => {
      for (const callback of [...pending]) {
        pending.delete(callback);
        callback();
      }
    },
  };
}

const READY = { kind: 'described', description: 'ready' as UntrustedText } as const;

function Probe(props: {
  readonly asker: PictureAsker;
  readonly schedule: AnalysisSchedule;
}): JSX.Element {
  const { state, ask } = useAnalysis(props.asker, { schedule: props.schedule });
  return (
    <>
      <output>{JSON.stringify(state)}</output>
      <button
        type="button"
        onClick={() => {
          ask('connection-check');
        }}
      >
        ask
      </button>
    </>
  );
}

function shown(): unknown {
  return JSON.parse(document.querySelector('output')?.textContent ?? 'null');
}

async function press(): Promise<void> {
  await inAct(() => {
    document.querySelector('button')?.click();
  });
}

describe('useAnalysis', () => {
  it('is idle, then asking, then answered — and keeps no words', async () => {
    const { asker, answer } = manualAsker();
    mounted = await mount(<Probe asker={asker} schedule={manualDeadline().schedule} />);
    expect(shown()).toStrictEqual({ kind: 'idle' });
    await press();
    expect(shown()).toStrictEqual({ kind: 'asking' });
    await inAct(() => {
      answer(0, READY);
    });
    await settle();
    expect(shown()).toStrictEqual({ kind: 'answered', understood: true, characters: 5 });
  });

  it('says there is no answer yet when the deadline passes', async () => {
    const { asker } = manualAsker();
    const deadline = manualDeadline();
    mounted = await mount(<Probe asker={asker} schedule={deadline.schedule} />);
    await press();
    await inAct(() => {
      deadline.fire();
    });
    expect(shown()).toStrictEqual({ kind: 'failed', failure: 'no-answer' });
  });

  it('lets a late answer replace "no answer yet", and does not abandon the request', async () => {
    const { asker, answer, cancelled } = manualAsker();
    const deadline = manualDeadline();
    mounted = await mount(<Probe asker={asker} schedule={deadline.schedule} />);
    await press();
    await inAct(() => {
      deadline.fire();
    });
    expect(cancelled).toStrictEqual([]);
    await inAct(() => {
      answer(0, READY);
    });
    await settle();
    expect(shown()).toMatchObject({ kind: 'answered', understood: true });
  });

  it('never lets an older answer overwrite a newer question', async () => {
    const { asker, answer, cancelled } = manualAsker();
    mounted = await mount(<Probe asker={asker} schedule={manualDeadline().schedule} />);
    await press();
    await press();
    // The first was cancelled when the second was asked…
    expect(cancelled).toStrictEqual([0]);
    // …and even if it answers anyway, the screen is the second's.
    await inAct(() => {
      answer(0, { kind: 'described', description: 'not ready at all' as UntrustedText });
    });
    await settle();
    expect(shown()).toStrictEqual({ kind: 'asking' });
    await inAct(() => {
      answer(1, { kind: 'failed', failure: 'unreachable' });
    });
    await settle();
    expect(shown()).toStrictEqual({ kind: 'failed', failure: 'unreachable' });
  });

  it('cancels the request when the screen goes away', async () => {
    const { asker, cancelled } = manualAsker();
    mounted = await mount(<Probe asker={asker} schedule={manualDeadline().schedule} />);
    await press();
    mounted.unmount();
    mounted = undefined;
    expect(cancelled).toStrictEqual([0]);
  });

  it('reads an answer that is not the word as not understood, keeping only its length', async () => {
    const { asker, answer } = manualAsker();
    mounted = await mount(<Probe asker={asker} schedule={manualDeadline().schedule} />);
    await press();
    await inAct(() => {
      answer(0, { kind: 'described', description: 'A person on a bike.' as UntrustedText });
    });
    await settle();
    expect(shown()).toStrictEqual({ kind: 'answered', understood: false, characters: 19 });
    expect(document.body.textContent).not.toContain('person');
  });
});
