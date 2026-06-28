import * as fs from "fs";

function byLengthDesc(a: string, b: string): number {
    return b.length - a.length;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type FnTypes = {
    params: Array<string | null>;
    ret: string | null;
};

export function injectTypeAnnotations(src: string, types: Map<string, FnTypes>): string {
    if (types.size === 0) return src;
    for (const [fnName, ann] of types) {
        if (ann.params.every(p => p === null) && ann.ret === null) continue;
        const re = new RegExp(
            `(local function ${escapeRegex(fnName)}\\()([^)]*)(\\.\\.\\.)?(\\))(?:\\s*:\\s*[^\\r\\n]+)?`,
        );
        src = src.replace(re, (_m, open: string, rawParams: string, vararg: string | undefined, close: string) => {
            const names = rawParams.split(",").map((s: string) => s.trim()).filter(Boolean);
            const annotated = names.map((name: string, i: number) => {
                const bare = name.split(":")[0].trim();
                const typ = ann.params[i];
                return typ ? `${bare}: ${typ}` : bare;
            });
            if (vararg) annotated.push("...");
            return `${open}${annotated.join(", ")}${close}${ann.ret ? `: ${ann.ret}` : ""}`;
        });
    }
    return src;
}

export function stripUselessBlockComments(src: string): string {
    const NOISE_TAGS = new Set([
        "@param", "@returns", "@return", "@throws", "@deprecated",
        "@private", "@protected", "@public", "@hidden", "@ignore", "@internal",
    ]);

    function isNoiseLine(raw: string): boolean {
        const t = raw.trim().replace(/^\*+\s*/, "");
        if (t === "") return true;
        const tag = t.split(/\s/)[0].toLowerCase();
        return NOISE_TAGS.has(tag);
    }

    const lines = src.split("\n");
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();

        if (trimmed === "--[[") {
            const openerIdx = i;
            const body: string[] = [];
            i++;
            while (i < lines.length && lines[i].trim() !== "]]") {
                body.push(lines[i]);
                i++;
            }
            const closerIdx = i;
            const isAllNoise = body.every(isNoiseLine);

            if (isAllNoise) {
                i++;
                if (lines[i]?.trim() === "") i++;
                continue;
            }

            out.push(lines[openerIdx]);
            for (const bl of body) out.push(bl);
            if (closerIdx < lines.length) out.push(lines[closerIdx]);
            i = closerIdx + 1;
            continue;
        }

        out.push(lines[i]);
        i++;
    }

    return out.join("\n");
}

export function fixBlockCommentOpeners(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];
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
                if (t === "]]") { i++; break; }
                i++;
            }
            continue;
        }

        if (trimmed.startsWith("*")) {
            let j = i;
            while (j < lines.length && lines[j].trim().startsWith("*")) j++;
            const hasTrailingBlank =
                j < lines.length && lines[j].trim() === "" && lines[j + 1]?.trim() === "]]";
            if (hasTrailingBlank) j++;
            const hasCloser = lines[j]?.trim() === "]]";

            if (hasCloser) {
                out.push("--[[");
                const bodyStart = lines[i]?.trim() === "*" ? i + 1 : i;
                const bodyEnd = hasTrailingBlank ? j - 1 : j;
                for (let k = bodyStart; k < bodyEnd; k++) out.push(lines[k]);
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

export function organizePreamble(src: string): string {
    const lines = src.split("\n");
    let i = 0;

    const shebang: string[] = [];
    const compiledLines: string[] = [];
    const services: string[] = [];
    const runtime: string[] = [];
    const imports: string[] = [];
    const bindings: string[] = [];

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === "") { i++; continue; }

        if (/^--\[\[/.test(trimmed)) {
            break;
        } else if (/^--!/.test(line)) {
            shebang.push(line); i++;
        } else if (/^-- Compiled/.test(line)) {
            compiledLines.push(line); i++;
        } else if (/^--/.test(line)) {
            i++;
        } else if (/^(?:local|const) \w+ = game:GetService\(/.test(line)) {
            const svcVar = line.match(/^(?:local|const) (\w+) = game:GetService\(/)![1];
            const duplicate = services.some(
                s => s.match(/^(?:local|const) (\w+) = game:GetService\(/)![1] === svcVar,
            );
            if (!duplicate) services.push(line);
            i++;
        } else if (/^(?:local|const) \w+ = require\(/.test(line)) {
            runtime.push(line); i++;
        } else if (/^(?:local|const) \w+ = TS\.import\(/.test(line)) {
            imports.push(line); i++;
        } else if (/^TS\.import\(/.test(line)) {
            imports.push(line); i++;
        } else if (/^(?:local|const) \w+ = \w+[\.\[]/.test(line) && !/^(?:local|const) function/.test(line)) {
            bindings.push(line); i++;
        } else {
            break;
        }
    }

    shebang.sort(byLengthDesc);
    services.sort(byLengthDesc);
    imports.sort(byLengthDesc);
    bindings.sort(byLengthDesc);

    const out: string[] = [...shebang];
    if (compiledLines.length > 0) out.push("", ...compiledLines);
    if (services.length > 0) out.push("", "-- Services", ...services);
    if (runtime.length > 0) out.push("", "-- Runtime", ...runtime);
    if (imports.length > 0) out.push("", "-- Imports", ...imports);
    if (bindings.length > 0) out.push("", "-- Bindings", ...bindings);
    if (i < lines.length) out.push("", ...lines.slice(i));

    return out.join("\n");
}

export function hoistGetService(src: string): string {
    const re = /game:GetService\("([^"]+)"\)/g;
    const counts = new Map<string, number>();
    for (const m of src.matchAll(re)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }

    const toHoist = [...counts.entries()]
        .filter(([, n]) => n >= 2)
        .map(([svc]) => svc)
        .filter(svc =>
            !new RegExp(`(?:^|\\n)(?:local|const) _${svc} = game:GetService\\(`).test(src),
        );

    if (toHoist.length === 0) return src;

    const decls = toHoist.map(svc => `local _${svc} = game:GetService("${svc}")`).join("\n");
    for (const svc of toHoist) {
        src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
    }

    const insertAt = src.search(/^(?!--[!\s]|--\s*Compiled)/m);
    if (insertAt === -1) return decls + "\n" + src;
    return src.slice(0, insertAt) + decls + "\n" + src.slice(insertAt);
}

export function promoteConstIfUnmutated(src: string, name: string): string {
    const lines = src.split("\n");
    const escaped = escapeRegex(name);
    const declRe = new RegExp(`^(\\t*)local (${escaped}) =`);
    const reassignRe = new RegExp(`^\\t*${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`);

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(declRe);
        if (!m) continue;

        const declIndent = m[1].length;
        let mutated = false;

        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const trimmed = line.replace(/^\t*/, "");
            if (trimmed === "") continue;
            const indent = line.length - trimmed.length;
            if (indent < declIndent) break;
            if (reassignRe.test(line)) { mutated = true; break; }
        }

        if (!mutated) lines[i] = lines[i].replace(declRe, `$1const $2 =`);
    }

    return lines.join("\n");
}

export function promoteAllTopLevelConsts(src: string): string {
    const lines = src.split("\n");
    const topLevelDeclRe = /^local ([A-Za-z_][A-Za-z0-9_]*) =/;
    const candidates = new Map<string, number>();

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(topLevelDeclRe);
        if (!m) continue;
        if (!candidates.has(m[1])) candidates.set(m[1], i);
    }

    for (const [name, declLine] of candidates) {
        const escaped = escapeRegex(name);
        const reassignRe = new RegExp(`(?:^|\\t)${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`);
        let mutated = false;
        for (let j = declLine + 1; j < lines.length; j++) {
            if (reassignRe.test(lines[j])) { mutated = true; break; }
        }
        if (!mutated) lines[declLine] = lines[declLine].replace(/^local /, "const ");
    }

    return lines.join("\n");
}

export function addSpacing(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const prevTrimmed = (out.length > 0 ? out[out.length - 1] : "").trim();
        const alreadyBlank = prevTrimmed === "";

        if (!alreadyBlank) {
            if (/^local function /.test(trimmed) && prevTrimmed !== "]]" && !/^---/.test(prevTrimmed)) {
                out.push("");
            } else if (
                /^return\b/.test(trimmed) &&
                !/\b(then|do|repeat)$/.test(prevTrimmed) &&
                !/function\s*\([^)]*\)$/.test(prevTrimmed) &&
                !/^local function /.test(prevTrimmed)
            ) {
                out.push("");
            } else if (
                /^(do\b|while |for |if |repeat\b)/.test(trimmed) &&
                /^(local |const )/.test(prevTrimmed)
            ) {
                out.push("");
            } else if (/^local /.test(trimmed) && /^const /.test(prevTrimmed)) {
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

export function castTsImports(src: string): string {
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

    return src.replace(re, (_, indent: string, kw: string | undefined, varName: string | undefined, call: string, base: string, childrenRaw: string) => {
        const children: string[] = [];
        for (const m of childrenRaw.matchAll(/"([^"]*)"/g)) children.push(m[1]);

        const path = base.trim() + children.map(c =>
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(c) ? `.${c}` : `["${c}"]`
        ).join("");

        if (!varName) {
            // Bare TS.import call (side-effect only) — leave as-is
            return _;
        }

        return `${indent}local ${varName}; if false then ${varName} = require(${path}) else ${varName} = ${call} :: any end`;
    });
}

export type FnDoc = {
    desc: string[];
    params: Map<string, string>;
    returns: string;
    deprecated?: string;
};

export function injectJsDocFromSidecar(src: string, sidecar: Map<string, FnDoc>): string {
    if (sidecar.size === 0) return src;
    const lines = src.split("\n");
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const funcMatch = lines[i].match(/^(\t*)local function (\w+)\(([^)]*)\)(?::\s*(.+))?$/);
        if (funcMatch) {
            const name = funcMatch[2];
            const doc = sidecar.get(name);
            const prevTrimmed = out.length > 0 ? out[out.length - 1].trim() : "";
            const alreadyHasDoc = /^---/.test(prevTrimmed);

            if (doc && !alreadyHasDoc) {
                const indent = funcMatch[1];
                const paramTypes = new Map<string, string>();
                if (funcMatch[3].trim()) {
                    for (const part of funcMatch[3].split(",")) {
                        const pm = part.trim().match(/^(\w+)(\??):\s*(.+)$/);
                        if (pm) paramTypes.set(pm[1], pm[2] ? `${pm[3].trim()}?` : pm[3].trim());
                    }
                }
                const rawRet = funcMatch[4]?.trim() ?? "";
                const retType = rawRet.startsWith("(") && rawRet.endsWith(")")
                    ? rawRet.slice(1, -1).split(",")[0]?.trim() ?? ""
                    : rawRet;

                if (doc.deprecated !== undefined) out.push(`${indent}--- @deprecated${doc.deprecated ? ` ${doc.deprecated}` : ""}`);
                for (const desc of doc.desc) out.push(`${indent}--- ${desc}`);
                for (const [paramName, paramDesc] of doc.params) {
                    const type = paramTypes.get(paramName);
                    out.push(`${indent}--- @param ${paramName}${type ? ` ${type}` : ""}${paramDesc ? ` ${paramDesc}` : ""}`);
                }
                if (doc.returns) {
                    out.push(`${indent}--- @return${retType ? ` ${retType}` : ""} ${doc.returns}`);
                }
            }
        }
        out.push(lines[i]);
    }

    return out.join("\n");
}

export function convertJsDocComments(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();

        if (trimmed === "--[[") {
            const blockStart = i;
            const rawBody: string[] = [];
            i++;
            while (i < lines.length && lines[i].trim() !== "]]") {
                rawBody.push(lines[i]);
                i++;
            }
            const closerLine = i < lines.length ? lines[i] : "]]";
            i++; // skip ]]

            // Skip blank lines between block and next statement
            let j = i;
            while (j < lines.length && lines[j].trim() === "") j++;

            const nextLine = j < lines.length ? lines[j] : "";
            const funcMatch = nextLine.match(/^(\t*)local function (\w+)\(([^)]*)\)(?::\s*(.+))?$/);

            if (!funcMatch) {
                out.push(lines[blockStart]);
                for (const bl of rawBody) out.push(bl);
                out.push(closerLine);
                continue;
            }

            // Strip * prefixes from JSDoc lines (rotor emits "\t * text" format)
            const cleanBody = rawBody
                .map(l => l.trim().replace(/^\*+\s*/, "").trim())
                .filter(l => l !== "");

            const descLines: string[] = [];
            const paramTags: Array<{ name: string; desc: string }> = [];
            let returnDesc = "";
            let deprecatedMsg: string | undefined;

            for (const line of cleanBody) {
                const lc = line.toLowerCase();
                if (lc.startsWith("@param")) {
                    const m = line.match(/@param\s+(\w+)(?:\s+\{[^}]*\})?\s*(.*)/i);
                    if (m) paramTags.push({ name: m[1].trim(), desc: m[2].trim() });
                } else if (lc.startsWith("@returns") || lc.startsWith("@return")) {
                    const m = line.match(/@returns?\s*(.*)/i);
                    if (m) returnDesc = m[1].trim();
                } else if (lc.startsWith("@deprecated")) {
                    const m = line.match(/@deprecated\s*(.*)/i);
                    deprecatedMsg = m?.[1].trim() ?? "";
                } else if (!lc.startsWith("@")) {
                    descLines.push(line);
                }
            }

            if (descLines.length === 0 && paramTags.length === 0 && !returnDesc && deprecatedMsg === undefined) {
                out.push(lines[blockStart]);
                for (const bl of rawBody) out.push(bl);
                out.push(closerLine);
                continue;
            }

            // Extract param types from Luau function signature
            const paramTypes = new Map<string, string>();
            const rawParams = funcMatch[3];
            if (rawParams.trim()) {
                for (const part of rawParams.split(",")) {
                    const pm = part.trim().match(/^(\w+)(\??):\s*(.+)$/);
                    if (pm) paramTypes.set(pm[1], pm[2] ? `${pm[3].trim()}?` : pm[3].trim());
                }
            }

            // Extract return types from Luau function signature
            const rawRet = funcMatch[4]?.trim() ?? "";
            let retTypes: string[] = [];
            if (rawRet) {
                retTypes = rawRet.startsWith("(") && rawRet.endsWith(")")
                    ? rawRet.slice(1, -1).split(",").map(t => t.trim()).filter(Boolean)
                    : [rawRet];
            }

            const indent = funcMatch[1];

            if (deprecatedMsg !== undefined) out.push(`${indent}--- @deprecated${deprecatedMsg ? ` ${deprecatedMsg}` : ""}`);
            for (const desc of descLines) {
                out.push(`${indent}--- ${desc}`);
            }
            for (const { name, desc } of paramTags) {
                const type = paramTypes.get(name);
                out.push(`${indent}--- @param ${name}${type ? ` ${type}` : ""}${desc ? ` ${desc}` : ""}`);
            }
            if (returnDesc) {
                const retType = retTypes[0] ?? "";
                out.push(`${indent}--- @return${retType ? ` ${retType}` : ""} ${returnDesc}`);
            }

            i = j; // skip blank lines, let function line emit normally
            continue;
        }

        out.push(lines[i]);
        i++;
    }

    return out.join("\n");
}

export function applyDirectives(src: string, strict: boolean, optimizeLevel: false | 0 | 1 | 2): string {
    if (strict && !src.includes("--!strict")) {
        src = "--!strict\n" + src;
    }
    if (optimizeLevel !== false && !src.includes("--!optimize")) {
        src = `--!optimize ${optimizeLevel}\n` + src;
    }
    return src;
}

const writingFiles = new Set<string>();

export function formatFile(
    luauPath: string,
    strict: boolean,
    optimizeLevel: false | 0 | 1 | 2,
    sidecar: Map<string, FnDoc> = new Map(),
    types: Map<string, FnTypes> = new Map(),
): void {
    if (writingFiles.has(luauPath)) return;
    if (!fs.existsSync(luauPath)) return;

    let src = fs.readFileSync(luauPath, "utf8");
    let changed = false;

    const apply = (fn: (s: string) => string): void => {
        const next = fn(src);
        if (next !== src) { src = next; changed = true; }
    };

    apply(s => applyDirectives(s, strict, optimizeLevel));
    apply(hoistGetService);
    apply(fixBlockCommentOpeners);
    apply(organizePreamble);
    apply(s => injectTypeAnnotations(s, types));
    apply(convertJsDocComments);
    apply(s => injectJsDocFromSidecar(s, sidecar));
    apply(stripUselessBlockComments);
    apply(castTsImports);
    apply(addSpacing);

    if (changed) {
        writingFiles.add(luauPath);
        try {
            fs.writeFileSync(luauPath, src, "utf8");
        } finally {
            setTimeout(() => writingFiles.delete(luauPath), 50).unref();
        }
    }
}
