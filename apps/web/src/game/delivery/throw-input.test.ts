// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1810 — what a key asks for, and which side *the next house* is on. What a
 * press on the HUD does, with the touch lock on and off, is
 * `hud/HudPanel.throw.test.tsx`'s, read back from the throws the ride took.
 */

import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import { recordDelivery, recordMiss, startRound } from './round';
import { THROW_WINDOW_AFTER_METRES, throwSideFor, type ThrowTarget } from './throw';
import {
  intentOfKey,
  THROW_INTENTS,
  THROW_KEYS,
  type ThrowIntent,
  type ThrowKeyEvent,
} from './throw-input';
import type { ThrowInputPort } from './throw-input-port';

afterEach(() => {
  document.body.replaceChildren();
});

function key(name: string, more: Partial<ThrowKeyEvent> = {}): ThrowKeyEvent {
  return {
    key: name,
    target: document.body,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...more,
  };
}

function placed<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  return element;
}

describe('the throw intents — #1810', () => {
  it('are left, right and toward the next house, and nothing else', () => {
    expect([...THROW_INTENTS]).toEqual(['left', 'right', 'next-house']);
    expectTypeOf<ThrowIntent>().toEqualTypeOf<'left' | 'right' | 'next-house'>();
    // Every key maps to one of them.
    for (const intent of Object.values(THROW_KEYS)) {
      expect(THROW_INTENTS).toContain(intent);
    }
  });

  it('reach the ride through one port method, which asks for a throw and nothing more', () => {
    expectTypeOf<keyof ThrowInputPort>().toEqualTypeOf<'throwParcel'>();
    expectTypeOf<Parameters<ThrowInputPort['throwParcel']>>().toEqualTypeOf<[ThrowIntent]>();
    expectTypeOf<ReturnType<ThrowInputPort['throwParcel']>>().toEqualTypeOf<void>();
  });
});

describe('a key — #1810', () => {
  it('maps the proposed default keys to their throws', () => {
    expect(
      ['ArrowLeft', 'PageUp', 'ArrowRight', 'PageDown', 'ArrowUp', 'Enter', ' '].map((name) =>
        intentOfKey(key(name)),
      ),
    ).toEqual(['left', 'left', 'right', 'right', 'next-house', 'next-house', 'next-house']);
  });

  it('asks for no throw from a key not in the map, nor from a name on the object prototype', () => {
    for (const name of ['a', 'Escape', 'Tab', 'ArrowDown', 'AudioVolumeUp', 'toString']) {
      expect(intentOfKey(key(name)), name).toBeUndefined();
    }
  });

  it('asks for none with a shortcut held, once a handler took it, or on a held key’s repeat', () => {
    for (const more of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { defaultPrevented: true },
      { repeat: true },
    ]) {
      expect(intentOfKey(key('ArrowLeft', more)), JSON.stringify(more)).toBeUndefined();
    }
    // Shift is no shortcut: a throw is still a throw.
    expect(intentOfKey(key('ArrowLeft', { shiftKey: true } as Partial<ThrowKeyEvent>))).toBe(
      'left',
    );
  });

  it('leaves every key to a form field', () => {
    for (const field of [
      placed(document.createElement('input')),
      placed(document.createElement('textarea')),
      placed(document.createElement('select')),
    ]) {
      for (const name of ['ArrowLeft', 'ArrowUp', 'Enter', ' ']) {
        expect(intentOfKey(key(name, { target: field })), `${field.tagName} ${name}`).toBe(
          undefined,
        );
      }
    }
    const editable = placed(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    expect(intentOfKey(key('ArrowRight', { target: editable }))).toBeUndefined();
  });

  it('leaves Enter and Space to a focused button, and throws on the arrows from one', () => {
    const button = placed(document.createElement('button'));
    const inside = button.appendChild(document.createElement('span'));
    for (const target of [button, inside]) {
      expect(intentOfKey(key('Enter', { target }))).toBeUndefined();
      expect(intentOfKey(key(' ', { target }))).toBeUndefined();
    }
    expect(intentOfKey(key('ArrowLeft', { target: button }))).toBe('left');
    expect(intentOfKey(key('PageDown', { target: button }))).toBe('right');
  });

  it('leaves Enter to a link and to a control with a role Enter activates', () => {
    const link = placed(document.createElement('a'));
    link.href = '#here';
    expect(intentOfKey(key('Enter', { target: link }))).toBeUndefined();
    const toggle = placed(document.createElement('div'));
    toggle.setAttribute('role', 'switch');
    expect(intentOfKey(key(' ', { target: toggle }))).toBeUndefined();
  });

  it('throws toward the next house on Enter or Space with no control focused', () => {
    const panel = placed(document.createElement('div'));
    expect(intentOfKey(key('Enter', { target: panel }))).toBe('next-house');
    expect(intentOfKey(key(' ', { target: document.body }))).toBe('next-house');
  });
});

const TARGETS: readonly ThrowTarget[] = [
  { position: 0, along: 100, side: 'left', clear: 2 },
  { position: 1, along: 160, side: 'right', clear: 2 },
  { position: 2, along: 220, side: 'left', clear: 2 },
];

describe('which side the next house is on — #1810, `throw.ts` §`throwSideFor`', () => {
  it('throws left and right as asked, whatever the round', () => {
    const round = startRound(3);
    expect(throwSideFor('left', { targets: TARGETS, round, along: 150 })).toBe('left');
    expect(throwSideFor('right', { targets: TARGETS, round, along: 90 })).toBe('right');
  });

  it('is the nearest house ahead still expecting a parcel, in whatever order the pick lists them', () => {
    const round = startRound(3);
    const shuffled = [TARGETS[2], TARGETS[1], TARGETS[0]] as ThrowTarget[];
    expect(throwSideFor('next-house', { targets: shuffled, round, along: 0 })).toBe('left');
    expect(throwSideFor('next-house', { targets: TARGETS, round, along: 130 })).toBe('right');
  });

  it('stays on a house until its window closes behind the rider', () => {
    const round = startRound(3);
    expect(
      throwSideFor('next-house', {
        targets: TARGETS,
        round,
        along: 100 + THROW_WINDOW_AFTER_METRES,
      }),
    ).toBe('left');
    expect(
      throwSideFor('next-house', {
        targets: TARGETS,
        round,
        along: 100 + THROW_WINDOW_AFTER_METRES + 0.01,
      }),
    ).toBe('right');
  });

  it('passes over a house already delivered or missed', () => {
    const round = recordMiss(recordDelivery(startRound(3), 0), 1);
    expect(throwSideFor('next-house', { targets: TARGETS, round, along: 0 })).toBe('left');
    const only = recordDelivery(startRound(3), 0);
    expect(throwSideFor('next-house', { targets: TARGETS, round: only, along: 0 })).toBe('right');
  });

  it('is no side at all once no house is left, so the key throws nothing', () => {
    const done = recordDelivery(recordDelivery(recordDelivery(startRound(3), 0), 1), 2);
    expect(throwSideFor('next-house', { targets: TARGETS, round: done, along: 0 })).toBe(undefined);
    expect(throwSideFor('next-house', { targets: TARGETS, round: startRound(3), along: 300 })).toBe(
      undefined,
    );
  });
});
