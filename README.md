# rbxts-transforms

A collection of TypeScript transformer plugins for [roblox-ts](https://roblox-ts.com/) / [rotor](https://github.com/roblox-ts/rotor) that apply Luau-specific optimisations and cleanup at build time — no runtime cost, no code changes required.

## Packages

| Package | Description |
|---|---|
| [`rbxts-transform-boost`](packages/rbxts-transform-boost) | GetService hoisting, property chain caching, loop bounds hoisting, `const` promotion |
| [`rbxts-transform-luau`](packages/rbxts-transform-luau) | Preamble formatting, TS.import type hints, comment cleanup, `--!strict`/`--!optimize` directives |
| [`rbxts-transform-native`](packages/rbxts-transform-native) | `--!native` injection, Luau type annotations, `const` promotion, `.d.luau` generation |

Each package has its own README with full option docs and examples.

---

## Quick start

Install whichever packages you need:

```bash
npm install --save-dev rbxts-transform-boost rbxts-transform-luau rbxts-transform-native
```

Add them to your `tsconfig.json` plugins in order — **boost → luau → native**:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "rbxts-transform-boost",
        "hoist": true,
        "verbose": true
      },
      {
        "transform": "rbxts-transform-luau",
        "strict": true,
        "optimize": true,
        "optimizeLevel": 2,
        "verbose": true
      },
      {
        "transform": "rbxts-transform-native",
        "types": true,
        "dluau": true,
        "verbose": true
      }
    ]
  }
}
```

All three are independent — use any combination you like.

---

## Benchmarks

Measured in Roblox Studio server context. 100,000 iterations per benchmark (10,000 for `cfLookAt`). Both suites use `//!native`.

| Benchmark | With | Without | Speedup | Driver |
|---|---|---|---|---|
| integrate (Verlet) | 0.058 µs | 0.071 µs | **1.2×** | type annotations |
| dot (V3 manual) | 0.025 µs | 0.046 µs | **1.8×** | type annotations |
| cross (V3 manual) | 0.024 µs | 0.072 µs | **3.0×** | 6× field hoisting + types |
| lerpVec3 (V3 manual) | 0.026 µs | 0.061 µs | **2.3×** | 3× field hoisting + types |
| serviceWork (GetService ×2) | 0.243 µs | 0.481 µs | **2.0×** | GetService hoisting |
| multiSvc (GetService ×3) | 0.154 µs | 0.505 µs | **3.3×** | GetService hoisting |
| cameraWork (prop chain) | 0.185 µs | 0.218 µs | **1.2×** | `camera.CFrame` hoisted |

---

## Development

```bash
bun install                # install all workspace dependencies
bun run build              # build all three packages
bun run bench:rotor        # compile bench/ with all transformers via rotor
bun run bench:roblox-ts    # compile bench/ via roblox-ts
```

Open the generated `.rbxlx` in Roblox Studio and run the server to see benchmark output.
