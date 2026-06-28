import ts from "typescript";
import * as path from "path";
import type { PluginConfig } from "./config";
import { formatFile, type FnDoc } from "./passes/format";
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

type FileMeta = {
    outPath: string;
    strict: boolean;
    optimizeLevel: false | 0 | 1 | 2;
    verbose: boolean;
    sidecar: Map<string, FnDoc>;
};

const pending = new Map<string, FileMeta>();
let finalizeRegistered = false;

function flushPending(): void {
    for (const [, meta] of pending) {
        try {
            formatFile(meta.outPath, meta.strict, meta.optimizeLevel, meta.sidecar);
        } catch {
            // silently skip files that fail — they stay as-is
        }
    }
    pending.clear();
}

function registerFinalizer(): void {
    if (finalizeRegistered) return;
    finalizeRegistered = true;
    process.on("exit", flushPending);
}

function jsDocText(comment: ts.JSDoc["comment"]): string {
    if (!comment) return "";
    if (typeof comment === "string") return comment.trim().replace(/^—\s*/, "");
    const raw = (comment as ts.NodeArray<ts.JSDocComment>)
        .map(c => ("text" in c ? (c as { text: string }).text : ""))
        .join("");
    return raw.trim().replace(/^—\s*/, "");
}

function collectJsDoc(ts: typeof import("typescript"), sourceFile: ts.SourceFile): Map<string, FnDoc> {
    const sidecar = new Map<string, FnDoc>();

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const jsDocs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
            if (jsDocs && jsDocs.length > 0) {
                const doc = jsDocs[jsDocs.length - 1];
                const rawDesc = jsDocText(doc.comment);
                const desc = rawDesc.split("\n").map(l => l.trim()).filter(Boolean);
                const params = new Map<string, string>();
                let returns = "";
                let deprecated: string | undefined;

                for (const tag of doc.tags ?? []) {
                    if (ts.isJSDocParameterTag(tag)) {
                        const name = ts.isIdentifier(tag.name) ? tag.name.text : "";
                        if (name) params.set(name, jsDocText(tag.comment).trim());
                    } else if (ts.isJSDocReturnTag(tag)) {
                        returns = jsDocText(tag.comment).trim();
                    } else if (ts.isJSDocDeprecatedTag(tag)) {
                        deprecated = jsDocText(tag.comment).trim();
                    }
                }

                if (desc.length > 0 || params.size > 0 || returns || deprecated !== undefined) {
                    sidecar.set(node.name.text, { desc, params, returns, deprecated });
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return sidecar;
}

export default function (
    program: ts.Program,
    config: PluginConfig = {},
): ts.TransformerFactory<ts.SourceFile> {
    const { strict = true, optimize = false, verbose = false } = config;
    const optimizeLevel: false | 0 | 1 | 2 = optimize === false ? false : ([0, 1, 2] as const).includes(optimize as 0|1|2) ? optimize : 2;

    // Watch mode: flush the previous run's pending files before starting this one.
    flushPending();
    registerFinalizer();

    const outDir = program.getCompilerOptions().outDir;

    return (_ctx) => (sourceFile) => {
        const outPath = outPathForSource(sourceFile, program);
        if (outPath) {
            const sidecar = collectJsDoc(ts, sourceFile);
            pending.set(outPath, { outPath, strict, optimizeLevel, verbose, sidecar });
            if (verbose) {
                const rel = outDir ? path.relative(outDir, outPath) : outPath;
                console.log(`luau: ${rel}`);
            }
        }
        return sourceFile;
    };
}
