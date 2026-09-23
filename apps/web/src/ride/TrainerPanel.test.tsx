// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * What the trainer panel tells a rider about a machine it will not drive —
 * #370's third acceptance criterion.
 *
 * > *A rider whose trainer serves only a proprietary control point is told
 * > "this trainer records fine but cannot be controlled" rather than "no
 * > controllable trainer".*
 *
 * ⚠️ **The three sentences are the subject, and they are asserted as strings.**
 * That is deliberately brittle in the way `TrainerPanel.tsx`'s header already
 * says the word *Holding* is: the whole defect was one sentence covering three
 * states, so a test that only checked "some notice appeared" would have passed
 * against the version this replaces.
 */

import { describe, expect, it, afterEach } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, type Mounted } from '../testing/mount';

import type { TrainerSnapshot } from './controller';
import { TrainerPanel } from './TrainerPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const snapshot = (overrides: Partial<TrainerSnapshot> = {}): TrainerSnapshot => ({
  paired: true,
  controllable: false,
  controlChoice: { kind: 'none' },
  canSetPower: false,
  canSimulate: false,
  powerRange: undefined,
  hasControl: false,
  target: { kind: 'none' },
  requested: undefined,
  lost: undefined,
  refusal: undefined,
  releaseFault: undefined,
  ...overrides,
});

async function render(trainer: TrainerSnapshot): Promise<string> {
  mounted = await mount(
    <TrainerPanel
      trainer={trainer}
      onRequestControl={() => undefined}
      onSetTargetPower={() => undefined}
      onClearTarget={() => undefined}
    />,
  );
  return (mounted.container.textContent ?? '').replace(/\s+/g, ' ');
}

describe('a trainer this app will not drive', () => {
  it('says a vendor-only machine records fine and cannot be controlled', async () => {
    const text = await render(
      snapshot({
        controlChoice: { kind: 'vendor-not-implemented', controlPoint: 'a026e005-0a7d' },
      }),
    );

    expect(text).toContain('records fine but cannot be controlled');
    // ⚠️ And NOT the sentence it used to get, which told a rider with a real
    // trainer that their trainer was not one.
    expect(text).not.toContain('does not offer a control point this app recognises');
  });

  /**
   * The other half of the pair the old sentence conflated: a machine that
   * offers FTMS and will not say what it can take. The rider's next action is
   * different — this one is worth chasing a firmware update for.
   */
  it('says a machine with a control point and no power range is missing the range', async () => {
    const text = await render(
      snapshot({
        controlChoice: {
          kind: 'fitness-machine',
          service: '00001826-0000-1000-8000-00805f9b34fb',
          controlPoint: '00002ad9-0000-1000-8000-00805f9b34fb',
          vendorAlsoPresent: false,
        },
      }),
    );

    // ⚠️ The whole phrase, not just 'did not report the power range'. The
    // general sentence contains those words too, so the short needle was green
    // against a panel that had collapsed back to one message — measured, by
    // pointing every branch at the general entry and watching this case stay
    // green.
    expect(text).toContain('offers a Fitness Machine control point but did not report the power');
    expect(text).not.toContain('records fine but cannot be controlled');
  });

  it('keeps the general sentence when nothing is known about the machine', async () => {
    const text = await render(snapshot());

    expect(text).toContain('does not offer a control point this app recognises');
  });

  /**
   * ⚠️ The control for the three above. A panel that rendered nothing at all
   * would satisfy every `not.toContain` and two thirds of this file would be
   * green over an empty box.
   */
  it('renders a notice at all — the control', async () => {
    expect(await render(snapshot())).not.toBe('');
  });
});

describe('the precedence rule, made observable — #370', () => {
  /**
   * `chooseTrainerControl` gives the standard control point priority outright.
   * Until it had a caller that priority was applied by accident, and a bug
   * report about a trainer behaving differently under two apps had nothing to
   * quote.
   */
  it('says the vendor control point is being passed over', async () => {
    const text = await render(
      snapshot({
        controllable: true,
        canSetPower: true,
        hasControl: true,
        controlChoice: {
          kind: 'fitness-machine',
          service: '00001826-0000-1000-8000-00805f9b34fb',
          controlPoint: '00002ad9-0000-1000-8000-00805f9b34fb',
          vendorAlsoPresent: true,
        },
      }),
    );

    expect(text).toContain('also carries its manufacturer’s own control point');
  });

  it('says nothing about a manufacturer when there is no vendor control point', async () => {
    const text = await render(
      snapshot({
        controllable: true,
        canSetPower: true,
        hasControl: true,
        controlChoice: {
          kind: 'fitness-machine',
          service: '00001826-0000-1000-8000-00805f9b34fb',
          controlPoint: '00002ad9-0000-1000-8000-00805f9b34fb',
          vendorAlsoPresent: false,
        },
      }),
    );

    expect(text).not.toContain('manufacturer');
    // The control: the ERG form is there, so the assertion above ran over a
    // panel that rendered something.
    expect(text).toContain('ERG target');
  });
});

describe('after a release — #372', () => {
  const driven = {
    controllable: true,
    canSetPower: true,
    controlChoice: {
      kind: 'fitness-machine' as const,
      service: '00001826-0000-1000-8000-00805f9b34fb',
      controlPoint: '00002ad9-0000-1000-8000-00805f9b34fb',
      vendorAlsoPresent: false,
    },
  };

  it('says nothing alarming after an acknowledged release, and does not ask for control again', async () => {
    // What the controller leaves behind an acknowledged release: control KEPT,
    // and no loss. ⚠️ PR #442's Reset left `hasControl: false` here and the
    // panel asking for control after every ride; a reviewer who remembers that
    // is reading the old file. `controller.test.ts` asserts the controller gets
    // here; this is what the rider then reads.
    const text = await render(snapshot({ ...driven, hasControl: true }));

    expect(text).not.toContain('Ask the trainer for control');
    expect(text).not.toContain('Control lost');
    expect(text).not.toContain('Not released');
  });

  it('says so when the trainer did not confirm it let go', async () => {
    const text = await render(
      snapshot({
        ...driven,
        hasControl: true,
        releaseFault: 'It may still be holding resistance.',
      }),
    );

    expect(text).toContain('Not released');
    expect(text).toContain('It may still be holding resistance.');
  });
});

describe('control is its own step, and ERG is one thing to do with it — #503', () => {
  const driven = {
    controllable: true,
    canSetPower: true,
    canSimulate: true,
    controlChoice: {
      kind: 'fitness-machine' as const,
      service: '00001826-0000-1000-8000-00805f9b34fb',
      controlPoint: '00002ad9-0000-1000-8000-00805f9b34fb',
      vendorAlsoPresent: false,
    },
  };

  it('does not frame pairing as being for ERG', async () => {
    const text = await render(snapshot({ paired: false }));
    expect(text).toContain('Pair a smart trainer to control it');
    // The sentence the owner read on 2026-09-23.
    expect(text).not.toContain('ERG');
  });

  it('asks for control as its own step, without showing an ERG form', async () => {
    const text = await render(snapshot({ ...driven, hasControl: false }));
    expect(text).toContain('This app does not have control of the trainer');
    // And says the game does not need this detour.
    expect(text).toContain('the trainer game asks for it itself when you press Ride');
    expect(text).toContain('Ask the trainer for control');
    expect(mounted?.container.querySelector('#oyl-erg-target')).toBeNull();
    expect(text).not.toContain('ERG, optional');
  });

  it('offers control to a trainer that takes no power target — the game may still drive it', async () => {
    // ⚠️ Until #503 the "No ERG" early return came first, so a machine without
    // Target Setting bit 3 had no way to be given control on this screen at
    // all — and the game, which never needs ERG, could not have it either.
    const text = await render(snapshot({ ...driven, canSetPower: false, hasControl: false }));
    expect(text).toContain('Ask the trainer for control');
  });

  it('says control is held, and shows ERG as optional — one thing to do with it', async () => {
    const text = await render(snapshot({ ...driven, hasControl: true }));
    expect(text).toContain('This app has control of the trainer.');
    expect(text).toContain('ERG, optional: No target set. The trainer is following your effort.');
    expect(mounted?.container.querySelector('#oyl-erg-target')).not.toBeNull();
    expect(text).not.toContain('Ask the trainer for control');
  });

  it('still says a target is outstanding when control went while it was asked for', async () => {
    // "Requested is not confirmed" survives the loss: the write is still in
    // flight, and hiding it with the ERG section would hide the one sentence
    // that says the machine may be about to change.
    const text = await render(
      snapshot({ ...driven, hasControl: false, lost: 'permission-lost', requested: watts(220) }),
    );
    expect(text).toContain('Asked for 220 W — waiting for the trainer to confirm');
  });

  it('still says a target may be held after control went', async () => {
    const text = await render(
      snapshot({
        ...driven,
        hasControl: false,
        lost: 'link-lost',
        target: { kind: 'unknown', attempted: watts(250) },
      }),
    );
    expect(text).toContain('may still be holding 250 W');
    expect(text).toContain('Ask the trainer for control');
    expect(mounted?.container.querySelector('#oyl-erg-target')).toBeNull();
  });
});
