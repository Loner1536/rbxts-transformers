import type ts from "typescript";
import type { PluginConfig } from "./config";
import { nativePass } from "./passes/native";
import { cachePass } from "./passes/cache";
import { annotatePass } from "./passes/annotate";

export type { PluginConfig };

export default function(
    program: ts.Program,
    config: PluginConfig = {},
    { ts }: { ts: typeof import("typescript") },
): ts.TransformerFactory<ts.SourceFile> {
    const { optimize = true, strict = true, hoist = true } = config;

    return (ctx: ts.TransformationContext) => (sourceFile: ts.SourceFile): ts.SourceFile => {
        annotatePass(ts, program, sourceFile);
        let result = sourceFile;
        if (hoist) result = cachePass(ts, program, ctx, result);
        if (optimize || strict) result = nativePass(ts, ctx, result, optimize, strict);
        return result;
    };
}
