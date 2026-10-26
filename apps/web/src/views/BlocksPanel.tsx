// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import type { BlocksPort, HeldBlock } from '../instance/blocks-port';

/**
 * **Riders you blocked** (#1529): on the Instance screen, every block this
 * rider made on the instance this device signed in to, each with the name
 * the race's result showed them when they blocked, and *Unblock*.
 *
 * The device never holds another rider's athlete id, so a block is listed and
 * undone by the instance's opaque handle for it (`instance/blocks-port.ts`).
 * A press asks first, as blocking does (`rooms/RaceResult.tsx`): unblocking
 * lets the two meet again. A rider with no block, or no instance, sees
 * nothing here.
 *
 * ⚠️ Draft wording awaiting the owner's approval.
 */
export const BLOCKS_TEXT = {
  heading: 'Riders you blocked',
  intro:
    'Neither of you is named to the other in a race, and a public room keeps you apart. ' +
    'Unblocking does not tell them.',
  /** A block the instance kept no name for: made before it kept names, or the rider deleted their account. */
  unnamed: 'A rider whose name was not kept',
  blockedOn: (date: string): string => `blocked ${date}`,
  open: 'Unblock',
  question: (subject: string, object: string): string =>
    `Unblock ${object}? From your next ride, you can be named to each other in a race and ` +
    `meet in a public room. ${subject} is not told.`,
  confirm: (object: string): string => `Unblock ${object}`,
  cancel: 'Cancel',
  sending: 'Sending…',
  unblocked: (subject: string): string => `${subject} is unblocked.`,
  unreachable: 'Not unblocked: your instance could not be reached.',
} as const;

/** A day, in UTC, so the screen says the same thing wherever it is read. */
function day(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** How a block's rider is named at the start of a sentence, and inside one. */
function riderOf(block: HeldBlock): { readonly subject: string; readonly object: string } {
  return block.name === null
    ? { subject: 'This rider', object: 'this rider' }
    : { subject: block.name, object: block.name };
}

type Undoing =
  | { readonly handle: string; readonly kind: 'asking' }
  | { readonly handle: string; readonly kind: 'sending' };

export function BlocksPanel({ port }: { readonly port: BlocksPort }): JSX.Element | null {
  const [blocks, setBlocks] = useState<readonly HeldBlock[] | undefined>(undefined);
  const [undoing, setUndoing] = useState<Undoing | undefined>(undefined);
  const [said, setSaid] = useState<string | undefined>(undefined);
  /** The block whose question was cancelled: its *Unblock*, back in its place, takes focus. */
  const [cancelled, setCancelled] = useState<string | undefined>(undefined);
  const answer = useRef<HTMLParagraphElement>(null);

  const read = useCallback(async (): Promise<void> => {
    const got = await port.read();
    if (got.kind === 'blocks') setBlocks(got.blocks);
  }, [port]);
  useEffect(() => {
    void read();
  }, [read]);
  useEffect(() => {
    // The confirming control is gone: focus goes to what became of the block.
    if (said !== undefined) answer.current?.focus();
  }, [said]);

  if (blocks === undefined || (blocks.length === 0 && said === undefined)) return null;

  const unblock = (block: HeldBlock): void => {
    setUndoing({ handle: block.handle, kind: 'sending' });
    void port.unblock(block.handle).then(async (done) => {
      setUndoing(undefined);
      if (done.kind === 'unblocked') {
        setSaid(BLOCKS_TEXT.unblocked(riderOf(block).subject));
        // Read back from the instance, not taken off the list here.
        await read();
      } else {
        setSaid(BLOCKS_TEXT.unreachable);
      }
    });
  };

  return (
    <section className="oyl-panel" aria-labelledby="oyl-instance-blocks">
      <h2 id="oyl-instance-blocks">{BLOCKS_TEXT.heading}</h2>
      <p>{BLOCKS_TEXT.intro}</p>
      {said === undefined ? null : (
        <p ref={answer} tabIndex={-1} role="status">
          {said}
        </p>
      )}
      {blocks.length === 0 ? null : (
        <ul className="oyl-moderation__list">
          {blocks.map((block) => {
            const { subject, object } = riderOf(block);
            const here = undoing?.handle === block.handle ? undoing : undefined;
            const questionId = `oyl-unblock-${block.handle}`;
            return (
              <li key={block.handle}>
                {block.name ?? BLOCKS_TEXT.unnamed}, {BLOCKS_TEXT.blockedOn(day(block.blockedAt))}
                {here === undefined ? (
                  <>
                    {' '}
                    <Button
                      variant="secondary"
                      focusOnMount={cancelled === block.handle}
                      onClick={() => {
                        setCancelled(undefined);
                        setSaid(undefined);
                        setUndoing({ handle: block.handle, kind: 'asking' });
                      }}
                    >
                      {BLOCKS_TEXT.open}
                      <span className="oyl-visually-hidden"> {object}</span>
                    </Button>
                  </>
                ) : here.kind === 'asking' ? (
                  <div role="group" aria-label={BLOCKS_TEXT.confirm(object)}>
                    <p id={questionId}>{BLOCKS_TEXT.question(subject, object)}</p>
                    <Button
                      variant="danger"
                      focusOnMount
                      describedBy={questionId}
                      onClick={() => {
                        unblock(block);
                      }}
                    >
                      {BLOCKS_TEXT.confirm(object)}
                    </Button>{' '}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCancelled(block.handle);
                        setUndoing(undefined);
                      }}
                    >
                      {BLOCKS_TEXT.cancel}
                    </Button>
                  </div>
                ) : (
                  <p>{BLOCKS_TEXT.sending}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
