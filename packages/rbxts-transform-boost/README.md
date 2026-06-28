# rbxts-transform-boost

A [roblox-ts](https://roblox-ts.com) / [rotor](https://github.com/roblox-ts/rotor) TypeScript transformer that improves compiled Luau performance by hoisting repeated expressions, caching property chains, and promoting locals to `const`.

## What it does

### GetService hoisting

`game:GetService("X")` calls used two or more times in a file are hoisted to a top-level local so the lookup only happens once.

```typescript
// Input
function a() { return game.GetService("RunService").Heartbeat }
function b() { return game.GetService("RunService").IsRunning }
```

```luau
-- Output
local _RunService = game:GetService("RunService")

local function a() return _RunService.Heartbeat end
local function b() return _RunService.IsRunning end
```

### Property chain caching

Repeated property accesses (e.g. `workspace.CurrentCamera.CFrame`) inside loops or hot functions are cached into a local so the engine only walks the chain once.

```typescript
// Input
for (let i = 0; i < n; i++) {
    const pos = workspace.CurrentCamera.CFrame.Position
}
```

```luau
-- Output
local _CFrame = workspace.CurrentCamera.CFrame
for i = 0, n - 1 do
    local pos = _CFrame.Position
end
```

### Loop bounds hoisting

Upper bounds that are non-trivial expressions are extracted to a local so they are not re-evaluated on every iteration.

```luau
-- Before
for i = 0, someTable:size() - 1 do

-- After
const _size = someTable:size()
for i = 0, _size - 1 do
```

### `const` promotion

Locals that are never reassigned — at any nesting depth — are promoted to `const`, allowing the Luau native compiler to make stronger assumptions.

```luau
-- Before
local N = 100000
local function compute()
    local scale = 0.5

-- After
const N = 100000
local function compute()
    const scale = 0.5
```

## Benchmarks

Measured in Roblox Studio server context, 100,000 iterations per benchmark. All suites use `//!native`.

| Benchmark | With | Without | Speedup | Driver |
|---|---|---|---|---|
| cross (V3 manual) | 0.024 µs | 0.072 µs | **3.0×** | 6× field hoisting |
| lerpVec3 (V3 manual) | 0.026 µs | 0.061 µs | **2.3×** | 3× field hoisting |
| multiSvc (GetService ×3) | 0.154 µs | 0.505 µs | **3.3×** | GetService hoisting |
| serviceWork (GetService ×2) | 0.243 µs | 0.481 µs | **2.0×** | GetService hoisting |
| cameraWork (prop chain) | 0.185 µs | 0.218 µs | **1.2×** | `camera.CFrame` hoisted |

## Installation

```bash
npm install --save-dev rbxts-transform-boost
```

## Setup

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "rbxts-transform-boost",
        "hoist": true
      }
    ]
  }
}
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `hoist` | `boolean` | `true` | Enable GetService hoisting, property chain caching, and loop bounds hoisting |
| `verbose` | `boolean` | `false` | Log per-file stats to the console |
