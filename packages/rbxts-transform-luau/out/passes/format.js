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
exports.stripUselessBlockComments = stripUselessBlockComments;
exports.fixBlockCommentOpeners = fixBlockCommentOpeners;
exports.organizePreamble = organizePreamble;
exports.hoistGetService = hoistGetService;
exports.promoteConstIfUnmutated = promoteConstIfUnmutated;
exports.promoteAllTopLevelConsts = promoteAllTopLevelConsts;
exports.addSpacing = addSpacing;
exports.castTsImports = castTsImports;
exports.applyDirectives = applyDirectives;
exports.formatFile = formatFile;
const fs = __importStar(require("fs"));
function byLengthDesc(a, b) {
    return b.length - a.length;
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripUselessBlockComments(src) {
    const NOISE_TAGS = new Set([
        "@param", "@returns", "@return", "@throws", "@deprecated",
        "@private", "@protected", "@public", "@hidden", "@ignore", "@internal",
    ]);
    function isNoiseLine(raw) {
        const t = raw.trim().replace(/^\*+\s*/, "");
        if (t === "")
            return true;
        const tag = t.split(/\s/)[0].toLowerCase();
        return NOISE_TAGS.has(tag);
    }
    const lines = src.split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === "--[[") {
            const openerIdx = i;
            const body = [];
            i++;
            while (i < lines.length && lines[i].trim() !== "]]") {
                body.push(lines[i]);
                i++;
            }
            const closerIdx = i;
            const isAllNoise = body.every(isNoiseLine);
            if (isAllNoise) {
                i++;
                if (lines[i]?.trim() === "")
                    i++;
                continue;
            }
            out.push(lines[openerIdx]);
            for (const bl of body)
                out.push(bl);
            if (closerIdx < lines.length)
                out.push(lines[closerIdx]);
            i = closerIdx + 1;
            continue;
        }
        out.push(lines[i]);
        i++;
    }
    return out.join("\n");
}
function fixBlockCommentOpeners(src) {
    const lines = src.split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === "--[[") {
            out.push(lines[i]);
            i++;
            while (i < lines.length) {
                const t = lines[i].trim();
                if (t === "" && lines[i + 1]?.trim() === "]]") {
                    i++;
                    continue;
                }
                out.push(lines[i]);
                if (t === "]]") {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (trimmed.startsWith("*")) {
            let j = i;
            while (j < lines.length && lines[j].trim().startsWith("*"))
                j++;
            const hasTrailingBlank = j < lines.length && lines[j].trim() === "" && lines[j + 1]?.trim() === "]]";
            if (hasTrailingBlank)
                j++;
            const hasCloser = lines[j]?.trim() === "]]";
            if (hasCloser) {
                out.push("--[[");
                const bodyStart = lines[i]?.trim() === "*" ? i + 1 : i;
                const bodyEnd = hasTrailingBlank ? j - 1 : j;
                for (let k = bodyStart; k < bodyEnd; k++)
                    out.push(lines[k]);
                out.push(lines[j]);
                i = j + 1;
                continue;
            }
        }
        out.push(lines[i]);
        i++;
    }
    return out.join("\n");
}
function organizePreamble(src) {
    const lines = src.split("\n");
    let i = 0;
    const shebang = [];
    const compiledLines = [];
    const services = [];
    const runtime = [];
    const imports = [];
    const bindings = [];
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === "") {
            i++;
            continue;
        }
        if (/^--\[\[/.test(trimmed)) {
            break;
        }
        else if (/^--!/.test(line)) {
            shebang.push(line);
            i++;
        }
        else if (/^-- Compiled/.test(line)) {
            compiledLines.push(line);
            i++;
        }
        else if (/^--/.test(line)) {
            i++;
        }
        else if (/^(?:local|const) \w+ = game:GetService\(/.test(line)) {
            const svcVar = line.match(/^(?:local|const) (\w+) = game:GetService\(/)[1];
            const duplicate = services.some(s => s.match(/^(?:local|const) (\w+) = game:GetService\(/)[1] === svcVar);
            if (!duplicate)
                services.push(line);
            i++;
        }
        else if (/^(?:local|const) \w+ = require\(/.test(line)) {
            runtime.push(line);
            i++;
        }
        else if (/^(?:local|const) \w+ = TS\.import\(/.test(line)) {
            imports.push(line);
            i++;
        }
        else if (/^TS\.import\(/.test(line)) {
            imports.push(line);
            i++;
        }
        else if (/^(?:local|const) \w+ = \w+[\.\[]/.test(line) && !/^(?:local|const) function/.test(line)) {
            bindings.push(line);
            i++;
        }
        else {
            break;
        }
    }
    shebang.sort(byLengthDesc);
    services.sort(byLengthDesc);
    imports.sort(byLengthDesc);
    bindings.sort(byLengthDesc);
    const out = [...shebang];
    if (compiledLines.length > 0)
        out.push("", ...compiledLines);
    if (services.length > 0)
        out.push("", "-- Services", ...services);
    if (runtime.length > 0)
        out.push("", "-- Runtime", ...runtime);
    if (imports.length > 0)
        out.push("", "-- Imports", ...imports);
    if (bindings.length > 0)
        out.push("", "-- Bindings", ...bindings);
    if (i < lines.length)
        out.push("", ...lines.slice(i));
    return out.join("\n");
}
function hoistGetService(src) {
    const re = /game:GetService\("([^"]+)"\)/g;
    const counts = new Map();
    for (const m of src.matchAll(re)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
    const toHoist = [...counts.entries()]
        .filter(([, n]) => n >= 2)
        .map(([svc]) => svc)
        .filter(svc => !new RegExp(`(?:^|\\n)(?:local|const) _${svc} = game:GetService\\(`).test(src));
    if (toHoist.length === 0)
        return src;
    const decls = toHoist.map(svc => `local _${svc} = game:GetService("${svc}")`).join("\n");
    for (const svc of toHoist) {
        src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
    }
    const insertAt = src.search(/^(?!--[!\s]|--\s*Compiled)/m);
    if (insertAt === -1)
        return decls + "\n" + src;
    return src.slice(0, insertAt) + decls + "\n" + src.slice(insertAt);
}
function promoteConstIfUnmutated(src, name) {
    const lines = src.split("\n");
    const escaped = escapeRegex(name);
    const declRe = new RegExp(`^(\\t*)local (${escaped}) =`);
    const reassignRe = new RegExp(`^\\t*${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(declRe);
        if (!m)
            continue;
        const declIndent = m[1].length;
        let mutated = false;
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const trimmed = line.replace(/^\t*/, "");
            if (trimmed === "")
                continue;
            const indent = line.length - trimmed.length;
            if (indent < declIndent)
                break;
            if (reassignRe.test(line)) {
                mutated = true;
                break;
            }
        }
        if (!mutated)
            lines[i] = lines[i].replace(declRe, `$1const $2 =`);
    }
    return lines.join("\n");
}
function promoteAllTopLevelConsts(src) {
    const lines = src.split("\n");
    const topLevelDeclRe = /^local ([A-Za-z_][A-Za-z0-9_]*) =/;
    const candidates = new Map();
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(topLevelDeclRe);
        if (!m)
            continue;
        if (!candidates.has(m[1]))
            candidates.set(m[1], i);
    }
    for (const [name, declLine] of candidates) {
        const escaped = escapeRegex(name);
        const reassignRe = new RegExp(`(?:^|\\t)${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`);
        let mutated = false;
        for (let j = declLine + 1; j < lines.length; j++) {
            if (reassignRe.test(lines[j])) {
                mutated = true;
                break;
            }
        }
        if (!mutated)
            lines[declLine] = lines[declLine].replace(/^local /, "const ");
    }
    return lines.join("\n");
}
function addSpacing(src) {
    const lines = src.split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const prevTrimmed = (out.length > 0 ? out[out.length - 1] : "").trim();
        const alreadyBlank = prevTrimmed === "";
        if (!alreadyBlank) {
            if (/^local function /.test(trimmed) && prevTrimmed !== "]]") {
                out.push("");
            }
            else if (/^return\b/.test(trimmed) &&
                !/\b(then|do|repeat)$/.test(prevTrimmed) &&
                !/function\s*\([^)]*\)$/.test(prevTrimmed) &&
                !/^local function /.test(prevTrimmed)) {
                out.push("");
            }
            else if (/^(do\b|while |for |if |repeat\b)/.test(trimmed) &&
                /^(local |const )/.test(prevTrimmed)) {
                out.push("");
            }
            else if (/^local /.test(trimmed) && /^const /.test(prevTrimmed)) {
                out.push("");
            }
        }
        out.push(line);
        if (trimmed === "end") {
            const next = lines[i + 1]?.trim() ?? "";
            if (next !== "" && !/^(end\b|else\b|elseif\b|until\b)/.test(next)) {
                out.push("");
            }
        }
    }
    return out.join("\n");
}
function castTsImports(src) {
    // Replace TS.import calls with an if/else where the dead branch does a direct
    // require() so luau-lsp can infer the module type without typeof(require(...))
    // (which is broken per luau-lang#1844 and luau-lsp#1057).
    //
    // Generated pattern:
    //   local opt
    //   if false then
    //       opt = require(game:GetService("ReplicatedStorage").shared.fns)
    //   else
    //       opt = TS.import(script, _ReplicatedStorage, "shared", "fns") :: any
    //   end
    //
    // Type checker unifies both branches; runtime always takes the else path.
    // Match full declaration lines: [const|local] name = TS.import(...)
    const re = /^([ \t]*)(?:(local|const) (\w+) = )?(TS\.import\(script,[ \t]*([^,")\s][^,)]*?)((?:,[ \t]*"[^"]*")*)\))$/gm;
    return src.replace(re, (_, indent, kw, varName, call, base, childrenRaw) => {
        const children = [];
        for (const m of childrenRaw.matchAll(/"([^"]*)"/g))
            children.push(m[1]);
        const path = base.trim() + children.map(c => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c) ? `.${c}` : `["${c}"]`).join("");
        if (!varName) {
            // Bare TS.import call (side-effect only) — leave as-is
            return _;
        }
        return `${indent}local ${varName}; if false then ${varName} = require(${path}) else ${varName} = ${call} :: any end`;
    });
}
function applyDirectives(src, strict, optimizeLevel) {
    if (strict && !src.includes("--!strict")) {
        src = "--!strict\n" + src;
    }
    if (optimizeLevel !== false && !src.includes("--!optimize")) {
        src = `--!optimize ${optimizeLevel}\n` + src;
    }
    return src;
}
const writingFiles = new Set();
function formatFile(luauPath, strict, optimizeLevel) {
    if (writingFiles.has(luauPath))
        return;
    if (!fs.existsSync(luauPath))
        return;
    let src = fs.readFileSync(luauPath, "utf8");
    let changed = false;
    const apply = (fn) => {
        const next = fn(src);
        if (next !== src) {
            src = next;
            changed = true;
        }
    };
    apply(s => applyDirectives(s, strict, optimizeLevel));
    apply(hoistGetService);
    apply(fixBlockCommentOpeners);
    apply(stripUselessBlockComments);
    apply(organizePreamble);
    apply(castTsImports);
    // promoteAllTopLevelConsts must run after organizePreamble — the classifier
    // routes lines by "local" prefix; promoting first breaks section layout.
    apply(promoteAllTopLevelConsts);
    apply(addSpacing);
    if (changed) {
        writingFiles.add(luauPath);
        try {
            fs.writeFileSync(luauPath, src, "utf8");
        }
        finally {
            setTimeout(() => writingFiles.delete(luauPath), 50).unref();
        }
    }
}
