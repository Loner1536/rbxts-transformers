import type ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const LUAU_TYPE: Record<string, string> = {
    number: "number",
    string: "string",
    boolean: "boolean",
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

type FnAnnotation = {
    params: Array<string | null>;
    ret: string | null;
};

const sidecar = new Map<string, Map<string, FnAnnotation>>();
let hooked = false;

function mapTypeNode(ts: typeof import("typescript"), typeNode: ts.TypeNode): string | null {
    if (ts.isTypeReferenceNode(typeNode)) {
        const name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : null;
        if (!name) return null;
        if (LUAU_TYPE[name]) return LUAU_TYPE[name];
        if ((name === "Array" || name === "ReadonlyArray") && typeNode.typeArguments?.length === 1) {
            const inner = mapTypeNode(ts, typeNode.typeArguments[0]);
            return inner ? `{${inner}}` : "{any}";
        }
        return null;
    }
    if (ts.isArrayTypeNode(typeNode)) {
        const inner = mapTypeNode(ts, typeNode.elementType);
        return inner ? `{${inner}}` : "{any}";
    }
    const kw: Partial<Record<number, string>> = {
        [ts.SyntaxKind.NumberKeyword]: "number",
        [ts.SyntaxKind.StringKeyword]: "string",
        [ts.SyntaxKind.BooleanKeyword]: "boolean",
    };
    if (typeNode.kind in kw) return kw[typeNode.kind]!;
    return null;
}

function luauTypeForParam(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    node: ts.ParameterDeclaration,
): string | null {
    if (node.type) {
        const mapped = mapTypeNode(ts, node.type);
        if (mapped) return mapped;
    }
    const name = checker.typeToString(checker.getTypeAtLocation(node));
    return LUAU_TYPE[name] ?? null;
}

function luauTypeForReturn(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    node: ts.FunctionDeclaration,
): string | null {
    if (node.type) {
        const mapped = mapTypeNode(ts, node.type);
        if (mapped) return mapped;
    }
    const sig = checker.getSignatureFromDeclaration(node);
    if (!sig) return null;
    const ret = checker.getReturnTypeOfSignature(sig);
    const name = checker.typeToString(ret);
    return LUAU_TYPE[name] ?? null;
}

function outPathForSource(sourceFile: ts.SourceFile, program: ts.Program): string | null {
    const options = program.getCompilerOptions();
    const outDir = options.outDir;
    if (!outDir) return null;
    const rootDir = options.rootDir ?? commonRoot(program.getRootFileNames());
    if (!rootDir) return null;
    const rel = path.relative(rootDir, sourceFile.fileName);
    if (rel.startsWith("..")) return null;
    return path.join(outDir, rel.replace(/\.tsx?$/, ".luau"));
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

function collectAnnotations(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    outPath: string,
): void {
    const fileMap = sidecar.get(outPath) ?? new Map<string, FnAnnotation>();
    sidecar.set(outPath, fileMap);

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const params = node.parameters.map(p => luauTypeForParam(ts, checker, p));
            const ret = luauTypeForReturn(ts, checker, node);
            if (params.some(p => p !== null) || ret !== null) {
                fileMap.set(node.name.text, { params, ret });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
}

function organizePreamble(src: string): string {
    const lines = src.split("\n");
    let i = 0;

    // Collect leading directives and header comments
    const directives: string[] = [];
    while (i < lines.length && lines[i].startsWith("--")) {
        directives.push(lines[i++]);
    }

    // Collect all top-level local declarations before the first function/other code
    const services: string[] = [];
    const imports: string[] = [];
    const bindings: string[] = [];

    while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === "") { i++; continue; }

        if (/^local \w+ = game:GetService\(/.test(line)) {
            services.push(line); i++;
        } else if (/^local \w+ = require\(/.test(line) || /^local \w+ = TS\.import\(/.test(line)) {
            imports.push(line); i++;
        } else if (/^local \w+ = \w+[\.\[]/.test(line) && !/^local function/.test(line)) {
            // property access binding: local x = module.x or local x = module["x"]
            bindings.push(line); i++;
        } else {
            break;
        }
    }

    const out: string[] = [...directives];
    if (services.length > 0) out.push("", "-- Services", ...services);
    if (imports.length > 0) out.push("", "-- Imports", ...imports);
    if (bindings.length > 0) out.push("", "-- Bindings", ...bindings);
    if (i < lines.length) out.push("", ...lines.slice(i));

    return out.join("\n");
}

function hoistGetService(src: string): string {
    // Count occurrences of each game:GetService("X") call
    const re = /game:GetService\("([^"]+)"\)/g;
    const counts = new Map<string, number>();
    for (const m of src.matchAll(re)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }

    const toHoist = [...counts.entries()].filter(([, n]) => n >= 2).map(([svc]) => svc);
    if (toHoist.length === 0) return src;

    // Build locals and replace
    const decls = toHoist
        .map(svc => `local _${svc} = game:GetService("${svc}")`)
        .join("\n");

    for (const svc of toHoist) {
        src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
    }

    // Insert after any leading --! directives and the rotor header comment
    const insertAt = src.search(/^(?!--[!\s]|--\s*Compiled)/m);
    if (insertAt === -1) return decls + "\n" + src;
    return src.slice(0, insertAt) + decls + "\n" + src.slice(insertAt);
}

function injectAnnotations(luauPath: string, fileMap: Map<string, FnAnnotation>): void {
    if (!fs.existsSync(luauPath)) return;
    let src = fs.readFileSync(luauPath, "utf8");
    let changed = false;

    // Inject param + return type annotations
    for (const [fnName, ann] of fileMap) {
        if (ann.params.every(p => p === null) && ann.ret === null) continue;

        const re = new RegExp(
            `(local function ${escapeRegex(fnName)}\\()([^)]*)(\\.\\.\\.)?(\\))`,
        );
        src = src.replace(re, (_m, open: string, rawParams: string, vararg: string | undefined, close: string) => {
            const names = rawParams.split(",").map((s: string) => s.trim()).filter(Boolean);
            const annotated = names.map((name: string, i: number) => {
                const bare = name.split(":")[0].trim();
                const typ = ann.params[i];
                return typ ? `${bare}: ${typ}` : bare;
            });
            if (vararg) annotated.push("...");
            const retSuffix = ann.ret ? `: ${ann.ret}` : "";
            changed = true;
            return `${open}${annotated.join(", ")}${close}${retSuffix}`;
        });
    }

    // Hoist any repeated game:GetService() calls injected by the compiler
    const hoisted = hoistGetService(src);
    if (hoisted !== src) { src = hoisted; changed = true; }

    // Organize preamble into labeled sections
    const organized = organizePreamble(src);
    if (organized !== src) { src = organized; changed = true; }

    if (changed) fs.writeFileSync(luauPath, src, "utf8");
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function installWatcher(outDir: string): void {
    if (hooked) return;
    hooked = true;
    const seen = new Set<string>();
    const watcher = fs.watch(outDir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith(".luau")) return;
        const full = path.join(outDir, filename);
        if (seen.has(full)) return;
        const fileMap = sidecar.get(full);
        if (!fileMap) return;
        seen.add(full);
        try { injectAnnotations(full, fileMap); } catch { /* ignore */ }
    });
    watcher.unref();
}

export function annotatePass(
    ts: typeof import("typescript"),
    program: ts.Program,
    sourceFile: ts.SourceFile,
): void {
    const outPath = outPathForSource(sourceFile, program);
    if (!outPath) return;
    collectAnnotations(ts, program.getTypeChecker(), sourceFile, outPath);
    installWatcher(program.getCompilerOptions().outDir!);
}
