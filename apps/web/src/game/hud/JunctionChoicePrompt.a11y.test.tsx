// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's junction prompt — #2898, ADR 0088 D-3's keyboard and
 * screen-reader row and D-3.1: audited in the HUD the game mounts, its ways
 * reachable and operable by keyboard alone, its default, choice and lock
 * said by the HUD's one region, its targets at the ride-time size, the touch
 * lock kept whole, and its colours held to the tokens. What a press does to
 * the road is `JunctionChoicePrompt.test.tsx`'s. Where it lands on the stage
 * is a layout claim, measured on the ride that first mounts it (#2896).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../../a11y/audit';
import { RIDE_SIZE_CLASS } from '../../design/Button';
import { AA_TEXT, contrastRatio } from '../../design/contrast';
import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { CONTRAST_REQUIREMENTS, paletteColours, THEMES } from '../../design/tokens';
import { activateWithKeyboard, mount, type Mounted } from '../../testing/mount';
import type { JunctionChoice } from '../open-world/junction-choice';
import { newRide, theJunction } from '../open-world/junction-ride-testing';
import { announce, INITIAL_ANNOUNCER, type AnnouncerState } from './announce';
import { DEFAULT_ANNOUNCEMENTS } from './announce-preference';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';
import { JunctionHud, pressKey, textOf, wayButton, wayButtons } from './junction-prompt-testing';
import {
  JUNCTION_BY_KEY_SENTENCE,
  JUNCTION_LOCKED_LINE,
  JUNCTION_PROMPT_TITLE,
  junctionEvent,
  junctionSpoken,
  NO_JUNCTION_ANNOUNCED,
  U_TURN_NAME,
  type JunctionAnnounced,
} from './junction-text';

// A path rather than `new URL(…, import.meta.url)`: under jsdom that URL is
// not a `file:` one.
const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Each value `property` is declared with in the rules whose selector list names `selector`. */
function declared(selector: string, property: string): (string | undefined)[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values: (string | undefined)[] = [];
  for (const match of themeCss.matchAll(new RegExp(`${escaped}(?=\\s*[,{])`, 'g'))) {
    const opened = themeCss.indexOf('{', match.index);
    const closed = themeCss.indexOf('}', opened);
    const block = themeCss.slice(opened + 1, closed);
    for (const each of block.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))) {
      values.push(each[1]?.trim());
    }
  }
  return values;
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A ride 200 m before the junction, inside the prompt and before the lock. */
function before(): { choice: JunctionChoice; rider: number; ways: string[]; taken: () => string } {
  const { route, choice } = newRide();
  const junction = theJunction(route);
  const rider = junction.distance - 200;
  route.advance(rider);
  return {
    choice,
    rider,
    ways: junction.ways.map((way) => way.edge.id),
    taken: () =>
      route.legs.find((leg) => leg.start === junction.distance)?.edge.id ?? 'no way taken',
  };
}

const group = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (each) =>
      document.getElementById(each.getAttribute('aria-labelledby') ?? '')?.textContent ===
      JUNCTION_PROMPT_TITLE,
  ) ?? null;

/** A control's accessible name as its text gives it: what `aria-hidden` hides is not in it. */
function nameOf(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return textOf(copy);
}

const uTurn = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
    textOf(each).startsWith(U_TURN_NAME),
  );

describe('the junction prompt on the HUD — #2898', () => {
  it('is a group named by its title, each way a button named by its words, and audits clean', async () => {
    const { choice, rider } = before();
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);

    expect(group()).not.toBeNull();
    expect(wayButtons().map(nameOf)).toEqual([
      'Left, key left arrow, pad left button',
      'Straight on Default Chosen, key up arrow, pad bottom button',
      'Right, key right arrow, pad right button',
    ]);
    for (const each of [...wayButtons(), uTurn()]) {
      expect(each?.getAttribute('type')).toBe('button');
      // Named by its text alone (SC 2.5.3): no label that says otherwise.
      expect(each?.hasAttribute('aria-label')).toBe(false);
    }
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean once the choice is final, and says so on the ways and in words', async () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    route.advance(junction.distance - 60);
    mounted = await mount(<JunctionHud choice={choice} rider={junction.distance - 60} />);

    expect(document.body.textContent).toContain(JUNCTION_LOCKED_LINE);
    for (const each of wayButtons()) {
      expect(each.getAttribute('aria-disabled')).toBe('true');
      // Never `disabled`: it stays focusable and still shows the way taken.
      expect(each.disabled).toBe(false);
    }
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('reachable and operable by keyboard alone (ADR 0088 D-3)', () => {
  it('puts every way and the U-turn in the tab order, after Pause and End ride, left to right', async () => {
    const { choice, rider } = before();
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);

    const order = tabbableElements(document);
    const at = (element: Element | undefined): number => order.indexOf(element as HTMLElement);
    const end = order.findIndex((each) => textOf(each) === 'End ride');
    const ways = wayButtons();
    expect(ways).toHaveLength(3);
    for (const each of [...ways, uTurn()]) expect(at(each)).toBeGreaterThan(end);
    expect(ways.map(at)).toEqual([...ways.map(at)].sort((a, b) => a - b));
    expect(at(uTurn())).toBeGreaterThan(at(ways[2]));
  });

  it('chooses each way with Enter on it, or with its key, and the default is a key away', async () => {
    const { choice, rider, ways, taken } = before();
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    const [left, straight, right] = ways as [string, string, string];

    await activateWithKeyboard(wayButton(left));
    expect(taken()).toBe(left);
    expect(textOf(wayButton(left))).toContain('Chosen');
    await activateWithKeyboard(wayButton(right));
    expect(taken()).toBe(right);
    pressKey('ArrowUp');
    expect(taken()).toBe(straight);
    expect(textOf(wayButton(straight))).toContain('Default Chosen');
    pressKey('PageUp');
    expect(taken()).toBe(left);
  });

  it('takes no press once the choice is final, by key or by Enter', async () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const rider = junction.distance - 90;
    route.advance(rider);
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    const taken = () => route.legs.find((leg) => leg.start === junction.distance)?.edge.id;

    await activateWithKeyboard(wayButton(junction.ways[0]?.edge.id as string));
    pressKey('ArrowRight');
    expect(taken()).toBe(junction.defaultWay);
  });
});

describe('said by the HUD’s one region (ADR 0088 D-3)', () => {
  it('announces the junction with its default, a choice made by key, and the lock', async () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    let announcer: AnnouncerState = INITIAL_ANNOUNCER;
    let announced: JunctionAnnounced = NO_JUNCTION_ANNOUNCED;
    let sentence = '';
    const heard: string[] = [];
    const region = (): string =>
      document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';

    // A ride at 10 m a second from 260 m before the junction (past the one
    // before it, 270 m back) to 50 m before it, as the session will run each frame: the prompt, its event offered
    // to the announcer with announcements OFF (the default), what the
    // announcer said handed back, and the HUD rendered with it.
    for (let second = 0; second <= 21; second += 1) {
      const rider = junction.distance - 260 + second * 10;
      route.advance(rider);
      const step = junctionEvent(announced, choice.prompt(rider));
      const said = announce(announcer, {
        now: second,
        readings: [],
        events: step.event === undefined ? [] : [step.event],
        preference: DEFAULT_ANNOUNCEMENTS,
      });
      announcer = said.state;
      announced = junctionSpoken(step.announced, said.kind);
      if (said.sentence !== undefined) sentence = said.sentence;
      if (mounted === undefined) {
        mounted = await mount(
          <JunctionHud choice={choice} rider={rider} announcement={sentence} />,
        );
      } else {
        await mounted.rerender(
          <JunctionHud choice={choice} rider={rider} announcement={sentence} />,
        );
      }
      if (heard.at(-1) !== region()) heard.push(region());
      // 150 m before the junction, the rider turns left by key.
      if (rider === junction.distance - 150) pressKey('ArrowLeft');
    }

    expect(DEFAULT_ANNOUNCEMENTS.enabled).toBe(false);
    expect(heard).toEqual([
      '',
      'Junction ahead: left, straight on or right. The default is straight on.',
      'Chosen: left.',
      'Junction choice locked: left.',
    ]);
  });
});

describe('ride-time targets, and the touch lock kept whole (ADR 0088 D-3.1)', () => {
  it('gives every way and the U-turn a ride-time target: 48 px at the least, and the HUD’s 72 px floor', async () => {
    const { choice, rider } = before();
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);

    const controls = [...wayButtons(), uTurn() as HTMLButtonElement];
    expect(controls).toHaveLength(4);
    for (const each of controls) {
      for (const size of [each.style.minHeight, each.style.minWidth]) {
        // #669's 48 px, under #94's 72 px for a gloved rider.
        expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(48);
        expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
      }
      expect(each.classList.contains(RIDE_SIZE_CLASS), each.outerHTML).toBe(true);
      expect(each.classList.contains('oyl-hud__control'), each.outerHTML).toBe(true);
    }
  });

  it('with the lock on, a tap takes no way and a key still does; it says so, and audits clean', async () => {
    const { choice, rider, ways, taken } = before();
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    const lock = [...document.querySelectorAll('button')].find(
      (each) => each.textContent === TOUCH_LOCK_NAME,
    );
    tap(lock as HTMLButtonElement);
    const [left, straight] = ways as [string, string, string];

    tap(wayButton(left));
    expect(taken()).toBe(straight);
    // The ways still show the choice.
    expect(textOf(wayButton(straight))).toContain('Chosen');
    pressKey('ArrowLeft');
    expect(taken()).toBe(left);
    expect(document.body.textContent).toContain(JUNCTION_BY_KEY_SENTENCE);
    const note = [...document.querySelectorAll('p')].find(
      (each) => each.textContent === JUNCTION_BY_KEY_SENTENCE,
    );
    for (const each of wayButtons()) expect(each.getAttribute('aria-describedby')).toBe(note?.id);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('wraps its ways, and sets its lines in the HUD’s inks on the panel’s opaque surface', () => {
    // SC 1.4.10: three 72 px ways can be wider than a landscape phone's actions panel.
    expect(declared('.oyl-hud__junction-ways', 'flex-wrap')).toEqual(['wrap']);
    expect(declared('.oyl-hud__junction-note', 'color')).toEqual([
      'var(--oyl-color-hud-ink-muted)',
    ]);
    expect(declared('.oyl-hud__junction-title', 'color')).toEqual(['var(--oyl-color-hud-ink)']);
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    // No backing of its own to change the pair the panel declares.
    for (const selector of ['.oyl-hud__junction', '.oyl-hud__junction-prompt']) {
      expect(declared(selector, 'background')).toEqual([]);
    }
    for (const ink of ['hudInk', 'hudInkMuted'] as const) {
      const pair = CONTRAST_REQUIREMENTS.find(
        (each) => each.foreground === ink && each.background === 'hudSurface',
      );
      expect(pair?.minimum).toBeGreaterThanOrEqual(AA_TEXT);
      for (const theme of THEMES) {
        const palette = paletteColours(theme);
        expect(contrastRatio(palette[ink], palette.hudSurface)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});
