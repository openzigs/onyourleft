// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **AI bots in the lap race's setup, and the consent they ask for** — #2710,
 * ADR 0071 D-1 and D-5, audited inside `test:a11y` on
 * `lap-race-chooser.a11y.test.tsx`'s precedent.
 *
 * Mounted through the real `GameView`, inside the landmark and heading the
 * shell supplies, with one loop. The tactics port is a double of the
 * instance: what it was asked, and with what, is read back off it. What is
 * read of the race is what the ride shows — the standings' line on AI bots —
 * and whether the race asked the instance anything at all.
 *
 * - No instance (no port), or one that offers no model: no AI bots switch, and
 *   the race is the seeded one, asking nothing (ADR 0036 D-3 (a)).
 * - Offered: the switch, and, switched on with no consent, the consent naming
 *   the instance and its model's address (D-5.2). *Agree* records a consent
 *   naming exactly those; *Not now* turns the option off; once consented, the
 *   consent is said and can be withdrawn (D-5.4).
 * - A race chosen with AI bots and no consent rides seeded and asks nothing.
 * - A race with AI bots starts the instance's race, asks it as it goes, says
 *   so on the standings, and ends it at *End ride*. Refused at its start, it
 *   says AI bots are not available right now and asks nothing more (D-6.3).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts, type ModelTacticsInput } from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { ModelTacticsReply } from './lap-race/model-race';
import type { ModelTacticsPort, TacticsStatus } from './lap-race/model-tactics-port';
import { AI_BOTS_RACE_TEXT } from './lap-race/ride-race';
import { RACE_NOTICE_LABEL } from './room-ride';
import type { GameRenderer } from './port';
import { circuitRoute } from './route-fixtures-testing';
import { AI_BOTS_TEXT, LAP_RACE_CHOICE_TEXT } from './StageChooser';

const LOOP: RidableRoute = {
  id: 'loop',
  name: 'Park loop',
  profile: circuitRoute(60),
  attempts: 0,
};

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([LOOP]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(220), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () =>
    Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

const INSTANCE = 'https://ride.example';
const MODEL = 'http://192.168.1.20:11434/v1';

/** A double of the rider's instance: what it says, and every call it was asked. */
interface Instance {
  readonly port: ModelTacticsPort;
  readonly calls: string[];
  readonly consents: { instance: string; modelAddress: string }[];
  readonly decided: ModelTacticsInput[];
  status: TacticsStatus;
  start: ModelTacticsReply;
}

function instance(status: TacticsStatus): Instance {
  const double: Instance = {
    calls: [],
    consents: [],
    decided: [],
    status,
    start: { kind: 'answer', body: { warming: true } },
    port: {
      tacticsStatus: () => {
        double.calls.push('status');
        return Promise.resolve(double.status);
      },
      recordTacticsConsent: (consent) => {
        double.calls.push('consent');
        double.consents.push({ instance: consent.instance, modelAddress: consent.modelAddress });
        double.status = {
          kind: 'offered',
          instance: INSTANCE,
          modelAddress: MODEL,
          consented: true,
        };
        return Promise.resolve(double.status);
      },
      withdrawTacticsConsent: () => {
        double.calls.push('withdraw');
        double.status = {
          kind: 'offered',
          instance: INSTANCE,
          modelAddress: MODEL,
          consented: false,
        };
        return Promise.resolve(double.status);
      },
      startTacticsRace: () => {
        double.calls.push('start');
        return Promise.resolve(double.start);
      },
      decideTactics: (input) => {
        double.calls.push('decide');
        double.decided.push(input);
        // #2836: one bot's pick, off the menu it was offered.
        return Promise.resolve({
          kind: 'answer',
          body: { reason: 'my-terrain', move: input.you.menu[0]?.move },
        });
      },
      endTacticsRace: () => {
        double.calls.push('end');
        return Promise.resolve();
      },
    },
  };
  return double;
}

const OFFERED: TacticsStatus = {
  kind: 'offered',
  instance: INSTANCE,
  modelAddress: MODEL,
  consented: false,
};

let pending: FrameRequestCallback[] = [];
let nowMs = 1_000_000;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function game(tactics?: ModelTacticsPort): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView
        port={PORT}
        renderer={() => Promise.resolve(RENDERER)}
        now={() => nowMs}
        {...(tactics === undefined ? {} : { tactics })}
      />
    </main>,
  );
  await settle();
}

function switchNamed(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find(
    (box) => (box.closest('label')?.textContent ?? '').trim() === words,
  );
}

function button(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith(words),
  );
}

async function pump(frames: number): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    const due = pending;
    pending = [];
    nowMs += 500;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  await settle();
}

/** The race's switch on, and AI bots' switch on. */
async function chooseAiBots(): Promise<void> {
  await activateWithKeyboard(switchNamed(LAP_RACE_CHOICE_TEXT.label) as HTMLElement);
  await activateWithKeyboard(switchNamed(AI_BOTS_TEXT.label) as HTMLElement);
}

function standingsNote(): string | undefined {
  return document.querySelector('.oyl-hud__standings-note')?.textContent ?? undefined;
}

/**
 * The HUD notice that carries the same line where the standings are not drawn
 * (#2710: 1024×600 and every phone, ADR 0051 D-7), in the race notice's word.
 */
function aiBotsNotice(): string | undefined {
  return (
    [...document.querySelectorAll('.oyl-hud__notices .oyl-status')]
      // The words, without the tone's aria-hidden glyph before them.
      .map((each) => each.lastElementChild?.textContent ?? '')
      .find((text) => text.includes('AI bots'))
  );
}

/** Ride past the countdown and some seconds of race, then *End ride* and discard. */
async function rideAndEnd(): Promise<void> {
  await activateWithKeyboard(button('Ride ') as HTMLElement);
  await pump(20 + 24);
}

async function endRide(): Promise<void> {
  await act(async () => {
    button('End ride')?.click();
    await Promise.resolve();
  });
  await settle();
  await act(async () => {
    endRideAnswer(document, 'End ride')?.click();
    await Promise.resolve();
  });
  await settle();
}

describe('#2710 — AI bots in the lap race’s setup', () => {
  it('offers no AI bots with no instance, nor when the instance offers no model, and the race asks nothing', async () => {
    await game();
    await activateWithKeyboard(switchNamed(LAP_RACE_CHOICE_TEXT.label) as HTMLElement);
    expect(switchNamed(LAP_RACE_CHOICE_TEXT.items)).toBeDefined();
    expect(switchNamed(AI_BOTS_TEXT.label)).toBeUndefined();
    mounted?.unmount();
    const none = instance({ kind: 'not-offered' });
    await game(none.port);
    await activateWithKeyboard(switchNamed(LAP_RACE_CHOICE_TEXT.label) as HTMLElement);
    expect(switchNamed(AI_BOTS_TEXT.label)).toBeUndefined();
    await rideAndEnd();
    expect(standingsNote()).toBeUndefined();
    expect(aiBotsNotice()).toBeUndefined();
    expect(none.calls).toEqual(['status']);
  });

  it('asks for a consent naming the instance and its model’s address, and records exactly those', async () => {
    const home = instance(OFFERED);
    await game(home.port);
    await activateWithKeyboard(switchNamed(LAP_RACE_CHOICE_TEXT.label) as HTMLElement);
    const box = switchNamed(AI_BOTS_TEXT.label) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      AI_BOTS_TEXT.hint,
    );
    // No consent is asked before the rider chooses AI bots.
    expect(button(AI_BOTS_TEXT.agree)).toBeUndefined();
    expect(formatViolations(auditAccessibility(document))).toBe('');
    await activateWithKeyboard(box);
    const group = document.querySelector('[role="group"][aria-labelledby$="ai-consent-title"]');
    expect(group?.textContent).toContain(INSTANCE);
    expect(group?.textContent).toContain(MODEL);
    expect(group?.textContent).toContain(AI_BOTS_TEXT.consent(INSTANCE, MODEL));
    expect(formatViolations(auditAccessibility(document))).toBe('');
    await activateWithKeyboard(button(AI_BOTS_TEXT.agree) as HTMLElement);
    expect(home.consents).toEqual([{ instance: INSTANCE, modelAddress: MODEL }]);
    expect(button(AI_BOTS_TEXT.agree)).toBeUndefined();
    expect(document.body.textContent).toContain(AI_BOTS_TEXT.consented(INSTANCE, MODEL));
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // Withdrawn, the consent is asked again.
    await activateWithKeyboard(button(AI_BOTS_TEXT.withdraw) as HTMLElement);
    expect(home.calls.filter((call) => call === 'withdraw')).toHaveLength(1);
    expect(button(AI_BOTS_TEXT.agree)).toBeDefined();
  });

  it('turns AI bots off at Not now, and rides a race chosen with them and no consent seeded, asking nothing', async () => {
    const home = instance(OFFERED);
    await game(home.port);
    await chooseAiBots();
    await activateWithKeyboard(button(AI_BOTS_TEXT.notNow) as HTMLElement);
    expect(switchNamed(AI_BOTS_TEXT.label)?.checked).toBe(false);
    await activateWithKeyboard(switchNamed(AI_BOTS_TEXT.label) as HTMLElement);
    await rideAndEnd();
    expect(standingsNote()).toBeUndefined();
    expect(aiBotsNotice()).toBeUndefined();
    expect(home.calls.filter((call) => call !== 'status')).toEqual([]);
  });

  it('rides a race with AI bots: starts the instance’s race, asks it, says so, and ends it at End ride', async () => {
    const home = instance({ ...OFFERED, consented: true });
    await game(home.port);
    await chooseAiBots();
    expect(document.body.textContent).toContain(AI_BOTS_TEXT.consented(INSTANCE, MODEL));
    await rideAndEnd();
    expect(standingsNote()).toBe(AI_BOTS_RACE_TEXT.racing);
    // Through the countdown and into the race, the notice says it too; past
    // STANDING_NOTICE_SECONDS of ride it is gone, and the standings keep it.
    expect(aiBotsNotice()).toBe(`${RACE_NOTICE_LABEL}: ${AI_BOTS_RACE_TEXT.racing}`);
    await pump(10);
    expect(aiBotsNotice()).toBeUndefined();
    expect(standingsNote()).toBe(AI_BOTS_RACE_TEXT.racing);
    expect(home.calls).toContain('start');
    expect(home.decided.length).toBeGreaterThan(2);
    expect(home.calls).not.toContain('end');
    await endRide();
    expect(home.calls.filter((call) => call === 'end')).toHaveLength(1);
  });

  it('says AI bots are not available right now when the instance refuses the race, and asks nothing more (D-6.3)', async () => {
    const home = instance({ ...OFFERED, consented: true });
    home.start = { kind: 'refused', code: 'tactics_busy' };
    await game(home.port);
    await chooseAiBots();
    await rideAndEnd();
    expect(standingsNote()).toBe(AI_BOTS_RACE_TEXT.unavailable);
    expect(aiBotsNotice()).toBe(`${RACE_NOTICE_LABEL}: ${AI_BOTS_RACE_TEXT.unavailable}`);
    expect(home.decided).toEqual([]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('the consent names what the privacy policy says is sent (D-5.2)', () => {
  /**
   * The policy's list of what is sent, word for word as §AI bots and its table
   * row both give it. A change to that list leaves the policy without this
   * sentence and goes red, so {@link SENT} and the consent change with it.
   */
  const POLICY_SENT =
    "each bot's place, gaps, energy and move, and your place, who is just ahead of you, your " +
    'gaps to the racers either side of you and to each bot, whether you are drafting, and your ' +
    'watts per kilogram';
  /** Each item of {@link POLICY_SENT}, both the bots' half and the rider's, as the consent words it. */
  const SENT = [
    "each bot's place, gaps, energy and move",
    'your place',
    'who is just ahead of you',
    'your gaps',
    'whether you are drafting',
    'your watts per kilogram',
  ];
  const plain = (text: string): string => text.replace(/\s+/g, ' ').replace(/’/g, "'");

  it('names each thing sent, about the bots and about the rider, as the policy does', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const policy = plain(readFileSync(join(here, '../../../../docs/privacy-policy.md'), 'utf8'));
    expect(policy.split(POLICY_SENT).length - 1, 'the policy’s list, in §AI bots and its row').toBe(
      2,
    );
    const consent = plain(AI_BOTS_TEXT.consent(INSTANCE, MODEL));
    for (const words of SENT) {
      expect(POLICY_SENT, `the policy names ${words}`).toContain(words);
      expect(consent, `the consent names ${words}`).toContain(words);
    }
  });
});
