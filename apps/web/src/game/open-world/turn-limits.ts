// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where an open-world ride offers no turn, on purpose, and the words that
 * say so** — #3124.
 *
 * The owner's tablet ride of 2026-11-24: "There are still a number of streets
 * that don't offer the option to turn onto … If there are limitations we just
 * need to make that known". Each reason a junction pop-up is not raised where
 * a street meets the ridden road was looked for (the issue's list), and each
 * one found is an accepted decision, so it is kept on purpose and said here:
 *
 * | Limit | Why | Where it is enforced |
 * |---|---|---|
 * | `service` | ADR 0091 D-3, the owner's answer to D-9 Q2: the tiles cannot tell a driveway from an alley, and leaving them in offers a turn at most driveways in a suburb | `@onyourleft/map-features` §`inStreetGraph` |
 * | `private` | ADR 0091 D-3: `access` `no` or `private` | the same |
 * | `motorway` | ADR 0091 D-3: `kind` `highway`, a motorway or its link | the same |
 * | `path` | ADR 0091 D-3, the owner's answer to D-9 Q1: footways, cycleways and paths, and the tracks and bridleways decoded with them, are not streets in the first version | `@onyourleft/map-features` §`decodeTile`, before the graph |
 * | `not-joined` | ADR 0091 D-4: a street meets the road where the two share a point within 1 m, cross, or one ends within 3 m of the other (`street-graph.ts` §`SNAP_METRES`, §`T_SNAP_METRES`); a street mapped to stop short of that meets it nowhere | `street-graph.ts` |
 * | `too-close` | ADR 0088 D-1.2 and D-1.5, under ADR 0087 D-6.2's grade safety: only the next junction is prompted, and a choice is final 100 m before its junction, so a junction less than 100 m after the last one, after a U-turn, or round a roundabout, takes its default | `junction-choice.ts`, `RollingRoute.choose` |
 *
 * And one that is not a limit, said because a rider may expect it to be one:
 * ADR 0091 D-5, the owner's answer to D-9 Q3, offers a one-way street **both
 * ways**.
 *
 * ⚠️ **Every sentence below is a draft** for the owner to approve (#3124's
 * acceptance). They are shown in the open-world start screen's help
 * (`shell/routes.ts` §`OPEN_WORLD_ROUTE`). `open-world/junction-limits.test.tsx`
 * rides a fixture junction for each limit through the real game screen,
 * holds that it offers no choice, and holds that its words are in that help.
 * `docs/agents/game.md` lists the limits for agents.
 *
 * Plain words and no import, because the shell's route table reads it.
 */

/** A reason an open-world junction offers no turn, kept on purpose. @see the header */
export type TurnLimit = 'service' | 'private' | 'motorway' | 'path' | 'not-joined' | 'too-close';

/** Each limit's words, as the help says them. Drafts for the owner (#3124). */
export const TURN_LIMIT_WORDS: Readonly<Record<TurnLimit, string>> = {
  service: 'driveways, car parks and alleys',
  private: 'private roads',
  motorway: 'motorways',
  path: 'footpaths, cycle paths and farm tracks',
  'not-joined': 'a street the map does not join to yours',
  'too-close':
    'A choice is final 100 metres (330 feet) before its junction, so a junction less than ' +
    '100 metres after the last one, after a U-turn or round a roundabout takes the way most ' +
    'nearly straight on.',
};

/**
 * The open-world start screen's help paragraph on turns: where they are
 * offered, every limit of {@link TURN_LIMIT_WORDS}, and that a one-way street
 * is offered both ways (ADR 0091 D-5). A draft for the owner (#3124).
 */
export const TURN_LIMITS_HELP =
  'Turns are offered where a public street meets the one you are on. Not offered: ' +
  `${TURN_LIMIT_WORDS.service}; ${TURN_LIMIT_WORDS.private}; ${TURN_LIMIT_WORDS.motorway}; ` +
  `${TURN_LIMIT_WORDS.path}; and ${TURN_LIMIT_WORDS['not-joined']}. ` +
  `${TURN_LIMIT_WORDS['too-close']} One-way streets are offered both ways.`;
