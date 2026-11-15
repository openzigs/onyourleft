// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The route editor, audited with a route open in it — #2007.
 *
 * #2007's fourth criterion: *the a11y path covers every action.* So every
 * action is made here from the keyboard alone — typed distances, the change
 * chooser, the nudges and the buttons — with the page audited after each, and
 * every control is checked to be in the tab order. `routes.a11y.test.tsx`
 * audits this route too, with no ports, which reaches only its empty sentence:
 * the same hole `RouteBuilder.a11y.test.tsx` names.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it (§4e).
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { athleteId, routeId, type RouteRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { routeStub } from '../routes/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { RouteEditorView } from './RouteEditorView';

const ATHLETE = athleteId('athlete-editing');
const ID = routeId('route-saturday');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function at(north: number, east: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(0.5 + north / 111_195),
    degreesLongitude(0.5 + east / 111_178),
  );
}

function saturday(): RouteRecord {
  return {
    id: ID,
    createdBy: ATHLETE,
    name: 'Saturday',
    profile: routeProfile([
      { position: at(0, 0), elevation: altitudeMetres(100) },
      { position: at(1_000, 200), elevation: altitudeMetres(150) },
      { position: at(2_000, 0), elevation: altitudeMetres(120) },
    ]),
    visibility: 'private',
    createdAt: unixSeconds(1_790_000_000),
    updatedAt: unixSeconds(1_790_000_000),
  };
}

/** The editor inside the landmark it ships in, for `RouteBuilder.a11y.test.tsx`'s reason. */
async function opened(): Promise<Mounted> {
  mounted = await mount(
    <main>
      <h1>Edit a route</h1>
      <RouteEditorView
        routes={routeStub(ATHLETE, [saturday()])}
        selected={ID}
        now={() => 1_800_000_000}
      />
    </main>,
  );
  await settle();
  await settle();
  return mounted;
}

function control<T extends HTMLElement>(view: Mounted, selector: string, text: string): T {
  const found = queryAll<T>(view.container, selector).find(
    (element) => (element.textContent ?? '').trim() === text,
  );
  if (found === undefined) throw new Error(`no ${selector} reading "${text}"`);
  return found;
}

function field(view: Mounted, label: string): HTMLInputElement {
  const found = queryAll<HTMLLabelElement>(view.container, 'label').find((candidate) =>
    (candidate.textContent ?? '').trim().startsWith(label),
  );
  const input = found?.control ?? found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field labelled "${label}"`);
  return input;
}

async function press(view: Mounted, label: string): Promise<void> {
  await activateWithKeyboard(control(view, 'button', label));
  await settle();
  await settle();
}

function clean(): string {
  return formatViolations(auditAccessibility(document));
}

describe('the route editor is inside the accessibility gate', () => {
  it('audits clean with a route open in it', async () => {
    await opened();
    expect(clean()).toBe('');
  });

  it('redraws a stretch from the keyboard, and audits clean after', async () => {
    const view = await opened();
    await typeInto(field(view, 'Stretch starts at'), '0.40');
    await typeInto(field(view, 'Stretch ends at'), '1.20');
    await press(view, 'Redraw this stretch');
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain('Redrew');
    expect(clean()).toBe('');
  });

  it('changes the start from the keyboard, and audits clean after', async () => {
    const view = await opened();
    await activateWithKeyboard(field(view, 'Its start'));
    await settle();
    expect(clean()).toBe('');
    await typeInto(field(view, 'It joins the route at'), '0.30');
    await press(view, 'Move the new start north');
    await press(view, 'Change the start');
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain(
      'Changed the start',
    );
    expect(clean()).toBe('');
  });

  it('changes the end from the keyboard, and audits clean after', async () => {
    const view = await opened();
    await activateWithKeyboard(field(view, 'Its end'));
    await settle();
    await typeInto(field(view, 'It joins the route at'), '1.70');
    await press(view, 'Move the new end south');
    await press(view, 'Change the end');
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain(
      'Changed the end',
    );
    expect(clean()).toBe('');
  });

  it('goes out and back, reverses, returns to start, undoes and redoes, auditing each', async () => {
    const view = await opened();
    for (const action of ['Out and back', 'Undo', 'Reverse', 'Return to start', 'Undo', 'Redo']) {
      await press(view, action);
      expect(clean(), `after ${action}`).toBe('');
    }
  });

  it('saves from the keyboard, and audits clean with the result said', async () => {
    const view = await opened();
    await press(view, 'Reverse');
    await press(view, 'Save over “Saturday”');
    expect(view.container.textContent).toContain('Saved the edit over “Saturday”');
    expect(clean()).toBe('');
  });
});

describe('every control on it is reachable by keyboard', () => {
  it('puts every control in the tab order, with none disabled', async () => {
    const view = await opened();
    await press(view, 'Reverse');
    const tabbable = new Set(tabbableElements(view.container));
    // A radio group is one tab stop; its unchecked radios are reached by the arrows.
    const controls = queryAll<HTMLElement>(view.container, 'a[href], button, input, select').filter(
      (element) =>
        !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked),
    );
    expect(controls.length).toBeGreaterThan(8);
    for (const element of controls) {
      expect(tabbable.has(element), `not in the tab order: ${element.outerHTML}`).toBe(true);
    }
  });

  it('labels every field a rider types into', async () => {
    const view = await opened();
    for (const input of queryAll<HTMLInputElement>(view.container, 'input')) {
      expect(input.labels?.length ?? 0, input.outerHTML).toBeGreaterThan(0);
    }
  });
});
