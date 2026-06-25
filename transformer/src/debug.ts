import type ts from "typescript";

export interface FunctionHoistInfo {
    fnName: string;
    hoisted: string[]; // e.g. ["Floor.CFrame!", "FloorOffset!"]
    mutableSkips: string[]; // chains skipped due to mutation — useful to know
}

export interface Debugger {
    // Called once per function that hoisted anything
    hoistInfo(info: FunctionHoistInfo): void;
    // Called once per file after all passes
    file(rel: string, stats: { cached: number; errors: string[] }): void;
    warn(pass: string, message: string): void;
    error(pass: string, message: string): void;
}

export function createDebugger(program: ts.Program, verboseEnabled: boolean): Debugger {
    // Accumulate per-file function hoist info between hoistInfo() and file() calls
    const pendingFnInfos: FunctionHoistInfo[] = [];

    return {
        hoistInfo(info) {
            pendingFnInfos.push(info);
        },

        file(rel, { cached, errors }) {
            const fnInfos = pendingFnInfos.splice(0);

            // Always print the file line
            // Format: boost: path/to/file.ts — 14 hoisted (Fn: Chain!, Chain2 | Fn2: Chain3)
            // Or just: boost: path/to/file.ts  (if nothing hoisted)
            if (cached === 0 && errors.length === 0) {
                console.log(`boost: ${rel}`);
                return;
            }

            const parts: string[] = [];

            if (cached > 0) {
                parts.push(`${cached} hoisted`);

                if (verboseEnabled && fnInfos.length > 0) {
                    // Per-function breakdown, compact
                    // e.g. RunCollision: Floor.CFrame!, Speed.X | AfterUpdateHook: Speed, Flags
                    const fnParts = fnInfos.map(info => {
                        // Strip common prefix for readability: Client.Ground.Floor.CFrame → Floor.CFrame
                        // Actually keep full chain — it's more useful for debugging
                        const chains = info.hoisted.join(", ");
                        const label = info.fnName === "<anonymous>"
                            ? `<anon:${info.hoisted[0]?.split(".").pop() ?? "?"}>`
                            : info.fnName;
                        const mutPart = info.mutableSkips.length > 0
                            ? ` [mut: ${info.mutableSkips.join(", ")}]`
                            : "";
                        return `${label}: ${chains}${mutPart}`;
                    });
                    parts.push(`(${fnParts.join(" | ")})`);
                }
            }

            if (errors.length > 0) {
                parts.push(`${errors.length} error${errors.length > 1 ? "s" : ""}: ${errors.join(", ")}`);
            }

            console.log(`boost: ${rel} — ${parts.join("  ")}`);
        },

        warn(pass, message) {
            console.warn(`[boost:${pass}] warn: ${message}`);
        },

        error(pass, message) {
            console.error(`[boost] error ${pass}: ${message}`);
        },
    };
}
