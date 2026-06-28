export interface PluginConfig {
    // Prepend --!strict to every emitted file that doesn't already have it.
    // Default: true
    strict?: boolean;

    // Prepend --!optimize <level> to every emitted file.
    // Set to 0, 1, or 2 to enable at that level. false to disable.
    // Default: false
    optimize?: false | 0 | 1 | 2;

    // Inject Luau type annotations into compiled function signatures using the
    // TypeScript type checker. Covers any type that maps to a known Luau type
    // (primitives, Roblox value types, arrays, LuaTuple multi-returns).
    // Default: true
    annotate?: boolean;

    // Emit Luau type declarations for TypeScript type aliases and interfaces.
    // Converts TS types → Luau `type` statements, injected after the preamble.
    // Utility types (Partial, Pick, Omit, …) are emitted as Luau type functions.
    // Default: true
    emitTypes?: boolean;

    // Restructure compiled TypeScript classes into idiomatic Luau OOP style:
    // removes the roblox-ts do...end wrapper, inlines field initialization into
    // new(), drops the internal constructor function, and adds explicit self
    // typing so LSP autocomplete works on instance fields and methods.
    // Disable if you need to preserve the original roblox-ts class layout.
    // Default: true
    restructureClasses?: boolean;

    // Print per-file processing info to the console during compilation.
    // Default: false
    verbose?: boolean;
}
