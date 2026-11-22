// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The AI pacer's switch and its consent on the picker, audited — #2712, ADR
 * 0072 D-1. With the pacer on and an instance that offers a local model: the
 * switch, the consent sentence naming the instance and the model address, and
 * its button; then, agreed, the sentence that says so and the withdraw
 * button. Each tree audits clean and every control is in the tab order.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations, keyboardReachableElements } from '../a11y/audit';
import type { PacerPort, PacerStatus } from '../instance/pacer-port';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';

function ridableRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id: 'a', name: 'Quarry climb', profile: routeProfile(points), attempts: 0 };
}

/** An instance that offers a local model: `agreed`, the rider's consent as it stands; `warmed` counts the warm-ups. */
function offering(agreed = false, warmed: { count: number } = { count: 0 }): PacerPort {
  let consented = agreed;
  const status = (): PacerStatus => ({
    kind: 'offered',
    instance: 'https://ride.example',
    modelAddress: 'http://127.0.0.1:11434/v1',
    consented,
  });
  return {
    offered: () => true,
    pacerStatus: () => Promise.resolve(status()),
    consentToPacer: () => {
      consented = true;
      return Promise.resolve(status());
    },
    withdrawPacerConsent: () => {
      consented = false;
      return Promise.resolve(status());
    },
    warmPacer: () => {
      warmed.count += 1;
      return Promise.resolve(true);
    },
    startPacerRide: () => Promise.resolve(true),
    decidePacer: () => Promise.resolve({ kind: 'failed' }),
    endPacerRide: () => Promise.resolve(),
  };
}

const port = (aiPacer: PacerPort = offering()): GamePort => ({
  listRoutes: () => Promise.resolve([ridableRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(0), live: false, paired: false },
    cadence: { value: undefined, live: false, paired: false },
    heartRate: { value: undefined, live: false, paired: false },
  }),
  aiPacer,
});

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function switchNamed(root: ParentNode, words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(root, 'input[type="checkbox"]').find((input) =>
    (input.closest('label')?.textContent ?? '').includes(words),
  );
}

function buttonNamed(root: ParentNode, words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(root, 'button').find(
    (button) => (button.textContent ?? '') === words,
  );
}

async function aiPacerOn(aiPacer?: PacerPort): Promise<Mounted> {
  const tree = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={port(aiPacer)} />
    </main>,
  );
  await settle();
  await activateWithKeyboard(switchNamed(tree.container, 'Ride against a pacer') as HTMLElement);
  await settle();
  const ai = switchNamed(tree.container, 'Let the AI on your server coach you through the pacer');
  expect(ai).toBeDefined();
  await activateWithKeyboard(ai as HTMLElement);
  await settle();
  await settle();
  return tree;
}

describe('the AI pacer on the picker — #2712', () => {
  it('is not drawn until the pacer is on', async () => {
    mounted = await mount(<GameView port={port()} />);
    await settle();
    expect(switchNamed(mounted.container, 'Let the AI')).toBeUndefined();
  });

  it('asks for consent naming the place, reachable by keyboard, and audits clean', async () => {
    mounted = await aiPacerOn();
    const text = mounted.container.textContent ?? '';
    expect(text).toContain('http://127.0.0.1:11434/v1');
    expect(text).toContain('https://ride.example');
    const allow = buttonNamed(mounted.container, 'Allow the AI pacer');
    expect(allow).toBeDefined();
    expect(keyboardReachableElements(document)).toContain(allow);
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('says it is on once agreed, offers the withdrawal, and audits clean', async () => {
    mounted = await aiPacerOn();
    await activateWithKeyboard(buttonNamed(mounted.container, 'Allow the AI pacer') as HTMLElement);
    await settle();
    await settle();
    expect(mounted.container.textContent).toContain('The AI will coach you on this ride.');
    const withdraw = buttonNamed(mounted.container, 'Withdraw consent');
    expect(withdraw).toBeDefined();
    expect(keyboardReachableElements(document)).toContain(withdraw);
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);

    await activateWithKeyboard(withdraw as HTMLElement);
    await settle();
    await settle();
    expect(buttonNamed(mounted.container, 'Allow the AI pacer')).toBeDefined();
  });
});

describe('the model is warmed from the ride menu, not at “Go” — #2835, ADR 0083 D-4', () => {
  it('warms it when the switch goes on and the rider had already agreed', async () => {
    const warmed = { count: 0 };
    mounted = await aiPacerOn(offering(true, warmed));
    expect(mounted.container.textContent).toContain('The AI will coach you on this ride.');
    expect(warmed.count).toBe(1);
  });

  it('sends nothing before the rider has agreed, and warms it once they do', async () => {
    const warmed = { count: 0 };
    mounted = await aiPacerOn(offering(false, warmed));
    expect(warmed.count).toBe(0);
    await activateWithKeyboard(buttonNamed(mounted.container, 'Allow the AI pacer') as HTMLElement);
    await settle();
    await settle();
    expect(warmed.count).toBe(1);
  });
});
