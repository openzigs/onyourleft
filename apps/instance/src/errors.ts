// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's ONE error shape (#36).
 *
 * Every error response this instance sends is
 *
 * ```json
 * { "error": { "code": "validation_failed", "message": "…", "fields": [ … ] } }
 * ```
 *
 * with `fields` present only on `validation_failed`. `code` is the stable,
 * machine-readable half and is what a client branches on; `message` is for a
 * person and may be reworded in any release. A third party implements against
 * this (#36's revision block: anyone can run an instance), so a new code is an
 * addition and renaming one is a breaking change.
 *
 * ## What a message may say
 *
 * ⚠️ **Never a value from the request.** ADR 0004 decision D says a message
 * about a coordinate names the field and the constraint and never the value;
 * here that is widened to every value, because the instance cannot tell which
 * field a stranger's client put a coordinate or a token in. So a
 * `validation_failed` names the FIELD and the PROBLEM, and the problem is one of
 * this module's fixed sentences rather than an echo.
 *
 * ## Why there is no `forbidden`
 *
 * ⚠️ **Another athlete's resource is `not_found`, deliberately.** A 403 says
 * "this exists and is not yours", which is the cross-athlete exposure
 * `CLAUDE.md` §6 lists, leaked through a status code. #36 names the case
 * "forbidden/not-found" and this is the one code for it. `registration_closed`
 * (#772) is a 403 about the INSTANCE — it registers nobody — and names no
 * athlete's resource.
 */

/** Every code this instance can send, and the HTTP status each one is sent with. */
export const ERROR_STATUS = {
  validation_failed: 400,
  unauthenticated: 401,
  wrong_purpose: 401,
  wrong_instance: 401,
  challenge_unknown: 401,
  challenge_used: 401,
  challenge_expired: 401,
  bad_signature: 401,
  key_revoked: 401,
  code_unknown: 401,
  code_used: 401,
  code_expired: 401,
  registration_closed: 403,
  not_found: 404,
  method_not_allowed: 405,
  key_in_use: 409,
  last_device: 409,
  payload_too_large: 413,
  file_type_unsupported: 415,
  file_undecodable: 422,
  record_malformed: 422,
  record_unsupported: 422,
  record_signature_mismatch: 422,
  record_content_mismatch: 422,
  record_not_your_key: 422,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** The error codes, in the order the specification lists them. */
export const ERROR_CODES = Object.keys(ERROR_STATUS) as readonly ErrorCode[];

/** One field a request got wrong: the field's name and what is wrong with it. */
export interface FieldProblem {
  readonly field: string;
  readonly problem: string;
}

/** The body of every error response. */
export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly fields?: readonly FieldProblem[];
  };
}

/**
 * The sentence each code carries. Fixed, and containing nothing from the
 * request — see "What a message may say" above.
 */
const MESSAGES: Record<ErrorCode, string> = {
  validation_failed: 'The request is not valid. Each field named in `fields` says why.',
  unauthenticated: 'This needs a signed-in device.',
  wrong_purpose: 'The signature is not a statement made for this request.',
  wrong_instance: 'The signature was made for another instance.',
  challenge_unknown: 'This instance did not issue that challenge to that key.',
  challenge_used: 'That challenge has already been used. Ask for a new one.',
  challenge_expired: 'That challenge has expired. Ask for a new one.',
  bad_signature: 'The signature does not verify with that key.',
  key_revoked: 'That device key has been revoked.',
  code_unknown: 'That code is not one this instance issued.',
  code_used: 'That code has already been used.',
  code_expired: 'That code has expired.',
  registration_closed: 'This instance is not registering new riders.',
  key_in_use: 'That device key is already registered here.',
  last_device: 'This is your last device. Revoking it needs one of your recovery codes.',
  unavailable: 'This instance does not offer accounts.',
  file_type_unsupported: 'The file is not a FIT, GPX or TCX activity file.',
  file_undecodable: 'The activity file could not be read, or holds no samples.',
  record_malformed: 'The signed record is not an activity record.',
  record_unsupported: 'The signed record is of a version or scheme this instance does not know.',
  record_signature_mismatch: 'The signed record’s signature does not verify.',
  record_content_mismatch: 'The file is not the one the signed record vouches for.',
  record_not_your_key: 'The signed record is signed by a key that is not one of yours.',
  not_found: 'There is nothing here that this device may see.',
  method_not_allowed: 'This address does not accept that method.',
  payload_too_large: 'The request body is larger than this instance accepts.',
  rate_limited: 'Too many requests. Wait and try again.',
  internal: 'The instance could not answer this request.',
};

/** The JSON media type every body this instance writes carries. */
export const JSON_TYPE = 'application/json; charset=utf-8';

/** Options for {@link errorResponse}: the fields of a validation failure, and extra headers. */
export interface ErrorOptions {
  readonly fields?: readonly FieldProblem[];
  readonly headers?: Readonly<Record<string, string>>;
}

/** The body for a code. Exported so the specification and the tests read the same shape. */
export function errorBody(code: ErrorCode, fields?: readonly FieldProblem[]): ErrorBody {
  return {
    error: {
      code,
      message: MESSAGES[code],
      ...(code === 'validation_failed' ? { fields: fields ?? [] } : {}),
    },
  };
}

/** An error response in the one shape, with the status its code is sent with. */
export function errorResponse(code: ErrorCode, options: ErrorOptions = {}): Response {
  return new Response(JSON.stringify(errorBody(code, options.fields)), {
    status: ERROR_STATUS[code],
    headers: { 'content-type': JSON_TYPE, ...options.headers },
  });
}
