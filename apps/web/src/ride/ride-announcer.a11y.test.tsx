// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Ride screen's one announcement region — #445.
 *
 * ⚠️ **Through `RideView`**, the component `AppShell` renders at `#/`, driven by
 * the stub controller every other Ride-screen test uses — not a `RideAnnouncer`
 * handed props. The defect #445 is about is between components: `TrainerPanel`
 * and `WorkoutPanel` each speaking for themselves beside the announcer's
 * throttle. A test of either alone cannot see two voices.
 *
 * What this cannot establish, stated rather than implied: that TalkBack in the
 * Capacitor WebView speaks what lands in the region, once. That is
 * `docs/validation/0003` (#393), and #445's PR body carries the step.
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CADENCE_SILENT_REASON,
  expandWorkout,
  RECOVERING_REASON,
  RELIEF_SHARE,
  seconds,
  thresholdShare,
  type WorkoutBlock,
  watts,
  type WorkoutRescue,
} from '@onyourleft/domain';

import { mount, settle, type Mounted } from '../testing/mount';
import { RideView } from '../views/RideView';
import { WorkoutPanel } from './WorkoutPanel';

import type { RideSnapshot, RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import type { ManualErgRescue } from './manual-erg';
import { ridingSnapshot, stubRideController } from './testing';

const blocks: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
];

const workout = (overrides: Partial<RideWorkoutSnapshot> = {}): RideWorkoutSnapshot => ({
  name: 'Sweet spot',
  status: 'running',
  elapsedSeconds: 120,
  totalSeconds: 600,
  holdingWatts: 150,
  nowRiding: '10 min at 60%',
  fault: undefined,
  rescue: undefined,
  timeline: expandWorkout({ name: 'Sweet spot', blocks }),
  ...overrides,
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const region = (): string =>
  document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';

/** Every element that would speak by itself: a live region of any flavour. */
const voices = (): readonly Element[] => [
  ...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]'),
];

async function ride(): Promise<ReturnType<typeof stubRideController>> {
  const stub = stubRideController({ ...ridingSnapshot(), workout: workout() });
  mounted = await mount(<RideView controller={stub.controller} />);
  await settle();
  return stub;
}

async function change(
  stub: ReturnType<typeof stubRideController>,
  next: Partial<RideSnapshot>,
): Promise<void> {
  await act(async () => {
    stub.set(next);
    await Promise.resolve();
  });
  await settle();
}

const trainerWith = (overrides: Partial<TrainerSnapshot>): TrainerSnapshot => ({
  ...ridingSnapshot().trainer,
  ...overrides,
});

describe('"Control lost" is spoken once, by the one region — #445', () => {
  it('says it when control goes, in the words the panel shows', async () => {
    const stub = await ride();
    expect(region()).toBe('');

    await change(stub, { trainer: trainerWith({ hasControl: false, lost: 'permission-lost' }) });

    expect(region()).toMatch(/^Control lost: The trainer took control back/);
  });

  it('still SHOWS it, and the message itself is no longer a second voice', async () => {
    const stub = await ride();
    await change(stub, { trainer: trainerWith({ hasControl: false, lost: 'permission-lost' }) });

    const shown = [...document.querySelectorAll('.oyl-status')].find((each) =>
      (each.textContent ?? '').includes('Control lost:'),
    );
    expect(shown, 'a sighted rider can no longer see "Control lost"').toBeDefined();
    expect(shown?.getAttribute('role'), '"Control lost" speaks for itself as well').toBeNull();
    expect(
      voices().filter((each) => (each.textContent ?? '').includes('Control lost')),
      'said by more than one region',
    ).toHaveLength(1);
  });

  it('is said even when losing the link makes the trainer uncontrollable in the same instant', async () => {
    // ⚠️ The state `WorkoutPanel` used to render NOTHING in. A region that
    // unmounted, or moved to a different parent, here would forget what it had
    // seen and say nothing — which is why it is the first child of a fragment.
    const stub = await ride();
    await change(stub, {
      trainer: trainerWith({ hasControl: false, controllable: false, lost: 'link-lost' }),
    });

    expect(region()).toMatch(/^Control lost: The connection to the trainer dropped/);
  });

  it('says a release the trainer did not acknowledge, and shows it too', async () => {
    const stub = await ride();
    await change(stub, {
      trainer: trainerWith({ releaseFault: 'The trainer may still be holding resistance.' }),
    });

    expect(region()).toBe('Not released: The trainer may still be holding resistance.');
    expect(document.body.textContent).toContain('The trainer may still be holding resistance.');
  });

  it('is not announced again on a screen that appears with control already lost', async () => {
    const stub = stubRideController({
      ...ridingSnapshot(),
      trainer: trainerWith({ hasControl: false, lost: 'permission-lost' }),
    });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();

    expect(region()).toBe('');
  });
});

describe('one region while riding — #395, #445', () => {
  it('is exactly ONE live region with control lost AND a workout fault standing', async () => {
    const stub = await ride();
    await change(stub, {
      trainer: trainerWith({ hasControl: false, lost: 'permission-lost' }),
      workout: workout({ status: 'paused', fault: 'The trainer refused that target.' }),
    });

    // Both are on the screen…
    expect(document.body.textContent).toContain('Control lost');
    expect(document.body.textContent).toContain('The trainer refused that target.');
    // …and one thing speaks.
    expect(voices()).toHaveLength(1);
    expect(voices()[0]?.getAttribute('data-oyl-announcer')).toBe('ride');
  });

  it('says the HIGHER of two things arriving together, and drops the lower', async () => {
    const stub = await ride();
    await change(stub, {
      trainer: trainerWith({ hasControl: false, lost: 'permission-lost' }),
      workout: workout({ status: 'paused', fault: 'The trainer refused that target.' }),
    });

    // Rank 1 over rank 2…
    expect(region()).toMatch(/^Control lost/);
  });

  it('never says the dropped one afterwards: dropped, not queued', async () => {
    const stub = await ride();
    // The Ride screen passes no clock, so the one it reads is `performance`.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    await act(async () => {
      stub.set({
        trainer: trainerWith({ hasControl: false, lost: 'permission-lost' }),
        workout: workout({ status: 'paused', fault: 'The trainer refused that target.' }),
      });
      await Promise.resolve();
    });
    expect(region()).toMatch(/^Control lost/);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    // …and ten seconds of open windows later, the fault has not been said.
    expect(region()).toMatch(/^Control lost/);
  });
});

describe('a sentence waiting for the window is said when it opens — #445', () => {
  /**
   * ⚠️ **The case the workout's old clock could not serve.** Losing control
   * pauses the workout, and the workout's clock stands still while it is
   * paused, so on that clock a "Control lost" arriving within three seconds of
   * the block change would have waited for ever. On the wall clock, with a
   * timer to re-ask the core when nothing re-renders, it is said.
   */
  it('says "Control lost" three seconds after the block change it arrived behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const trainer = ridingSnapshot().trainer;
    const panel = (t: TrainerSnapshot, w: RideWorkoutSnapshot) => (
      <WorkoutPanel
        trainer={t}
        workout={w}
        onStart={() => undefined}
        onEnd={() => undefined}
        announcerClock={() => now}
      />
    );
    mounted = await mount(panel(trainer, workout()));
    await mounted.rerender(panel(trainer, workout({ nowRiding: '5 min at 95%' })));
    expect(region()).toBe('Now: 5 min at 95%');

    now = 101;
    await mounted.rerender(
      panel(
        { ...trainer, hasControl: false, lost: 'permission-lost' },
        workout({ nowRiding: '5 min at 95%', status: 'paused' }),
      ),
    );
    // Inside the window: waiting, not said, and not lost.
    expect(region()).toBe('Now: 5 min at 95%');

    now = 103.5;
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(region()).toMatch(/^Control lost: The trainer took control back/);
  });
});

describe('a workout’s eased target is said when it appears and when its reason changes — #585', () => {
  const STALLED: WorkoutRescue = {
    kind: 'floor',
    reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
  };
  const SILENT: WorkoutRescue = { kind: 'floor', reason: CADENCE_SILENT_REASON };
  const RECOVERING: WorkoutRescue = {
    kind: 'relief',
    share: RELIEF_SHARE,
    reason: RECOVERING_REASON,
  };

  it('says the stall through the one region, and shows it without a second voice', async () => {
    const stub = await ride();
    await change(stub, { workout: workout({ rescue: STALLED }) });

    expect(region()).toMatch(/^Eased: Pedalling has stopped/);
    expect(region()).toContain('Press End workout to leave it.');
    expect(
      voices().filter((each) => (each.textContent ?? '').includes('Pedalling has stopped')),
      'said by more than one region',
    ).toHaveLength(1);
    const shown = [...document.querySelectorAll('.oyl-status')].find((each) =>
      (each.textContent ?? '').includes('Pedalling has stopped'),
    );
    expect(shown, 'a sighted rider cannot see why it is eased').toBeDefined();
  });

  it('says the silent sensor when the reason changes, and nothing when it clears', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const trainer = ridingSnapshot().trainer;
    const panel = (w: RideWorkoutSnapshot) => (
      <WorkoutPanel
        trainer={trainer}
        workout={w}
        onStart={() => undefined}
        onEnd={() => undefined}
        announcerClock={() => now}
      />
    );
    mounted = await mount(panel(workout()));
    await mounted.rerender(panel(workout({ rescue: STALLED })));
    expect(region()).toMatch(/^Eased: Pedalling has stopped/);

    now = 110;
    await mounted.rerender(panel(workout({ rescue: SILENT })));
    expect(region()).toMatch(/^Eased: No cadence is being reported/);

    now = 120;
    await mounted.rerender(panel(workout({ rescue: RECOVERING })));
    expect(region()).toMatch(/^Eased: Cadence is recovering/);

    now = 130;
    await mounted.rerender(panel(workout({ rescue: undefined })));
    // Clearing is felt, not said: the region keeps its last sentence.
    expect(region()).toMatch(/^Eased: Cadence is recovering/);
  });

  it('does not say a rescue that cleared while its sentence was waiting — PR #599, N1', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const trainer = ridingSnapshot().trainer;
    const panel = (w: RideWorkoutSnapshot) => (
      <WorkoutPanel
        trainer={trainer}
        workout={w}
        onStart={() => undefined}
        onEnd={() => undefined}
        announcerClock={() => now}
      />
    );
    mounted = await mount(panel(workout()));
    // Something said at 100, so the window is shut when the rescue arrives.
    await mounted.rerender(panel(workout({ fault: 'The trainer did not answer.' })));
    expect(region()).toMatch(/^Heads up: The trainer did not answer/);

    now = 101;
    await mounted.rerender(
      panel(workout({ fault: 'The trainer did not answer.', rescue: STALLED })),
    );
    now = 102;
    await mounted.rerender(panel(workout({ fault: 'The trainer did not answer.' })));

    // The window opens, and the timer that was waiting for it fires.
    now = 110;
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(region()).toMatch(/^Heads up: The trainer did not answer/);
  });

  it('is not announced again on a screen that appears with the target already eased', async () => {
    const stub = stubRideController({ ...ridingSnapshot(), workout: workout({ rescue: STALLED }) });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();

    expect(region()).toBe('');
    expect(document.body.textContent).toContain('Pedalling has stopped');
  });
});

describe('a hand-set ERG target that is eased is said, as the workout’s is — #598', () => {
  /**
   * ⚠️ **Keyed on the REASON, not on the whole sentence**, which is #598's
   * own wording. The panel's sentence also names a target the rider set
   * during the rescue; only what the MACHINE is doing, and why, is said again.
   */
  const STALLED: ManualErgRescue = {
    target: watts(200),
    holding: 'floor',
    reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
    pending: undefined,
  };
  const SILENT: ManualErgRescue = { ...STALLED, reason: CADENCE_SILENT_REASON };
  const RECOVERING: ManualErgRescue = {
    ...STALLED,
    holding: 'relief',
    reason: RECOVERING_REASON,
  };

  async function manualRide(): Promise<ReturnType<typeof stubRideController>> {
    const stub = stubRideController({ ...ridingSnapshot(), workout: undefined });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();
    return stub;
  }

  it('says the stall through the one region, in the words the panel shows', async () => {
    const stub = await manualRide();
    expect(region()).toBe('');

    await change(stub, { trainer: trainerWith({ ergRescue: STALLED }) });

    expect(region()).toMatch(/^Eased: Pedalling has stopped/);
    expect(region()).toContain('Your 200 W comes back by itself');
    expect(region()).toContain('Press End ERG to leave it off.');
    expect(
      voices().filter((each) => (each.textContent ?? '').includes('Pedalling has stopped')),
      'said by more than one region',
    ).toHaveLength(1);
    const shown = [...document.querySelectorAll('.oyl-status')].find((each) =>
      (each.textContent ?? '').includes('Pedalling has stopped'),
    );
    expect(shown?.textContent, 'the panel and the region say different things').toContain(
      region().slice('Eased: '.length),
    );
  });

  /** The Ride screen's panel under a clock the test holds, as #585's cases do. */
  function panelAt(clock: () => number) {
    return (trainer: TrainerSnapshot) => (
      <WorkoutPanel
        trainer={trainer}
        workout={undefined}
        onStart={() => undefined}
        onEnd={() => undefined}
        announcerClock={clock}
      />
    );
  }

  it('says it again when the reason changes, and nothing when it clears', async () => {
    let now = 100;
    const panel = panelAt(() => now);
    mounted = await mount(panel(trainerWith({})));
    await mounted.rerender(panel(trainerWith({ ergRescue: STALLED })));
    expect(region()).toMatch(/^Eased: Pedalling has stopped/);

    now = 110;
    await mounted.rerender(panel(trainerWith({ ergRescue: SILENT })));
    expect(region()).toMatch(/^Eased: No cadence is being reported/);

    now = 120;
    await mounted.rerender(panel(trainerWith({ ergRescue: RECOVERING })));
    expect(region()).toMatch(/^Eased: Cadence is recovering/);

    now = 130;
    await mounted.rerender(panel(trainerWith({ ergRescue: undefined })));
    // Clearing is felt, not said: the region keeps its last sentence.
    expect(region()).toMatch(/^Eased: Cadence is recovering/);
  });

  it('is not said again when only the rider’s pending target changes', async () => {
    let now = 100;
    const panel = panelAt(() => now);
    mounted = await mount(panel(trainerWith({})));
    await mounted.rerender(panel(trainerWith({ ergRescue: STALLED })));
    expect(region()).toContain('Your 200 W comes back by itself');

    now = 110;
    await mounted.rerender(panel(trainerWith({ ergRescue: { ...STALLED, pending: watts(180) } })));
    // Not the rescue said again for the rider's own *Set* — which is, today,
    // said by nothing at all (see `RideAnnouncer.tsx` §`Seen.manualReason`).
    expect(region()).toContain('Your 200 W comes back by itself');
  });

  it('does not say a rescue that cleared while its sentence was waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const panel = panelAt(() => now);
    const refused = 'The trainer did not acknowledge the stop.';
    mounted = await mount(panel(trainerWith({})));
    // Something said at 100, so the window is shut when the rescue arrives.
    await mounted.rerender(panel(trainerWith({ releaseFault: refused })));
    expect(region()).toMatch(/^Not released:/);

    now = 101;
    await mounted.rerender(panel(trainerWith({ releaseFault: refused, ergRescue: STALLED })));
    now = 102;
    await mounted.rerender(panel(trainerWith({ releaseFault: refused })));

    // The window opens, and the timer that was waiting for it fires.
    now = 110;
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(region()).toMatch(/^Not released:/);
  });

  it('is not announced again on a screen that appears with the target already eased', async () => {
    const stub = stubRideController({
      ...ridingSnapshot(),
      workout: undefined,
      trainer: trainerWith({ ergRescue: STALLED }),
    });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();

    expect(region()).toBe('');
    expect(document.body.textContent).toContain('Pedalling has stopped');
  });
});
