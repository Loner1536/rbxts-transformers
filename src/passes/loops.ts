import type ts from "typescript";

export function loopsPass(
    ts: typeof import("typescript"),
    _program: ts.Program,
    ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
): ts.SourceFile {
    const factory = ctx.factory;

    function isArrayLengthExpr(node: ts.Expression): ts.Expression | undefined {
        // matches: arr.size() or arr.length (if it ever appears)
        if (ts.isCallExpression(node)) {
            const expr = node.expression;
            if (ts.isPropertyAccessExpression(expr) && expr.name.text === "size" && node.arguments.length === 0) {
                return expr.expression;
            }
        }
        return undefined;
    }

    function rewriteForLoop(node: ts.ForStatement): ts.Statement {
        // Match: for (let i = 0; i < arr.size(); i++) { ... }
        const { initializer, condition, incrementor, statement } = node;
        if (!initializer || !condition || !incrementor) return node;
        if (!ts.isVariableDeclarationList(initializer)) return node;
        const decls = initializer.declarations;
        if (decls.length !== 1) return node;
        const decl = decls[0];
        if (!ts.isIdentifier(decl.name)) return node;
        if (!decl.initializer || !ts.isNumericLiteral(decl.initializer) || decl.initializer.text !== "0") return node;
        if (!ts.isBinaryExpression(condition)) return node;
        if (condition.operatorToken.kind !== ts.SyntaxKind.LessThanToken) return node;

        const arr = isArrayLengthExpr(condition.right);
        if (!arr) return node;

        const loopVar = decl.name.text;
        const arrName = ts.isIdentifier(arr) ? arr.text : undefined;
        if (!arrName) return node;

        const lenName = `_len_${arrName}`;
        const lenDecl = factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
                [factory.createVariableDeclaration(
                    factory.createIdentifier(lenName),
                    undefined,
                    factory.createTypeReferenceNode("number"),
                    factory.createCallExpression(
                        factory.createPropertyAccessExpression(arr, "size"),
                        undefined, [],
                    ),
                )],
                ts.NodeFlags.Const,
            ),
        );

        const newCondition = factory.updateBinaryExpression(
            condition,
            condition.left,
            condition.operatorToken,
            factory.createIdentifier(lenName),
        );
        const newFor = factory.updateForStatement(
            node, initializer, newCondition, incrementor, statement,
        );

        return factory.createBlock([lenDecl, newFor], true) as unknown as ts.Statement;
    }

    const visitor = (node: ts.Node): ts.Node => {
        if (ts.isForStatement(node)) {
            return rewriteForLoop(node);
        }
        return ts.visitEachChild(node, visitor, ctx);
    };

    return ts.visitEachChild(sourceFile, visitor, ctx) as ts.SourceFile;
}
