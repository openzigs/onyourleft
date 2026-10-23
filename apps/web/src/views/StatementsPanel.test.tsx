// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The statements of reasons on the Instance screen (#910): each in DSA Art.
 * 17(3)'s parts, the notifier only where the moderator named them, the
 * conflict declared where it was, and the way to ask for a second look.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { RiderStatement, StatementsPort } from '../instance/statements-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { APPEAL_REFUSAL_TEXT, ERASE_REFUSAL_TEXT } from '../instance/statements-port';
import { activateWithKeyboard, typeIntoTextArea } from '../testing/mount';
import {
  APPEAL_TEXT,
  CONFLICT_TEXT,
  COURT_TEXT,
  DECIDED_ON_TEXT,
  NO_AUTOMATED_MEANS_TEXT,
  STATEMENTS_HEADING,
  StatementsPanel,
  YOUR_DATA_TEXT,
} from './StatementsPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const SUSPENDED: RiderStatement = {
  statementId: 4,
  at: 1_790_000_000,
  restriction: 'suspend',
  endsAt: 1_790_604_800,
  facts: 'Repeated abuse of other riders in a room.',
  decidedOn: 'report',
  legalGround: null,
  termsGround: 'The terms of service, on abuse.',
  notifierNamed: null,
  moderatorConflict: false,
  contactEmail: 'moderator@club.example',
  appeal: null,
};

const portOf = (statements: readonly RiderStatement[]): StatementsPort => ({
  read: () => Promise.resolve({ kind: 'statements', statements }),
  appeal: () => Promise.reject(new Error('no appeal in this test')),
  exportAccount: () => Promise.reject(new Error('no export in this test')),
  eraseAccount: () => Promise.reject(new Error('no deletion in this test')),
});

async function show(port: StatementsPort, onErased?: () => void): Promise<string> {
  mounted = await mount(
    <main>
      <h1>Instance</h1>
      <StatementsPanel port={port} {...(onErased === undefined ? {} : { onErased })} />
    </main>,
  );
  await settle();
  return mounted.container.textContent ?? '';
}

describe('the statements of reasons, shown (#910)', () => {
  it('says what was done, until when, why, on what, by whom and how to ask again', async () => {
    const text = await show(portOf([SUSPENDED]));
    expect(text).toContain(STATEMENTS_HEADING);
    expect(text).toContain('Your account was suspended, 2026-09-21 14:13 UTC');
    expect(text).toContain('It ends on 2026-09-28 14:13 UTC.');
    expect(text).toContain(`Why: ${SUSPENDED.facts}`);
    expect(text).toContain(DECIDED_ON_TEXT.report);
    expect(text).toContain(NO_AUTOMATED_MEANS_TEXT);
    expect(text).toContain(`The terms we relied on: ${SUSPENDED.termsGround}`);
    expect(text).not.toContain('The law we relied on');
    expect(text).not.toContain(CONFLICT_TEXT);
    expect(text).not.toContain('It was sent by');
    expect(text).toContain(COURT_TEXT);
    const write = mounted?.container.querySelector('a[href^="mailto:"]');
    expect(write?.getAttribute('href')).toBe('mailto:moderator@club.example');
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('declares a conflict, names a notifier only where the moderator did, and says when there is no contact', async () => {
    const text = await show(
      portOf([
        {
          ...SUSPENDED,
          restriction: 'hide_display_name',
          endsAt: null,
          legalGround: 'An offence of harassment.',
          notifierNamed: 'A. Notifier',
          moderatorConflict: true,
          contactEmail: null,
        },
      ]),
    );
    expect(text).toContain('Your display name was hidden');
    expect(text).toContain('It has no end date.');
    expect(text).toContain('The law we relied on: An offence of harassment.');
    expect(text).toContain('It was sent by A. Notifier');
    expect(text).toContain(CONFLICT_TEXT);
    expect(text).toContain('has not published a contact address.');
    expect(mounted?.container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('names a moderator’s removal from a room in words, not the instance’s name for it (#1384)', async () => {
    const text = await show(
      portOf([{ ...SUSPENDED, restriction: 'remove_from_room', endsAt: null }]),
    );
    expect(text).toContain('You were removed from a room, 2026-09-21 14:13 UTC');
    expect(text).not.toContain('remove_from_room');
  });

  it('shows nothing when there is no statement, or nothing could be read', async () => {
    expect(await show(portOf([]))).not.toContain(STATEMENTS_HEADING);
    mounted?.unmount();
    expect(
      await show({
        read: () => Promise.resolve({ kind: 'unreachable' }),
        appeal: () => Promise.reject(new Error('no appeal')),
        exportAccount: () => Promise.reject(new Error('no export')),
        eraseAccount: () => Promise.reject(new Error('no deletion')),
      }),
    ).not.toContain(STATEMENTS_HEADING);
  });
});

describe('appealing, from the Instance screen (#911)', () => {
  function appealable(): StatementsPort & { appealed: [number, string][] } {
    let held: readonly RiderStatement[] = [SUSPENDED];
    const appealed: [number, string][] = [];
    return {
      appealed,
      read: () => Promise.resolve({ kind: 'statements', statements: held }),
      exportAccount: () => Promise.reject(new Error('no export in this test')),
      eraseAccount: () => Promise.reject(new Error('no deletion in this test')),
      appeal: (statementId, grounds) => {
        appealed.push([statementId, grounds]);
        if (grounds.trim() === '') {
          return Promise.resolve({ kind: 'refused', text: APPEAL_REFUSAL_TEXT.grounds });
        }
        held = [
          {
            ...SUSPENDED,
            appeal: {
              filedAt: 1_790_001_000,
              grounds,
              outcome: null,
              decision: null,
              moderatorConflict: false,
              decidedAt: null,
            },
          },
        ];
        return Promise.resolve({ kind: 'filed' });
      },
    };
  }

  function box(): HTMLTextAreaElement {
    const label = [...(mounted?.container.querySelectorAll('label') ?? [])].find(
      (each) => each.textContent === APPEAL_TEXT.label,
    );
    const found = mounted?.container.querySelector<HTMLTextAreaElement>(
      `[id="${label?.getAttribute('for') ?? ''}"]`,
    );
    if (found === null || found === undefined) throw new Error('no appeal box');
    return found;
  }

  function sendButton(): HTMLButtonElement {
    const found = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
      (each) => each.textContent === APPEAL_TEXT.send,
    );
    if (found === undefined) throw new Error('no send button');
    return found;
  }

  it('sends the grounds for that decision, then shows the appeal waiting', async () => {
    const port = appealable();
    await show(port);
    await typeIntoTextArea(box(), 'I was quoting another rider.');
    await activateWithKeyboard(sendButton());
    await settle();
    expect(port.appealed).toEqual([[SUSPENDED.statementId, 'I was quoting another rider.']]);
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain(APPEAL_TEXT.sent);
    expect(text).toContain(APPEAL_TEXT.waiting);
    expect(text).toContain('Your grounds: I was quoting another rider.');
    expect(mounted?.container.querySelector('textarea')).toBeNull();
  });

  it('says why an appeal was not sent, and keeps the box', async () => {
    const port = appealable();
    await show(port);
    await activateWithKeyboard(sendButton());
    await settle();
    expect(mounted?.container.textContent).toContain(APPEAL_REFUSAL_TEXT.grounds);
    expect(box()).toBeDefined();
  });

  it('shows a decided appeal: the outcome, the answer, and a declared conflict', async () => {
    const text = await show(
      portOf([
        {
          ...SUSPENDED,
          appeal: {
            filedAt: 1_790_001_000,
            grounds: 'Quoting.',
            outcome: 'reversed',
            decision: 'You were quoting. Lifted.',
            moderatorConflict: true,
            decidedAt: 1_790_002_000,
          },
        },
      ]),
    );
    expect(text).toContain(APPEAL_TEXT.reversed);
    expect(text).toContain('The moderator’s answer: You were quoting. Lifted.');
    expect(text).toContain(APPEAL_TEXT.conflict);
    expect(mounted?.container.querySelector('textarea')).toBeNull();
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

describe('a suspended rider’s own data, from the Instance screen (#1517)', () => {
  function buttonNamed(name: string): HTMLButtonElement {
    const found = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
      (each) => each.textContent === name,
    );
    if (found === undefined) throw new Error(`no button ${name}`);
    return found;
  }

  function dataPort(
    exported: string | undefined,
    erase: Awaited<ReturnType<StatementsPort['eraseAccount']>>,
  ): StatementsPort & { erased: number } {
    const port = {
      erased: 0,
      read: () => Promise.resolve({ kind: 'statements' as const, statements: [SUSPENDED] }),
      appeal: () => Promise.reject(new Error('no appeal in this test')),
      exportAccount: () => Promise.resolve(exported),
      eraseAccount: () => {
        port.erased += 1;
        return Promise.resolve(erase);
      },
    };
    return port;
  }

  it('is offered only to a rider who was suspended', async () => {
    expect(await show(portOf([SUSPENDED]))).toContain(YOUR_DATA_TEXT.heading);
    mounted?.unmount();
    expect(await show(portOf([{ ...SUSPENDED, restriction: 'hide_display_name' }]))).not.toContain(
      YOUR_DATA_TEXT.heading,
    );
  });

  it('prepares the instance’s copy as a file to save, or says it could not', async () => {
    const created: Blob[] = [];
    const original: unknown = Reflect.get(URL, 'createObjectURL');
    const originalRevoke: unknown = Reflect.get(URL, 'revokeObjectURL');
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return 'blob:account';
    };
    URL.revokeObjectURL = () => undefined;
    try {
      await show(dataPort('{"athlete":{"id":"a1"}}', { kind: 'erased' }));
      await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.save));
      await settle();
      const link = mounted?.container.querySelector('a[download]');
      expect(link?.getAttribute('download')).toBe(YOUR_DATA_TEXT.file);
      expect(link?.getAttribute('href')).toBe('blob:account');
      expect(link?.textContent).toBe(YOUR_DATA_TEXT.link);
      expect(JSON.parse(await created[0]!.text())).toEqual({ athlete: { id: 'a1' } });
      mounted?.unmount();
      await show(dataPort(undefined, { kind: 'erased' }));
      await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.save));
      await settle();
      expect(mounted?.container.textContent).toContain(YOUR_DATA_TEXT.unreadable);
      expect(mounted?.container.querySelector('a[download]')).toBeNull();
    } finally {
      Reflect.set(URL, 'createObjectURL', original);
      Reflect.set(URL, 'revokeObjectURL', originalRevoke);
    }
  });

  it('deletes the account only once the rider confirms, then says the rides stay', async () => {
    const port = dataPort(undefined, { kind: 'erased' });
    await show(port);
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.erase));
    await settle();
    expect(port.erased).toBe(0);
    expect(mounted?.container.textContent).toContain(YOUR_DATA_TEXT.confirm);
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.keep));
    await settle();
    expect(mounted?.container.textContent).not.toContain(YOUR_DATA_TEXT.confirm);
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.erase));
    await settle();
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.confirmErase));
    await settle();
    expect(port.erased).toBe(1);
    expect(mounted?.container.textContent).toContain(YOUR_DATA_TEXT.erased);
  });

  it('tells its host the account is gone, so the host re-reads, and only then', async () => {
    const onErased = vi.fn();
    await show(dataPort(undefined, { kind: 'refused', text: ERASE_REFUSAL_TEXT }), onErased);
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.erase));
    await settle();
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.confirmErase));
    await settle();
    expect(onErased).not.toHaveBeenCalled();
    mounted?.unmount();
    await show(dataPort(undefined, { kind: 'erased' }), onErased);
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.erase));
    await settle();
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.confirmErase));
    await settle();
    expect(onErased).toHaveBeenCalledTimes(1);
  });

  it('says why the account was not deleted', async () => {
    const port = dataPort(undefined, { kind: 'refused', text: ERASE_REFUSAL_TEXT });
    await show(port);
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.erase));
    await settle();
    await activateWithKeyboard(buttonNamed(YOUR_DATA_TEXT.confirmErase));
    await settle();
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain(ERASE_REFUSAL_TEXT);
    expect(text).not.toContain(YOUR_DATA_TEXT.erased);
  });
});
