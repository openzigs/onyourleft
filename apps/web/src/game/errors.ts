// SPDX-License-Identifier: AGPL-3.0-or-later

/** Why the game could not do something a rider asked for. */
export type GameErrorCode =
  /**
   * A stored ride cannot be replayed as a ghost.
   *
   * An input error rather than a programmer error: the recording is whatever the
   * rider's sensors produced that day, and "this ride is too holed to race
   * against" is a thing to tell them rather than a bug.
   */
  'ghost-unusable';

/** @see GameErrorCode */
export class GameError extends Error {
  readonly code: GameErrorCode;

  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}
