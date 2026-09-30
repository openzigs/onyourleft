// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Moderation screen (#955), over the scripted port in
 * `instance/testing.ts`. `instance/moderation-port.test.ts` is where the port
 * meets a real instance; this is what the screen does with its answers. The
 * route is audited, over both walk fixtures, by `a11y/routes.a11y.test.tsx`,
 * and laid out at 320 px by `browser/reflow.browser.spec.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { NOTHING_CHANGED_TEXT } from '../instance/moderation-port';
import {
  scriptedModeration,
  SCRIPTED_MODERATOR,
  type ScriptedModeration,
} from '../instance/testing';
import { activateWithKeyboard, mount, settle, typeInto, type Mounted } from '../testing/mount';
import {
  ACTION_DONE_TEXT,
  actionLabel,
  MODERATION_IS_LOGGED,
  MODERATION_NO_PORT,
  MODERATION_STANDING_TEXT,
  ModerationView,
  REPORT_CONFLICT_TEXT,
} from './ModerationView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function text(root: ParentNode | undefined = mounted?.container): string {
  return (root?.textContent ?? '').replace(/\s+/g, ' ');
}

function container(): HTMLElement {
  if (mounted === undefined) throw new Error('nothing mounted');
  return mounted.container;
}

/** The list item whose heading is `heading`. */
function item(heading: string): HTMLLIElement {
  const found = [...container().querySelectorAll('li')].find(
    (each) => each.querySelector('h3')?.textContent === heading,
  );
  if (found === undefined) throw new Error(`no item headed ${heading}`);
  return found;
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((each) => each.textContent === name);
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

function section(heading: string): HTMLElement {
  const found = [...container().querySelectorAll('section')].find(
    (each) => each.querySelector('h2')?.textContent === heading,
  );
  if (found === undefined) throw new Error(`no ${heading} section`);
  return found;
}

async function open(scripted: ScriptedModeration): Promise<void> {
  mounted = await mount(<ModerationView port={scripted.port} />);
  await settle();
}

async function decide(root: HTMLElement, reason: string, choice: string): Promise<void> {
  // The reason box is the last box in its row; an account's id comes before it.
  const box = [...root.querySelectorAll('input')].at(-1);
  if (box === undefined) throw new Error('no reason box');
  await typeInto(box, reason);
  await activateWithKeyboard(button(root, choice));
  await settle();
}

describe('who sees what — #955', () => {
  it('says there is no store to sign in from, with no port', async () => {
    mounted = await mount(<ModerationView />);
    expect(text()).toContain(MODERATION_NO_PORT);
  });

  it.each(['not-moderator', 'not-connected', 'signed-out', 'unreachable'] as const)(
    'shows an account that does not moderate (%s) no queue and no control',
    async (standing) => {
      const scripted = scriptedModeration({ standing });
      await open(scripted);
      expect(text()).toContain(MODERATION_STANDING_TEXT[standing]);
      expect(container().querySelectorAll('button, input')).toHaveLength(0);
      expect(text()).not.toContain('Anna');
      expect(text()).not.toContain(MODERATION_IS_LOGGED);
    },
  );
});

describe('the approval queue — #775, #955', () => {
  it('approves with a reason, then reads the queue back and says it was logged', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    expect(text()).toContain(MODERATION_IS_LOGGED);
    await decide(item('Anna'), 'Known to the club.', 'Approve');
    expect(scripted.calls).toContain('approve pending-anna');
    expect(scripted.calls.filter((call) => call === 'read')).toHaveLength(2);
    expect(text(section('Waiting for approval'))).not.toContain('Anna');
    expect(text()).toContain(ACTION_DONE_TEXT);
    expect(text(section('Moderation log'))).toContain('Approved an account');
  });

  it('refuses, and says a refusal the instance gave beside the row', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await decide(item('Anna'), '   ', 'Refuse');
    expect(text(item('Anna'))).toContain('Give a reason.');
    expect(text()).not.toContain(ACTION_DONE_TEXT);
    await decide(item('Anna'), 'Not known.', 'Refuse');
    expect(scripted.calls).toContain('refuse pending-anna');
    expect(text(section('Waiting for approval'))).not.toContain('Anna');
  });
});

describe('the report queue — #83, #905, #955', () => {
  it('declares a report about you a conflict, with no control on it', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    const conflict = item('Report 8');
    expect(text(conflict)).toContain(REPORT_CONFLICT_TEXT);
    expect(text(conflict)).toContain(`${SCRIPTED_MODERATOR} (you)`);
    expect(conflict.querySelectorAll('button, input')).toHaveLength(0);
    // The other report is decidable.
    expect(text(item('Report 7'))).not.toContain(REPORT_CONFLICT_TEXT);
    expect(button(item('Report 7'), 'Dismiss')).toBeDefined();
  });

  it('suspends a report’s account for the report, which closes it', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await decide(item('Report 7'), 'A slur.', 'Suspend the account');
    expect(scripted.calls).toContain('suspend rider-dafydd for 7');
    expect(text(section('Reports'))).not.toContain('Report 7');
    expect(text(section('Reports'))).toContain('Report 8');
  });

  it('hides a report’s display name, and dismisses', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await decide(item('Report 7'), 'Rude name.', 'Hide its display name');
    expect(scripted.calls).toContain('hide_display_name rider-dafydd for 7');
    scripted.held.reports.push({
      reportId: 9,
      reporterAthleteId: 'rider-carys',
      targetAthleteId: 'rider-dafydd',
      reason: 'Again.',
      createdAt: 1_790_003_000,
    });
    mounted?.unmount();
    await open(scripted);
    await decide(item('Report 9'), 'Not a breach.', 'Dismiss');
    expect(scripted.calls).toContain('dismiss 9');
    expect(text(section('Reports'))).not.toContain('Report 9');
  });
});

describe('an account by its id — #955', () => {
  it('suspends and lifts, and says nothing changed — in one sentence — for an id it cannot act on', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    const account = section('An account');
    const [id] = [...account.querySelectorAll('input')] as HTMLInputElement[];
    if (id === undefined) throw new Error('no id box');

    await typeInto(id, 'nobody-at-all');
    await decide(account, 'why', 'Suspend');
    expect(text(account)).toContain(NOTHING_CHANGED_TEXT);

    await typeInto(id, 'rider-carys');
    await decide(account, 'Rude.', 'Suspend');
    expect(scripted.held.suspended.has('rider-carys')).toBe(true);
    expect(text()).toContain(ACTION_DONE_TEXT);

    await decide(section('An account'), 'Again.', 'Suspend');
    expect(text(section('An account'))).toContain(NOTHING_CHANGED_TEXT);

    await decide(section('An account'), 'Apologised.', 'Lift the suspension');
    expect(scripted.held.suspended.has('rider-carys')).toBe(false);
    await decide(section('An account'), 'Rude name.', 'Hide the display name');
    expect(scripted.calls).toContain('hide_display_name rider-carys');
  });
});

describe('the moderation log — #891, #955', () => {
  it('is read-only and newest first', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await decide(item('Anna'), 'Known.', 'Approve');
    const log = section('Moderation log');
    expect(log.querySelectorAll('button, input, textarea, select')).toHaveLength(0);
    const lines = [...log.querySelectorAll('li')].map((each) => text(each));
    expect(lines[0]).toContain('Approved an account');
    expect(lines[0]).toContain('account pending-anna');
    expect(lines.at(-1)).toContain('account rider-carys');
  });

  it('names every action, a refused one included, and an unknown one by its own word', () => {
    expect(actionLabel('suspend')).toBe('Suspended an account');
    expect(actionLabel('refused_dismiss_report')).toBe(
      'Refused, and changed nothing: dismissed a report',
    );
    expect(actionLabel('something_new')).toBe('something_new');
  });
});
