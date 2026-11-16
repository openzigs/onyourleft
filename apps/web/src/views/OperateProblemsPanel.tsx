// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  momentText,
  noProblemsText,
  PROBLEMS_HELD_TEXT,
  PROBLEMS_UNREADABLE_TEXT,
  problemSentence,
  problemsSinceText,
  RAW_LINE_LABEL,
} from '@onyourleft/operate-text';
import { useEffect, useState, type JSX } from 'react';

import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type { OperatePort, OperateProblem, OperateProblemsRead } from '../instance/operate-port';

/**
 * **Recent problems** (#2614, epic #2601): the instance's last problem lines,
 * from `GET /v1/operate/logs`, without opening a terminal on the host.
 *
 * Each line is said as a sentence from `docs/operating-an-instance.md`'s
 * tables (`@onyourleft/operate-text` §`problemSentence`), with its time; the
 * line itself, exactly as the instance logged it, is behind *The line as
 * logged*. A line has been through the instance's one redaction before it
 * left it — no token, key, name or coordinate — and the port holds each to
 * what that redaction writes before it reaches the screen.
 *
 * The instance keeps them in memory only, so the section says since when:
 * after a restart the list starts again.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

export { PROBLEMS_UNREADABLE_TEXT } from '@onyourleft/operate-text';

function Line({ problem }: { readonly problem: OperateProblem }): JSX.Element {
  return (
    <li>
      <strong>{momentText(problem.at)}</strong>: {problemSentence(problem.fields)}
      <details className="oyl-details">
        <summary>{RAW_LINE_LABEL}</summary>
        <code>{problem.line}</code>
      </details>
    </li>
  );
}

/** The Recent problems section: the instance's last problem lines, newest first. */
export function OperateProblemsPanel({
  port,
}: {
  readonly port: Pick<OperatePort, 'problems'>;
}): JSX.Element {
  const [read, setRead] = useState<OperateProblemsRead | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void port.problems().then((next) => {
      if (current) setRead(next);
    });
    return () => {
      current = false;
    };
  }, [port]);

  const heading = (
    <SectionHeading level={2} id="oyl-operate-problems" help={<p>{PROBLEMS_HELD_TEXT}</p>}>
      Recent problems
    </SectionHeading>
  );
  if (read === undefined) {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-problems">
        {heading}
        <p className="oyl-muted">Reading the recent problems…</p>
      </section>
    );
  }
  if (read.kind !== 'problems') {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-problems">
        {heading}
        <StatusMessage tone="warning" label="Not read" live>
          {PROBLEMS_UNREADABLE_TEXT}
        </StatusMessage>
      </section>
    );
  }
  const since = momentText(read.since);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-problems">
      {heading}
      {read.lines.length === 0 ? (
        <p className="oyl-muted">{noProblemsText(since)}</p>
      ) : (
        <>
          <p>{problemsSinceText(since)}</p>
          <ol className="oyl-operate__problems">
            {read.lines.map((problem, index) => (
              // Two lines may be the same text at the same second: the place in the list is the key.
              <Line key={`${String(index)} ${problem.at}`} problem={problem} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
