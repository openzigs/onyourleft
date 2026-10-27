// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one sentence a rider whose hosted key was deleted reads, once** —
 * [#1103](https://github.com/openzigs/onyourleft/issues/1103), #1104's A1.
 *
 * Drawn at the top of the Camera page, where the key was typed. It reads the
 * note `retired-hosted-key.ts` left at launch as the page opens, and takes the
 * note away once the page has shown it, so the next visit says nothing. Its
 * own module rather than a part of `views/CameraView.tsx` because that view
 * holds a model's answer, and a view that holds one builds no link
 * (`camera/analysis-safety.test.ts` §"builds no URL").
 */

import { useEffect, useState, type JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';
import { hrefFor, INSTANCE_ROUTE } from '../shell/routes';

import {
  forgetRetiredKeyNotice,
  readRetiredKeyNotice,
  RETIRED_KEY_AFTER,
  RETIRED_KEY_BEFORE,
  type RetiredKeyStorage,
} from './retired-hosted-key';

export function RetiredKeyNotice({
  storage,
}: {
  /** This device's storage, or `undefined` where the browser refuses it. */
  readonly storage: RetiredKeyStorage | undefined;
}): JSX.Element | null {
  const [shown] = useState(() => readRetiredKeyNotice(storage));
  useEffect(() => {
    if (shown) forgetRetiredKeyNotice(storage);
  }, [shown, storage]);
  if (!shown) return null;
  return (
    <StatusMessage tone="info">
      {RETIRED_KEY_BEFORE} <a href={hrefFor(INSTANCE_ROUTE)}>{INSTANCE_ROUTE.title}</a>
      {RETIRED_KEY_AFTER}
    </StatusMessage>
  );
}
