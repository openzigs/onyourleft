// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #62's accessibility criterion, on the state that matters.
 *
 * `routes.a11y.test.tsx` audits every route, and it renders `AppShell` with no
 * ports — so on the activities route it audits the *no local store* screen.
 * That state is worth auditing and it is not the interesting one: the table,
 * its per-row controls and its sort buttons only exist once there is a store,
 * and an audit that never sees them would report a clean route while the thing
 * riders use went unchecked.
 *
 * So this file audits the populated table directly. It carries the
 * `*.a11y.test.*` name, which is what `test:a11y` selects on and what
 * `check-a11y-suite` enforces — a file in this shape is in the gate without
 * anyone editing CI.
 */

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId, type ActivitySummary } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { ActivitiesView } from '../views/ActivitiesView';

import { stubLibrary } from './testing';

const OWNER = athleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function ride(id: string, name: string, hasPosition: boolean): ActivitySummary {
  return {
    id: activityId(id),
    athleteId: OWNER,
    name,
    startedAt: unixSeconds(1_700_000_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(3_725),
    movingTime: seconds(3_600),
    distance: metres(42_195),
    visibility: 'private',
    hasPosition,
    averagePower: watts(212),
    createdAt: unixSeconds(1_700_000_000),
  };
}

async function mountLibrary(): Promise<void> {
  const library = stubLibrary(OWNER, [
    ride('outdoor', 'Tuesday hills', true),
    ride('indoor', 'Zwift hour', false),
  ]);
  mounted = await mount(
    <main>
      <h1>Activities</h1>
      <ActivitiesView library={library} />
    </main>,
  );
  await settle();
}

describe('the activity library, populated', () => {
  it('has no accessibility violations', async () => {
    await mountLibrary();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toStrictEqual([]);
  });

  it('puts every control in the tab order, including one per row', async () => {
    // A delete button reachable only by pointer is #48's first criterion
    // failing quietly: the control is there, it is just not operable.
    await mountLibrary();

    const tabbable = tabbableElements(document.body);
    const buttons = queryAll<HTMLButtonElement>(document.body, 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) {
      expect(tabbable).toContain(button);
    }
  });

  it('names each row control by its ride, not just “Delete”', async () => {
    // Six identical "Delete" buttons is a list a screen reader cannot navigate:
    // the name has to say which ride. `VisuallyHidden` carries the name so the
    // visible column stays narrow.
    await mountLibrary();

    const names = queryAll<HTMLButtonElement>(document.body, 'tbody button').map(
      (button) => button.textContent ?? '',
    );
    expect(names.some((name) => name.includes('Tuesday hills'))).toBe(true);
    expect(names.some((name) => name.includes('Zwift hour'))).toBe(true);
  });

  it('states the indoor case in words rather than by an absent element', async () => {
    // #48's sixth criterion: nothing meaning-bearing may be carried by colour
    // or by a gap alone. An indoor ride is the common case here.
    await mountLibrary();

    const indoorRow = queryAll(document.body, 'tbody tr').find((row) =>
      (row.textContent ?? '').includes('Zwift hour'),
    );
    expect(indoorRow?.textContent).toContain('indoor');
  });

  it('keeps the confirmation reachable and announced when a delete is armed', async () => {
    await mountLibrary();
    const remove = queryAll<HTMLButtonElement>(document.body, 'tbody button')[0];
    await activateWithKeyboard(remove as HTMLElement);
    await settle();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toStrictEqual([]);
    expect(document.body.textContent).toContain('cannot be undone');
  });
});
