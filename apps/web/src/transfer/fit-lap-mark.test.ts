// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { FitActivity } from '@onyourleft/fit';
import { FIT_APPLICATION_ID, fitLapKindsOf, fitLapMarkOf } from './fit-lap-mark';

type Input = Pick<FitActivity, 'developerApplications' | 'laps'>;

function activityWith(applicationIndex: number, fieldIndex: number): Input {
  return {
    developerApplications: [
      {
        developerDataIndex: applicationIndex,
        applicationId: FIT_APPLICATION_ID,
        manufacturerId: undefined,
        applicationVersion: undefined,
      },
    ],
    laps: [
      { developerFields: [{ ...fitLapMarkOf('lap'), developerDataIndex: fieldIndex }] },
    ] as unknown as Input['laps'],
  };
}

describe('fitLapKindsOf', () => {
  it('reads a mark declared at the same developer data index as this application', () => {
    expect(fitLapKindsOf(activityWith(1, 1))).toEqual(['lap']);
  });

  it("does not read another application's field 0 as the lap mark", () => {
    expect(fitLapKindsOf(activityWith(1, 0))).toBe('broken');
  });
});
