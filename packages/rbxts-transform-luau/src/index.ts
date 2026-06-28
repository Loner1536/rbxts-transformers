import ts from "typescript";
import * as path from "path";
import type { PluginConfig } from "./config";
import { formatFile, type FnDoc, type FnTypes, type ClassInfo, type MethodInfo } from "./passes/format";
import { collectTypeDecls, type TypeDecl } from "./passes/types";
export type { PluginConfig };

const LUAU_TYPE: Record<string, string> = {
    number: "number",
    string: "string",
    boolean: "boolean",
    void: "()",
    Vector3: "Vector3",
    Vector2: "Vector2",
    Vector2int16: "Vector2int16",
    Vector3int16: "Vector3int16",
    CFrame: "CFrame",
    UDim: "UDim",
    UDim2: "UDim2",
    Color3: "Color3",
    BrickColor: "BrickColor",
    TweenInfo: "TweenInfo",
    NumberRange: "NumberRange",
    NumberSequence: "NumberSequence",
    ColorSequence: "ColorSequence",
    Rect: "Rect",
    Region3: "Region3",
    Ray: "Ray",
    buffer: "buffer",
    Instance: "Instance",
    BasePart: "BasePart",
    Part: "Part",
    Model: "Model",
    Player: "Player",
    Camera: "Camera",
    Workspace: "Workspace",
    RunService: "RunService",
    Players: "Players",
};

function mapTypeNode(typeNode: ts.TypeNode): string | null {
    if (ts.isTypeReferenceNode(typeNode)) {
        const name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : null;
        if (!name) return null;
        if (LUAU_TYPE[name]) return LUAU_TYPE[name];
        if ((name === "Array" || name === "ReadonlyArray") && typeNode.typeArguments?.length === 1) {
            const inner = mapTypeNode(typeNode.typeArguments[0]);
            return inner ? `{${inner}}` : "{any}";
        }
        if (name === "LuaTuple" && typeNode.typeArguments?.length === 1) {
            const arg = typeNode.typeArguments[0];
            if (ts.isTupleTypeNode(arg)) {
                const elements = arg.elements
                    .map(e => {
                        const el = "type" in e ? (e as ts.NamedTupleMember).type : e;
                        return mapTypeNode(el as ts.TypeNode);
                    })
                    .filter((t): t is string => t !== null);
                if (elements.length > 0) return `(${elements.join(", ")})`;
            }
        }
        return null;
    }
    if (ts.isArrayTypeNode(typeNode)) {
        const inner = mapTypeNode(typeNode.elementType);
        return inner ? `{${inner}}` : "{any}";
    }
    const kw: Partial<Record<number, string>> = {
        [ts.SyntaxKind.NumberKeyword]: "number",
        [ts.SyntaxKind.StringKeyword]: "string",
        [ts.SyntaxKind.BooleanKeyword]: "boolean",
        [ts.SyntaxKind.VoidKeyword]: "()",
    };
    if (typeNode.kind in kw) return kw[typeNode.kind]!;
    return null;
}

// Returns true if the TypeScript type is a user-defined class or interface —
// meaning we can use its name as a Luau type annotation directly.
function isUserDefinedType(tsType: ts.Type): boolean {
    const sym = tsType.getSymbol();
    if (!sym) return false;
    return (sym.getDeclarations() ?? []).some(
        d => ts.isClassDeclaration(d) || ts.isInterfaceDeclaration(d),
    );
}

function luauTypeForTs(checker: ts.TypeChecker, tsType: ts.Type): string | null {
    const name = checker.typeToString(tsType);
    if (LUAU_TYPE[name]) return LUAU_TYPE[name];
    if (isUserDefinedType(tsType)) return name;
    return null;
}

function luauTypeForParam(checker: ts.TypeChecker, node: ts.ParameterDeclaration): string | null {
    if (node.type) {
        const mapped = mapTypeNode(node.type);
        if (mapped) return mapped;
    }
    return luauTypeForTs(checker, checker.getTypeAtLocation(node));
}

function luauTypeForReturn(checker: ts.TypeChecker, node: ts.FunctionDeclaration | ts.MethodDeclaration): string | null {
    if (node.type) {
        const mapped = mapTypeNode(node.type);
        if (mapped) return mapped;
    }
    const sig = checker.getSignatureFromDeclaration(node);
    if (!sig) return null;
    return luauTypeForTs(checker, checker.getReturnTypeOfSignature(sig));
}

function collectTypes(checker: ts.TypeChecker, sourceFile: ts.SourceFile): {
    types: Map<string, FnTypes>;
    classInfoMap: Map<string, ClassInfo>;
} {
    const types = new Map<string, FnTypes>();
    const classInfoMap = new Map<string, ClassInfo>();

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const params = node.parameters.map(p => luauTypeForParam(checker, p));
            const ret = luauTypeForReturn(checker, node);
            if (params.some(p => p !== null) || ret !== null) {
                types.set(node.name.text, { params, ret });
            }
        }
        if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;
            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
                    const params = member.parameters.map(p => luauTypeForParam(checker, p));
                    const ret = luauTypeForReturn(checker, member);
                    if (params.some(p => p !== null) || ret !== null) {
                        types.set(`${className}:${member.name.text}`, { params, ret });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    // Build ClassInfo for restructuring class blocks into idiomatic Luau OOP.
    for (const stmt of sourceFile.statements) {
        if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
        const cn = stmt.name.text;

        let baseClass: string | null = null;
        for (const clause of stmt.heritageClauses ?? []) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0) {
                const t = clause.types[0];
                if (ts.isIdentifier(t.expression)) baseClass = t.expression.text;
            }
        }

        const ctorParams: ClassInfo["ctorParams"] = [];
        const methods: MethodInfo[] = [];

        for (const m of stmt.members) {
            if (ts.isConstructorDeclaration(m)) {
                for (const p of m.parameters) {
                    ctorParams.push({
                        name: ts.isIdentifier(p.name) ? p.name.text : "_",
                        type: luauTypeForParam(checker, p),
                    });
                }
            } else if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
                const methodParams = m.parameters.map(p => ({
                    name: ts.isIdentifier(p.name) ? p.name.text : "_",
                    type: luauTypeForParam(checker, p),
                }));
                methods.push({ name: m.name.text, params: methodParams, ret: luauTypeForReturn(checker, m) });
            }
        }

        classInfoMap.set(cn, { baseClass, ctorParams, methods });
    }

    return { types, classInfoMap };
}

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
    annotate: boolean;
    emitTypes: boolean;
    doRestructure: boolean;
    verbose: boolean;
    sidecar: Map<string, FnDoc>;
    types: Map<string, FnTypes>;
    classInfoMap: Map<string, ClassInfo>;
    typeDecls: TypeDecl[];
    typeFunctions: string[];
    classNames: string[];
};

const pending = new Map<string, FileMeta>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let finalizeRegistered = false;

function processFile(meta: FileMeta): void {
    try {
        formatFile(
            meta.outPath,
            meta.strict,
            meta.optimizeLevel,
            meta.sidecar,
            meta.annotate ? meta.types : new Map(),
            meta.emitTypes ? meta.typeDecls : [],
            meta.emitTypes ? meta.typeFunctions : [],
            meta.annotate && meta.doRestructure ? meta.classInfoMap : new Map(),
        );
    } catch {
        // silently skip files that fail — they stay as-is
    }
}

function flushPending(): void {
    for (const [, meta] of pending) {
        processFile(meta);
    }
    pending.clear();
}

// roblox-ts emit is synchronous — files are on disk when the timer fires.
// Rotor (Go binary) writes .luau files after the TypeScript plugin exits, so
// we keep the timer ref'd (process stays alive) and use a longer delay to give
// rotor time to finish writing before we post-process.
// 100ms > boost's 50ms so boost's hoisting lands before we format.
function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flushPending(); }, 100);
    // Do NOT unref — keeps the process alive so rotor has time to write files.
}

function registerFinalizer(): void {
    if (finalizeRegistered) return;
    finalizeRegistered = true;
    // Final safety net for single-build mode, where the process exits before
    // the debounced timer fires (the timer is unref'd so it can't hold it open).
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
    const { strict = true, optimize = false, annotate = true, emitTypes = true, restructureClasses: doRestructure = true, verbose = false } = config;
    const optimizeLevel: false | 0 | 1 | 2 = optimize === false ? false : ([0, 1, 2] as const).includes(optimize as 0|1|2) ? optimize : 2;

    // Watch mode: process any leftovers from the previous cycle before this one.
    flushPending();
    registerFinalizer();

    const outDir = program.getCompilerOptions().outDir;
    const checker = annotate ? program.getTypeChecker() : null;

    return (_ctx) => (sourceFile) => {
        const outPath = outPathForSource(sourceFile, program);
        if (outPath) {
            const sidecar = collectJsDoc(ts, sourceFile);
            const { types, classInfoMap } = checker
                ? collectTypes(checker, sourceFile)
                : { types: new Map<string, FnTypes>(), classInfoMap: new Map<string, ClassInfo>() };
            const { decls: typeDecls, typeFunctions, classNames } = emitTypes
                ? collectTypeDecls(sourceFile, types)
                : { decls: [], typeFunctions: [], classNames: [] };
            pending.set(outPath, { outPath, strict, optimizeLevel, annotate, emitTypes, doRestructure, verbose, sidecar, types, classInfoMap, typeDecls, typeFunctions, classNames });
            scheduleFlush();
            if (verbose) {
                const rel = outDir ? path.relative(outDir, outPath) : outPath;
                console.log(`luau: ${rel}`);
            }
        }
        return sourceFile;
    };
}
