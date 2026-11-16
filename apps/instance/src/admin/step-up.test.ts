// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a step-up is bound to (#2642, ADR 0069 D-4): the action and the
 * SHA-256 of its canonical fields. The issue names *back up now* and *end
 * room*; their pages are #2647's and #2649's, so here they are bindings, and
 * `admin-passkeys.test.ts` holds a challenge issued for *back up now* to the
 * one change this issue ships — revoking a passkey — through the real handler.
 */

import { describe, expect, it } from 'vitest';

import { ADMIN_CHANGES, bindingOf, boundFields, isAdminChange } from './step-up.ts';

describe('the binding of a step-up (#2642)', () => {
  it('differs between back up now and end room, and between two rooms', async () => {
    const backUp = await bindingOf('backup_now', {});
    const endRoom = await bindingOf('end_room', { room: 'ABCD' });
    expect(backUp).not.toBe(endRoom);
    expect(await bindingOf('end_room', { room: 'WXYZ' })).not.toBe(endRoom);
    // The action is part of what is hashed: the same fields under another name differ.
    expect(await bindingOf('end_room', {})).not.toBe(backUp);
    expect(backUp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same whatever order the fields came in, and tells a value from a name', async () => {
    expect(await bindingOf('x', { a: '1', b: '2' })).toBe(await bindingOf('x', { b: '2', a: '1' }));
    // A field that holds `&` or `=` cannot pass for two fields.
    expect(await bindingOf('x', { a: '1&b=2' })).not.toBe(await bindingOf('x', { a: '1', b: '2' }));
  });

  it('takes the declared fields once each, ignores the proof, and refuses anything else', () => {
    const declared = ADMIN_CHANGES.passkey_revoke.fields;
    const form = (text: string) => new URLSearchParams(text);
    expect(boundFields(declared, form('id=abc&csrf=t&action=passkey_revoke&signature=s'))).toEqual({
      id: 'abc',
    });
    for (const refused of ['', 'csrf=t', 'id=a&id=b', 'id=a&extra=1', 'id=a&csrf=1&csrf=2']) {
      expect(boundFields(declared, form(refused)), refused).toBeUndefined();
    }
  });

  it('names only the changes the admin pages make, never a property of every object', () => {
    expect(isAdminChange('passkey_revoke')).toBe(true);
    for (const name of ['backup_now', 'constructor', '__proto__', 'toString']) {
      expect(isAdminChange(name), name).toBe(false);
    }
  });
});
