// NO //!native at the top — only functions tagged @native in JSDoc get annotated.
// Everything else must remain unannotated (bare param names, no return type).

/**
 * @native
 * Should get full type annotations: Vector3, Vector3, number return.
 */
export function annotatedDot(a: Vector3, b: Vector3): number {
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z;
}

/**
 * @native
 * Should get number, number, number params and number return.
 */
export function annotatedLerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * @native
 * Should get CFrame param and Vector3 return.
 */
export function annotatedPosition(cf: CFrame): Vector3 {
    return cf.Position;
}

/**
 * @native
 * LuaTuple return — should get multi-return annotation (number, number).
 */
export function annotatedMinMax(a: number, b: number): LuaTuple<[number, number]> {
    return $tuple(math.min(a, b), math.max(a, b));
}

// ---- NO @native below — MUST stay unannotated ----

export function bareAdd(a: number, b: number): number {
    return a + b;
}

export function bareScale(v: Vector3, s: number): Vector3 {
    return new Vector3(v.X * s, v.Y * s, v.Z * s);
}

/**
 * Has JSDoc description and @param but NO @native — must NOT be annotated.
 * @param x The input value.
 * @returns The doubled value.
 */
export function bareWithDoc(x: number): number {
    return x * 2;
}
