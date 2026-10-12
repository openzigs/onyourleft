// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one place a picture's hosted connection is built** — #1106, the
 * owner's ruling of 2026-10-12 (ruling 3): a side-camera picture may be shown
 * to *"a hosted vendor's model when the rider has entered their own key for
 * it"*, and never on anybody else's key.
 *
 * `analysis/hosted.ts` is the seam for text and puts every word behind the
 * rider's masking (#1101). A picture has no words to mask, so it does not go
 * through that seam: it goes through this one, whose connection can be handed
 * a picture and NOTHING else (`picture-model.ts` §`PictureLookRequest` has no
 * field for text), with the question fixed here.
 * `hosted-pictures-seam.test.ts` walks every shipped module of the instance
 * and fails if any other names `createHostedPictureModel`.
 *
 * What a hosted service is sent, in full: {@link SIDE_POSE_QUESTION}, one
 * JPEG, the model's name and a token bound. No athlete id, no session, no
 * ride, no file name, and nothing the rider typed.
 */

import { createHostedPictureModel } from '../analysis/model.ts';
import type { OpenedHostedKey } from '../analysis/source.ts';
import type { PictureConnection, PictureQuestion } from './picture-model.ts';

/**
 * The one question a side-camera picture is sent with. A constant of this
 * repository: nothing of a rider's is in it, and no request can change it.
 *
 * ⚠️ **The same words the app asked the rider's own computer**
 * (`apps/web/src/camera/analysis-port.ts` §`ANALYSIS_PROMPTS` `side-pose`),
 * copied because the instance may not import the client, and because the
 * answer is read by the app's one reader of that shape
 * (`side-pose-answer` in `apps/web/src/camera/computer-pose.ts`
 * §`sidePoseFromAnswer`). A change to either is a change to both.
 */
export const SIDE_POSE_QUESTION =
  'First decide whether this picture shows a person riding a bicycle, filmed from the side. ' +
  'It may show nobody at all: an empty room, a blank picture or noise. If it does not clearly ' +
  'show a person on a bicycle, or you are not sure, reply with JSON only: {"rider":false} ' +
  'Only if it clearly does, find the side of their body nearest the camera and reply with ' +
  'JSON only, with no other text, ' +
  'in exactly this form: {"rider":true,"nearSide":"left","landmarks":{"ear":[x,y],' +
  '"shoulder":[x,y],"elbow":[x,y],"wrist":[x,y],"hip":[x,y],"knee":[x,y],"ankle":[x,y],' +
  '"heel":[x,y],"toe":[x,y]}} where x and y are the point as fractions of the picture from its ' +
  'top-left corner, each between 0 and 1, "toe" is the tip of the shoe, "nearSide" is the ' +
  'person’s own left or right, and a point you cannot see is null.';

/**
 * The answer's bound: 512 tokens. Nine landmarks as JSON are about 150.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const SIDE_POSE_ANSWER_TOKENS = 512;

/** What every picture connection here is built to ask. */
export const SIDE_POSE_PICTURE_QUESTION: PictureQuestion = {
  question: SIDE_POSE_QUESTION,
  maxOutputTokens: SIDE_POSE_ANSWER_TOKENS,
};

/** The hosted model on the rider's own opened key, for pictures and the one fixed question. */
export function hostedForPictures(
  key: OpenedHostedKey,
  fetch?: typeof globalThis.fetch,
): PictureConnection {
  return createHostedPictureModel({
    baseUrl: new URL(key.url),
    model: key.model,
    apiKey: key.key,
    question: SIDE_POSE_PICTURE_QUESTION,
    ...(key.reasoningTokens === undefined ? {} : { reasoningTokens: key.reasoningTokens }),
    ...(fetch === undefined ? {} : { fetch }),
  });
}
