// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The route picker, audited — including the pacer controls #237 added to it.
 *
 * ⚠️ **This file exists because the route-level audit cannot reach these
 * controls.** `routes.a11y.test.tsx` renders every entry in `shell/routes.ts`,
 * and it renders the game screen with **no port**, so `listRoutes` never
 * resolves to anything and the screen shows the empty picker — the two links
 * #232 put there, and nothing else. Every control on this screen — the ghost
 * checkbox, the new pacer checkbox, the intensity box and the ride buttons — is
 * therefore outside the gate that looks exactly like the gate that covers them.
 * Adding controls to a screen the a11y suite renders is not the same as adding
 * controls the a11y suite audits, and this is the difference.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it, and so
 * `scripts/check-a11y-suite.mjs` would catch it if it ever stopped being
 * selected.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

function ridableRoute(id: string, name: string, attempts: number): RidableRoute {
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
  return { id, name, profile: routeProfile(points), attempts };
}

const PORT: GamePort = {
  listRoutes: () =>
    Promise.resolve([ridableRoute('a', 'Box Hill', 0), ridableRoute('b', 'Ditchling', 4)]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(0), live: false, paired: false },
    cadence: { value: undefined, live: false, paired: false },
    heartRate: { value: undefined, live: false, paired: false },
  }),
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * The picker inside the landmark it actually lives in.
 *
 * The same argument `HudPanel.a11y.test.tsx` makes: `auditAccessibility` walks
 * the whole document, and mounting a screen bare would report a missing landmark
 * the shipping shell supplies — a false failure that trains the next person to
 * loosen the audit.
 */
async function mountPicker(): Promise<Mounted> {
  const tree = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={PORT} />
    </main>,
  );
  await settle();
  return tree;
}

describe('the route picker', () => {
  it('is clean under every accessibility rule', async () => {
    mounted = await mountPicker();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('names every one of its controls, the pacer and wind ones included', async () => {
    mounted = await mountPicker();

    // Every control the rule above audits is present — if one disappeared the
    // rule would have nothing to audit and would pass. Three number boxes: the
    // pacer's intensity, and #326's wind speed and direction.
    expect(queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')).toHaveLength(3);
    for (const words of ['pacer', 'wind']) {
      expect(
        queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').filter((input) =>
          (input.closest('label')?.textContent ?? '').includes(words),
        ),
      ).toHaveLength(1);
    }
  });

  it('puts every control in the tab order, so none of them needs a pointer', async () => {
    mounted = await mountPicker();

    const reachable = tabbableElements(document);
    const controls = queryAll(mounted.container, 'input, button').filter(
      (element) => !(element as HTMLInputElement | HTMLButtonElement).disabled,
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(reachable).toContain(control);
    }
  });
});

describe('the pacer refusal reaches the rider it stops (#255)', () => {
  /**
   * Puts the picker into the state a slipped decimal point produces: a pacer
   * asked for, at an intensity `botPacerPlan` refuses.
   *
   * ⚠️ Driven through the controls rather than by rendering a refused picker
   * directly. The association being asserted is between elements that appear
   * and disappear together, and the failure mode is a **dangling**
   * `aria-describedby` — which only shows up when the state is arrived at the
   * way a rider arrives at it.
   */
  async function refused(): Promise<Mounted> {
    const tree = await mountPicker();
    const box = queryAll<HTMLInputElement>(tree.container, 'input[type="checkbox"]').find((input) =>
      (input.closest('label')?.textContent ?? '').includes('pacer'),
    );
    expect(box).toBeDefined();
    await activateWithKeyboard(box as HTMLInputElement);
    const intensity = queryAll<HTMLInputElement>(tree.container, 'input[type="number"]')[0];
    expect(intensity).toBeDefined();
    await typeInto(intensity as HTMLInputElement, '70');
    await settle();
    return tree;
  }

  function rideButtons(root: ParentNode): HTMLButtonElement[] {
    return queryAll<HTMLButtonElement>(root, 'button').filter((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
  }

  function describedText(element: Element): string {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    return ids
      .map((id) => {
        const target = document.getElementById(id);
        // ⚠️ A dangling reference is the failure this whole association can
        // have and still look correct in the markup, so it is named rather
        // than allowed to surface as `null.textContent`.
        expect(
          target,
          `aria-describedby names #${id}, which is not in the document`,
        ).not.toBeNull();
        return target?.textContent ?? '';
      })
      .join(' ');
  }

  it('describes the intensity box with the reason, and marks it invalid', async () => {
    mounted = await refused();

    const intensity = queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')[0];
    expect(intensity?.getAttribute('aria-invalid')).toBe('true');
    // The rule's own message, reached through the reference rather than found
    // by reading the page — which is what a screen reader does with it.
    expect(describedText(intensity as HTMLInputElement)).toContain('70');
  });

  it('says nothing about validity while the number is one the rule accepts', async () => {
    mounted = await mountPicker();

    const intensity = queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')[0];
    expect(intensity?.getAttribute('aria-invalid')).toBeNull();
    expect(intensity?.getAttribute('aria-describedby')).toBeNull();
  });

  it('leaves every blocked ride control in the tab order, not behind it', async () => {
    // ⚠️ The defect in #255's own words: `disabled` *"removes every ride button
    // from the tab order"*, so a rider who slips a decimal point tabs from the
    // intensity box straight past all the ride controls to whatever follows,
    // with the explanation left behind them.
    mounted = await refused();

    const reachable = tabbableElements(document);
    const buttons = rideButtons(mounted.container);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(reachable).toContain(button);
    }
  });

  it('tells the control that is blocked why it is blocked, not only the field', async () => {
    mounted = await refused();

    for (const button of rideButtons(mounted.container)) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(describedText(button)).toContain('70');
    }
  });

  it('still refuses to start the ride when the blocked control is activated', async () => {
    // `aria-disabled` is a promise to a screen reader and nothing at all to a
    // click, so the guard in the handler is the half that actually refuses.
    // Without it this change would trade an accessibility defect for a rider
    // being paced by a bot the rule rejected.
    mounted = await refused();

    const button = rideButtons(mounted.container)[0];
    expect(button).toBeDefined();
    await activateWithKeyboard(button as HTMLButtonElement);

    // Still on the picker: the ride screen has a canvas and this does not.
    expect(mounted.container.querySelector('canvas')).toBeNull();
    expect(rideButtons(mounted.container).length).toBeGreaterThan(0);
  });

  it('audits clean while refusing, which is a different tree', async () => {
    mounted = await refused();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

describe('the wind refusal reaches the rider it stops (#326)', () => {
  /**
   * Puts the picker into the state an empty wind-speed box produces: a wind
   * asked for, and no number to make one from.
   *
   * Driven through the controls for `refused`'s reason — the association being
   * asserted is between elements that appear and disappear together, and the
   * failure mode is a dangling `aria-describedby`.
   */
  async function windRefused(): Promise<Mounted> {
    const tree = await mountPicker();
    const box = queryAll<HTMLInputElement>(tree.container, 'input[type="checkbox"]').find((input) =>
      (input.closest('label')?.textContent ?? '').includes('wind'),
    );
    expect(box).toBeDefined();
    await activateWithKeyboard(box as HTMLInputElement);
    await settle();
    return tree;
  }

  /** A number box, found by the words beside it rather than by its position. */
  function boxLabelled(root: ParentNode, words: string): HTMLInputElement | undefined {
    return queryAll<HTMLInputElement>(root, 'input[type="number"]').find((input) =>
      (input.closest('label')?.textContent ?? '').includes(words),
    );
  }

  /** What a box says about its own validity, as the two attributes together. */
  function validity(
    root: ParentNode,
    words: string,
  ): { invalid: string | null; describes: string } {
    const box = boxLabelled(root, words);
    expect(box, words).toBeDefined();
    const id = box?.getAttribute('aria-describedby') ?? '';
    return {
      invalid: box?.getAttribute('aria-invalid') ?? null,
      describes: id === '' ? '' : (document.getElementById(id)?.textContent ?? ''),
    };
  }

  it('marks the box the refusal is ABOUT, and leaves the other one alone', async () => {
    mounted = await windRefused();

    // The speed box is the empty one, so it is the one that is wrong.
    expect(validity(mounted.container, 'Wind speed').invalid).toBe('true');
    expect(validity(mounted.container, 'Wind speed').describes).toMatch(/wind speed/);
    // ⚠️ And the direction box, which holds a perfectly good bearing, says
    // nothing about its own validity. Marking it too — #255's single-box
    // pattern applied to two boxes — points a screen reader at a sentence
    // about a different control, which is what WCAG 2.2 SC 3.3.1 asks a page
    // not to do.
    expect(validity(mounted.container, 'Wind direction').invalid).toBeNull();
    expect(validity(mounted.container, 'Wind direction').describes).toBe('');
  });

  it('moves the mark to the direction box when that is the box that is wrong', async () => {
    // The other way round, so neither assertion above can be passing because
    // the mark is simply pinned to the first box on the screen.
    mounted = await windRefused();
    const speed = boxLabelled(mounted.container, 'Wind speed');
    const direction = boxLabelled(mounted.container, 'Wind direction');
    expect(speed).toBeDefined();
    expect(direction).toBeDefined();
    await typeInto(speed as HTMLInputElement, '12');
    await typeInto(direction as HTMLInputElement, '3600');
    await settle();

    expect(validity(mounted.container, 'Wind direction').invalid).toBe('true');
    expect(validity(mounted.container, 'Wind direction').describes).toMatch(/wind direction/);
    expect(validity(mounted.container, 'Wind speed').invalid).toBeNull();
  });

  it('says nothing about validity while the rider has not asked for a wind', async () => {
    mounted = await mountPicker();

    const box = boxLabelled(mounted.container, 'Wind speed');
    expect(box?.getAttribute('aria-invalid')).toBeNull();
    expect(box?.getAttribute('aria-describedby')).toBeNull();
  });

  it('blocks every ride control and tells it why, without taking its tab stop', async () => {
    mounted = await windRefused();

    const reachable = tabbableElements(document);
    const buttons = queryAll<HTMLButtonElement>(mounted.container, 'button').filter((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(reachable).toContain(button);
      const ids = (button.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      expect(ids).toHaveLength(1);
      expect(document.getElementById(ids[0] ?? '')?.textContent ?? '').toMatch(/wind speed/);
    }
  });

  it('still refuses to start the ride when the blocked control is activated', async () => {
    mounted = await windRefused();

    const button = queryAll<HTMLButtonElement>(mounted.container, 'button').find((candidate) =>
      (candidate.textContent ?? '').startsWith('Ride '),
    );
    expect(button).toBeDefined();
    await activateWithKeyboard(button as HTMLButtonElement);

    // Still on the picker: the ride screen has a canvas and this does not.
    expect(mounted.container.querySelector('canvas')).toBeNull();
  });

  it('audits clean while refusing, which is a different tree again', async () => {
    mounted = await windRefused();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
