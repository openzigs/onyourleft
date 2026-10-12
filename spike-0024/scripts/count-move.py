# Spike 0024: count what a real move from WebGLRenderer would rewrite in three-renderer.ts.
# usage: python3 -I count.py <path to three-renderer.ts>
import re, sys
src = open(sys.argv[1]).read()
lines = src.split('\n')

def enclosing(i):
    for j in range(i, -1, -1):
        m = re.match(r'^(?:export )?(?:async )?(?:function|class) (\w+)', lines[j])
        if m: return m.group(1)
    return '?'

def block_end(i):
    """Line index where the brace opened on line i closes."""
    depth = 0; started = False
    for j in range(i, len(lines)):
        for ch in lines[j]:
            if ch == '{': depth += 1; started = True
            elif ch == '}': depth -= 1
        if started and depth <= 0: return j
    return len(lines) - 1

print('file lines', len(lines))
print('\n== material construction sites')
tot = {}
for i, l in enumerate(lines):
    if re.match(r'^\s*(//|\*|/\*)', l): continue
    for m in re.finditer(r'new (\w*Material)\(', l):
        tot[m.group(1)] = tot.get(m.group(1), 0) + 1
        print(f'  {i+1:6d} {m.group(1):22s} in {enclosing(i)}')
print(tot, 'total', sum(tot.values()))

print('\n== onBeforeCompile patches (assignment sites)')
total = 0
for i, l in enumerate(lines):
    if re.search(r'onBeforeCompile = \(', l) and not re.match(r'^\s*(//|\*)', l):
        e = block_end(i); n = e - i + 1; total += n
        body = '\n'.join(lines[i:e+1])
        print(f'  {i+1:6d} {n:4d} lines, {len(re.findall(r"\.replace\(", body)):2d} replace(), in {enclosing(i)}')
print('  total lines inside patches', total)

print('\n== GLSL template literals (/* glsl */ `...`)')
g = 0; n = 0
for m in re.finditer(r'/\* glsl \*/\s*`', src):
    end = src.index('`', m.end())
    body = src[m.end():end]
    c = body.count('\n') + 1; g += c; n += 1
print('  literals', n, 'lines', g)

print('\n== three internals a node material does not have')
for name in ['ShaderChunk', 'UniformsLib', 'UniformsUtils', 'customProgramCacheKey', '#include <', 'ShaderMaterial', 'onBeforeCompile', 'WebGLRenderer', 'WebGLProgramParametersWithUniforms', 'renderer.getContext', 'renderer.compile', 'renderer.info.programs', 'capabilities.', 'PMREMGenerator', 'shadowMap', 'forceContextLoss', 'WebGLRenderTarget', 'readRenderTargetPixels', 'gl.', 'KHR_parallel_shader_compile', 'fenceSync', 'detectSupport']:
    code = [i+1 for i, l in enumerate(lines) if name in l and not re.match(r'^\s*(//|\*|/\*)', l)]
    print(f'  {name:36s} {len(code):4d} code lines', code[:14])
