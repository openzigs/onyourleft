// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { RenderBoundary } from '../design/ChartSlot';
import { StatusMessage } from '../design/StatusMessage';
import type { ColourToken } from '../design/tokens';

import {
  ERG_CUE,
  LOW_CADENCE_LABEL,
  targetBand,
  targetBandWords,
  type TargetBandInput,
} from './target-band';

/**
 * The class each mark of the band is painted by, and the token it paints
 * with — #1434. `theme.css` §"THE BLOCK'S TARGET BAND" is the same table as
 * rules. Every token is one `tokens.ts` already pairs with `surface`, the
 * well the gauge paints for itself, or with `surfaceRaised` where a mark
 * crosses the band.
 *
 * Not colour alone (SC 1.4.1): the band is a shaded box with edges, the 3 s
 * power a tall bar with a cap, the block's average a ring — and the line
 * under the gauge says in words where the power is against the band.
 */
export const TARGET_BAND_PAINTS: readonly {
  readonly className: string;
  readonly token: ColourToken;
  readonly property: 'background-color' | 'border-color';
}[] = [
  { className: 'oyl-target-band__gauge', token: 'border', property: 'border-color' },
  { className: 'oyl-target-band__band', token: 'surfaceRaised', property: 'background-color' },
  { className: 'oyl-target-band__band', token: 'ink', property: 'border-color' },
  { className: 'oyl-target-band__power', token: 'accent', property: 'background-color' },
  { className: 'oyl-target-band__average', token: 'ink', property: 'border-color' },
];

export interface TargetBandProps {
  readonly workout: TargetBandInput;
}

/**
 * The block being ridden against its target, on the Ride screen — #1434.
 * `target-band.ts` is the numbers and the words, and says when there is no
 * band at all; then this renders nothing.
 *
 * ⚠️ **An image with a name**: the gauge is `role="img"` named with every
 * number it is drawn from, and the same numbers are written beside it.
 *
 * ⚠️ **A band that throws draws nothing and takes nothing with it**
 * (`RenderBoundary`): it sits on the screen that holds *End workout*.
 */
export function TargetBand(props: TargetBandProps): JSX.Element {
  return (
    <RenderBoundary fallback={null}>
      <Drawn {...props} />
    </RenderBoundary>
  );
}

const percent = (value: number): string => `${value.toFixed(2)}%`;

function Drawn({ workout }: TargetBandProps): JSX.Element | null {
  const band = targetBand(workout);
  if (band === undefined) {
    return null;
  }
  const words = targetBandWords(band);
  return (
    <div className="oyl-target-band" data-oyl-target-band={band.standing ?? 'none'}>
      <p className="oyl-target-band__heading">
        <span className="oyl-target-band__reading">{words.band}</span>
        {words.left === undefined ? null : <span>{words.left}</span>}
      </p>
      <div className="oyl-target-band__gauge" role="img" aria-label={words.name}>
        <span
          className="oyl-target-band__band"
          style={{ left: percent(band.at.low), width: percent(band.at.high - band.at.low) }}
        />
        {band.at.average === undefined ? null : (
          <span
            className="oyl-target-band__average"
            data-oyl-mark="average"
            style={{ left: percent(band.at.average) }}
          />
        )}
        {band.at.smoothed === undefined ? null : (
          <span
            className="oyl-target-band__power"
            data-oyl-mark="power"
            style={{ left: percent(band.at.smoothed) }}
          />
        )}
      </div>
      <p className="oyl-target-band__standing">
        <span className="oyl-target-band__reading">{words.standing}</span>
        {words.readings === '' ? null : <span>{words.readings}</span>}
      </p>
      <p className="oyl-target-band__cue">{ERG_CUE}</p>
      {words.cadence === undefined ? null : (
        <StatusMessage tone="warning" label={LOW_CADENCE_LABEL}>
          {words.cadence}
        </StatusMessage>
      )}
    </div>
  );
}
