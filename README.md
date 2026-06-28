# rbxts-transforms

A collection of TypeScript transformer plugins for [roblox-ts](https://roblox-ts.com/) / [rotor](https://github.com/roblox-ts/rotor) that improve and clean up compiled Luau output at build time — no runtime cost.

## Packages

| Package | npm | Description |
|---|---|---|
| [`rbxts-transform-boost`](packages/rbxts-transform-boost) | [![npm](https://img.shields.io/npm/v/rbxts-transform-boost)](https://www.npmjs.com/package/rbxts-transform-boost) | GetService hoisting, property chain caching, loop bounds hoisting, `const` promotion |
| [`rbxts-transform-luau`](packages/rbxts-transform-luau) | [![npm](https://img.shields.io/npm/v/rbxts-transform-luau)](https://www.npmjs.com/package/rbxts-transform-luau) | Preamble formatting, TS.import type hints, JSDoc conversion, Luau type annotations, `--!strict`/`--!optimize` |

Each package is independent — use any combination, in any order.

---

## Quick start

Install whichever packages you need:

```bash
npm install --save-dev rbxts-transform-boost rbxts-transform-luau
```

Add them to your `tsconfig.json` plugins:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "rbxts-transform-boost",
        "hoist": true
      },
      {
        "transform": "rbxts-transform-luau",
        "strict": true,
        "optimize": 2
      }
    ]
  }
}
```

---

## Development

```bash
bun install           # install all workspace dependencies
bun run build         # build all packages
bun run bench:rotor   # compile bench/ with rotor
bun run bench:roblox-ts  # compile bench/ with roblox-ts
```
