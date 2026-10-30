// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One picture shown to a model, as the side camera's route sees it** —
 * #1106, the port between `camera/side-pose.ts` and the one module that names
 * the AI SDK (`analysis/model.ts`, ADR 0046 D-8).
 *
 * ⚠️ **A picture and nothing else.** {@link PictureLookRequest} has no field
 * for text: the question a model is asked is a constant of this repository,
 * fixed when the connection is built ({@link PictureQuestion}), so nothing a
 * rider typed, no id and no name can travel beside a picture (ADR 0029 D-7:
 * *"The frame, and a fixed prompt this repository's source contains. Nothing
 * else"*).
 *
 * ⚠️ **A failure is a closed enumeration** ({@link PictureFailure}), as
 * `analysis/model-turn.ts`'s is. A model server's own error text can echo
 * what it was sent, and what it was sent is a photograph of a rider: it never
 * crosses this port, into a log line, an error or a response (ADR 0029 D-8).
 */

/** The fixed question, and how long an answer may be. Constants of the caller's module. */
export interface PictureQuestion {
  readonly question: string;
  /** The answer's own bound, in tokens, beside any reasoning allowance. */
  readonly maxOutputTokens: number;
}

/** One picture: JPEG bytes, already checked by `camera/picture.ts`. */
export interface PictureLookRequest {
  readonly picture: Uint8Array;
  /** How long the model may take before the look is given up as `timed-out`. */
  readonly timeoutMilliseconds: number;
  /** An abort here aborts the request on the wire. */
  readonly signal: AbortSignal;
}

/** Why a look gave no answer. Closed: nothing else ever crosses the port. */
export type PictureFailure =
  /** The configured name resolved outside the local ranges (ADR 0040 D-6). */
  | 'not-local'
  /** The configured name resolved to nothing. */
  | 'unresolved'
  /** No answer: refused, reset, or the connection failed. */
  | 'unreachable'
  | 'timed-out'
  | 'aborted'
  /** The server said this model, or this service, takes no picture. */
  | 'model-without-pictures'
  /** Any other 4xx. */
  | 'refused'
  /** Any 5xx. */
  | 'server-error'
  /** A reply that is not a chat completion. */
  | 'malformed';

export type PictureLook =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: PictureFailure };

/** A model that is shown pictures, one at a time. */
export interface PictureConnection {
  look(request: PictureLookRequest): Promise<PictureLook>;
}
