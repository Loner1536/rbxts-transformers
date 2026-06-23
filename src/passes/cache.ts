import type ts from "typescript";
import { chainKey, walk, isAssignmentTarget } from "../util";

function isGetServiceCall(ts: typeof import("typescript"), node: ts.Node): node is ts.CallExpression {
    if (!ts.isCallExpression(node)) return false;
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr)) return false;
    const obj = expr.expression;
    return ts.isIdentifier(obj) && obj.text === "game" && expr.name.text === "GetService";
}

function getServiceName(ts: typeof import("typescript"), call: ts.CallExpression): string | undefined {
    const args = call.arguments;
    if (args.length !== 1) return undefined;
    const arg = args[0];
    if (!ts.isStringLiteral(arg)) return undefined;
    return arg.text;
}

export function cachePass(
    ts: typeof import("typescript"),
    _program: ts.Program,
    ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
): ts.SourceFile {
    const factory = ctx.factory;

    // --- GetService hoisting ---
    const services = new Map<string, string>();
    walk(ts, sourceFile, node => {
        if (!node || !isGetServiceCall(ts, node)) return;
        const name = getServiceName(ts, node as ts.CallExpression);
        if (name && !services.has(name)) services.set(name, `_${name}`);
    });

    const serviceVisitor = (node: ts.Node): ts.Node => {
        if (isGetServiceCall(ts, node)) {
            const name = getServiceName(ts, node as ts.CallExpression);
            if (name && services.has(name)) return factory.createIdentifier(services.get(name)!);
        }
        return ts.visitEachChild(node, serviceVisitor, ctx);
    };

    let result = ts.visitEachChild(sourceFile, serviceVisitor, ctx) as ts.SourceFile;

    if (services.size > 0) {
        const hoistDecls = Array.from(services.entries()).map(([name, localName]) =>
            factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                    [factory.createVariableDeclaration(
                        factory.createIdentifier(localName),
                        undefined,
                        undefined,
                        factory.createCallExpression(
                            factory.createPropertyAccessExpression(
                                factory.createIdentifier("game"),
                                "GetService",
                            ),
                            undefined,
                            [factory.createStringLiteral(name)],
                        ),
                    )],
                    ts.NodeFlags.Const,
                ),
            )
        );
        result = factory.updateSourceFile(result, [...hoistDecls, ...Array.from(result.statements)]);
    }

    // --- Property chain hoisting within functions ---
    result = hoistPropertyChains(ts, result, factory, ctx);
    return result;
}

function hoistPropertyChains(
    ts: typeof import("typescript"),
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
    ctx: ts.TransformationContext,
): ts.SourceFile {
    const visitor = (node: ts.Node): ts.Node => {
        if (
            ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
        ) {
            return hoistInFunction(ts, node as ts.FunctionLikeDeclaration, factory, ctx);
        }
        return ts.visitEachChild(node, visitor, ctx);
    };
    return ts.visitEachChild(sourceFile, visitor, ctx) as ts.SourceFile;
}

/**
 * Collect every identifier name that is assigned (mutated) anywhere inside
 * the given node.  This includes:
 *   - plain assignment:  x = …
 *   - compound assignment: x += …  x -= …  etc.
 *   - prefix/postfix ++/--
 *   - `for` / `for…of` / `for…in` loop variables declared with `let`
 *   - `let` variable declarations (re-assignable by nature)
 */
function collectMutatedIdentifiers(
    ts: typeof import("typescript"),
    body: ts.Block,
): Set<string> {
    const mutated = new Set<string>();

    walk(ts, body, node => {
        // x = …  or  x += …  etc.
        if (ts.isBinaryExpression(node)) {
            const op = node.operatorToken.kind;
            const isAssign =
                op === ts.SyntaxKind.EqualsToken ||
                op === ts.SyntaxKind.PlusEqualsToken ||
                op === ts.SyntaxKind.MinusEqualsToken ||
                op === ts.SyntaxKind.AsteriskEqualsToken ||
                op === ts.SyntaxKind.SlashEqualsToken ||
                op === ts.SyntaxKind.PercentEqualsToken ||
                op === ts.SyntaxKind.AmpersandEqualsToken ||
                op === ts.SyntaxKind.BarEqualsToken ||
                op === ts.SyntaxKind.CaretEqualsToken ||
                op === ts.SyntaxKind.LessThanLessThanEqualsToken ||
                op === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
                op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
                op === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
                op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
                op === ts.SyntaxKind.BarBarEqualsToken ||
                op === ts.SyntaxKind.QuestionQuestionEqualsToken;

            if (isAssign && ts.isIdentifier(node.left)) {
                mutated.add(node.left.text);
            }
        }

        // ++x  --x  x++  x--
        if (
            (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            ts.isIdentifier(node.operand)
        ) {
            mutated.add((node.operand as ts.Identifier).text);
        }

        // `let x` or `let x = …` declarations (re-assignable)
        if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Let)) {
            for (const decl of node.declarations) {
                if (ts.isIdentifier(decl.name)) mutated.add(decl.name.text);
            }
        }

        // for (x of …) / for (x in …) where x is an existing identifier
        if (
            (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
            ts.isIdentifier((node as ts.ForOfStatement | ts.ForInStatement).initializer)
        ) {
            const init = (node as ts.ForOfStatement | ts.ForInStatement).initializer as ts.Identifier;
            mutated.add(init.text);
        }
    });

    return mutated;
}

function hoistInFunction(
    ts: typeof import("typescript"),
    fn: ts.FunctionLikeDeclaration,
    factory: ts.NodeFactory,
    ctx: ts.TransformationContext,
): ts.FunctionLikeDeclaration {
    if (!fn.body || !ts.isBlock(fn.body)) return fn;

    // Collect all identifiers that are mutated anywhere in this function body.
    // We must not hoist any property chain that starts with (or passes through)
    // a mutable identifier, because the cached value would be stale and — more
    // importantly — the hoisted `const _cacheN = x.Prop` declaration would be
    // placed at the top of the block before `x` is assigned, causing TS2448.
    const mutatedIds = collectMutatedIdentifiers(ts, fn.body);

    /**
     * Returns true when any prefix segment of the dot-separated chain key is
     * a mutated identifier.  E.g. for "Root.IsA", the root "Root" is checked;
     * for "a.b.c", both "a" and "a.b" are checked.
     */
    function chainHasMutableSegment(key: string): boolean {
        const parts = key.split(".");
        let prefix = "";
        for (let i = 0; i < parts.length - 1; i++) {
            prefix = i === 0 ? parts[0] : `${prefix}.${parts[i]}`;
            if (mutatedIds.has(parts[i])) return true;
        }
        return false;
    }

    const counts = new Map<string, number>();
    walk(ts, fn.body, node => {
        if (!node || !ts.isPropertyAccessExpression(node)) return;
        const key = chainKey(ts, node);
        if (!key || !key.includes(".")) return;
        if (isAssignmentTarget(ts, node)) return;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    const toHoist = new Map<string, string>();
    let counter = 0;

    const candidates = Array.from(counts.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[0].length - a[0].length);

    for (const [key] of candidates) {
        // Skip chains that touch a mutable variable — caching them is unsafe.
        if (chainHasMutableSegment(key)) continue;
        const alreadyCovered = Array.from(toHoist.keys()).some(h => h.startsWith(key + "."));
        if (alreadyCovered) continue;
        toHoist.set(key, `_cache${counter++}`);
    }

    if (toHoist.size === 0) return fn;

    const chainVisitor = (node: ts.Node): ts.Node => {
        if (ts.isPropertyAccessExpression(node)) {
            const key = chainKey(ts, node);
            if (key && toHoist.has(key) && !isAssignmentTarget(ts, node)) {
                return factory.createIdentifier(toHoist.get(key)!);
            }
        }
        return ts.visitEachChild(node, chainVisitor, ctx);
    };

    const newBody = ts.visitEachChild(fn.body, chainVisitor, ctx) as ts.Block;

    const hoistStmts = Array.from(toHoist.entries()).map(([key, localName]) => {
        const parts = key.split(".");
        let expr: ts.Expression = factory.createIdentifier(parts[0]);
        for (let i = 1; i < parts.length; i++) {
            expr = factory.createPropertyAccessExpression(expr, parts[i]);
        }
        return factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
                [factory.createVariableDeclaration(
                    factory.createIdentifier(localName),
                    undefined, undefined, expr,
                )],
                ts.NodeFlags.Const,
            ),
        );
    });

    const updatedBody = factory.updateBlock(newBody, [...hoistStmts, ...Array.from(newBody.statements)]);

    if (ts.isFunctionDeclaration(fn)) return factory.updateFunctionDeclaration(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, updatedBody);
    if (ts.isFunctionExpression(fn)) return factory.updateFunctionExpression(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, updatedBody);
    if (ts.isArrowFunction(fn)) return factory.updateArrowFunction(fn, fn.modifiers, fn.typeParameters, fn.parameters, fn.type, fn.equalsGreaterThanToken, updatedBody);
    if (ts.isMethodDeclaration(fn)) return factory.updateMethodDeclaration(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.questionToken, fn.typeParameters, fn.parameters, fn.type, updatedBody);
    return fn;
}
