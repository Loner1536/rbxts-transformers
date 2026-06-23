import type ts from "typescript";
import { hasOptimizeDirective } from "../util";

export function nativePass(
    ts: typeof import("typescript"),
    ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
): ts.SourceFile {
    if (hasOptimizeDirective(sourceFile)) return sourceFile;

    const factory = ctx.factory;
    const optimize = ts.addSyntheticLeadingComment(
        factory.createNotEmittedStatement(sourceFile),
        ts.SyntaxKind.SingleLineCommentTrivia,
        "!optimize 2",
        true,
    );
    return factory.updateSourceFile(sourceFile, [optimize, ...Array.from(sourceFile.statements)]);
}
