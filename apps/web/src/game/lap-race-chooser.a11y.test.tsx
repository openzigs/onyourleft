// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The solo lap race offered in the stage chooser — #1907, audited inside
 * `test:a11y`, on `delivery-chooser.a11y.test.tsx`'s precedent (#1818).
 *
 * Mounted through the real `GameView`, inside the landmark and heading the
 * shell supplies, with one loop and one point-to-point route. What is read is
 * what a rider reaches: on the point-to-point route, no race and the reason
 * in words; on the loop, the switch and each of the race's options, by
 * keyboard and by name; and, once *Ride* is pressed, **the race that runs**,
 * read back off the ride's own HUD and frames, never off the chooser's state:
 * its laps, its field, its bots' tier and whether it has items.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_TIER_WATTS_PER_KILOGRAM, BOT_TIERS, watts } from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  type Mounted,
} from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { BOT_TIER_TEXT } from './hud/lap-race-hud';
import { LAP_RACE_ASSIST_STORAGE_KEY } from './lap-race/assist-preference';
import { DEFAULT_LAP_RACE_CHOICE, LAP_RACE_MOST_BOTS, LAP_RACE_MOST_LAPS } from './lap-race/choice';
import type { GameRenderer, SceneFrame } from './port';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { LAP_RACE_CHOICE_TEXT } from './StageChooser';
import { writeRealisticWorldChoice } from './world-preference';

const LOOP: RidableRoute = {
  id: 'loop',
  name: 'Park loop',
  profile: circuitRoute(60),
  attempts: 0,
};
const OUT: RidableRoute = {
  id: 'out',
  name: 'Out to the coast',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([OUT, LOOP]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(220), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

/** Every frame the ride drew, and how often the realistic world was asked for. */
let drawn: SceneFrame[] = [];
let realisticAsked = 0;
const RENDERER: GameRenderer = {
  loadRealisticWorld: () => {
    realisticAsked += 1;
    return Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' });
  },
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: (frame: SceneFrame) => {
      drawn.push(frame);
    },
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let pending: FrameRequestCallback[] = [];
let nowMs = 1_000_000;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  drawn = [];
  realisticAsked = 0;
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

async function game(): Promise<Mounted> {
  mounted = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={PORT} renderer={() => Promise.resolve(RENDERER)} now={() => nowMs} />
    </main>,
  );
  await settle();
  return mounted;
}

function raceSwitch(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find((box) =>
    (box.closest('label')?.textContent ?? '').includes(LAP_RACE_CHOICE_TEXT.label),
  );
}

function itemsSwitch(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find(
    (box) => box.closest('label')?.textContent === LAP_RACE_CHOICE_TEXT.items,
  );
}

/** A form control by the text of the label that names it. */
function labelled<T extends HTMLElement>(words: string): T | undefined {
  const label = queryAll<HTMLLabelElement>(document.body, 'label').find(
    (each) => each.textContent === words,
  );
  const target = label?.htmlFor === undefined || label.htmlFor === '' ? undefined : label.htmlFor;
  return target === undefined
    ? undefined
    : ((document.getElementById(target) as T | null) ?? undefined);
}

/** The radio of one tier, by its chip's name. */
function tierRadio(name: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[type="radio"]').find(
    (radio) => radio.closest('label')?.textContent === name,
  );
}

/** The route card's radio for a route, by its name. */
function card(route: RidableRoute): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, '.oyl-chooser__card input[type="radio"]').find(
    (radio) => (radio.closest('.oyl-chooser__card')?.textContent ?? '').includes(route.name),
  );
}

/** The switch's description, as a screen reader reads it after its name. */
function described(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? `(no element ${id})`)
    .join(' ');
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
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
    });
  }
  await settle();
}

/** The lap race's HUD fields' text, in order. */
function raceFields(): string[] {
  return queryAll<HTMLElement>(document.body, '.oyl-hud__field--lap-race').map((each) =>
    (each.textContent ?? '').trim(),
  );
}

describe('#1907 — the lap race in the chooser', () => {
  it('offers no race on a point-to-point route and says why in words; offers it on the loop', async () => {
    await game();
    // The first route is chosen: the one that does not loop.
    expect(card(OUT)?.checked).toBe(true);
    expect(raceSwitch()).toBeUndefined();
    const loadout = document.querySelector('.oyl-chooser__loadout');
    expect(loadout?.textContent).toContain(LAP_RACE_CHOICE_TEXT.notALoop);
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // The loop: the switch, and no reason.
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    expect(card(LOOP)?.checked).toBe(true);
    const box = raceSwitch();
    expect(box, 'no race switch on the loop').toBeDefined();
    expect(box?.checked).toBe(false);
    expect(loadout?.textContent).not.toContain(LAP_RACE_CHOICE_TEXT.notALoop);
    expect(described(box as HTMLInputElement)).toBe(LAP_RACE_CHOICE_TEXT.hint);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('starts an ordinary ride on the point-to-point route, in the world Settings chose, though the switch was left on', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    await activateWithKeyboard(raceSwitch() as HTMLElement);
    expect(raceSwitch()?.checked).toBe(true);
    await activateWithKeyboard(card(OUT) as HTMLElement);
    await activateWithKeyboard(rideButton() as HTMLElement);
    await pump(4);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
    expect(raceFields()).toEqual([]);
    // An ordinary ride, in the world Settings chose.
    expect(realisticAsked).toBe(1);
  });

  it('labels every option and reaches each by keyboard once the race is on, with no violation', async () => {
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    const box = raceSwitch() as HTMLInputElement;
    // Off: none of the options is on the page yet.
    expect(labelled(LAP_RACE_CHOICE_TEXT.laps)).toBeUndefined();
    box.focus();
    expect(document.activeElement).toBe(box);
    await activateWithKeyboard(box);
    expect(raceSwitch()?.checked).toBe(true);
    const laps = labelled<HTMLSelectElement>(LAP_RACE_CHOICE_TEXT.laps);
    const bots = labelled<HTMLSelectElement>(LAP_RACE_CHOICE_TEXT.bots);
    expect(laps?.tagName).toBe('SELECT');
    expect(bots?.tagName).toBe('SELECT');
    expect([...(laps?.options ?? [])].map((option) => option.textContent)).toEqual(
      Array.from({ length: LAP_RACE_MOST_LAPS }, (_, index) => String(index + 1)),
    );
    expect([...(bots?.options ?? [])].map((option) => option.textContent)).toEqual(
      Array.from({ length: LAP_RACE_MOST_BOTS }, (_, index) => String(index + 1)),
    );
    expect(laps?.value).toBe(String(DEFAULT_LAP_RACE_CHOICE.laps));
    expect(bots?.value).toBe(String(DEFAULT_LAP_RACE_CHOICE.bots));
    // The tiers: a named group of four chips, each a radio named for its tier,
    // described by each tier's watts per kilogram in words.
    const group = tierRadio(BOT_TIER_TEXT.steady)?.closest('fieldset');
    expect(group?.querySelector('legend')?.textContent).toBe(LAP_RACE_CHOICE_TEXT.tier);
    expect(described(tierRadio(BOT_TIER_TEXT.hard) as HTMLInputElement)).toBe(
      `${BOT_TIERS.map((tier) => `${BOT_TIER_TEXT[tier]} ${BOT_TIER_WATTS_PER_KILOGRAM[tier].toFixed(1)}`).join(', ')} watts per kilogram.`,
    );
    for (const tier of BOT_TIERS) expect(tierRadio(BOT_TIER_TEXT[tier])).toBeDefined();
    expect(tierRadio(BOT_TIER_TEXT[DEFAULT_LAP_RACE_CHOICE.tier])?.checked).toBe(true);
    expect(itemsSwitch()?.checked).toBe(true);
    // The assisted setting: how it stands, and the way to Settings.
    const settings = queryAll<HTMLAnchorElement>(document.body, '.oyl-game__lap-race a');
    expect(settings.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      [LAP_RACE_CHOICE_TEXT.assistedLink, '#/settings'],
    ]);
    expect(document.querySelector('.oyl-game__lap-race')?.textContent).toContain(
      LAP_RACE_CHOICE_TEXT.assistedOff,
    );
    // Every one is in the tab order, in the loadout's order.
    for (const control of [
      laps,
      bots,
      tierRadio(BOT_TIER_TEXT.brisk),
      itemsSwitch(),
      settings[0],
    ]) {
      expect(control?.tabIndex, control?.outerHTML).toBe(0);
      control?.focus();
      expect(document.activeElement).toBe(control);
    }
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says nothing about the world when Settings chose the realistic one: a race rides it (#1971)', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    expect(described(raceSwitch() as HTMLInputElement)).toBe(LAP_RACE_CHOICE_TEXT.hint);
    expect(document.querySelector('.oyl-game__lap-race')?.textContent).not.toMatch(
      /standard world/i,
    );
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says the assisted setting is on when any part of it is', async () => {
    localStorage.setItem(
      LAP_RACE_ASSIST_STORAGE_KEY,
      JSON.stringify({ itemsOff: false, autoUse: true, noKnockBack: false, gentlerBots: false }),
    );
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    await activateWithKeyboard(raceSwitch() as HTMLElement);
    expect(document.querySelector('.oyl-game__lap-race')?.textContent).toContain(
      LAP_RACE_CHOICE_TEXT.assistedOn,
    );
  });

  it('turns a Delivery round off when the race is switched on, and the race off for a round: one mode a ride', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    const delivery = (): HTMLInputElement | undefined =>
      queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find((box) =>
        (box.closest('label')?.textContent ?? '').includes('Delivery'),
      );
    await activateWithKeyboard(delivery() as HTMLElement);
    expect(delivery()?.checked).toBe(true);
    await activateWithKeyboard(raceSwitch() as HTMLElement);
    expect(raceSwitch()?.checked).toBe(true);
    expect(delivery()?.checked).toBe(false);
    await activateWithKeyboard(delivery() as HTMLElement);
    expect(delivery()?.checked).toBe(true);
    expect(raceSwitch()?.checked).toBe(false);
  });

  it('names no other game in anything it says (ADR 0060 D-1.5)', async () => {
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    await activateWithKeyboard(raceSwitch() as HTMLElement);
    const said = [
      document.querySelector('.oyl-game__lap-race')?.textContent ?? '',
      ...Object.values(LAP_RACE_CHOICE_TEXT).map((each) =>
        typeof each === 'function' ? each() : each,
      ),
    ].join(' ');
    expect(said.length).toBeGreaterThan(200);
    expect(said).not.toMatch(/mario|kart|nintendo|zwift|rouvy|wahoo|systm|peloton|trainerroad/iu);
  });

  it('starts the race chosen: its laps, field, tier and items read back off the running race', async () => {
    await game();
    await activateWithKeyboard(card(LOOP) as HTMLElement);
    await activateWithKeyboard(raceSwitch() as HTMLElement);
    await chooseOption(
      labelled<HTMLSelectElement>(LAP_RACE_CHOICE_TEXT.laps) as HTMLSelectElement,
      '2',
    );
    await chooseOption(
      labelled<HTMLSelectElement>(LAP_RACE_CHOICE_TEXT.bots) as HTMLSelectElement,
      '3',
    );
    await activateWithKeyboard(tierRadio(BOT_TIER_TEXT.steady) as HTMLElement);
    await activateWithKeyboard(itemsSwitch() as HTMLElement);
    expect(itemsSwitch()?.checked).toBe(false);
    await activateWithKeyboard(rideButton() as HTMLElement);
    await pump(6);
    // The running race's HUD: the place among the rider and three bots, the
    // first of two laps, and no item field, for a race with no items.
    const fields = raceFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatch(/^Place\d of 4/u);
    expect(fields[0]).toContain('Lap 1 of 2');
    // Its standings name three bots, each of the tier chosen.
    const standings = document.querySelector('.oyl-hud__standings')?.textContent ?? '';
    for (const number of [1, 2, 3])
      expect(standings).toContain(`${BOT_TIER_TEXT.steady} bot ${String(number)}`);
    expect(standings).not.toContain('bot 4');
    expect(standings).not.toMatch(/Brisk|Hard|Fierce/u);
    // Its frames: three bots drawn, and no pick-up point or puddle, for no
    // items are in it.
    const frame = drawn.at(-1);
    expect(frame?.lapRace).toEqual({ pickUps: [], hazards: [] });
    expect(frame?.markers.filter((marker) => marker.kind === 'bot')).toHaveLength(3);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
