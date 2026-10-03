// SPDX-License-Identifier: AGPL-3.0-or-later

/** ADR 0040 D-11's disclosure, as the three places a rider writes show it (#836). */

import type { JSX } from 'react';

import { KeptVisible } from '../design/KeptVisible';
import {
  RIDER_TEXT_DISCLOSURE_DETAIL,
  RIDER_TEXT_DISCLOSURE_LEAD,
  RIDER_TEXT_MODEL_WARNING,
} from './disclosure';

export function RiderTextDisclosure(): JSX.Element {
  return (
    <KeptVisible>
      <p className="oyl-muted">
        <strong>{RIDER_TEXT_DISCLOSURE_LEAD}</strong> {RIDER_TEXT_DISCLOSURE_DETAIL}
      </p>
      <p className="oyl-muted">{RIDER_TEXT_MODEL_WARNING}</p>
    </KeptVisible>
  );
}
