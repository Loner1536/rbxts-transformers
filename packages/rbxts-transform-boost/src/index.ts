import ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import type { PluginConfig } from "./config";
import { cachePass } from "./passes/cache";
import { loopsPass } from "./passes/loops";
import { createDebugger } from "./debug";
export type { PluginConfig };

function outPathForSource(sourceFile: ts.SourceFile, program: ts.Program): string | null {
    const options = program.getCompilerOptions();
    const outDir = options.outDir;
    if (!outDir) return null;
    const rootDir = options.rootDir ?? commonRoot(program.getRootFileNames());
    if (!rootDir) return null;
    const rel = path.relative(rootDir, sourceFile.fileName);
    if (rel.startsWith("..")) return null;
    const dir = path.dirname(rel);
    const base = path.basename(rel).replace(/\.tsx?$/, "");
    const renamedBase = base.replace(/^index(?=$|\.)/, "init");
    return path.join(outDir, dir, `${renamedBase}.luau`);
}

function commonRoot(files: readonly string[]): string | undefined {
    if (files.length === 0) return undefined;
    const parts = files[0].split(path.sep);
    let root = parts.slice(0, parts.length - 1);
    for (const f of files.slice(1)) {
        const fp = f.split(path.sep);
        let i = 0;
        while (i < root.length && i < fp.length - 1 && root[i] === fp[i]) i++;
        root = root.slice(0, i);
    }
    return root.join(path.sep) || undefined;
}

// Moves --! directive lines to the top of the file, above everything except
// other --! lines. Fixes the case where cachePass prepends service locals
// before --!native or other directives that were leading comments in the source.
function liftDirectives(src: string): string {
    const lines = src.split("\n");
    const directives: string[] = [];
    const rest: string[] = [];
    for (const line of lines) {
        if (/^--!/.test(line)) directives.push(line);
        else rest.push(line);
    }
    if (directives.length === 0) return src;
    return [...directives, ...rest].join("\n");
}

// Hoists repeated game:GetService("X") calls (≥2 uses) to local declarations
// at the top of the file. Handles the roblox-ts/rotor runtime lines that the
// compiler emits after our AST pass runs, which the AST pass can never see.
function hoistServices(src: string): string {
    const re = /game:GetService\("([^"]+)"\)/g;
    const counts = new Map<string, number>();
    for (const m of src.matchAll(re)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }

    const toHoist = [...counts.entries()]
        .filter(([, n]) => n >= 2)
        .map(([svc]) => svc)
        .filter(svc =>
            !new RegExp(`(?:^|\\n)local _${svc} = game:GetService\\(`).test(src),
        );

    if (toHoist.length === 0) return src;

    const decls = toHoist.map(svc => `local _${svc} = game:GetService("${svc}")`).join("\n");
    for (const svc of toHoist) {
        src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
    }

    // Insert after any --! directives and -- Compiled header lines.
    const lines = src.split("\n");
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^--!/.test(t) || /^-- Compiled/.test(t)) {
            insertAt = i + 1;
        } else if (t === "") {
            continue;
        } else {
            break;
        }
    }
    lines.splice(insertAt, 0, decls);
    return lines.join("\n");
}

const pendingPaths = new Set<string>();
const writingFiles = new Set<string>();
let finalizeRegistered = false;

function flushPending(): void {
    for (const outPath of pendingPaths) {
        if (!fs.existsSync(outPath)) continue;
        try {
            let src = fs.readFileSync(outPath, "utf8");
            let changed = false;

            const afterHoist = hoistServices(src);
            if (afterHoist !== src) { src = afterHoist; changed = true; }

            const afterLift = liftDirectives(src);
            if (afterLift !== src) { src = afterLift; changed = true; }

            if (changed) {
                writingFiles.add(outPath);
                try {
                    fs.writeFileSync(outPath, src, "utf8");
                } finally {
                    setTimeout(() => writingFiles.delete(outPath), 50).unref();
                }
            }
        } catch {
            // leave file as-is on error
        }
    }
    pendingPaths.clear();
}

function registerFinalizer(): void {
    if (finalizeRegistered) return;
    finalizeRegistered = true;
    process.on("exit", flushPending);
}

export default function (
    program: ts.Program,
    config: PluginConfig = {},
): ts.TransformerFactory<ts.SourceFile> {
    const { hoist = true, verbose = false } = config;
    const dbg = createDebugger(program, verbose);
    const outDir = program.getCompilerOptions().outDir;

    // Watch mode: flush previous run before starting this one.
    flushPending();
    registerFinalizer();

    return (_ctx) => (sourceFile) => {
        const errors: string[] = [];
        let cached = 0;

        // Always queue for post-emit — roblox-ts emits its own GetService calls
        // in the runtime require and TS.import lines after our AST pass finishes.
        const outPath = outPathForSource(sourceFile, program);
        if (outPath && hoist) pendingPaths.add(outPath);
        const rel = outPath && outDir ? path.relative(outDir, outPath) : sourceFile.fileName;

        if (!hoist) {
            dbg.file(rel, { cached: 0, errors: [] });
            return sourceFile;
        }

        try {
            let result = sourceFile;

            try {
                const cacheResult = cachePass(ts, program, _ctx, result, dbg);
                result = cacheResult.result;
                cached = cacheResult.cached;
            } catch (err) {
                errors.push(`cache: ${err instanceof Error ? err.message : String(err)}`);
            }

            try {
                result = loopsPass(ts, program, _ctx, result);
            } catch (err) {
                errors.push(`loops: ${err instanceof Error ? err.message : String(err)}`);
            }

            dbg.file(rel, { cached, errors });
            return result;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            dbg.file(rel, { cached: 0, errors: [`fatal: ${msg}`] });
            return sourceFile;
        }
    };
}
