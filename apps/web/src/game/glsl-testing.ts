// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A GLSL function, evaluated** — #678. Test support, never shipped (the
 * `-testing.ts` suffix).
 *
 * A shader's arithmetic that a TypeScript twin claims to match "step for
 * step" is held to that twin by nothing unless something runs the shader's
 * own text. The browser gate reads the product through AgX, which draws a
 * tint's shift at about three quarters of its size, so a tolerance wide enough
 * for that let a tint half again too strong through (#678). This reads the
 * GLSL the renderer ACTUALLY hands three and evaluates it on the CPU, so a
 * unit test can compare it with the twin to the sixth decimal place.
 *
 * ## What it reads
 *
 * Exactly the subset the realistic world's tint uses, and a throw for
 * anything else rather than a guess: a body of `float|vec3 name = expr;`
 * statements and one `return expr;`; `+ - * /` over floats and `vec3`s with a
 * float broadcast to a `vec3`; unary minus; `.x .y .z` (and `.r .g .b`);
 * `vec3(…)` of one or three floats; and `cos`, `sin`, `floor`, `max`, `dot`
 * and `cross`. Evaluated in double precision, where the GPU uses single, so a
 * comparison needs a tolerance of about 1e-6 of the values compared.
 */

/** A value in the subset: a float, or a `vec3`. */
export type GlslValue = number | readonly [number, number, number];

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'symbol'; readonly value: string };

function tokens(source: string): Token[] {
  const found: Token[] = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_]\w*)|([-+*/(),;=.{}]))/y;
  let at = 0;
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) {
      break;
    }
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (match === null) {
      throw new Error(`glsl-testing cannot read ${JSON.stringify(source.slice(at, at + 20))}`);
    }
    at = pattern.lastIndex;
    const [, number, name, symbol] = match;
    if (number !== undefined) {
      found.push({ kind: 'number', value: Number(number) });
    } else if (name !== undefined) {
      found.push({ kind: 'name', value: name });
    } else {
      found.push({ kind: 'symbol', value: symbol ?? '' });
    }
  }
  return found;
}

const COMPONENT: Readonly<Record<string, 0 | 1 | 2>> = { x: 0, y: 1, z: 2, r: 0, g: 1, b: 2 };

function elementwise(a: GlslValue, b: GlslValue, op: (x: number, y: number) => number): GlslValue {
  if (typeof a === 'number' && typeof b === 'number') {
    return op(a, b);
  }
  const at = (value: GlslValue, index: 0 | 1 | 2): number =>
    typeof value === 'number' ? value : value[index];
  return [op(at(a, 0), at(b, 0)), op(at(a, 1), at(b, 1)), op(at(a, 2), at(b, 2))];
}

function vector(value: GlslValue, name: string): readonly [number, number, number] {
  if (typeof value === 'number') {
    throw new Error(`glsl-testing: ${name} wants a vec3`);
  }
  return value;
}

function scalar(value: GlslValue, name: string): number {
  if (typeof value !== 'number') {
    throw new Error(`glsl-testing: ${name} wants a float`);
  }
  return value;
}

const FUNCTIONS: Readonly<Record<string, (args: readonly GlslValue[]) => GlslValue>> = {
  cos: ([a]) => Math.cos(scalar(a ?? 0, 'cos')),
  sin: ([a]) => Math.sin(scalar(a ?? 0, 'sin')),
  floor: ([a]) => Math.floor(scalar(a ?? 0, 'floor')),
  max: ([a, b]) => elementwise(a ?? 0, b ?? 0, Math.max),
  dot: ([a, b]) => {
    const [x, y] = [vector(a ?? 0, 'dot'), vector(b ?? 0, 'dot')];
    return x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  },
  cross: ([a, b]) => {
    const [x, y] = [vector(a ?? 0, 'cross'), vector(b ?? 0, 'cross')];
    return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  },
  vec3: (args) => {
    if (args.length === 1) {
      const only = scalar(args[0] ?? 0, 'vec3');
      return [only, only, only];
    }
    if (args.length !== 3) {
      throw new Error('glsl-testing: vec3 takes one float or three');
    }
    return [
      scalar(args[0] ?? 0, 'vec3'),
      scalar(args[1] ?? 0, 'vec3'),
      scalar(args[2] ?? 0, 'vec3'),
    ];
  },
};

/**
 * The GLSL function `name` in `source`, as a TypeScript function of its
 * arguments. Throws when the function is not there, or holds anything outside
 * the subset this file reads.
 */
export function glslFunction(
  source: string,
  name: string,
): (...args: readonly GlslValue[]) => GlslValue {
  const header = new RegExp(`(?:float|vec3)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
  if (header === null) {
    throw new Error(`glsl-testing: no function ${name} in the source`);
  }
  // The body runs to the brace that closes the one the header opened.
  let depth = 1;
  let end = header.index + header[0].length;
  for (; end < source.length && depth > 0; end += 1) {
    depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
  }
  const body = source.slice(header.index + header[0].length, end - 1);
  const parameters = (header[1] ?? '')
    .split(',')
    .map((parameter) => parameter.trim().split(/\s+/)[1] ?? '')
    .filter((parameter) => parameter !== '');
  const program = tokens(body);

  return (...args) => {
    if (args.length !== parameters.length) {
      throw new Error(`glsl-testing: ${name} takes ${String(parameters.length)} arguments`);
    }
    const scope = new Map<string, GlslValue>(
      parameters.map((parameter, index) => [parameter, args[index] ?? 0]),
    );
    let at = 0;
    const peek = (): Token | undefined => program[at];
    const take = (): Token => {
      const next = program[at];
      if (next === undefined) {
        throw new Error(`glsl-testing: ${name} ended early`);
      }
      at += 1;
      return next;
    };
    const expect = (symbol: string): void => {
      const next = take();
      if (next.kind !== 'symbol' || next.value !== symbol) {
        throw new Error(`glsl-testing: ${name} wanted ${symbol}, read ${String(next.value)}`);
      }
    };
    const isSymbol = (symbol: string): boolean => {
      const next = peek();
      return next?.kind === 'symbol' && next.value === symbol;
    };

    const primary = (): GlslValue => {
      const next = take();
      if (next.kind === 'number') {
        return next.value;
      }
      if (next.kind === 'symbol') {
        if (next.value !== '(') {
          throw new Error(`glsl-testing: ${name} read ${next.value} where a value belongs`);
        }
        const inner = expression();
        expect(')');
        return inner;
      }
      if (isSymbol('(')) {
        take();
        const args: GlslValue[] = [];
        while (!isSymbol(')')) {
          args.push(expression());
          if (isSymbol(',')) {
            take();
          }
        }
        expect(')');
        const call = FUNCTIONS[next.value];
        if (call === undefined) {
          throw new Error(`glsl-testing: ${name} calls ${next.value}, which it cannot evaluate`);
        }
        return call(args);
      }
      const value = scope.get(next.value);
      if (value === undefined) {
        throw new Error(`glsl-testing: ${name} reads ${next.value}, which has no value`);
      }
      return value;
    };
    const postfix = (): GlslValue => {
      let value = primary();
      while (isSymbol('.')) {
        take();
        const field = take();
        const index = field.kind === 'name' ? COMPONENT[field.value] : undefined;
        if (index === undefined) {
          throw new Error(`glsl-testing: ${name} reads .${String(field.value)}`);
        }
        value = vector(value, `.${String(field.value)}`)[index];
      }
      return value;
    };
    const unary = (): GlslValue => {
      if (isSymbol('-')) {
        take();
        return elementwise(0, unary(), (a, b) => a - b);
      }
      return postfix();
    };
    const term = (): GlslValue => {
      let value = unary();
      while (isSymbol('*') || isSymbol('/')) {
        const op = take().value;
        const right = unary();
        value = elementwise(value, right, op === '*' ? (a, b) => a * b : (a, b) => a / b);
      }
      return value;
    };
    function expression(): GlslValue {
      let value = term();
      while (isSymbol('+') || isSymbol('-')) {
        const op = take().value;
        const right = term();
        value = elementwise(value, right, op === '+' ? (a, b) => a + b : (a, b) => a - b);
      }
      return value;
    }

    while (at < program.length) {
      const first = take();
      if (first.kind === 'name' && first.value === 'return') {
        const value = expression();
        expect(';');
        return value;
      }
      if (first.kind !== 'name' || (first.value !== 'float' && first.value !== 'vec3')) {
        throw new Error(`glsl-testing: ${name} holds a statement it cannot read`);
      }
      const variable = take();
      expect('=');
      const value = expression();
      expect(';');
      if ((first.value === 'float') !== (typeof value === 'number')) {
        throw new Error(
          `glsl-testing: ${name} declares ${String(variable.value)} as the wrong type`,
        );
      }
      scope.set(String(variable.value), value);
    }
    throw new Error(`glsl-testing: ${name} returns nothing`);
  };
}
