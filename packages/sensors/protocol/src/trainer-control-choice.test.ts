// SPDX-License-Identifier: Apache-2.0

/**
 * #90 criterion 7 as a decision: which control point, on a machine with more
 * than one.
 *
 * The end-to-end half — a simulated device serving both, driven, with the
 * proprietary characteristic observed untouched — is in
 * `fitness-machine-simulation.test.ts`. This is the rule itself.
 */

import { describe, expect, it } from 'vitest';

import { CYCLING_POWER_MEASUREMENT, CYCLING_POWER_SERVICE } from './cycling-power';
import { FITNESS_MACHINE_CONTROL_POINT, FITNESS_MACHINE_SERVICE } from './fitness-machine';
import { HEART_RATE_SERVICE } from './heart-rate';
import { canonicalUuid } from './uuid';
import { chooseTrainerControl, WAHOO_TRAINER_CONTROL_POINT } from './trainer-control-choice';

describe('choosing a control point', () => {
  it('prefers FTMS when a machine offers both', () => {
    expect(
      chooseTrainerControl([
        CYCLING_POWER_SERVICE,
        WAHOO_TRAINER_CONTROL_POINT,
        FITNESS_MACHINE_SERVICE,
      ]),
    ).toStrictEqual({
      kind: 'fitness-machine',
      service: FITNESS_MACHINE_SERVICE,
      controlPoint: FITNESS_MACHINE_CONTROL_POINT,
      vendorAlsoPresent: true,
    });
  });

  it('prefers FTMS whichever order the link resolved them in', () => {
    // Not an order-dependent scan: the vendor characteristic first is exactly
    // how a device that serves 0x1818 before 0x1826 would present.
    const first = chooseTrainerControl([WAHOO_TRAINER_CONTROL_POINT, FITNESS_MACHINE_SERVICE]);
    const second = chooseTrainerControl([FITNESS_MACHINE_SERVICE, WAHOO_TRAINER_CONTROL_POINT]);
    expect(first).toStrictEqual(second);
    expect(first.kind).toBe('fitness-machine');
  });

  it('takes the FTMS control point on its own, for a caller that listed characteristics', () => {
    const choice = chooseTrainerControl([FITNESS_MACHINE_CONTROL_POINT]);
    expect(choice.kind).toBe('fitness-machine');
    expect(choice.kind === 'fitness-machine' && choice.vendorAlsoPresent).toBe(false);
  });

  it('reports a proprietary-only machine as unimplemented rather than absent', () => {
    expect(
      chooseTrainerControl([CYCLING_POWER_SERVICE, WAHOO_TRAINER_CONTROL_POINT]),
    ).toStrictEqual({ kind: 'vendor-not-implemented', controlPoint: WAHOO_TRAINER_CONTROL_POINT });
  });

  it('answers none for a device with no control point of either kind', () => {
    expect(
      chooseTrainerControl([HEART_RATE_SERVICE, CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT]),
    ).toStrictEqual({ kind: 'none' });
    expect(chooseTrainerControl([])).toStrictEqual({ kind: 'none' });
  });

  it('compares through the canonical form, so 0x1826 and the long form are one entry', () => {
    expect(chooseTrainerControl([0x1826]).kind).toBe('fitness-machine');
    expect(chooseTrainerControl(['0000ffff-0000-1000-8000-00805f9b34fb']).kind).toBe('none');
  });

  it('refuses a UUID that is neither form, rather than silently ignoring it', () => {
    // A misspelling that was ignored would be a controllable trainer reported
    // as uncontrollable, which is the hardest failure in this stack to chase.
    expect(() => chooseTrainerControl(['not-a-uuid'])).toThrow(RangeError);
  });

  it('carries the vendor characteristic in its canonical form', () => {
    expect(WAHOO_TRAINER_CONTROL_POINT).toBe(canonicalUuid('A026E005-0A7D-4AB3-97FA-F1500F9FEB8B'));
    // ⚠️ Secondary-sourced, and the file says why that is tolerable: it is
    // only ever recognised, never written to. This pins the transcription, not
    // the value's provenance.
    expect(WAHOO_TRAINER_CONTROL_POINT).toBe('a026e005-0a7d-4ab3-97fa-f1500f9feb8b');
    expect(WAHOO_TRAINER_CONTROL_POINT).not.toBe(FITNESS_MACHINE_CONTROL_POINT);
  });
});
