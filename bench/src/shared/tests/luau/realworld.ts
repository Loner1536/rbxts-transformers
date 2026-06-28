// Real-world roblox-ts module: a round-based game system.
// This tests that all common TypeScript patterns produce correct Luau types.

// ─── Primitive aliases that carry meaning ─────────────────────────────────────
// (trivial aliases like `type UserId = number` are intentionally filtered — Luau
// already knows what number is; these types add no information in the output)

// ─── Nested data interfaces ───────────────────────────────────────────────────

export interface Currency {
    coins: number;
    gems: number;
}

export interface PlayerStats {
    kills: number;
    deaths: number;
    assists: number;
    damage: number;
}

export interface PlayerData {
    userId: number;
    username: string;
    currency: Currency;
    level: number;
    xp: number;
    inventory: string[];
    stats: Record<string, number>;
    joinedAt: number;
    lastSeen?: number;
    isBanned?: boolean;
}

// ─── Discriminated union — game state machine ─────────────────────────────────

export type GamePhase = "waiting" | "starting" | "playing" | "ended";

export type GameState =
    | { phase: "waiting"; playerCount: number }
    | { phase: "starting"; countdown: number; playerCount: number }
    | { phase: "playing"; roundId: string; startedAt: number; mapName: string }
    | { phase: "ended"; winnerId: number; duration: number; stats: PlayerStats };

// ─── Configuration with utility types ────────────────────────────────────────

export interface RoundConfig {
    maxPlayers: number;
    roundDuration: number;
    mapName: string;
    pvpEnabled: boolean;
    spawnDelay: number;
    friendlyFire: boolean;
}

// Partial for defaults / drafts
export type DraftConfig = Partial<RoundConfig>;

// Pick for the minimal required subset
export type ServerBroadcast = Pick<RoundConfig, "maxPlayers" | "mapName" | "pvpEnabled">;

// Omit for internal-only fields
export type PublicConfig = Omit<RoundConfig, "spawnDelay" | "friendlyFire">;

// Required to enforce that a draft has been filled in
export type FinalConfig = Required<DraftConfig>;

// ─── Generic containers ───────────────────────────────────────────────────────

export type Result<T, E = string> =
    | { ok: true; value: T }
    | { ok: false; error: E };

export type Option<T> = { some: true; value: T } | { some: false };

export interface Registry<K extends string, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    delete(key: K): boolean;
    size(): number;
}

// ─── Callback / event types ───────────────────────────────────────────────────

export type EventHandler<T> = (event: T) => void;
export type Unsubscribe = () => void;

export interface PlayerEvent {
    userId: number;
    timestamp: number;
}

export interface DamageEvent extends PlayerEvent {
    damage: number;
    source: string;
    victimId: number;
}

// ─── Intersection types ───────────────────────────────────────────────────────

export type Serializable = { serialize(): string };
export type Identifiable = { id: string };
export type SerializableEntity = Serializable & Identifiable;

// ─── Index signatures ─────────────────────────────────────────────────────────

export interface StringMap<V> {
    [key: string]: V;
}

export interface Cache<K extends string, V> {
    data: Record<K, V>;
    hits: number;
    misses: number;
}

// ─── NonNullable for strict APIs ──────────────────────────────────────────────

export type StrictUserId = NonNullable<number | undefined>;

// ─── Runtime code that uses the types ─────────────────────────────────────────

export function createDefaultConfig(): DraftConfig {
    return {
        maxPlayers: 10,
        mapName: "Classic",
        pvpEnabled: true,
    };
}

export function getPhase(state: GameState): GamePhase {
    return state.phase;
}

export function makeOk<T>(value: T): Result<T> {
    return { ok: true, value };
}

export function makeErr<T>(message: string): Result<T> {
    return { ok: false, error: message };
}

export function isPlaying(state: GameState): boolean {
    return state.phase === "playing";
}

export function getLevel(data: PlayerData): number {
    return data.level;
}

export function sumCoins(a: number, b: number): number {
    return a + b;
}
