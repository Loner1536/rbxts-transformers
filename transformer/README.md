# rbxts-transform-boost

> **Successor to [`rbxts-transformer-luau-annotate`](https://github.com/Loner1536/rbxts-transformer-luau-annotate).** That package was accidentally removed from npm. Migrate to this one.
>
> **What carried over:** Luau type annotation injection on function parameters for native codegen (primitives, Roblox value types, arrays).
>
> **What's new:** `--!optimize 2` on every file, `game:GetService()` hoisting to module-level locals, repeated property chain hoisting, loop bounds hoisting, `const` keyword for TypeScript `const` declarations, output formatting so compiled files look human-written.
>
> **What's different:** The old package also annotated return types, local variable declarations, class methods, and user-defined interfaces/type aliases. Those are not yet in this package — they're planned. The old package also had reliability issues that this rewrite addresses.

A TypeScript transformer for Roblox that automatically applies Luau performance directives and cleans up compiled output at build time — no runtime cost, no code changes required.

## Installation

```bash
npm install --save-dev rbxts-transform-boost
```

`tsconfig.json`:
```json
{
    "compilerOptions": {
        "plugins": [
            {
                "transform": "rbxts-transform-boost",
                "optimize": true,
                "verbose": true,
                "strict": true,
                "hoist": true
            }
        ]
    }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `optimize` | `boolean` | `true` | Prepend `--!optimize 2` to every file that doesn't already have it |
| `strict` | `boolean` | `true` | Prepend `--!strict` to every file that doesn't already have it |
| `hoist` | `boolean` | `true` | Hoist `GetService` calls, repeated property reads, and loop bounds to locals |
| `verbose` | `boolean` | `false` | Log each transformed file during compilation |

`--!native` is never auto-inserted. Add `//!native` at the top of your TypeScript file for hot paths you've profiled — the compiler preserves it.

```typescript
//!native
export function integrate(pos: Vector3, vel: Vector3, acc: Vector3, dt: number) {
    // ...
}
```

---

## What it does

### `--!optimize 2` — always on top

Every file gets `--!optimize 2` prepended if it doesn't already have it. Roblox already runs all scripts at optimization level 2 in live games, but the directive makes Studio behaviour match production and signals intent.

```lua
-- Without transformer
local function encodeFixed(buf, offset, value, scale)
    local fixed = math.floor(value * scale)
    local clamped = math.clamp(fixed, -32768, 32767)
    buffer.writei16(buf, offset, clamped)
    return offset + 2
end
```

```lua
-- With transformer
--!optimize 2

local function encodeFixed(buf: buffer, offset: number, value: number, scale: number): number
    const fixed = math.floor(value * scale)
    const clamped = math.clamp(fixed, -32768, 32767)
    buffer.writei16(buf, offset, clamped)

    return offset + 2
end
```

---

### `const` for TypeScript `const` declarations

TypeScript `const` declarations are emitted as Luau `const` (shipped in Roblox Studio March 2026). TypeScript `let` stays as `local`. Transformer-generated internal variables (`_cache0`, `_shouldIncrement`, etc.) are not affected.

```typescript
// TypeScript
const N = 100000;
let i = 0;
const elapsed = os.clock() - t0;
```

```lua
-- Compiled output
const N = 100000
local i = 0
const elapsed = os.clock() - t0
```

---

### GetService hoisting

Every `game:GetService("X")` call in a file is hoisted to a module-level local on first load. Functions that call `GetService` on every invocation — the most common compiled pattern — pay the registry lookup cost zero times at runtime.

```typescript
// TypeScript source
export function serviceWork(): string {
    const count = game.GetService("Players").GetPlayers().size();
    const running = game.GetService("RunService").IsRunning();
    return `${count}-${running}`;
}
```

```lua
-- Without transformer
local function serviceWork()
    local count = #game:GetService("Players"):GetPlayers()
    local running = game:GetService("RunService"):IsRunning()
    return `{count}-{running}`
end
```

```lua
-- With transformer
--!optimize 2

-- Services
local _RunService = game:GetService("RunService")
local _Players = game:GetService("Players")

local function serviceWork(): string
    const count = #_Players:GetPlayers()
    const running = _RunService:IsRunning()

    return `{count}-{running}`
end
```

**2.4× faster** — `GetService` calls eliminated from the hot path entirely.

---

### Property chain hoisting

Any property access chain that appears **2 or more times** inside the same function is hoisted to a local. Instance property reads go through Roblox's C++ property system — doing the same read twice is wasted work.

```typescript
// TypeScript source
export function cameraWork(camera: Camera): number {
    const pos = camera.CFrame.Position;
    const look = camera.CFrame.LookVector;  // camera.CFrame read twice
    const fov = camera.FieldOfView;
    return pos.Magnitude + look.X + fov;
}
```

```lua
-- Without transformer
local function cameraWork(camera)
    local pos = camera.CFrame.Position
    local look = camera.CFrame.LookVector
    local fov = camera.FieldOfView
    return pos.Magnitude + look.X + fov
end
```

```lua
-- With transformer
local function cameraWork(camera: Camera): number
    const _cache0 = camera.CFrame
    const pos = _cache0.Position
    const look = _cache0.LookVector
    const fov = camera.FieldOfView

    return pos.Magnitude + look.X + fov
end
```

**1.5× faster.** Also hoists value type field reads (`.X`, `.Y`, `.Z`) when they appear multiple times — the `cross` function reads each component twice, so all six are hoisted:

```lua
-- With transformer
local function cross(a: Vector3, b: Vector3): Vector3
    const _cache0 = a.Y
    const _cache1 = b.Z
    const _cache2 = a.Z
    const _cache3 = b.Y
    const _cache4 = b.X
    const _cache5 = a.X

    return Vector3.new(
        _cache0 * _cache1 - _cache2 * _cache3,
        _cache2 * _cache4 - _cache5 * _cache1,
        _cache5 * _cache3 - _cache0 * _cache4
    )
end
```

**2.7× faster.**

---

### Loop bounds hoisting

`for` loops whose upper bound is `arr.size()` have the size hoisted to a local before the loop. This avoids calling `.size()` on every iteration check.

```typescript
// TypeScript source
for (let i = 0; i < arr.size(); i++) {
    process(arr[i]);
}
```

```lua
-- Without transformer
for i = 0, arr:size() - 1 do
    process(arr[i + 1])
end
```

```lua
-- With transformer
const _len_arr: number = arr:size()
for i = 0, _len_arr - 1 do
    process(arr[i + 1])
end
```

---

### Luau type annotation injection

After the compiler writes `.luau` files, the transformer injects Luau type annotations on function parameters and return types. This lets the native compiler generate specialized code for numeric and Roblox value types.

```typescript
// TypeScript source
export function dot(a: Vector3, b: Vector3): number {
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z;
}
```

```lua
-- Without transformer
local function dot(a, b)
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
```

```lua
-- With transformer
local function dot(a: Vector3, b: Vector3): number
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
```

Supported types: `number`, `string`, `boolean`, `Vector3`, `Vector2`, `Vector2int16`, `Vector3int16`, `CFrame`, `UDim`, `UDim2`, `Color3`, `BrickColor`, `TweenInfo`, `NumberRange`, `NumberSequence`, `ColorSequence`, `Rect`, `Region3`, `Ray`, `buffer`, `Instance`, `BasePart`, `Part`, `Model`, `Player`, `Camera`, `RunService`, `Players`, `Workspace`, and array forms (`{number}`, `{Vector3}`, etc.).

---

### Output formatting

This one's a personal pet peeve — yes, most people will never open a compiled `.luau` file. But the transformer post-processes every compiled `.luau` file so the output looks like a human wrote it anyway, not a compiler.

**Preamble organisation** — top-level declarations are sorted into labeled sections in dependency order. Sections are sorted by line length (longest first). If you put a comment before a group of imports in TypeScript, that comment becomes the section label:

```typescript
// Shared
import * as utils from "../shared/utils";

// Server
import * as data from "../server/data";
```

```lua
--!optimize 2
--!native

-- Compiled with rotor v2.2.0

-- Runtime
local TS = require(...)

-- Services
local _ReplicatedStorage = game:GetService("ReplicatedStorage")
local _Workspace = game:GetService("Workspace")

-- Shared
local utils = TS.import(script, ...)

-- Server
local data = TS.import(script, ...)
```

**Spacing inside functions** — blank lines are added so blocks breathe:

- Before `return` when it's not the only statement in the function
- After `end` blocks when the next line is not another `end`, `else`, or `elseif`
- Before block starters (`do`/`while`/`for`/`if`) when preceded by a group of `local`/`const` assignments
- At `const` → `local` transitions

**`--!` directives** are sorted by length and separated from the compiler header comment with a blank line.

---

## Benchmarks

Measured in Roblox Studio server context. 100,000 iterations per benchmark (10,000 for `cfLookAt`). Both suites use `//!native` — the only variable is whether the transformer is applied, so the numbers reflect what the transformer itself contributes on top of native.

| Benchmark | With transformer | Without | Speedup | Driver |
|-----------|-----------------|---------|---------|--------|
| integrate (Verlet) | 0.058 µs | 0.071 µs | **1.2×** | type annotations |
| dot (V3 manual) | 0.025 µs | 0.046 µs | **1.8×** | type annotations |
| cross (V3 manual) | 0.024 µs | 0.072 µs | **3.0×** | 6× field hoisting + type annotations |
| lerpVec3 (V3 manual) | 0.026 µs | 0.061 µs | **2.3×** | 3× field hoisting + type annotations |
| encodeFixed (buf+math) | 0.025 µs | 0.026 µs | ~1× | — |
| encodePacket (3× fixed) | 0.030 µs | 0.028 µs | ~1× | — |
| sumWeighted (loop) | 0.051 µs | 0.054 µs | ~1× | type annotations |
| dotProduct (loop) | 0.050 µs | 0.060 µs | **1.2×** | type annotations |
| norm (loop+sqrt) | 0.052 µs | 0.058 µs | **1.1×** | type annotations |
| mathHeavy (trig+sqrt) | 0.044 µs | 0.050 µs | **1.1×** | type annotations |
| fib(20) (iter) | 0.062 µs | 0.071 µs | **1.1×** | type annotations |
| cfLookAt (ctor) | 0.087 µs | 0.082 µs | ~1× | C++ floor — no Luau work |
| cfChain (mul+angles) | 0.102 µs | 0.092 µs | ~1× | C++ floor — no Luau work |
| serviceWork (GetService ×2) | 0.243 µs | 0.481 µs | **2.0×** | GetService hoisting |
| multiSvc (GetService ×3) | 0.154 µs | 0.505 µs | **3.3×** | GetService hoisting |
| cameraWork (prop chain) | 0.185 µs | 0.218 µs | **1.2×** | `camera.CFrame` hoisted (2 reads → 1) |
| formatStats (template) | 0.191 µs | 0.187 µs | ~1× | string — no arithmetic |
| buildKey (template) | 0.085 µs | 0.079 µs | ~1× | — |

### What the transformer cannot help with

- **Pure engine API calls** — `CFrame.lookAt`, `CFrame.Angles`, `CFrame` multiplication execute immediately in C++. `--!native` cannot speed up code that is already running natively.
- **Single-access properties** — the cache pass only hoists when a property is read 2+ times in the same function.
- **String-heavy functions** — Luau string operations are not meaningfully accelerated by the native compiler.

---

## Development

```bash
bun run build              # compile the transformer (tsc → out/)
bun run bench:roblox-ts    # build with transformer via roblox-ts
bun run bench:rotor        # build with transformer via rotor
bun run bench:rbxlx:roblox-ts  # produce bench/benchmark-roblox-ts.rbxlx
bun run bench:rbxlx:rotor      # produce bench/benchmark-rotor.rbxlx
```

Open the `.rbxlx` file in Roblox Studio and run the server. The optimized suite prints first, then the baseline suite.
