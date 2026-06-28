// Tests for @deprecated JSDoc tag → ---@deprecated in Luau output.
// These functions have NO //!native so param types come from TypeScript types
// via the sidecar, not from //!native annotation.

/**
 * @deprecated Use add() instead.
 * @param a First number.
 * @param b Second number.
 * @returns The sum.
 */
export function oldAdd(a: number, b: number): number {
    return a + b;
}

/**
 * @deprecated Use Vector3.new() directly.
 * @param x X component.
 * @param y Y component.
 * @param z Z component.
 * @returns A new Vector3.
 */
export function makeVec(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
}

/**
 * @deprecated No replacement available.
 */
export function noReplacement(): void {
    // nothing
}

/**
 * @deprecated
 * No deprecation message — tag alone should still emit ---@deprecated.
 */
export function silentDeprecated(x: number): number {
    return x;
}

// Not deprecated — should pass through without ---@deprecated
export function current(x: number): number {
    return x * 2;
}

/**
 * Has JSDoc but no deprecated tag — should pass through cleanly.
 * @param x The value.
 * @returns Doubled.
 */
export function currentWithDoc(x: number): number {
    return x * 2;
}
