import type ts from "typescript";
import * as fs from "fs";
import * as path from "path";

// Luau type names for TypeScript type strings rotor knows about
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
    // Roblox service types
    Instance: "Instance",
    BasePart: "BasePart",
    Part: "Part",
    Model: "Model",
    Player: "Player",
    Camera: "Camera",
    Workspace: "Workspace",
    RunService: "RunService",
    Players: "Players",
    // Luau numeric arrays — kept as {number} in Luau
};

type FnAnnotation = {
    params: Array<string | null>; // null = unknown/skip
};

// Global sidecar: outLuauPath → list of function annotations for that file
const sidecar = new Map<string, Map<string, FnAnnotation>>();
let hooked = false;

function luauTypeForTsType(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    node: ts.ParameterDeclaration,
): string | null {
    if (node.type) {
        const mapped = mapTypeNode(ts, node.type);
        if (mapped) return mapped;
    }
    const type = checker.getTypeAtLocation(node);
    const name = checker.typeToString(type);
    return LUAU_TYPE[name] ?? null;
}

function mapTypeNode(ts: typeof import("typescript"), typeNode: ts.TypeNode): string | null {
    if (ts.isTypeReferenceNode(typeNode)) {
        const name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : null;
        if (!name) return null;
        if (LUAU_TYPE[name]) return LUAU_TYPE[name];
        // Array<T> → {T}
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

function outPathForSource(
    sourceFile: ts.SourceFile,
    program: ts.Program,
): string | null {
    const options = program.getCompilerOptions();
    const outDir = options.outDir;
    if (!outDir) return null;

    // Compute rootDir: explicit option or the common root of all source files
    const rootDir = options.rootDir
        ?? commonRoot(program.getRootFileNames());
    if (!rootDir) return null;

    const rel = path.relative(rootDir, sourceFile.fileName);
    if (rel.startsWith("..")) return null;

    // Change .ts / .tsx extension to .luau
    const luauRel = rel.replace(/\.tsx?$/, ".luau");
    return path.join(outDir, luauRel);
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
            const fnName = node.name.text;
            const params = node.parameters.map(p => luauTypeForTsType(ts, checker, p));
            if (params.some(p => p !== null)) {
                fileMap.set(fnName, { params });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
}

function injectAnnotations(luauPath: string, fileMap: Map<string, FnAnnotation>): void {
    if (!fs.existsSync(luauPath)) return;
    let src = fs.readFileSync(luauPath, "utf8");
    let changed = false;

    for (const [fnName, ann] of fileMap) {
        if (ann.params.every(p => p === null)) continue;

        // Match: local function fnName(a, b, c)
        // Captures the param list so we can replace individual names
        const re = new RegExp(
            `(local function ${escapeRegex(fnName)}\\()([^)]*)(\\.\\.\\.\\))?\\)`,
        );
        src = src.replace(re, (_match: string, open: string, rawParams: string, vararg: string | undefined) => {
            const names = rawParams.split(",").map((s: string) => s.trim()).filter(Boolean);
            const annotated = names.map((name: string, i: number) => {
                // strip any existing annotation
                const bare = name.split(":")[0].trim();
                const typ = ann.params[i];
                return typ ? `${bare}: ${typ}` : bare;
            });
            if (vararg) annotated.push("...");
            changed = true;
            return `${open}${annotated.join(", ")})`;
        });
    }

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
        if (fileMap.size > 0) {
            try { injectAnnotations(full, fileMap); } catch { /* ignore */ }
        }
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

    const checker = program.getTypeChecker();
    collectAnnotations(ts, checker, sourceFile, outPath);
    const outDir = program.getCompilerOptions().outDir!;
    installWatcher(outDir);
}
