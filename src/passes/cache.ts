import type ts from "typescript";
import { chainKey, walk, isAssignmentTarget } from "../util";
import type { Debugger } from "../debug";

const SKIP_ROOTS = new Set([
    "math", "string", "table", "bit32", "os", "buffer",
    "utf8", "coroutine", "io", "debug", "package",
    "game", "workspace", "script", "shared",
    "Vector3", "Vector2", "CFrame", "Color3", "UDim", "UDim2",
    "TweenInfo", "NumberRange", "NumberSequence", "ColorSequence",
    "Rect", "Region3", "Ray", "BrickColor", "Axes", "Faces",
    "Instance", "Enum", "task", "tick", "time", "warn", "error",
    "print", "tostring", "tonumber", "type", "typeof", "select",
    "pairs", "ipairs", "next", "unpack", "pcall", "xpcall",
    "setmetatable", "getmetatable", "rawget", "rawset", "rawequal",
]);

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
    program: ts.Program,
    ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
    dbg: Debugger,
): { result: ts.SourceFile; cached: number } {
    const factory = ctx.factory;
    const checker = program.getTypeChecker();
    let cached = 0;

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
        cached += services.size;
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
    const chainResult = hoistPropertyChains(ts, result, factory, ctx, checker, dbg);
    result = chainResult.result;
    cached += chainResult.cached;

    return { result, cached };
}

function hoistPropertyChains(
    ts: typeof import("typescript"),
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
    ctx: ts.TransformationContext,
    checker: ts.TypeChecker,
    dbg: Debugger,
): { result: ts.SourceFile; cached: number } {
    let totalCached = 0;

    const visitor = (node: ts.Node): ts.Node => {
        if (
            ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
        ) {
            const { fn, cached } = hoistInFunction(ts, node as ts.FunctionLikeDeclaration, factory, ctx, checker, dbg);
            totalCached += cached;
            return fn;
        }
        return ts.visitEachChild(node, visitor, ctx);
    };

    return {
        result: ts.visitEachChild(sourceFile, visitor, ctx) as ts.SourceFile,
        cached: totalCached,
    };
}

/**
 * Collect every identifier name that is assigned (mutated) anywhere inside
 * the given node.
 */
function collectMutatedIdentifiers(
    ts: typeof import("typescript"),
    body: ts.Block,
): Set<string> {
    const mutated = new Set<string>();

    walk(ts, body, node => {
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

        if (
            (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            ts.isIdentifier(node.operand)
        ) {
            mutated.add((node.operand as ts.Identifier).text);
        }

        if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Let)) {
            for (const decl of node.declarations) {
                if (ts.isIdentifier(decl.name)) mutated.add(decl.name.text);
            }
        }

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

/**
 * Collect every identifier name declared as `const` anywhere inside the body.
 * Hoisting a chain whose root is a const local would place the cache declaration
 * above the root's own declaration, causing TS2448/TS2454.
 */
function collectConstDeclaredIdentifiers(
    ts: typeof import("typescript"),
    body: ts.Block,
): Set<string> {
    const consts = new Set<string>();
    walk(ts, body, node => {
        if (!ts.isVariableDeclarationList(node)) return;
        if (!(node.flags & ts.NodeFlags.Const)) return;
        for (const decl of node.declarations) {
            if (ts.isIdentifier(decl.name)) consts.add(decl.name.text);
        }
    });
    return consts;
}

/**
 * Returns true when hoisting this chain would provide a real performance benefit.
 *
 * We only hoist chains whose root resolves to something that:
 *   - is a parameter or local variable (not a global/module-level name), AND
 *   - holds a value whose property reads go through Roblox's C++ object system
 *     (instances, value types) rather than a plain Lua table lookup.
 *
 * Chains rooted at known Lua/Roblox static globals (math, string, Vector3, etc.)
 * are skipped — their properties are either C-level constants or constructors that
 * cost nothing extra to look up twice.
 */
function chainHasBenefit(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    key: string,
    fn: ts.FunctionLikeDeclaration,
): boolean {
    const root = key.split(".")[0];

    // Fast path: known static globals — never worth caching
    if (SKIP_ROOTS.has(root)) return false;

    // Find the root identifier's symbol in the function's parameter list or body
    // to verify it's a local/parameter rather than a module-level global
    const params = new Set(
        fn.parameters
            .map(p => ts.isIdentifier(p.name) ? p.name.text : null)
            .filter((n): n is string => n !== null)
    );

    if (params.has(root)) {
        // It's a parameter — check its type to confirm it's an instance/value type
        // rather than a plain number/string/boolean/function
        const param = fn.parameters.find(p => ts.isIdentifier(p.name) && p.name.text === root);
        if (param) {
            const type = checker.getTypeAtLocation(param);
            const typeName = checker.typeToString(type);
            // Skip primitives and function types — their properties aren't C++ reads
            if (/^(number|string|boolean|undefined|null|void|never|unknown|any)$/.test(typeName)) return false;
            if (typeName.includes("=>") || typeName.startsWith("(")) return false;
        }
        return true;
    }

    // For non-parameter roots, fall back to checking if it looks like a global
    // by seeing if the symbol has no value declaration inside this function.
    // If we can't determine it, allow it — better to over-hoist than under-hoist
    // for non-globals.
    try {
        // Walk the function body looking for a local declaration of root
        let foundLocal = false;
        if (fn.body && ts.isBlock(fn.body)) {
            walk(ts, fn.body, node => {
                if (foundLocal) return;
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === root) {
                    foundLocal = true;
                }
            });
        }
        // If it's a local variable (not a parameter, not a global), allow hoisting
        // only if it's not in SKIP_ROOTS (already checked above)
        return foundLocal || !SKIP_ROOTS.has(root);
    } catch {
        return true;
    }
}

function hoistInFunction(
    ts: typeof import("typescript"),
    fn: ts.FunctionLikeDeclaration,
    factory: ts.NodeFactory,
    ctx: ts.TransformationContext,
    checker: ts.TypeChecker,
    dbg: Debugger,
): { fn: ts.FunctionLikeDeclaration; cached: number } {
    if (!fn.body || !ts.isBlock(fn.body)) return { fn, cached: 0 };

    const mutatedIds = collectMutatedIdentifiers(ts, fn.body);
    const constIds = collectConstDeclaredIdentifiers(ts, fn.body);

    function chainHasMutableSegment(key: string): boolean {
        const parts = key.split(".");
        for (let i = 0; i < parts.length - 1; i++) {
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
        // Skip chains that touch a mutable variable
        if (chainHasMutableSegment(key)) continue;
        // Skip chains whose root is a const local declared in this body
        if (constIds.has(key.split(".")[0])) continue;
        // Skip chains that wouldn't benefit from caching
        if (!chainHasBenefit(ts, checker, key, fn)) continue;
        const alreadyCovered = Array.from(toHoist.keys()).some(h => h.startsWith(key + "."));
        if (alreadyCovered) continue;
        toHoist.set(key, `_cache${counter++}`);
    }

    if (toHoist.size === 0) return { fn, cached: 0 };

    try {
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

        let updated: ts.FunctionLikeDeclaration = fn;
        if (ts.isFunctionDeclaration(fn)) updated = factory.updateFunctionDeclaration(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, updatedBody);
        else if (ts.isFunctionExpression(fn)) updated = factory.updateFunctionExpression(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, updatedBody);
        else if (ts.isArrowFunction(fn)) updated = factory.updateArrowFunction(fn, fn.modifiers, fn.typeParameters, fn.parameters, fn.type, fn.equalsGreaterThanToken, updatedBody);
        else if (ts.isMethodDeclaration(fn)) updated = factory.updateMethodDeclaration(fn, fn.modifiers, fn.asteriskToken, fn.name, fn.questionToken, fn.typeParameters, fn.parameters, fn.type, updatedBody);

        return { fn: updated, cached: toHoist.size };
    } catch (err) {
        const fnName = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : "<anonymous>";
        dbg.warn("cachePass", `skipped hoisting in ${fnName}: ${err instanceof Error ? err.message : String(err)}`);
        return { fn, cached: 0 };
    }
}
