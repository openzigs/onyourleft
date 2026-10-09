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

import { auditAccessibility, formatViolations } from '../a11y/audit';

import { INSTANCE_KEY_TEXT, WEB_BUILD_TEXT } from '../instance/instance-pin';
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
  hideNameConfirmation,
  MODERATION_CANCEL_LABEL,
  MODERATION_IS_LOGGED,
  MODERATION_LOG_UNREADABLE_TEXT,
  MODERATION_NO_PORT,
  MODERATION_STANDING_TEXT,
  ModerationView,
  MORE_UNREADABLE_TEXT,
  REPORT_CONFLICT_TEXT,
  SUSPENDED_UNREADABLE_TEXT,
  suspendConfirmation,
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

/** The open confirmation, which Radix portals into the body — #962. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

/** The choices #962 confirms before they act. */
const CONFIRMED = new Set([
  'Suspend',
  'Suspend the account',
  'Hide the display name',
  'Hide its display name',
]);

async function decide(root: HTMLElement, reason: string, choice: string): Promise<void> {
  // The reason box is the last box in its row; an account's id comes before it.
  const box = [...root.querySelectorAll('input')].at(-1);
  if (box === undefined) throw new Error('no reason box');
  await typeInto(box, reason);
  await activateWithKeyboard(button(root, choice));
  await settle();
  if (CONFIRMED.has(choice)) {
    const asked = dialog();
    if (asked === null) throw new Error(`${choice} acted without asking`);
    const confirm = [...asked.querySelectorAll('button')].find(
      (each) => each.textContent !== MODERATION_CANCEL_LABEL,
    );
    if (confirm === undefined) throw new Error('the confirmation has no confirm button');
    await activateWithKeyboard(confirm);
    await settle();
  }
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

describe('a moderator on a device that cannot seal (#1192, ADR 0047 D-7, D-11)', () => {
  it.each([
    ['a copy of the app a website served', WEB_BUILD_TEXT],
    ['no card', INSTANCE_KEY_TEXT['needs-card']],
  ] as const)(
    'is told why, in the gate’s own sentence, with no queue and no control (%s)',
    async (_name, sentence) => {
      const scripted = scriptedModeration({ sealedUnavailable: sentence });
      await open(scripted);
      expect(text()).toContain(sentence);
      expect(container().querySelectorAll('button, input')).toHaveLength(0);
      expect(text()).not.toContain('Anna');
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

  // #1009, the owner's ruling: the log note is read before acting, as consent
  // text is, so it stands above every action — and kept visible.
  it('says every action is logged above the first action, not below it', async () => {
    await open(scriptedModeration());
    const note = [...container().querySelectorAll('p')].find(
      (each) => each.textContent === MODERATION_IS_LOGGED,
    );
    if (note === undefined) throw new Error('the log note is not on the screen');
    expect(note.closest('[data-oyl-kept-visible]')).not.toBeNull();
    expect(note.closest('details')).toBeNull();
    const controls = [...container().querySelectorAll('button, input, textarea, select')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        note.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${control.tagName} “${control.textContent ?? ''}” comes before the log note`,
      ).toBeTruthy();
    }
  });

  // #957's review: the read-back failing must not take the notice with it,
  // or a moderator is left to press again not knowing it was done.
  it('keeps saying it was done when the read-back after an action fails', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    scripted.held.standing = 'unreachable';
    await decide(item('Anna'), 'Known to the club.', 'Approve');
    expect(scripted.calls).toContain('approve pending-anna');
    expect(text()).toContain(MODERATION_STANDING_TEXT.unreachable);
    expect(text()).toContain(ACTION_DONE_TEXT);
  });

  it('refuses, and says a refusal the instance gave beside the row', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await decide(item('Anna'), '   ', 'Refuse');
    expect(text()).toContain('Give a reason.');
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
    expect(text()).toContain(NOTHING_CHANGED_TEXT);

    await typeInto(id, 'rider-carys');
    await decide(account, 'Rude.', 'Suspend');
    expect(scripted.held.suspended.has('rider-carys')).toBe(true);
    expect(text()).toContain(ACTION_DONE_TEXT);

    await decide(section('An account'), 'Again.', 'Suspend');
    expect(text()).toContain(NOTHING_CHANGED_TEXT);

    await decide(section('An account'), 'Apologised.', 'Lift the suspension');
    expect(scripted.held.suspended.has('rider-carys')).toBe(false);
    await decide(section('An account'), 'Rude name.', 'Hide the display name');
    expect(scripted.calls).toContain('hide_display_name rider-carys');
  });

  // #957's review: the instance logs an action on a moderator as
  // `refused_<action>`, so a refusal is read back too, and still said.
  it('reads the log back after a refused action, keeping the refusal on the screen', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    const account = section('An account');
    const [id] = [...account.querySelectorAll('input')] as HTMLInputElement[];
    if (id === undefined) throw new Error('no id box');
    await typeInto(id, SCRIPTED_MODERATOR);
    await decide(account, 'Myself.', 'Suspend');
    expect(scripted.calls.filter((call) => call === 'read')).toHaveLength(2);
    expect(text()).toContain(NOTHING_CHANGED_TEXT);
    expect(text()).not.toContain(ACTION_DONE_TEXT);
    const [newest] = [...section('Moderation log').querySelectorAll('li')];
    expect(text(newest)).toContain('Refused, and changed nothing: suspended an account');
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

  it('says the log could not be read, and still shows the queues', async () => {
    const scripted = scriptedModeration();
    scripted.held.logReadable = false;
    await open(scripted);
    expect(text(section('Moderation log'))).toContain(MODERATION_LOG_UNREADABLE_TEXT);
    expect(section('Moderation log').querySelectorAll('li')).toHaveLength(0);
    expect(text(section('Waiting for approval'))).toContain('Anna');
    expect(text(section('Reports'))).toContain('Report 7');
  });

  it('names every action, a refused one included, and an unknown one by its own word', () => {
    expect(actionLabel('suspend')).toBe('Suspended an account');
    expect(actionLabel('refused_dismiss_report')).toBe(
      'Refused, and changed nothing: dismissed a report',
    );
    expect(actionLabel('something_new')).toBe('something_new');
  });
});

describe('a refusal outlives its row — #960', () => {
  it('still says why an action was refused when the read-back removes the row it was pressed on', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    const anna = item('Anna');
    // Another moderator decided Anna between this page's read and the press:
    // the instance refuses, and the read-back no longer has her row.
    scripted.held.registrations = scripted.held.registrations.filter(
      (each) => each.athleteId !== 'pending-anna',
    );
    await decide(anna, 'Known to the club.', 'Approve');
    expect(scripted.calls).toContain('approve pending-anna');
    expect(anna.isConnected).toBe(false);
    expect(text(section('Waiting for approval'))).not.toContain('Anna');
    const said = [...container().querySelectorAll('[role="status"]')].find((each) =>
      (each.textContent ?? '').includes(NOTHING_CHANGED_TEXT),
    );
    expect(said, 'the refusal left with its row').toBeDefined();
    expect(text()).not.toContain(ACTION_DONE_TEXT);
  });

  it('says a refusal once, not once in the row and again on the page', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await decide(item('Anna'), '   ', 'Refuse');
    expect(text().split('Give a reason.')).toHaveLength(2);
  });
});

describe('suspending and hiding a name are confirmed first — #962', () => {
  async function account(id: string): Promise<{ scripted: ScriptedModeration; root: HTMLElement }> {
    const scripted = scriptedModeration();
    await open(scripted);
    const root = section('An account');
    const [box, reason] = [...root.querySelectorAll('input')] as HTMLInputElement[];
    if (box === undefined || reason === undefined) throw new Error('no boxes');
    await typeInto(box, id);
    await typeInto(reason, 'Rude.');
    return { scripted, root };
  }

  it.each([
    ['Suspend', suspendConfirmation('rider-carys')],
    ['Hide the display name', hideNameConfirmation('rider-carys')],
  ] as const)(
    '%s asks in a dialog, and does nothing when the moderator changes nothing',
    async (choice, asked) => {
      const { scripted, root } = await account('rider-carys');
      const pressed = button(root, choice);
      await activateWithKeyboard(pressed);
      await settle();
      const shown = dialog();
      expect(shown).not.toBeNull();
      expect(text(shown ?? undefined)).toContain(asked.title);
      expect(text(shown ?? undefined)).toContain(asked.body);
      expect(document.activeElement?.textContent).toBe(MODERATION_CANCEL_LABEL);
      const violations = auditAccessibility(document);
      expect(violations, formatViolations(violations)).toStrictEqual([]);
      expect(scripted.calls.some((call) => call.includes('rider-carys'))).toBe(false);

      await activateWithKeyboard(button(shown as HTMLElement, MODERATION_CANCEL_LABEL));
      await settle();
      expect(dialog()).toBeNull();
      expect(scripted.calls.some((call) => call.includes('rider-carys'))).toBe(false);
      expect(document.activeElement).toBe(pressed);
    },
  );

  it.each([
    ['Suspend', suspendConfirmation('rider-carys'), 'suspend rider-carys'],
    ['Hide the display name', hideNameConfirmation('rider-carys'), 'hide_display_name rider-carys'],
  ] as const)('%s acts once it is confirmed', async (choice, asked, call) => {
    const { scripted, root } = await account('rider-carys');
    await activateWithKeyboard(button(root, choice));
    await settle();
    await activateWithKeyboard(button(dialog() as HTMLElement, asked.confirmLabel));
    await settle();
    expect(dialog()).toBeNull();
    expect(scripted.calls.filter((each) => each === call)).toHaveLength(1);
    expect(text()).toContain(ACTION_DONE_TEXT);
  });

  it('asks on a report too, and lifting a suspension or dismissing does not ask', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    await activateWithKeyboard(button(item('Report 7'), 'Suspend the account'));
    await settle();
    expect(text(dialog() ?? undefined)).toContain(suspendConfirmation('rider-dafydd').title);
    await activateWithKeyboard(button(dialog() as HTMLElement, MODERATION_CANCEL_LABEL));
    await settle();
    await activateWithKeyboard(button(item('Report 7'), 'Hide its display name'));
    await settle();
    expect(text(dialog() ?? undefined)).toContain(hideNameConfirmation('rider-dafydd').title);
    await activateWithKeyboard(button(dialog() as HTMLElement, MODERATION_CANCEL_LABEL));
    await settle();
    expect(scripted.calls.some((call) => call.includes('rider-dafydd'))).toBe(false);

    const root = section('An account');
    await activateWithKeyboard(button(root, 'Lift the suspension'));
    await settle();
    expect(dialog()).toBeNull();
    await activateWithKeyboard(button(item('Report 7'), 'Dismiss'));
    await settle();
    expect(dialog()).toBeNull();
    expect(scripted.calls).toContain('dismiss 7');
  });

  it('acts once however often it is pressed while the instance has not answered', async () => {
    const scripted = scriptedModeration();
    let answer: () => void = () => undefined;
    const port = {
      ...scripted.port,
      actOnAccount: async (...args: Parameters<typeof scripted.port.actOnAccount>) => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return scripted.port.actOnAccount(...args);
      },
    };
    mounted = await mount(<ModerationView port={port} />);
    await settle();
    const root = section('An account');
    const [box, reason] = [...root.querySelectorAll('input')] as HTMLInputElement[];
    if (box === undefined || reason === undefined) throw new Error('no boxes');
    await typeInto(box, 'rider-carys');
    await typeInto(reason, 'Rude.');
    const lift = button(root, 'Lift the suspension');
    await activateWithKeyboard(lift);
    await settle();
    expect(lift.getAttribute('aria-disabled')).toBe('true');
    await activateWithKeyboard(lift);
    await activateWithKeyboard(button(root, 'Suspend'));
    await settle();
    expect(dialog()).toBeNull();
    answer();
    await settle();
    expect(scripted.calls.filter((call) => call.startsWith('unsuspend'))).toHaveLength(1);
  });
});

describe('the suspended accounts — #961', () => {
  it('lists each suspended account, and lifts a suspension from its row with no id typed', async () => {
    const scripted = scriptedModeration();
    scripted.held.suspended.set('rider-carys', 1_790_020_000);
    scripted.held.suspended.set('rider-dafydd', 1_790_030_000);
    await open(scripted);
    const list = section('Suspended accounts');
    const heads = [...list.querySelectorAll('h3')].map((each) => each.textContent);
    expect(heads).toEqual(['rider-dafydd', 'rider-carys']);
    expect(text(list)).toContain('suspended 2026-09-21');

    await decide(item('rider-carys'), 'Appeal upheld.', 'Lift the suspension');
    expect(scripted.calls).toContain('unsuspend rider-carys');
    expect(scripted.held.suspended.has('rider-carys')).toBe(false);
    // Read back: the row has gone because the instance says so.
    expect(
      [...section('Suspended accounts').querySelectorAll('h3')].map((each) => each.textContent),
    ).toEqual(['rider-dafydd']);
    expect(text()).toContain(ACTION_DONE_TEXT);
  });

  it('says when nobody is suspended, and adds a suspension made on the page', async () => {
    const scripted = scriptedModeration();
    await open(scripted);
    expect(text(section('Suspended accounts'))).toContain('No account is suspended.');
    await decide(item('Report 7'), 'For the report.', 'Suspend the account');
    expect(scripted.held.suspended.has('rider-dafydd')).toBe(true);
    expect(text(section('Suspended accounts'))).toContain('rider-dafydd');
  });

  it('says the suspended accounts could not be read, and still shows the queues', async () => {
    const scripted = scriptedModeration();
    scripted.held.suspendedReadable = false;
    await open(scripted);
    expect(text(section('Suspended accounts'))).toContain(SUSPENDED_UNREADABLE_TEXT);
    expect(text(section('Waiting for approval'))).toContain('Anna');
  });

  it('shows more suspended accounts a page at a time, until there are no more', async () => {
    const scripted = scriptedModeration();
    scripted.held.pageSize = 1;
    scripted.held.suspended.set('rider-carys', 1_790_020_000);
    scripted.held.suspended.set('rider-dafydd', 1_790_030_000);
    await open(scripted);
    const list = (): string[] =>
      [...section('Suspended accounts').querySelectorAll('h3')].map(
        (each) => each.textContent ?? '',
      );
    expect(list()).toEqual(['rider-dafydd']);
    await activateWithKeyboard(
      button(section('Suspended accounts'), 'Show more suspended accounts'),
    );
    await settle();
    expect(scripted.calls).toContain('more suspended 1');
    expect(list()).toEqual(['rider-dafydd', 'rider-carys']);
    expect(
      [...section('Suspended accounts').querySelectorAll('button')].some(
        (each) => each.textContent === 'Show more suspended accounts',
      ),
    ).toBe(false);
  });
});

describe('the log, a page at a time — #961', () => {
  const logLines = (): string[] =>
    [...section('Moderation log').querySelectorAll('li')].map((each) => text(each));

  /** A scripted instance whose log has a third entry, and pages one entry at a time. */
  function paged(): ScriptedModeration {
    const scripted = scriptedModeration();
    scripted.held.pageSize = 1;
    scripted.held.log.push(
      {
        logId: 2,
        action: 'hide_display_name',
        actorAthleteId: SCRIPTED_MODERATOR,
        targetAthleteId: 'rider-dafydd',
        reportId: null,
        reason: 'Rude name.',
        at: 1_789_991_000,
      },
      {
        logId: 3,
        action: 'suspend',
        actorAthleteId: SCRIPTED_MODERATOR,
        targetAthleteId: 'rider-dafydd',
        reportId: null,
        reason: 'Again.',
        at: 1_789_992_000,
      },
    );
    return scripted;
  }

  it('shows the newest page first, and older entries on Show older entries, each once', async () => {
    const scripted = paged();
    const all = scripted.held.log.map((entry) => entry.logId);
    await open(scripted);
    expect(logLines()).toHaveLength(1);
    for (let page = 1; page < all.length; page += 1) {
      await activateWithKeyboard(button(section('Moderation log'), 'Show older entries'));
      await settle();
      expect(logLines()).toHaveLength(page + 1);
    }
    expect(
      [...section('Moderation log').querySelectorAll('button')].map((each) => each.textContent),
    ).toEqual([]);
    // Newest first: the scripted log's last entry is the first line.
    expect(logLines()[0]).toContain('Suspended an account');
    expect(logLines()[1]).toContain('Hid a display name');
    expect(logLines()[2]).toContain('account rider-carys');
  });

  it('says a page did not come, keeps what is shown, and offers it again', async () => {
    const scripted = paged();
    await open(scripted);
    scripted.held.moreReadable = false;
    await activateWithKeyboard(button(section('Moderation log'), 'Show older entries'));
    await settle();
    expect(text(section('Moderation log'))).toContain(MORE_UNREADABLE_TEXT);
    expect(logLines()).toHaveLength(1);
    scripted.held.moreReadable = true;
    await activateWithKeyboard(button(section('Moderation log'), 'Show older entries'));
    await settle();
    expect(text(section('Moderation log'))).not.toContain(MORE_UNREADABLE_TEXT);
    expect(logLines()).toHaveLength(2);
  });

  it('starts again from the newest page after an action, rather than keep a stale tail', async () => {
    const scripted = paged();
    await open(scripted);
    await activateWithKeyboard(button(section('Moderation log'), 'Show older entries'));
    await settle();
    expect(logLines()).toHaveLength(2);
    await decide(item('Anna'), 'Known to the club.', 'Approve');
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toContain('Approved an account');
  });

  it('drops a page that arrives after an action read everything back — it is not the new list’s next', async () => {
    const scripted = paged();
    await open(scripted);
    // Hold the next page until the read-back after an action has landed.
    const real = scripted.port.moreLog.bind(scripted.port);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    scripted.port.moreLog = async (cursor) => {
      const page = await real(cursor);
      await held;
      return page;
    };
    await activateWithKeyboard(button(section('Moderation log'), 'Show older entries'));
    await decide(item('Anna'), 'Known to the club.', 'Approve');
    expect(logLines()).toHaveLength(1);
    release();
    await settle();
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toContain('Approved an account');
  });

  it('clears a page’s failure once an action reads everything back', async () => {
    const scripted = paged();
    await open(scripted);
    scripted.held.moreReadable = false;
    await activateWithKeyboard(button(section('Moderation log'), 'Show older entries'));
    await settle();
    expect(text(section('Moderation log'))).toContain(MORE_UNREADABLE_TEXT);
    await decide(item('Anna'), 'Known to the club.', 'Approve');
    expect(text(section('Moderation log'))).not.toContain(MORE_UNREADABLE_TEXT);
  });

  it('passes the accessibility audit with both lists paged', async () => {
    const scripted = paged();
    scripted.held.suspended.set('rider-carys', 1_790_020_000);
    scripted.held.suspended.set('rider-dafydd', 1_790_030_000);
    // The shell's own landmark and title, which the route gives the view.
    mounted = await mount(
      <main>
        <h1>Moderation</h1>
        <ModerationView port={scripted.port} />
      </main>,
    );
    await settle();
    expect(button(section('Moderation log'), 'Show older entries')).toBeDefined();
    expect(button(section('Suspended accounts'), 'Show more suspended accounts')).toBeDefined();
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
