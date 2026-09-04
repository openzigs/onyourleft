// SPDX-License-Identifier: Apache-2.0

/**
 * The compile-time guarantees the simulator's bench makes.
 *
 * As in `../type-safety.test.ts`: each `// @ts-expect-error` is the assertion,
 * and if the rejected line ever compiles, `TS2578: Unused '@ts-expect-error'
 * directive` fails `pnpm run typecheck`. Verified by widening each parameter to
 * `number` against a clean tree; the mutation list is in the pull request.
 *
 * The bench is not the #39 interface, but it is where a test author types a
 * number in a hurry — `advance(30)`, `target: 250` — and a bench that accepted
 * the bare number would be the first unlabelled quantity in this package.
 */

import { seconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId } from '../index';
import { createSimulator, ftmsTrainer, type FtmsControlRequest } from './index';

describe('the bench takes labelled quantities only', () => {
  it('does not advance by a bare number', () => {
    const { bench } = createSimulator({ devices: [] });
    // @ts-expect-error thirty what? Seconds, but the type has to say so
    expect(() => bench.advance(30)).not.toThrow();
  });

  it('does not accept a bare number as a target power', () => {
    const request: Extract<FtmsControlRequest, { opCode: 'set-target-power' }> = {
      opCode: 'set-target-power',
      // @ts-expect-error a target is applied as resistance to a person who is pedalling; it is labelled or it is refused
      target: 250,
    };
    expect(request.target).toBe(250);
  });

  it('does not accept a bare number as a trainer power range', () => {
    // @ts-expect-error the supported range is a power, not a count
    expect(() => ftmsTrainer({ maxTargetPower: 1000 })).not.toThrow();
  });

  it('accepts the same values once labelled', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'trainer', maxTargetPower: watts(1000) })],
    });
    await transport.connect(deviceId('trainer'));
    const request: FtmsControlRequest = { opCode: 'set-target-power', target: watts(250) };
    bench.device(deviceId('trainer')).controlPoint?.enableIndications();
    expect(bench.device(deviceId('trainer')).controlPoint?.write(request)).toEqual({
      kind: 'accepted',
    });
    bench.advance(seconds(1));
  });
});
