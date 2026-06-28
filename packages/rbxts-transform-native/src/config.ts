export interface PluginConfig {
    // Inject Luau type annotations into emitted function signatures wherever
    // TypeScript types can be mapped to known Luau types. Only applied to files
    // that have //!native in the TypeScript source.
    // Default: true
    types?: boolean;

    // Print per-file processing info to the console during compilation.
    // Default: false
    verbose?: boolean;
}
