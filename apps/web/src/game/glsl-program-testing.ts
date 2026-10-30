// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A GLSL program, evaluated** — #1662. Test support, never shipped (the
 * `-testing.ts` suffix), beside `glsl-testing.ts`.
 *
 * `glsl-testing.ts` reads the straight-line subset the tint uses. The room
 * behind the glass is branching, vector code — `if`, `else if`, a ternary,
 * `vec2`s, `vec3`s, constant arrays and calls between functions — so this
 * reads that: the source a test hands it, whole, on the CPU. It exists so
 * that `oylInterior`'s colour, and the pane each call site hands it, are held
 * to the twin (`facade.ts` §`interiorAt`) by running the shader's own text,
 * not by reading it.
 *
 * ## What it reads, and what it throws for
 *
 * Top-level `const TYPE name = expr;` and `const TYPE name[N] = TYPE[N](…);`
 * and functions `TYPE name(TYPE param, …) { … }` over `float`, `int`, `vec2`
 * and `vec3`; statements `TYPE name = expr;`, `name = expr;` and `name op=
 * expr;`, `if` / `else if` / `else`, and `return`; expressions `+ - * /`
 * (a vector with a vector or a float), `< <= > >= == !=`, `&& ||`, `?:`,
 * unary `-` and `!`, `.x .y .z .w` swizzles, `a[i]`, and calls — the
 * program's own, the constructors `vec2` `vec3` `float` `int` and `TYPE[N]`,
 * and `abs min max clamp floor ceil fract sin cos mod mix step smoothstep
 * sign dot length sqrt pow`. Anything else (`out` parameters, loops,
 * structs, `uniform`) is a thrown error rather than a guess. Evaluated in
 * double precision, where the GPU uses single, so a comparison with the twin
 * is exact only where the twin is double too.
 */

/** A value in the subset: a float or an int, or a `vec2` or `vec3` as an array. */
export type GlslNumbers = number | readonly number[];

type Token = { readonly kind: 'number' | 'name' | 'symbol'; readonly text: string };

function tokensOf(source: string): Token[] {
  const found: Token[] = [];
  const pattern =
    /\s*(?:\/\/[^\n]*|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*)|(<=|>=|==|!=|&&|\|\||\+=|-=|\*=|\/=|[-+*/(),;=.{}[\]<>?:!]))/y;
  let at = 0;
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) break;
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (match === null) {
      throw new Error(
        `glsl-program-testing cannot read ${JSON.stringify(source.slice(at, at + 24))}`,
      );
    }
    at = pattern.lastIndex;
    const [, number, name, symbol] = match;
    if (number !== undefined) found.push({ kind: 'number', text: number });
    else if (name !== undefined) found.push({ kind: 'name', text: name });
    else if (symbol !== undefined) found.push({ kind: 'symbol', text: symbol });
  }
  return found;
}

type Value = number | number[];
type Scope = { readonly vars: Map<string, Value>; readonly parent: Scope | undefined };
type Expr = (scope: Scope) => Value;
/** A statement answers `undefined` to carry on, or `{ value }` once it has returned. */
type Stmt = (scope: Scope) => { readonly value: Value } | undefined;

const TYPES = new Set(['float', 'int', 'vec2', 'vec3', 'void']);

function lookup(scope: Scope, name: string): Value {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
    const found = s.vars.get(name);
    if (found !== undefined) return found;
  }
  throw new Error(`glsl-program-testing: ${name} is not bound`);
}

function assign(scope: Scope, name: string, value: Value): void {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
    if (s.vars.has(name)) {
      s.vars.set(name, value);
      return;
    }
  }
  throw new Error(`glsl-program-testing: ${name} is assigned before it is declared`);
}

/** `f` over the components of the arguments, a float broadcast against a vector. */
function lift(f: (...xs: number[]) => number, args: readonly Value[]): Value {
  const width = Math.max(...args.map((a) => (typeof a === 'number' ? 1 : a.length)));
  if (width === 1 && args.every((a) => typeof a === 'number')) {
    return f(...(args as number[]));
  }
  return Array.from({ length: width }, (_, i) =>
    f(...args.map((a) => (typeof a === 'number' ? a : (a[i] as number)))),
  );
}

const fract = (x: number): number => x - Math.floor(x);
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
  return t * t * (3 - 2 * t);
};

const componentsOf = (value: Value): number[] => (typeof value === 'number' ? [value] : value);

const BUILT_INS: Readonly<Record<string, (...args: Value[]) => Value>> = {
  abs: (x) => lift(Math.abs, [x]),
  min: (a, b) => lift(Math.min, [a, b]),
  max: (a, b) => lift(Math.max, [a, b]),
  clamp: (x, lo, hi) => lift((v, l, h) => Math.min(Math.max(v, l), h), [x, lo, hi]),
  floor: (x) => lift(Math.floor, [x]),
  ceil: (x) => lift(Math.ceil, [x]),
  fract: (x) => lift(fract, [x]),
  sin: (x) => lift(Math.sin, [x]),
  cos: (x) => lift(Math.cos, [x]),
  sqrt: (x) => lift(Math.sqrt, [x]),
  sign: (x) => lift(Math.sign, [x]),
  pow: (a, b) => lift(Math.pow, [a, b]),
  mod: (a, b) => lift((x, y) => x - y * Math.floor(x / y), [a, b]),
  mix: (a, b, t) => lift((x, y, k) => x * (1 - k) + y * k, [a, b, t]),
  step: (edge, x) => lift((e, v) => (v < e ? 0 : 1), [edge, x]),
  smoothstep: (lo, hi, x) => lift(smoothstep, [lo, hi, x]),
  dot: (a, b) => {
    const v = componentsOf(b);
    return componentsOf(a).reduce((sum, x, i) => sum + x * (v[i] ?? 0), 0);
  },
  length: (a) => Math.hypot(...componentsOf(a)),
  int: (x) => lift(Math.trunc, [x]),
  float: (x) => x,
};

function binary(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '+':
      return lift((x, y) => x + y, [a, b]);
    case '-':
      return lift((x, y) => x - y, [a, b]);
    case '*':
      return lift((x, y) => x * y, [a, b]);
    case '/':
      return lift((x, y) => x / y, [a, b]);
    default:
      throw new Error(`glsl-program-testing: no operator ${op}`);
  }
}

function scalar(value: Value): number {
  if (typeof value !== 'number')
    throw new Error('glsl-program-testing: a vector where a float is read');
  return value;
}

class Parser {
  private at = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly program: GlslProgram,
  ) {}

  done(): boolean {
    return this.at >= this.tokens.length;
  }

  peek(offset = 0): string | undefined {
    return this.tokens[this.at + offset]?.text;
  }

  take(): Token {
    const token = this.tokens[this.at];
    if (token === undefined) throw new Error('glsl-program-testing: the source ends early');
    this.at += 1;
    return token;
  }

  expect(text: string): void {
    const token = this.take();
    if (token.text !== text) {
      throw new Error(`glsl-program-testing: expected ${text} and read ${token.text}`);
    }
  }

  accept(text: string): boolean {
    if (this.peek() === text) {
      this.at += 1;
      return true;
    }
    return false;
  }

  // Expressions, loosest first.
  expression(): Expr {
    const test = this.or();
    if (!this.accept('?')) return test;
    const yes = this.expression();
    this.expect(':');
    const no = this.expression();
    return (scope) => (scalar(test(scope)) !== 0 ? yes(scope) : no(scope));
  }

  private or(): Expr {
    let left = this.and();
    while (this.accept('||')) {
      const [a, b] = [left, this.and()];
      left = (scope) => (scalar(a(scope)) !== 0 || scalar(b(scope)) !== 0 ? 1 : 0);
    }
    return left;
  }

  private and(): Expr {
    let left = this.equality();
    while (this.accept('&&')) {
      const [a, b] = [left, this.equality()];
      left = (scope) => (scalar(a(scope)) !== 0 && scalar(b(scope)) !== 0 ? 1 : 0);
    }
    return left;
  }

  private equality(): Expr {
    let left = this.relational();
    while (this.peek() === '==' || this.peek() === '!=') {
      const op = this.take().text;
      const [a, b] = [left, this.relational()];
      left = (scope) => ((scalar(a(scope)) === scalar(b(scope))) === (op === '==') ? 1 : 0);
    }
    return left;
  }

  private relational(): Expr {
    let left = this.additive();
    while (['<', '<=', '>', '>='].includes(this.peek() ?? '')) {
      const op = this.take().text;
      const [a, b] = [left, this.additive()];
      left = (scope) => {
        const [x, y] = [scalar(a(scope)), scalar(b(scope))];
        return (op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y) ? 1 : 0;
      };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.take().text;
      const [a, b] = [left, this.multiplicative()];
      left = (scope) => binary(op, a(scope), b(scope));
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.take().text;
      const [a, b] = [left, this.unary()];
      left = (scope) => binary(op, a(scope), b(scope));
    }
    return left;
  }

  private unary(): Expr {
    if (this.accept('-')) {
      const operand = this.unary();
      return (scope) => lift((x) => -x, [operand(scope)]);
    }
    if (this.accept('!')) {
      const operand = this.unary();
      return (scope) => (scalar(operand(scope)) === 0 ? 1 : 0);
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let value = this.primary();
    for (;;) {
      if (this.accept('.')) {
        const letters = [...this.take().text];
        const inner = value;
        value = (scope) => {
          const v = inner(scope);
          const parts = letters.map((letter) => {
            const index = 'xyzw'.indexOf(letter);
            if (typeof v === 'number' || index < 0 || index >= v.length) {
              throw new Error(`glsl-program-testing: no swizzle .${letters.join('')}`);
            }
            return v[index] as number;
          });
          return parts.length === 1 ? (parts[0] as number) : parts;
        };
      } else if (this.accept('[')) {
        const index = this.expression();
        this.expect(']');
        const inner = value;
        value = (scope) => {
          const v = inner(scope);
          if (typeof v === 'number') throw new Error('glsl-program-testing: indexed a float');
          const at = scalar(index(scope));
          const element = v[at];
          if (element === undefined)
            throw new Error(`glsl-program-testing: index ${String(at)} is out of range`);
          return element;
        };
      } else {
        return value;
      }
    }
  }

  private args(): Expr[] {
    const found: Expr[] = [];
    this.expect('(');
    if (!this.accept(')')) {
      do found.push(this.expression());
      while (this.accept(','));
      this.expect(')');
    }
    return found;
  }

  private primary(): Expr {
    const token = this.take();
    if (token.kind === 'number') {
      const n = Number(token.text);
      return () => n;
    }
    if (token.text === '(') {
      const inner = this.expression();
      this.expect(')');
      return inner;
    }
    if (token.kind !== 'name') {
      throw new Error(`glsl-program-testing: unexpected ${token.text}`);
    }
    const name = token.text;
    if (this.peek() === '[' && TYPES.has(name)) {
      // TYPE[N](a, b, …): a constant array.
      this.expect('[');
      this.take();
      this.expect(']');
      const items = this.args();
      return (scope) => items.map((item) => item(scope)) as unknown as Value;
    }
    if (this.peek() !== '(') return (scope) => lookup(scope, name);
    const args = this.args();
    if (name === 'vec2' || name === 'vec3') {
      const width = name === 'vec2' ? 2 : 3;
      return (scope) => {
        const parts = args.flatMap((arg) => [arg(scope)].flat());
        if (parts.length === 1) return Array.from({ length: width }, () => parts[0] as number);
        if (parts.length !== width)
          throw new Error(`glsl-program-testing: ${name} of ${String(parts.length)}`);
        return parts;
      };
    }
    const builtIn = BUILT_INS[name];
    if (builtIn !== undefined) return (scope) => builtIn(...args.map((arg) => arg(scope)));
    return (scope) => this.program.call(name, ...args.map((arg) => arg(scope)));
  }

  // Statements.
  statement(): Stmt {
    if (this.accept('{')) {
      const body: Stmt[] = [];
      while (!this.accept('}')) body.push(this.statement());
      return (scope) => {
        const inner: Scope = { vars: new Map(), parent: scope };
        for (const stmt of body) {
          const out = stmt(inner);
          if (out !== undefined) return out;
        }
        return undefined;
      };
    }
    if (this.accept('return')) {
      const value = this.expression();
      this.expect(';');
      return (scope) => ({ value: value(scope) });
    }
    if (this.accept('if')) {
      this.expect('(');
      const test = this.expression();
      this.expect(')');
      const yes = this.statement();
      const no = this.accept('else') ? this.statement() : undefined;
      return (scope) => (scalar(test(scope)) !== 0 ? yes(scope) : no?.(scope));
    }
    const first = this.peek() ?? '';
    if (TYPES.has(first) || first === 'const') {
      this.accept('const');
      this.take();
      const name = this.take().text;
      this.expect('=');
      const init = this.expression();
      this.expect(';');
      return (scope) => {
        scope.vars.set(name, init(scope));
        return undefined;
      };
    }
    // name = expr; or name op= expr;
    const name = this.take().text;
    const op = this.take().text;
    const value = this.expression();
    this.expect(';');
    return (scope) => {
      const right = value(scope);
      assign(scope, name, op === '=' ? right : binary(op.slice(0, 1), lookup(scope, name), right));
      return undefined;
    };
  }
}

/** One function of the program: its parameter names and its body. */
interface Fn {
  readonly params: readonly string[];
  readonly body: Stmt;
}

/** A program parsed from GLSL source: its constants and functions, callable. */
export class GlslProgram {
  private readonly globals: Scope = { vars: new Map(), parent: undefined };
  private readonly functions = new Map<string, Fn>();

  constructor(source: string) {
    const parser = new Parser(tokensOf(source), this);
    while (!parser.done()) {
      const constant = parser.accept('const');
      parser.take();
      // `TYPE name[N] = …;` carries its length between brackets.
      const name = parser.take().text;
      if (parser.accept('[')) {
        parser.take();
        parser.expect(']');
      }
      if (constant) {
        parser.expect('=');
        const init = parser.expression();
        parser.expect(';');
        this.globals.vars.set(name, init(this.globals));
        continue;
      }
      parser.expect('(');
      const params: string[] = [];
      if (!parser.accept(')')) {
        do {
          parser.take();
          params.push(parser.take().text);
        } while (parser.accept(','));
        parser.expect(')');
      }
      this.functions.set(name, { params, body: parser.statement() });
    }
  }

  /** The program's function `name`, called with `args`. */
  call(name: string, ...args: readonly GlslNumbers[]): Value {
    const fn = this.functions.get(name);
    if (fn === undefined)
      throw new Error(`glsl-program-testing: the program has no function ${name}`);
    const scope: Scope = { vars: new Map(), parent: this.globals };
    fn.params.forEach((param, i) => scope.vars.set(param, args[i] as Value));
    const out = fn.body(scope);
    if (out === undefined) throw new Error(`glsl-program-testing: ${name} returns nothing`);
    return out.value;
  }

  /** The constant `name`. */
  constant(name: string): Value {
    return lookup(this.globals, name);
  }

  /** An expression over the program's constants and functions, with `bindings` for its free names. */
  evaluate(expression: string, bindings: Readonly<Record<string, GlslNumbers>> = {}): Value {
    const scope: Scope = {
      vars: new Map(Object.entries(bindings).map(([k, v]) => [k, v as Value])),
      parent: this.globals,
    };
    const parser = new Parser(tokensOf(expression), this);
    const value = parser.expression();
    if (!parser.done()) throw new Error(`glsl-program-testing: trailing text in ${expression}`);
    return value(scope);
  }
}
