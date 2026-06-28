import ts from "typescript";

export type TypeDecl = {
    name: string;
    exported: boolean;
    luau: string;
};

// Utility type names that require Luau type function implementations
const NEEDS_TYPE_FUNCTION = new Set([
    "Partial", "Required", "Pick", "Omit", "NonNullable",
    "ReturnType", "Parameters", "Extract", "Exclude", "Awaited",
]);

// Utility types with a simple direct-mapping instead of a type function
const DIRECT_MAP: Record<string, (args: string[]) => string> = {
    Record: ([k = "any", v = "any"]) => `{[${k}]: ${v}}`,
    Readonly: ([t = "any"]) => t,
    ReadonlyArray: ([t = "any"]) => `{${t}}`,
    Array: ([t = "any"]) => `{${t}}`,
    LuaTuple: () => "any", // handled separately
    Map: ([k = "any", v = "any"]) => `{[${k}]: ${v}}`,
    Set: ([t = "any"]) => `{[${t}]: boolean}`,
    Promise: ([t = "any"]) => `Promise<${t}>`,
};

function formatTypeParams(params: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): string {
    if (!params || params.length === 0) return "";
    return `<${params.map(p => p.name.text).join(", ")}>`;
}

export function tsTypeToLuau(node: ts.TypeNode, used: Set<string>): string {
    switch (node.kind) {
        case ts.SyntaxKind.StringKeyword:    return "string";
        case ts.SyntaxKind.NumberKeyword:    return "number";
        case ts.SyntaxKind.BooleanKeyword:   return "boolean";
        case ts.SyntaxKind.NullKeyword:
        case ts.SyntaxKind.UndefinedKeyword: return "nil";
        // void is only valid as () in function return position; in a standalone
        // type alias (e.g. type Vd = void) it must be nil
        case ts.SyntaxKind.VoidKeyword:      return "nil";
        case ts.SyntaxKind.AnyKeyword:       return "any";
        case ts.SyntaxKind.UnknownKeyword:   return "unknown";
        case ts.SyntaxKind.NeverKeyword:     return "never";
        case ts.SyntaxKind.ObjectKeyword:    return "{[any]: any}";
        case ts.SyntaxKind.BigIntKeyword:    return "number"; // no bigint in Luau
        case ts.SyntaxKind.SymbolKeyword:    return "any";
    }

    if (ts.isArrayTypeNode(node)) {
        return `{${tsTypeToLuau(node.elementType, used)}}`;
    }

    if (ts.isUnionTypeNode(node)) {
        const parts = [...new Set(node.types.map(t => tsTypeToLuau(t, used)))];
        // true | false → boolean
        if (parts.length === 2 && parts.includes("true") && parts.includes("false")) return "boolean";
        // all members collapsed to the same type (e.g. 200 | 404 | 500 → number | number | number)
        if (parts.length === 1) return parts[0];
        return parts.join(" | ");
    }

    if (ts.isIntersectionTypeNode(node)) {
        return node.types.map(t => tsTypeToLuau(t, used)).join(" & ");
    }

    if (ts.isParenthesizedTypeNode(node)) {
        return `(${tsTypeToLuau(node.type, used)})`;
    }

    if (ts.isFunctionTypeNode(node)) {
        const typeParams = formatTypeParams(node.typeParameters);
        const params = node.parameters.map(p => {
            const t = p.type ? tsTypeToLuau(p.type, used) : "any";
            return p.questionToken ? `${t}?` : t;
        });
        // void in return position → () (empty return pack), not nil
        const ret = node.type
            ? (node.type.kind === ts.SyntaxKind.VoidKeyword ? "()" : tsTypeToLuau(node.type, used))
            : "()";
        return `${typeParams}(${params.join(", ")}) -> ${ret}`;
    }

    if (ts.isConstructorTypeNode(node)) {
        // new (...) => T — treated as a callable
        const params = node.parameters.map(p => p.type ? tsTypeToLuau(p.type, used) : "any");
        const ret = node.type ? tsTypeToLuau(node.type, used) : "any";
        return `(${params.join(", ")}) -> ${ret}`;
    }

    if (ts.isTypeLiteralNode(node)) {
        return formatObjectType(node.members, used);
    }

    if (ts.isTupleTypeNode(node)) {
        const elems = node.elements.map(e => {
            const inner = ts.isNamedTupleMember(e) ? e.type : (e as ts.TypeNode);
            const mapped = tsTypeToLuau(inner, used);
            return ts.isNamedTupleMember(e) && e.questionToken ? `${mapped}?` : mapped;
        });
        return `{${elems.join(", ")}}`;
    }

    if (ts.isLiteralTypeNode(node)) {
        const lit = node.literal;
        if (ts.isStringLiteral(lit))  return `"${lit.text}"`;
        // Luau doesn't support number literal types — widen to number
        if (ts.isNumericLiteral(lit)) return "number";
        if (lit.kind === ts.SyntaxKind.TrueKeyword)  return "true";
        if (lit.kind === ts.SyntaxKind.FalseKeyword) return "false";
        if (lit.kind === ts.SyntaxKind.NullKeyword)  return "nil";
        return "any";
    }

    if (ts.isTypeReferenceNode(node)) {
        return mapTypeRef(node, used);
    }

    if (ts.isOptionalTypeNode(node)) {
        return `${tsTypeToLuau(node.type, used)}?`;
    }

    if (ts.isRestTypeNode(node)) {
        return `...${tsTypeToLuau(node.type, used)}`;
    }

    // keyof T → string (or a string literal union for inline object types)
    // readonly T → T (strip readonly modifier)
    if (ts.isTypeOperatorNode(node)) {
        if (node.operator === ts.SyntaxKind.KeyOfKeyword) {
            // For inline object types, we can produce the actual key union
            if (ts.isTypeLiteralNode(node.type)) {
                const keys = node.type.members
                    .filter(ts.isPropertySignature)
                    .map(m => ts.isIdentifier(m.name) ? `"${m.name.text}"` : null)
                    .filter((k): k is string => k !== null);
                return keys.length > 0 ? keys.join(" | ") : "string";
            }
            return "string";
        }
        if (node.operator === ts.SyntaxKind.ReadonlyKeyword) {
            return tsTypeToLuau(node.type, used);
        }
        return "any";
    }

    // typeof x — can't resolve without a runtime value; widen to any
    if (ts.isTypeQueryNode(node)) {
        return "any";
    }

    // Conditional, mapped, indexed-access, infer — not expressible statically
    if (ts.isConditionalTypeNode(node) || ts.isMappedTypeNode(node) || ts.isIndexedAccessTypeNode(node) || ts.isInferTypeNode(node)) {
        return "any";
    }

    if (ts.isTemplateLiteralTypeNode(node)) {
        return "string";
    }

    return "any";
}

function mapTypeRef(node: ts.TypeReferenceNode, used: Set<string>): string {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : "any";
    const args = node.typeArguments ? node.typeArguments.map(a => tsTypeToLuau(a, used)) : [];

    // LuaTuple<[A, B, C]> → (A, B, C)
    if (name === "LuaTuple" && node.typeArguments?.[0] && ts.isTupleTypeNode(node.typeArguments[0])) {
        const elems = (node.typeArguments[0] as ts.TupleTypeNode).elements.map(e => {
            const inner = ts.isNamedTupleMember(e) ? e.type : (e as ts.TypeNode);
            return tsTypeToLuau(inner, used);
        });
        return `(${elems.join(", ")})`;
    }

    if (name in DIRECT_MAP) {
        return DIRECT_MAP[name](args);
    }

    if (NEEDS_TYPE_FUNCTION.has(name)) {
        used.add(name);
    }

    return args.length > 0 ? `${name}<${args.join(", ")}>` : name;
}

function formatObjectType(members: ts.NodeArray<ts.TypeElement>, used: Set<string>): string {
    const parts: string[] = [];

    for (const m of members) {
        if (ts.isPropertySignature(m) && m.name) {
            const key = memberKey(m.name);
            if (key === null) continue;
            const val = m.type ? tsTypeToLuau(m.type, used) : "any";
            const opt = m.questionToken ? "?" : "";
            parts.push(`${key}: ${val}${opt}`);

        } else if (ts.isIndexSignatureDeclaration(m)) {
            const kType = m.parameters[0]?.type ? tsTypeToLuau(m.parameters[0].type, used) : "any";
            const vType = m.type ? tsTypeToLuau(m.type as ts.TypeNode, used) : "any";
            parts.push(`[${kType}]: ${vType}`);

        } else if (ts.isMethodSignature(m) && m.name) {
            const key = memberKey(m.name);
            if (key === null) continue;
            const typeParams = formatTypeParams(m.typeParameters);
            const params = m.parameters.map(p => {
                const t = p.type ? tsTypeToLuau(p.type, used) : "any";
                return p.questionToken ? `${t}?` : t;
            });
            const ret = m.type
                ? (m.type.kind === ts.SyntaxKind.VoidKeyword ? "()" : tsTypeToLuau(m.type, used))
                : "()";
            parts.push(`${key}: ${typeParams}(${params.join(", ")}) -> ${ret}`);

        } else if (ts.isCallSignatureDeclaration(m)) {
            const params = m.parameters.map(p => p.type ? tsTypeToLuau(p.type, used) : "any");
            const ret = m.type ? tsTypeToLuau(m.type, used) : "any";
            parts.push(`_call: (${params.join(", ")}) -> ${ret}`);
        }
    }

    if (parts.length === 0) return "{}";
    return `{ ${parts.join(", ")} }`;
}

function memberKey(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name)) return `["${name.text}"]`;
    if (ts.isNumericLiteral(name)) return `[${name.text}]`;
    return null;
}

// ─── Luau type function implementations ──────────────────────────────────────
// These are emitted at the top of the file when referenced.

const TYPE_FUNCTION_IMPLS: Record<string, string> = {
    Partial: `type function Partial(T)
    local result = types.newtable(nil, nil)
    for key, prop in T:properties() do
        result:setproperty(key, types.optional(prop.read))
    end
    return result
end`,
    Required: `type function Required(T)
    local result = types.newtable(nil, nil)
    for key, prop in T:properties() do
        local ty = prop.read
        if ty:is("union") then
            local comps = ty:components()
            local union: type? = nil
            for i = 1, #comps do
                local part = comps[i]
                if part ~= types.singleton(nil) then
                    union = if union then types.unionof(union, part) else part
                end
            end
            if union then result:setproperty(key, union) end
        else
            result:setproperty(key, ty)
        end
    end
    return result
end`,
    Pick: `type function Pick(T, K)
    local result = types.newtable(nil, nil)
    for key, prop in T:properties() do
        local match = false
        if K:is("union") then
            local kcomps = K:components()
            for i = 1, #kcomps do
                if key == kcomps[i] then match = true; break end
            end
        else
            match = key == K
        end
        if match then result:setproperty(key, prop.read) end
    end
    return result
end`,
    Omit: `type function Omit(T, K)
    local result = types.newtable(nil, nil)
    for key, prop in T:properties() do
        local skip = false
        if K:is("union") then
            local kcomps = K:components()
            for i = 1, #kcomps do
                if key == kcomps[i] then skip = true; break end
            end
        else
            skip = key == K
        end
        if not skip then result:setproperty(key, prop.read) end
    end
    return result
end`,
    NonNullable: `type function NonNullable(T)
    if T:is("union") then
        local comps = T:components()
        local union: type? = nil
        for i = 1, #comps do
            local part = comps[i]
            if part ~= types.singleton(nil) then
                union = if union then types.unionof(union, part) else part
            end
        end
        return union or types.never
    end
    return T
end`,
    Extract: `type function Extract(T, U)
    if T:is("union") then
        local comps = T:components()
        local union: type? = nil
        for i = 1, #comps do
            local part = comps[i]
            if types.unionof(part, U) == types.unionof(U, part) then
                union = if union then types.unionof(union, part) else part
            end
        end
        return union or types.never
    end
    return types.never
end`,
    Exclude: `type function Exclude(T, U)
    if T:is("union") then
        local comps = T:components()
        local union: type? = nil
        for i = 1, #comps do
            local part = comps[i]
            if not (types.unionof(part, U) == types.unionof(U, part)) then
                union = if union then types.unionof(union, part) else part
            end
        end
        return union or types.never
    end
    return T
end`,
    ReturnType: `type function ReturnType(F)
    if F:is("function") then
        local ret = F:returns()
        local head = ret.head
        return if head and #head == 1 then head[1] else types.never
    end
    return types.never
end`,
    Parameters: `type function Parameters(F)
    if F:is("function") then
        local result = types.newtable(nil, nil)
        local params = F:parameters()
        local head = params.head
        if head then
            for i = 1, #head do
                result:setproperty(types.singleton(i - 1), head[i])
            end
        end
        return result
    end
    return types.newtable(nil, nil)
end`,
    Awaited: `type function Awaited(T)
    return T
end`,
};

// ─── Trivial alias detection ──────────────────────────────────────────────────
// Skip type aliases whose RHS is a single primitive or bare type name with no
// type parameters — they add no information Luau doesn't already know.
const LUAU_PRIMITIVES = new Set([
    "string", "number", "boolean", "nil", "any", "unknown", "never",
    "{[any]: any}", "{}",
]);

function isTrivialAlias(name: string, typeParams: string, rhs: string): boolean {
    // Has type params → it's a generic wrapper, keep it
    if (typeParams.length > 0) return false;
    // RHS is a plain primitive with no structure
    return LUAU_PRIMITIVES.has(rhs) || rhs === name;
}

// ─── Collection ───────────────────────────────────────────────────────────────

// Returns whether a class member modifier includes any access/property modifier
// that makes a constructor parameter into an instance property.
function isPropertyParam(param: ts.ParameterDeclaration): boolean {
    return (param.modifiers ?? []).some(m =>
        m.kind === ts.SyntaxKind.PublicKeyword ||
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword ||
        m.kind === ts.SyntaxKind.ReadonlyKeyword,
    );
}

function classInstanceFields(node: ts.ClassDeclaration, used: Set<string>): string[] {
    const fields: string[] = [];

    // Constructor parameter properties: constructor(public x: number)
    const ctor = node.members.find(ts.isConstructorDeclaration);
    if (ctor) {
        for (const param of ctor.parameters) {
            if (!isPropertyParam(param) || !ts.isIdentifier(param.name)) continue;
            const ty = param.type ? tsTypeToLuau(param.type, used) : "any";
            const opt = param.questionToken ? "?" : "";
            fields.push(`${param.name.text}${opt}: ${ty}`);
        }
    }

    // Non-static property declarations: name: string;
    for (const m of node.members) {
        if (!ts.isPropertyDeclaration(m) || !ts.isIdentifier(m.name)) continue;
        const isStatic = (m.modifiers ?? []).some(mod => mod.kind === ts.SyntaxKind.StaticKeyword);
        if (isStatic) continue;
        const ty = m.type ? tsTypeToLuau(m.type, used) : "any";
        const opt = m.questionToken ? "?" : "";
        fields.push(`${m.name.text}${opt}: ${ty}`);
    }

    return fields;
}

type MethodTypeEntry = { params: Array<string | null>; ret: string | null };

export function collectTypeDecls(
    sourceFile: ts.SourceFile,
    methodTypes: Map<string, MethodTypeEntry> = new Map(),
): { decls: TypeDecl[]; typeFunctions: string[]; classNames: string[] } {
    const decls: TypeDecl[] = [];
    const usedUtilities: Set<string> = new Set();
    const classNames: string[] = [];

    for (const stmt of sourceFile.statements) {
        const mods = (stmt as ts.HasModifiers).modifiers;
        // Skip declare / ambient blocks
        if (mods?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;

        if (ts.isTypeAliasDeclaration(stmt)) {
            const name = stmt.name.text;
            const exported = mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
            const typeParams = formatTypeParams(stmt.typeParameters);
            const rhs = tsTypeToLuau(stmt.type, usedUtilities);
            if (!isTrivialAlias(name, typeParams, rhs)) {
                decls.push({ name, exported, luau: `type ${name}${typeParams} = ${rhs}` });
            }
        }

        if (ts.isInterfaceDeclaration(stmt)) {
            const name = stmt.name.text;
            const exported = mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
            const typeParams = formatTypeParams(stmt.typeParameters);

            const heritage = stmt.heritageClauses
                ?.filter(h => h.token === ts.SyntaxKind.ExtendsKeyword)
                ?.flatMap(h => h.types.map(t => {
                    const hName = ts.isIdentifier(t.expression) ? t.expression.text : "any";
                    const hArgs = t.typeArguments?.map(a => tsTypeToLuau(a, usedUtilities)) ?? [];
                    return hArgs.length > 0 ? `${hName}<${hArgs.join(", ")}>` : hName;
                })) ?? [];

            const body = formatObjectType(stmt.members, usedUtilities);
            const full = heritage.length > 0 ? [...heritage, body].join(" & ") : body;
            decls.push({ name, exported, luau: `type ${name}${typeParams} = ${full}` });
        }

        if (ts.isClassDeclaration(stmt) && stmt.name) {
            const name = stmt.name.text;
            const exported = mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

            // Base class from `extends` clause
            const baseClasses = stmt.heritageClauses
                ?.filter(h => h.token === ts.SyntaxKind.ExtendsKeyword)
                ?.flatMap(h => h.types.map(t =>
                    ts.isIdentifier(t.expression) ? t.expression.text : null,
                ).filter((n): n is string => n !== null)) ?? [];

            const fields = classInstanceFields(stmt, usedUtilities);

            // Append method signatures so instances have full LSP autocomplete.
            // Format: methodName: (ClassName, param1, param2, ...) -> RetType
            const methodFields: string[] = [];
            for (const m of stmt.members) {
                if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name)) continue;
                const mt = methodTypes.get(`${name}:${m.name.text}`);
                if (!mt) continue;
                const selfAndParams = [name, ...mt.params.map(p => p ?? "any")].join(", ");
                const ret = mt.ret ?? "()";
                methodFields.push(`${m.name.text}: (${selfAndParams}) -> ${ret}`);
            }

            const allFields = [...fields, ...methodFields];
            if (allFields.length > 0 || baseClasses.length > 0) {
                const body = allFields.length > 0 ? `{ ${allFields.join(", ")} }` : "{}";
                const full = baseClasses.length > 0 ? [...baseClasses, body].join(" & ") : body;
                decls.push({ name, exported, luau: `type ${name} = ${full}` });
                classNames.push(name);
            }
        }
    }

    const typeFunctions = [...usedUtilities]
        .filter(u => u in TYPE_FUNCTION_IMPLS)
        .map(u => TYPE_FUNCTION_IMPLS[u]);

    return { decls, typeFunctions, classNames };
}
