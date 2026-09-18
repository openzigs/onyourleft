// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, type JSX } from 'react';

import { creditsFrom, externalLink, licenceLink, type CreditedWork } from '../credits/credits';
import { parseAssetManifest } from '../credits/manifest';
import { ASSET_MANIFEST_SOURCE } from '../credits/source';
import { StatusMessage } from '../design/StatusMessage';

/**
 * Who made the art this app ships, generated from `ASSETS.toml` — #358.
 *
 * ## Why this page exists, and why it is not a list somebody maintains
 *
 * [ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md) admits `CC-BY-4.0`
 * for a committed asset, and CC BY is the one licence in this repository whose
 * obligation never ends: it is discharged by the shipped application crediting
 * the work, every time it ships. §3(a)(2) lets that be satisfied *"in any
 * reasonable manner based on the medium"*, and the medium here is an APK —
 * somebody who installs this app never sees the repository, so a row in a file
 * in git is not reasonably discoverable *by them*. This screen is where the
 * notice is discoverable, beside the AGPL statement on the About page that is
 * there for the same reason.
 *
 * ⚠️ **It is derived, not written.** `ASSET001` already forces `ASSETS.toml` to
 * name every committed binary — a binary it does not name is a red build, and
 * discovery walks the tree rather than trusting an extension list. A screen
 * generated from the manifest inherits that completeness; a hand-maintained
 * list cannot, and ADR 0023 §"What would make this ADR wrong" says a
 * hand-maintained credits list should be read as the failure of that decision
 * rather than as a workaround.
 *
 * ## The two sections, and the one that must not imply an obligation
 *
 * The first section is what the app **must** credit. The second is offered
 * anyway, for assets whose licence asks for nothing — every one in the tree
 * today. They are separate, and the courtesy one says in words that nothing is
 * owed, because #358's third bullet is that the screen *"must not imply an
 * obligation that does not exist"*.
 *
 * ## What is rendered when something is wrong
 *
 * A manifest line the client cannot read, and an attribution-requiring entry
 * with a key missing, are both **shown**. `ASSET006` and `ASSET005` already
 * make each a red build, so neither can reach a release — and the answer to
 * "what if one does" is a visible problem rather than a row quietly missing
 * from the page. A dropped row is an asset credited nowhere, which is the one
 * outcome ADR 0023 §Consequences calls a licensing defect.
 */

export interface CreditsViewProps {
  /**
   * The manifest to credit from. Defaults to the one built into this bundle.
   *
   * A prop only so that `CreditsView.test.tsx` can render a manifest carrying
   * a `CC-BY-4.0` asset. There is none in the tree — ADR 0023 D-7 makes this
   * screen the thing that lands before the first one — so without it every
   * assertion about the attributed half would pass over an empty list.
   */
  readonly manifest?: string;
}

/**
 * The sentence CC BY 4.0 §3(a)(1)(A)(ii) and (iii) ask for, once.
 *
 * ADR 0023 D-3: the copyright notice and the warranty disclaimer are the same
 * sentence for every attributed work, so they are the screen's own wording
 * rather than a per-asset key that could drift row by row.
 */
const NOTICE =
  'Each work below remains the copyright of its creator and is used under the licence named ' +
  'beside it. The material is provided as-is, without warranties of any kind.';

/** One work, its licence, what was changed, and the files taken from it. */
function Work({ work }: { readonly work: CreditedWork }): JSX.Element {
  const licence = licenceLink(work.licence);
  const original = externalLink(work.url);
  return (
    <li>
      <p>
        <strong>{work.creator === '' ? 'Creator not recorded' : work.creator}</strong>
        {original === undefined ? null : (
          <>
            {' — '}
            <a href={original} target="_blank" rel="noreferrer">
              the original
            </a>
          </>
        )}
        {', under '}
        {licence === undefined ? (
          work.licence
        ) : (
          <a href={licence} target="_blank" rel="noreferrer">
            {work.licence}
          </a>
        )}
        .
      </p>
      <p>{modificationNote(work)}</p>
      <ul>
        {work.files.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * What the modification note says.
 *
 * ⚠️ `"no"` is a recorded answer rather than an absent one — ADR 0023 D-3 —
 * so it is rendered as a statement rather than as silence. A work whose entry
 * records nothing at all says that too, because the alternative is the screen
 * claiming an asset is unmodified on no evidence.
 */
function modificationNote(work: CreditedWork): string {
  if (work.modified === undefined) {
    return 'Whether this app changed it is not recorded.';
  }
  return work.modified.trim().toLowerCase() === 'no'
    ? 'Used unmodified.'
    : `Modified by this app: ${work.modified}`;
}

export function CreditsView({ manifest }: CreditsViewProps): JSX.Element {
  const credits = useMemo(
    () => creditsFrom(parseAssetManifest(manifest ?? ASSET_MANIFEST_SOURCE)),
    [manifest],
  );

  return (
    <>
      {credits.problems.length === 0 ? null : (
        <StatusMessage tone="warning" label="This page may be incomplete">
          <p>
            Some of what this app records about its assets could not be read, so somebody may be
            missing from this page.
          </p>
          <ul>
            {credits.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </StatusMessage>
      )}

      <p>
        This page is generated from the record this app keeps of every file it ships that somebody
        else made — the artwork in the trainer game, and the templates the Android build is
        assembled from. Nothing here is typed by hand, so an asset cannot be added without appearing
        here. Links to the originals open in a new tab.
      </p>

      <h2>Credited because the licence asks for it</h2>
      {credits.required.length === 0 ? (
        <StatusMessage tone="info" label="Nothing owed">
          No asset in this build is under a licence that requires attribution. Everything below is
          credited because it seemed right, not because it was asked for.
        </StatusMessage>
      ) : (
        <>
          <p>{NOTICE}</p>
          <ul>
            {credits.required.map((work) => (
              <Work key={`${work.creator}${work.licence}${work.files[0] ?? ''}`} work={work} />
            ))}
          </ul>
        </>
      )}

      <h2>Credited as a courtesy</h2>
      {credits.courtesy.length === 0 ? (
        <p>Nothing else in this build came from somebody outside this project.</p>
      ) : (
        <>
          <p>
            Each of these is published under a licence that asks for nothing in return — no credit
            is required and none is implied to be owed. They are here because the work was worth
            crediting anyway.
          </p>
          <ul>
            {credits.courtesy.map((work) => (
              <Work key={`${work.creator}${work.licence}${work.files[0] ?? ''}`} work={work} />
            ))}
          </ul>
        </>
      )}

      <h2>Where this list comes from</h2>
      <p>
        From <code>ASSETS.toml</code> in this project&rsquo;s own repository, which records the
        source, the licence and a checksum for every file of somebody else&rsquo;s that is committed
        to it. A file that is not recorded there fails the build, so this page is as complete as
        that record is.
      </p>
    </>
  );
}
