"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const typescript_1 = __importDefault(require("typescript"));
const path = __importStar(require("path"));
const format_1 = require("./passes/format");
const LUAU_TYPE = {
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
function mapTypeNode(typeNode) {
    if (typescript_1.default.isTypeReferenceNode(typeNode)) {
        const name = typescript_1.default.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : null;
        if (!name)
            return null;
        if (LUAU_TYPE[name])
            return LUAU_TYPE[name];
        if ((name === "Array" || name === "ReadonlyArray") && typeNode.typeArguments?.length === 1) {
            const inner = mapTypeNode(typeNode.typeArguments[0]);
            return inner ? `{${inner}}` : "{any}";
        }
        if (name === "LuaTuple" && typeNode.typeArguments?.length === 1) {
            const arg = typeNode.typeArguments[0];
            if (typescript_1.default.isTupleTypeNode(arg)) {
                const elements = arg.elements
                    .map(e => {
                    const el = "type" in e ? e.type : e;
                    return mapTypeNode(el);
                })
                    .filter((t) => t !== null);
                if (elements.length > 0)
                    return `(${elements.join(", ")})`;
            }
        }
        return null;
    }
    if (typescript_1.default.isArrayTypeNode(typeNode)) {
        const inner = mapTypeNode(typeNode.elementType);
        return inner ? `{${inner}}` : "{any}";
    }
    const kw = {
        [typescript_1.default.SyntaxKind.NumberKeyword]: "number",
        [typescript_1.default.SyntaxKind.StringKeyword]: "string",
        [typescript_1.default.SyntaxKind.BooleanKeyword]: "boolean",
        [typescript_1.default.SyntaxKind.VoidKeyword]: "()",
    };
    if (typeNode.kind in kw)
        return kw[typeNode.kind];
    return null;
}
function luauTypeForParam(checker, node) {
    if (node.type) {
        const mapped = mapTypeNode(node.type);
        if (mapped)
            return mapped;
    }
    const name = checker.typeToString(checker.getTypeAtLocation(node));
    return LUAU_TYPE[name] ?? null;
}
function luauTypeForReturn(checker, node) {
    if (node.type) {
        const mapped = mapTypeNode(node.type);
        if (mapped)
            return mapped;
    }
    const sig = checker.getSignatureFromDeclaration(node);
    if (!sig)
        return null;
    const ret = checker.getReturnTypeOfSignature(sig);
    const name = checker.typeToString(ret);
    return LUAU_TYPE[name] ?? null;
}
function collectTypes(checker, sourceFile) {
    const types = new Map();
    function visit(node) {
        if (typescript_1.default.isFunctionDeclaration(node) && node.name) {
            const params = node.parameters.map(p => luauTypeForParam(checker, p));
            const ret = luauTypeForReturn(checker, node);
            if (params.some(p => p !== null) || ret !== null) {
                types.set(node.name.text, { params, ret });
            }
        }
        typescript_1.default.forEachChild(node, visit);
    }
    visit(sourceFile);
    return types;
}
function outPathForSource(sourceFile, program) {
    const options = program.getCompilerOptions();
    const outDir = options.outDir;
    if (!outDir)
        return null;
    const rootDir = options.rootDir ?? commonRoot(program.getRootFileNames());
    if (!rootDir)
        return null;
    const rel = path.relative(rootDir, sourceFile.fileName);
    if (rel.startsWith(".."))
        return null;
    const dir = path.dirname(rel);
    const base = path.basename(rel).replace(/\.tsx?$/, "");
    const renamedBase = base.replace(/^index(?=$|\.)/, "init");
    return path.join(outDir, dir, `${renamedBase}.luau`);
}
function commonRoot(files) {
    if (files.length === 0)
        return undefined;
    const parts = files[0].split(path.sep);
    let root = parts.slice(0, parts.length - 1);
    for (const f of files.slice(1)) {
        const fp = f.split(path.sep);
        let i = 0;
        while (i < root.length && i < fp.length - 1 && root[i] === fp[i])
            i++;
        root = root.slice(0, i);
    }
    return root.join(path.sep) || undefined;
}
const pending = new Map();
let finalizeRegistered = false;
function flushPending() {
    for (const [, meta] of pending) {
        try {
            (0, format_1.formatFile)(meta.outPath, meta.strict, meta.optimizeLevel, meta.sidecar, meta.annotate ? meta.types : new Map());
        }
        catch {
            // silently skip files that fail — they stay as-is
        }
    }
    pending.clear();
}
function registerFinalizer() {
    if (finalizeRegistered)
        return;
    finalizeRegistered = true;
    process.on("exit", flushPending);
}
function jsDocText(comment) {
    if (!comment)
        return "";
    if (typeof comment === "string")
        return comment.trim().replace(/^—\s*/, "");
    const raw = comment
        .map(c => ("text" in c ? c.text : ""))
        .join("");
    return raw.trim().replace(/^—\s*/, "");
}
function collectJsDoc(ts, sourceFile) {
    const sidecar = new Map();
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const jsDocs = node.jsDoc;
            if (jsDocs && jsDocs.length > 0) {
                const doc = jsDocs[jsDocs.length - 1];
                const rawDesc = jsDocText(doc.comment);
                const desc = rawDesc.split("\n").map(l => l.trim()).filter(Boolean);
                const params = new Map();
                let returns = "";
                let deprecated;
                for (const tag of doc.tags ?? []) {
                    if (ts.isJSDocParameterTag(tag)) {
                        const name = ts.isIdentifier(tag.name) ? tag.name.text : "";
                        if (name)
                            params.set(name, jsDocText(tag.comment).trim());
                    }
                    else if (ts.isJSDocReturnTag(tag)) {
                        returns = jsDocText(tag.comment).trim();
                    }
                    else if (ts.isJSDocDeprecatedTag(tag)) {
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
function default_1(program, config = {}) {
    const { strict = true, optimize = false, annotate = true, verbose = false } = config;
    const optimizeLevel = optimize === false ? false : [0, 1, 2].includes(optimize) ? optimize : 2;
    // Watch mode: flush the previous run's pending files before starting this one.
    flushPending();
    registerFinalizer();
    const outDir = program.getCompilerOptions().outDir;
    const checker = annotate ? program.getTypeChecker() : null;
    return (_ctx) => (sourceFile) => {
        const outPath = outPathForSource(sourceFile, program);
        if (outPath) {
            const sidecar = collectJsDoc(typescript_1.default, sourceFile);
            const types = checker ? collectTypes(checker, sourceFile) : new Map();
            pending.set(outPath, { outPath, strict, optimizeLevel, annotate, verbose, sidecar, types });
            if (verbose) {
                const rel = outDir ? path.relative(outDir, outPath) : outPath;
                console.log(`luau: ${rel}`);
            }
        }
        return sourceFile;
    };
}
