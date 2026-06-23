export interface PluginConfig {
    // Prepend --!optimize 2 to every file that doesn't already have it.
    // Default: true
    optimize?: boolean;

    // Hoist repeated game.GetService() calls to module-level locals,
    // and hoist repeated property access chains within functions to locals.
    // Default: true
    hoist?: boolean;
}
