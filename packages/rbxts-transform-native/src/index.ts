import ts from "typescript";
import * as path from "path";
import type { PluginConfig } from "./config";
import { collectSidecar, applyAnnotations, type FileSidecar } from "./passes/annotate";
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

const pending = new Map<string, { sidecar: FileSidecar; injectTypes: boolean }>();
let finalizeRegistered = false;

function flushPending(): void {
    for (const [outPath, meta] of pending) {
        try {
            applyAnnotations(outPath, meta.sidecar, meta.injectTypes);
        } catch {
            // silently skip — file stays as-is
        }
    }
    pending.clear();
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
    const { types: injectTypes = true, verbose = false } = config;
    const outDir = program.getCompilerOptions().outDir;

    // Watch mode: flush previous run before starting this one.
    flushPending();
    registerFinalizer();

    return (_ctx) => (sourceFile) => {
        const outPath = outPathForSource(sourceFile, program);
        if (!outPath) return sourceFile;

        const sidecar = collectSidecar(ts, program, sourceFile);
        if (!sidecar.native) return sourceFile;

        pending.set(outPath, { sidecar, injectTypes });

        if (verbose) {
            const rel = outDir ? path.relative(outDir, outPath) : outPath;
            const parts: string[] = ["--!native"];
            if (injectTypes) {
                const fnCount = sidecar.fns.size;
                const constCount = sidecar.consts.size;
                if (fnCount > 0) parts.push(`${fnCount} fn${fnCount !== 1 ? "s" : ""}`);
                if (constCount > 0) parts.push(`${constCount} const${constCount !== 1 ? "s" : ""}`);
            }
            console.log(`native: ${rel} — ${parts.join(", ")}`);
        }

        return sourceFile;
    };
}
