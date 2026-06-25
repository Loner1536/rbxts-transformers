import ts from "typescript";
import type { PluginConfig } from "./config";
import { nativePass } from "./passes/native";
import { cachePass } from "./passes/cache";
import { loopsPass } from "./passes/loops";
import { annotatePass } from "./passes/annotate";
import { createDebugger } from "./debug";
export type { PluginConfig };

export default function (
    program: ts.Program,
    config: PluginConfig = {},
): ts.TransformerFactory<ts.SourceFile> {
    const { optimize = true, strict = true, hoist = true, verbose = false } = config;
    const dbg = createDebugger(program, verbose);

    return (ctx) => (sourceFile) => {
        if (sourceFile.fileName.endsWith("fns-bare.ts")) return sourceFile;
        const rel = sourceFile.fileName.replace(process.cwd() + "/", "");

        const errors: string[] = [];

        try {
            annotatePass(ts, program, sourceFile);
            let result = sourceFile;
            let cached = 0;

            if (hoist) {
                try {
                    const cacheResult = cachePass(ts, program, ctx, result, dbg);
                    result = cacheResult.result;
                    cached = cacheResult.cached;
                } catch (err) {
                    errors.push(`cache: ${err instanceof Error ? err.message : String(err)}`);
                }

                try {
                    result = loopsPass(ts, program, ctx, result);
                } catch (err) {
                    errors.push(`loops: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            if (optimize || strict) {
                try {
                    result = nativePass(ts, ctx, result, optimize, strict);
                } catch (err) {
                    errors.push(`native: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            dbg.file(rel, { cached, errors });
            return result;
        } catch (err) {
            // Unrecoverable — whole file failed
            const msg = err instanceof Error ? err.message : String(err);
            dbg.file(rel, { cached: 0, errors: [`fatal: ${msg} — using original`] });
            return sourceFile;
        }
    };
}
