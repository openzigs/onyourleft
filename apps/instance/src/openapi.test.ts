// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorBody, ERROR_CODES } from './errors.ts';
import { startTestInstance, type TestInstance } from './instance-testing.ts';
import { openApiDocument, openApiText } from './openapi.ts';
import { ROUTES, type Schema } from './routes.ts';

/**
 * The specification cannot drift from the implementation (#36): the committed
 * file is what the route table generates, and every route's body is what its
 * entry declares, read through the real listener.
 */

const COMMITTED = new URL('../openapi.json', import.meta.url);
const REGENERATE = 'pnpm --filter @onyourleft/instance run openapi:generate';

/** Problems with `value` against the subset of JSON Schema `routes.ts` allows. */
function violations(value: unknown, schema: Schema, at = '$'): string[] {
  if ('$ref' in schema) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const components = (openApiDocument(ROUTES).components as { schemas: Record<string, Schema> })
      .schemas;
    const target = components[name];
    return target === undefined
      ? [`${at}: unresolved ${schema.$ref}`]
      : violations(value, target, at);
  }
  if ('enum' in schema) {
    return typeof value === 'string' && schema.enum.includes(value) ? [] : [`${at}: not in enum`];
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : Number.isInteger(value)
          ? 'integer'
          : typeof value;
  if (!types.includes(actual as never)) return [`${at}: ${actual} is not ${types.join('|')}`];
  if (actual === 'string' && 'format' in schema && schema.format === 'uri') {
    return URL.canParse(value as string) ? [] : [`${at}: not a URI`];
  }
  if (schema.type === 'array') {
    return (value as unknown[]).flatMap((item, index) =>
      violations(item, schema.items, `${at}[${String(index)}]`),
    );
  }
  if (schema.type === 'object' && 'properties' in schema) {
    const record = value as Record<string, unknown>;
    const found: string[] = [];
    for (const key of schema.required) if (!(key in record)) found.push(`${at}.${key}: missing`);
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties[key];
      if (property === undefined) found.push(`${at}.${key}: not declared`);
      else found.push(...violations(item, property, `${at}.${key}`));
    }
    return found;
  }
  return [];
}

describe('the committed specification', () => {
  it(`is what the route table generates — if not, run \`${REGENERATE}\``, () => {
    expect(readFileSync(COMMITTED, 'utf8')).toBe(openApiText(ROUTES));
  });

  it('describes every route the handler dispatches on, and nothing else', () => {
    const paths = openApiDocument(ROUTES).paths as Record<string, Record<string, unknown>>;
    const described = Object.entries(paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(described.sort()).toEqual(ROUTES.map((route) => `${route.method} ${route.path}`).sort());
  });

  it('declares every error code, and the error schema accepts every error body', () => {
    const document = openApiDocument(ROUTES) as {
      components: { schemas: { Error: Schema }; responses: Record<string, unknown> };
    };
    expect(Object.keys(document.components.responses)).toEqual([...ERROR_CODES]);
    for (const code of ERROR_CODES) {
      const body = errorBody(code, [{ field: 'limit', problem: 'must be a whole number' }]);
      expect(violations(body, document.components.schemas.Error)).toEqual([]);
    }
  });
});

describe('every route answers with the shape its entry declares', () => {
  let instance: TestInstance;
  beforeAll(async () => {
    instance = await startTestInstance();
  });
  afterAll(async () => {
    await instance.listening.close();
  });

  it.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s',
    async (_, route) => {
      const response = await fetch(`${instance.url}${route.path}`, { method: route.method });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        `${route.response.contentType}; charset=utf-8`,
      );
      if (route.response.contentType === 'application/json') {
        expect(violations(await response.json(), route.response.schema)).toEqual([]);
      } else {
        expect(typeof (await response.text())).toBe('string');
      }
    },
  );

  it('the checker itself rejects a body that does not match — the control', () => {
    const health = ROUTES.find((route) => route.path === '/health');
    if (health?.response.contentType !== 'application/json') throw new Error('no /health');
    expect(violations({ status: 'ok', version: '1' }, health.response.schema)).toEqual([
      '$.commit: missing',
    ]);
    expect(violations({ status: 'ok', version: 1, commit: null }, health.response.schema)).toEqual([
      '$.version: integer is not string',
    ]);
    expect(
      violations({ status: 'ok', version: '1', commit: null, extra: true }, health.response.schema),
    ).toEqual(['$.extra: not declared']);
  });
});
