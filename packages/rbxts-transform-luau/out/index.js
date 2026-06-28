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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const path = __importStar(require("path"));
const format_1 = require("./passes/format");
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
            (0, format_1.formatFile)(meta.outPath, meta.strict, meta.optimize, meta.optimizeLevel);
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
function default_1(program, config = {}) {
    const { strict = true, optimize = false, optimizeLevel: rawLevel = 2, verbose = false, } = config;
    const optimizeLevel = [0, 1, 2].includes(rawLevel)
        ? rawLevel
        : 2;
    // Watch mode: flush the previous run's pending files before starting this one.
    flushPending();
    registerFinalizer();
    const outDir = program.getCompilerOptions().outDir;
    return (_ctx) => (sourceFile) => {
        const outPath = outPathForSource(sourceFile, program);
        if (outPath) {
            pending.set(outPath, { outPath, strict, optimize, optimizeLevel, verbose });
            if (verbose) {
                const rel = outDir ? path.relative(outDir, outPath) : outPath;
                console.log(`luau: ${rel}`);
            }
        }
        return sourceFile;
    };
}
