// SPDX-License-Identifier: Apache-2.0

/**
 * The two cancellation types the runner uses, declared for this package's
 * platform-free program (`tsconfig.platform-free.json`, `lib: ["ES2024"]`,
 * `types: []`), which otherwise knows neither.
 *
 * `AbortController` is the one global the core names that ES2024 does not
 * define, and it is not a platform API in the sense ADR 0046 D-5 forbids: it
 * reaches no network, file, process, clock or device, and every runtime the
 * core runs in has it — a browser, the Android WebView, Node and `workerd`.
 * The runner already used it in `apps/web` (#811): a run's signal, and one
 * controller per step so a late reply can be cut off. #1094 moved it unchanged.
 *
 * Only what the runner calls is declared, so a wider use of either — or of
 * anything else they carry in a browser — is still a compile error here. In a
 * program with the DOM lib or `@types/node` these merge with the full
 * declarations.
 */

interface AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

// A global value is declared with `var` and nothing else: `const` would clash
// with the DOM lib's and `@types/node`'s own `var` where those are present.
// eslint-disable-next-line no-var
declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};
