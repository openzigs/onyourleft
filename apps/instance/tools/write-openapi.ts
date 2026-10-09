// SPDX-License-Identifier: AGPL-3.0-or-later

import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

/**
 * Write `apps/instance/openapi.json` from the route table (#36).
 *
 * The only way that file is meant to change. `src/openapi.test.ts` fails when
 * the committed file is not what this writes, so a route added without running
 * this is a red build rather than a specification that quietly lies.
 *
 * The resolve hook goes first, as in `src/main.ts`: the route table reaches
 * the workspace packages' extensionless imports (`src/node-imports.ts`).
 */
registerHooks({ resolve: resolveExtensionless });

const { openApiText } = await import('../src/openapi.ts');
const { ROUTES } = await import('../src/routes.ts');

const target = new URL('../openapi.json', import.meta.url);
writeFileSync(target, openApiText(ROUTES));
process.stdout.write(`wrote ${target.pathname}\n`);
