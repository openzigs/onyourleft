// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A *Set* the stall rescue held is answered, once — #655.
 *
 * ⚠️ **Through `RideView`** with the stub controller, as #445's and #598's
 * cases are: the question is which of two components speaks, and a test of
 * either alone cannot hear two voices, or none.
 *
 * The stub carries no logic, so the controller's half — that a held *Set*
 * writes nothing to the trainer and is what sets `TrainerSnapshot.ergHeld` —
 * is `controller.test.ts` §"#655", against the #44 simulator.
 *
 * What this cannot establish: that TalkBack speaks a message inserted into
 * the page once. That is `docs/validation/0003` (#393).
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TREND_WINDOW, watts } from '@onyourleft/domain';

import {
  DEFAULT_ANNOUNCEMENTS,
  writeAnnouncementPreference,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { activateWithKeyboard, mount, settle, typeInto, type Mounted } from '../testing/mount';
import { RideView } from '../views/RideView';

import type { TrainerSnapshot } from './controller';
import type { ManualErgRescue } from './manual-erg';
import { ridingSnapshot, stubRideController } from './testing';
import { WorkoutPanel } from './WorkoutPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const STALLED: ManualErgRescue = {
  target: watts(200),
  holding: 'floor',
  reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
  pending: undefined,
};

const ANSWER = `Your new target of 180 W will be set once your cadence has held steady for ${String(
  TREND_WINDOW,
)} seconds.`;

const trainerWith = (overrides: Partial<TrainerSnapshot>): TrainerSnapshot => ({
  ...ridingSnapshot().trainer,
  ...overrides,
});

/** The rescue with the rider's press held, as the real controller reports it. */
const heldAt = (press: number, target = 180): TrainerSnapshot =>
  trainerWith({
    ergRescue: { ...STALLED, pending: watts(target) },
    ergHeld: { target: watts(target), press },
  });

const region = (): Element | null => document.querySelector('[data-oyl-announcer="ride"]');
const regionText = (): string => region()?.textContent ?? '<no region>';

/** Every element that would speak by itself: a live region of any flavour. */
const voices = (): readonly Element[] => [
  ...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]'),
];
/** What an element says: its text without the `aria-hidden` glyph. */
function words(element: Element | undefined): string {
  if (element === undefined) return '<nothing>';
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? '';
}

/** The voices whose words answer the press. */
const answering = (): readonly Element[] => voices().filter((each) => words(each).includes(ANSWER));

/** The press's answer on the screen, live or not. */
const shownAnswer = (): Element | undefined =>
  [...document.querySelectorAll('.oyl-status')].find((each) => words(each) === `Held: ${ANSWER}`);

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button named ${label}`);
  return found;
}

function announcementsOn(): void {
  writeAnnouncementPreference(localStorage, { ...DEFAULT_ANNOUNCEMENTS, enabled: true });
}

async function rideInRescue(trainer: TrainerSnapshot = trainerWith({ ergRescue: STALLED })) {
  const stub = stubRideController({ ...ridingSnapshot(), workout: undefined, trainer });
  mounted = await mount(<RideView controller={stub.controller} />);
  await settle();
  return stub;
}

async function change(
  stub: ReturnType<typeof stubRideController>,
  trainer: TrainerSnapshot,
): Promise<void> {
  await act(async () => {
    stub.set({ trainer });
    await Promise.resolve();
  });
  await settle();
}

/** Type a target and press *Set target*, as a rider does. */
async function press(value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#oyl-erg-target');
  await typeInto(input as HTMLInputElement, value);
  await activateWithKeyboard(buttonNamed('Set target'));
}

describe('announcements OFF (the default): the form answers the press — #655', () => {
  it('answers a held Set once, in the form, with the one sentence and not the rescue', async () => {
    const stub = await rideInRescue();
    expect(answering()).toHaveLength(0);

    await press('180');
    expect(stub.calls.setTargetPower).toEqual([180]);
    await change(stub, heldAt(1));

    const voiced = answering();
    expect(voiced, 'answered by no voice, or by two').toHaveLength(1);
    expect(words(voiced[0])).toBe(`Held: ${ANSWER}`);
    // Not the whole rescue said again: the reason is the notice's, unvoiced.
    expect(words(voiced[0])).not.toContain('Pedalling has stopped');
    // …and the ride's one region stays out of it with announcements off.
    expect(regionText()).toBe('');
  });

  it('answers a second press of the same number again — a new message, not no change', async () => {
    const stub = await rideInRescue();
    await press('180');
    await change(stub, heldAt(1));
    const first = shownAnswer();
    expect(first?.getAttribute('role')).toBe('status');

    await press('180');
    expect(stub.calls.setTargetPower).toEqual([180, 180]);
    await change(stub, heldAt(2));

    const second = shownAnswer();
    expect(second?.getAttribute('role')).toBe('status');
    expect(second, 'the same node, so nothing new to hear').not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(answering()).toHaveLength(1);
  });

  it('says nothing on a screen that appears with the answer already standing', async () => {
    await rideInRescue(heldAt(3));

    // Shown — it is still true — but not live: no press was made here.
    expect(shownAnswer()).toBeDefined();
    expect(shownAnswer()?.getAttribute('role')).toBeNull();
    expect(answering()).toHaveLength(0);
    expect(regionText()).toBe('');
  });

  it('goes when the rescue hands back, since the target is then written', async () => {
    const stub = await rideInRescue();
    await press('180');
    await change(stub, heldAt(1));
    expect(shownAnswer()).toBeDefined();

    await change(stub, trainerWith({ target: { kind: 'confirmed', target: watts(180) } }));
    expect(shownAnswer()).toBeUndefined();
  });
});

describe('announcements ON: the ride’s one region answers the press — #655', () => {
  it('says it through the region, once, and the form shows it without a voice', async () => {
    announcementsOn();
    const stub = await rideInRescue();
    expect(regionText()).toBe('');

    await press('180');
    await change(stub, heldAt(1));

    expect(regionText()).toBe(`Held: ${ANSWER}`);
    expect(answering(), 'said by the form as well as the region').toHaveLength(1);
    expect(shownAnswer()?.getAttribute('role')).toBeNull();
  });

  it('says a second press of the same number again, as a new node in the region', async () => {
    // The region's wall clock, held by the test: `RideView` hands it no other.
    let wall = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => wall * 1000);
    announcementsOn();
    const stub = await rideInRescue();
    await press('180');
    await change(stub, heldAt(1));
    const first = region()?.firstElementChild;
    expect(first?.textContent).toBe(`Held: ${ANSWER}`);

    // Past the region's window, so the second answer is not waiting for it.
    wall += 5;
    await press('180');
    await change(stub, heldAt(2));

    const second = region()?.firstElementChild;
    expect(second?.textContent).toBe(`Held: ${ANSWER}`);
    expect(second, 'identical text in the same node is nothing to hear').not.toBe(first);
  });

  it('says nothing on a screen that appears with the answer already standing', async () => {
    announcementsOn();
    await rideInRescue(heldAt(3));
    expect(regionText()).toBe('');
    expect(answering()).toHaveLength(0);
  });
});

describe('the region owes the answer until it is said, and takes it back when false — #655', () => {
  /** The panel that holds the region, under a clock and a preference the test holds. */
  function panelAt(clock: () => number, storage: PreferenceStorage) {
    return (trainer: TrainerSnapshot) => (
      <WorkoutPanel
        trainer={trainer}
        workout={undefined}
        onStart={() => undefined}
        onEnd={() => undefined}
        announcerClock={clock}
        announcements={storage}
      />
    );
  }

  function enabledStorage(): PreferenceStorage {
    const rows = new Map<string, string>();
    const storage: PreferenceStorage = {
      getItem: (key) => rows.get(key) ?? null,
      setItem: (key, value) => {
        rows.set(key, value);
      },
    };
    writeAnnouncementPreference(storage, { ...DEFAULT_ANNOUNCEMENTS, enabled: true });
    return storage;
  }

  const refused = 'The trainer did not acknowledge the stop.';

  it('waits behind a sentence already said, and is said when the window opens', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const panel = panelAt(() => now, enabledStorage());
    mounted = await mount(panel(trainerWith({ ergRescue: STALLED })));
    await mounted.rerender(panel(trainerWith({ ergRescue: STALLED, releaseFault: refused })));
    expect(regionText()).toMatch(/^Not released:/);

    now = 101;
    await mounted.rerender(panel({ ...heldAt(1), releaseFault: refused }));
    expect(regionText()).toMatch(/^Not released:/);

    now = 110;
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(regionText()).toBe(`Held: ${ANSWER}`);
  });

  it('is not lost behind a higher sentence arriving in the same window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const panel = panelAt(() => now, enabledStorage());
    mounted = await mount(panel(trainerWith({ ergRescue: STALLED })));
    await mounted.rerender(panel(trainerWith({ ergRescue: STALLED, releaseFault: refused })));

    // The press is answered while the window is shut; control is lost before it opens.
    now = 101;
    await mounted.rerender(panel({ ...heldAt(1), releaseFault: refused }));
    now = 102;
    await mounted.rerender(panel({ ...heldAt(1), releaseFault: refused, lost: 'link-lost' }));

    now = 104;
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(regionText()).toMatch(/^Control lost:/);

    now = 108;
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(regionText()).toBe(`Held: ${ANSWER}`);
  });

  it('owes nothing with announcements off, so no timer keeps asking for it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const off: PreferenceStorage = { getItem: () => null, setItem: () => undefined };
    const panel = panelAt(() => now, off);
    mounted = await mount(panel(trainerWith({ ergRescue: STALLED })));
    // Said with announcements off too, so the window is shut behind it.
    await mounted.rerender(panel(trainerWith({ ergRescue: STALLED, releaseFault: refused })));
    expect(regionText()).toMatch(/^Not released:/);

    now = 101;
    await mounted.rerender(panel({ ...heldAt(1), releaseFault: refused }));
    now = 110;
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    // Nothing new said, and nothing left waiting to say it: the form answered.
    expect(regionText()).toMatch(/^Not released:/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not say an answer that stopped being true while it waited', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const panel = panelAt(() => now, enabledStorage());
    mounted = await mount(panel(trainerWith({ ergRescue: STALLED })));
    await mounted.rerender(panel(trainerWith({ ergRescue: STALLED, releaseFault: refused })));

    now = 101;
    await mounted.rerender(panel({ ...heldAt(1), releaseFault: refused }));
    // The rescue hands back and writes the 180 W: "will be set" is now false.
    now = 102;
    await mounted.rerender(panel(trainerWith({ releaseFault: refused })));

    now = 110;
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(regionText()).toMatch(/^Not released:/);
  });
});
