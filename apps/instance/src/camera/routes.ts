// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's one route (#1106): a picture in, a model's words out,
 * nothing kept. `side-pose.ts` says what it holds and the rulings it follows.
 *
 * `auth: 'session'` and `reaches: 'own'`: the athlete is the session's, the
 * hosted key read is theirs alone, and no body or path names an athlete.
 *
 * ⚠️ **Sealed, on every instance.** It is marked `sealed: 'only'` and listed
 * in `sealed/phase-one.ts`, which refuses a plaintext request on an instance
 * that holds keys before a session is read or a body parsed. An instance with
 * NO keys answers its other sealed routes in plaintext (ADR 0047 D-7), and
 * this route must not follow them: the owner's ruling is *"if it is not
 * available they are refused, never sent unsealed"*. So the handler below
 * answers `sealed_required` itself to anything that did not arrive inside
 * `POST /v1/sealed`, and a keyless instance takes no picture at all.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route } from '../route-kit.ts';
import { PICTURE_SOURCES } from './side-pose.ts';

export const SIDE_POSE_PATH = '/v1/camera/side-pose';

export const CAMERA_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: SIDE_POSE_PATH,
    sealed: 'only',
    operationId: 'lookAtSidePicture',
    reaches: 'own',
    summary:
      'Show ONE side-camera picture to a model and answer what it said (#1106). `picture` is a JPEG of at most 64 KiB, base64, carrying no location or device metadata. `source` is `instance-local` (the model this instance’s operator named for pictures, on the box) or `instance-hosted` (the hosted service YOUR OWN key is for, never anybody else’s), and with `instance-hosted` `endpoint` is the `https:` origin your own consent to send pictures there names: a key at another origin is refused `picture_source_unavailable`. The model is asked one fixed question and sent the picture and nothing else. **The picture is not stored**: not in a table, a file or a log; it is dropped with the request. `answer` is the model’s own text, unread, for your device to read as numbers or nothing. Reached only sealed, on every instance: one that holds no keys answers `sealed_required`. `rate_limited` while another picture of yours is with the model; `pictures_off` when no local model is named for pictures; `model_without_pictures` when the model said it takes none; `picture_model_failed` when it gave no usable answer.',
    identity: true,
    auth: 'session',
    sidePose: true,
    request: {
      type: 'object',
      properties: {
        picture: { type: 'string' },
        source: { type: 'string', enum: [...PICTURE_SOURCES] },
        endpoint: { type: 'string' },
      },
      required: ['picture', 'source'],
      additionalProperties: false,
    },
    errors: [
      'unauthenticated',
      'validation_failed',
      'sealed_required',
      'rate_limited',
      'pictures_off',
      'picture_source_unavailable',
      'model_without_pictures',
      'picture_model_failed',
      'unavailable',
    ],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      // Never unsealed: on an instance with no keys too (the file comment).
      if (!context.sealedRequest) return errorResponse('sealed_required');
      const { sidePose, caller } = context;
      if (sidePose === undefined || caller === undefined) return errorResponse('unavailable');
      const outcome = await sidePose.look(caller, context.json, context.request.signal);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
];
