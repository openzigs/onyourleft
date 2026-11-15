// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The tailor pane, audited — #2305.
 *
 * - **Audited** at one pane and at two: as written, in watts, with a refusal
 *   standing, after a copy is saved, on a test that offers nothing to change
 *   and on a heart-rate session (`a11y/audit.ts`'s rules).
 * - **Every control is labelled**: each box and the length select by its own
 *   `<label>`, each stepper button by what it changes.
 * - **Refusals are announced**: a refusal is a live status inside the
 *   control's own group, so it is read out when it appears and found beside
 *   the control that caused it.
 * - **48 px targets**, declared in `theme.css` §"THE TAILOR PANE" over the
 *   select, the steppers and *Save a copy*; the laid-out boxes are
 *   `browser/controls.browser.spec.ts` §"#2305".
 * - **Both palettes**: no colour is new. The words are the page's ink and
 *   `oyl-muted`, the warnings `StatusMessage`'s, the graph the block chart's —
 *   all pairs `contrast.a11y.test.ts` and `zones.a11y.test.tsx` hold in each
 *   palette.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { watts } from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { AnalysisPort, AnalysisStore } from '../analysis/store-port';
import { chooseOption, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { answerTwoPanes } from '../testing/panes';
import { workoutStub } from '../workouts/testing';
import { WorkoutsView } from './WorkoutsView';

// `join` rather than `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const THEME = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../design/theme.css'),
  'utf8',
);

const OWNER = athleteId('athlete-a');

let mounted: Mounted | undefined;
let restore: (() => void) | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  restore?.();
  restore = undefined;
});

const RIDER: AnalysisPort = {
  athleteId: OWNER,
  store: {
    getAthlete: () =>
      Promise.resolve({ id: OWNER, thresholdPower: watts(250), thresholdHeartRate: 170 }),
  } as unknown as AnalysisStore,
};

async function screen(id: string, analysis?: AnalysisPort): Promise<HTMLElement> {
  mounted = await mount(
    <main>
      <h1>Workouts</h1>
      <WorkoutsView port={workoutStub(OWNER)} selected={`built-in:${id}`} analysis={analysis} />
    </main>,
  );
  await settle();
  const pane = document.querySelector<HTMLElement>('[data-oyl-built-in-detail]');
  if (pane === null) throw new Error('no tailor pane');
  return pane;
}

const audit = (): string => formatViolations(auditAccessibility(document));

function press(root: ParentNode, text: string): Promise<void> {
  const button = queryAll<HTMLButtonElement>(root, 'button').find(
    (each) => each.textContent === text,
  );
  if (button === undefined) throw new Error(`no button ${text}`);
  button.click();
  return settle();
}

describe('the tailor pane passes the audit — #2305', () => {
  for (const wide of [false, true]) {
    describe(wide ? 'at two panes' : 'at one pane', () => {
      it('as written, and in watts', async () => {
        restore = answerTwoPanes(wide, THEME);
        await screen('sweet-spot-3x12');
        expect(audit()).toBe('');
        mounted?.unmount();
        await screen('sweet-spot-3x12', RIDER);
        expect(audit()).toBe('');
      });

      it('with a refusal standing, and after a copy is saved', async () => {
        restore = answerTwoPanes(wide, THEME);
        const pane = await screen('sweet-spot-3x12');
        const length = pane.querySelector<HTMLSelectElement>('[data-oyl-tailor="length"] select');
        await chooseOption(length as HTMLSelectElement, '30');
        expect(audit()).toBe('');
        await chooseOption(length as HTMLSelectElement, '45');
        await press(pane, 'Save a copy');
        expect(pane.textContent).toContain('to your workouts.');
        expect(audit()).toBe('');
      });

      it('on a test ridden as written, and on a heart-rate session', async () => {
        restore = answerTwoPanes(wide, THEME);
        await screen('ramp-test', RIDER);
        expect(audit()).toBe('');
        mounted?.unmount();
        await screen('endurance-heart-rate', RIDER);
        expect(audit()).toBe('');
      });
    });
  }
});

describe('every control is labelled — #2305', () => {
  it('names each box, the select and each stepper button by what it changes', async () => {
    const pane = await screen('sweet-spot-3x12');
    const form = pane.querySelector('form');
    expect(form?.getAttribute('aria-label')).toBe('Tailor Sweet spot, three by twelve');
    const fields = queryAll<HTMLInputElement | HTMLSelectElement>(
      form as HTMLElement,
      'input, select',
    );
    expect(
      fields.map(
        (each) => document.querySelector(`label[for="${CSS.escape(each.id)}"]`)?.textContent,
      ),
    ).toEqual([
      'Length',
      'Intensity, % easier or harder',
      'Repeats',
      'Recovery between repeats, seconds',
    ]);
    expect(
      queryAll(form as HTMLElement, 'button').map((each) => each.getAttribute('aria-label')),
    ).toEqual([
      'Decrease intensity',
      'Increase intensity',
      'Decrease repeats',
      'Increase repeats',
      'Decrease recovery seconds',
      'Increase recovery seconds',
    ]);
  });
});

describe('a refusal is announced beside its control — #2305', () => {
  it('as a live status inside the control’s own group, and in no other', async () => {
    const pane = await screen('sweet-spot-3x12');
    expect(pane.querySelectorAll('[role="status"]')).toHaveLength(0);
    const length = pane.querySelector<HTMLSelectElement>('[data-oyl-tailor="length"] select');
    await chooseOption(length as HTMLSelectElement, '30');
    const said = queryAll(pane, '[role="status"]');
    expect(said).toHaveLength(1);
    expect(said[0]?.closest('[data-oyl-tailor]')?.getAttribute('data-oyl-tailor')).toBe('length');
    expect(said[0]?.textContent).toContain('can be no shorter than 40 minutes');
  });
});

describe('every control is a 48 px target — #2305', () => {
  it('declares 48 px on the select, the steppers and Save a copy', async () => {
    const pane = await screen('sweet-spot-3x12');
    expect(pane.querySelector('form')?.classList.contains('oyl-tailor')).toBe(true);
    const save = queryAll<HTMLButtonElement>(pane, 'button').find(
      (each) => each.textContent === 'Save a copy',
    );
    expect(save?.closest('.oyl-tailor__save')).not.toBeNull();
    const at = THEME.indexOf('.oyl-tailor select,');
    expect(at, 'theme.css has no rule for the tailor pane').toBeGreaterThan(-1);
    const last = 'min-inline-size: 3rem;\n}';
    expect(THEME.slice(at, THEME.indexOf(last, at) + last.length)).toBe(
      '.oyl-tailor select,\n.oyl-tailor__save .oyl-button {\n  min-height: 3rem;\n}\n\n' +
        '.oyl-tailor .oyl-stepper__step,\n.oyl-tailor .oyl-stepper > input {\n' +
        '  min-block-size: 3rem;\n}\n\n.oyl-tailor .oyl-stepper__step {\n  min-inline-size: 3rem;\n}',
    );
  });
});
