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

    // Print per-file processing info to the console during compilation.
    // Default: false
    verbose?: boolean;
}
