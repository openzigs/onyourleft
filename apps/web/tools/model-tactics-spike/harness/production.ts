// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **the instance's own prompt and request**, as the
 * harness takes them.
 *
 * The words the model is told and the body it is sent live in
 * `apps/instance/src/analysis/tactics-prompt.ts` and `pacer-prompt.ts`. The
 * harness keeps no copy of either: `run-harness.mjs` loads those two modules
 * and hands them to `main.ts`, and `harness.test.ts` loads them the same way
 * and holds them to this shape. So a change to a prompt, a schema or a
 * request is what the next run scores, with no edit here.
 *
 * They are handed in, not imported, for two reasons. `apps/instance` is not
 * a dependency of the client (ADR 0036 D-3), and every test in `apps/web`
 * that needs it reaches it by a path, never by an import the client's
 * program compiles. And this directory is walked by `spike-boundary.test.ts`,
 * which follows only imports it can name.
 */

import type { ModelPacerInput, ModelTacticsInput } from '@onyourleft/domain';

/** What the harness takes from `apps/instance/src/analysis/tactics-prompt.ts`. */
export interface TacticsPromptModule {
  readonly TACTICS_PROMPT_VERSION: string;
  readonly tacticsRequest: (
    model: string,
    input: ModelTacticsInput,
  ) => Readonly<Record<string, unknown>>;
}

/** What the harness takes from `apps/instance/src/analysis/pacer-prompt.ts`. */
export interface PacerPromptModule {
  readonly PACER_PROMPT_VERSION: string;
  readonly pacerRequest: (
    model: string,
    input: ModelPacerInput,
  ) => Readonly<Record<string, unknown>>;
}

/** The instance's two prompt modules. */
export interface Production {
  readonly tactics: TacticsPromptModule;
  readonly pacer: PacerPromptModule;
}

/** Where the two modules are, from the repository's `apps/instance/src/analysis/`. */
export const PRODUCTION_MODULES = {
  tactics: 'tactics-prompt.ts',
  pacer: 'pacer-prompt.ts',
} as const;

/**
 * `modules` as {@link Production}, checked: a module that no longer exports
 * what the harness sends is an error here, before any model is asked.
 *
 * @throws {Error} naming the export that is missing.
 */
export function productionFrom(modules: {
  readonly tactics: unknown;
  readonly pacer: unknown;
}): Production {
  const has = (module: unknown, name: string, type: 'string' | 'function'): void => {
    if (
      typeof module !== 'object' ||
      module === null ||
      typeof (module as Record<string, unknown>)[name] !== type
    ) {
      throw new Error(`the instance's prompt module no longer exports ${name} as a ${type}`);
    }
  };
  has(modules.tactics, 'TACTICS_PROMPT_VERSION', 'string');
  has(modules.tactics, 'tacticsRequest', 'function');
  has(modules.pacer, 'PACER_PROMPT_VERSION', 'string');
  has(modules.pacer, 'pacerRequest', 'function');
  return modules as Production;
}
