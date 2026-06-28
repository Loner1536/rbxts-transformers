// Tests for TypeScript → Luau type conversion.
// Each declaration here should appear as a Luau `type` statement in the output.

// ─── Primitives ───────────────────────────────────────────────────────────────

export type Str = string;
export type Num = number;
export type Bool = boolean;
export type Nul = null;
export type Undef = undefined;
export type Vd = void;
export type Anything = any;
export type Unknown = unknown;
export type Never = never;

// ─── Object / table types ────────────────────────────────────────────────────

export type Point2D = {
    x: number;
    y: number;
};

export type Entity = {
    id: number;
    name: string;
    health?: number;
    tags: string[];
};

// Method signature
export type Transformer = {
    transform(input: string): string;
    reset(): void;
};

// Index signature
export type StringMap = {
    [key: string]: string;
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Vector2Like {
    X: number;
    Y: number;
}

export interface Vector3Like extends Vector2Like {
    Z: number;
}

export interface Generic<T> {
    value: T;
    map<U>(fn: (v: T) => U): Generic<U>;
}

// ─── Union and intersection ───────────────────────────────────────────────────

export type StringOrNumber = string | number;
export type Nullable<T> = T | null;
export type Combined = Vector2Like & { magnitude: number };

// ─── Literal types ────────────────────────────────────────────────────────────

export type Direction = "north" | "south" | "east" | "west";
export type StatusCode = 200 | 404 | 500;
export type Toggle = true | false;

// ─── Array types ──────────────────────────────────────────────────────────────

export type NumberList = number[];
export type Matrix = number[][];
export type ArrayOf<T> = Array<T>;

// ─── Function types ───────────────────────────────────────────────────────────

export type Callback = () => void;
export type Predicate<T> = (value: T) => boolean;
export type Mapper<T, U> = (input: T) => U;
export type BinaryOp = (a: number, b: number) => number;

// ─── Record / Map ─────────────────────────────────────────────────────────────

export type NamedNumbers = Record<string, number>;
export type Config = Record<string, boolean | number | string>;

// ─── Utility types (require Luau type functions) ──────────────────────────────

export type PartialPoint = Partial<Point2D>;
export type RequiredEntity = Required<Entity>;
export type PickedPoint = Pick<Point2D, "x">;
export type OmittedEntity = Omit<Entity, "tags">;
export type NonNullId = NonNullable<number | null>;

// ─── Generic aliases ─────────────────────────────────────────────────────────

export type Box<T> = { value: T };
export type Pair<A, B> = { first: A; second: B };
export type Triple<A, B, C> = { a: A; b: B; c: C };

// ─── Functions that use the types (so file isn't empty of runtime code) ───────

export function makePoint(x: number, y: number): Point2D {
    return { x, y };
}

export function getDirection(dx: number, dy: number): Direction {
    if (dx > 0) return "east";
    if (dx < 0) return "west";
    if (dy > 0) return "north";
    return "south";
}
