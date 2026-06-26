import type ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import type { Debugger } from "../debug";

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

type FileSidecar = {
  fns: Map<string, FnAnnotation>;
  consts: Set<string>;
  optimize: boolean;
  optimizeLevel: 0 | 1 | 2;
  strict: boolean;
};

const sidecar = new Map<string, FileSidecar>();

function mapTypeNode(
  ts: typeof import("typescript"),
  typeNode: ts.TypeNode,
): string | null {
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : null;
    if (!name) return null;
    if (LUAU_TYPE[name]) return LUAU_TYPE[name];
    if (
      (name === "Array" || name === "ReadonlyArray") &&
      typeNode.typeArguments?.length === 1
    ) {
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

function outPathForSource(
  sourceFile: ts.SourceFile,
  program: ts.Program,
): string | null {
  const options = program.getCompilerOptions();
  const outDir = options.outDir;
  if (!outDir) return null;
  const rootDir = options.rootDir ?? commonRoot(program.getRootFileNames());
  if (!rootDir) return null;
  const rel = path.relative(rootDir, sourceFile.fileName);
  if (rel.startsWith("..")) return null;

  // roblox-ts renames index.ts/index.client.ts/index.server.ts to
  // init.luau/init.client.luau/init.server.luau respectively, so that the
  // containing directory itself becomes the ModuleScript with the file's
  // siblings as its children (Rojo convention for "script with children").
  // Every other filename is emitted as-is, just with its .ts/.tsx swapped
  // for .luau — this rename only applies to the literal basename "index".
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

function collectAnnotations(
  ts: typeof import("typescript"),
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  outPath: string,
  optimize: boolean,
  optimizeLevel: 0 | 1 | 2,
  strict: boolean,
): void {
  const entry = sidecar.get(outPath) ?? {
    fns: new Map<string, FnAnnotation>(),
    consts: new Set<string>(),
    optimize,
    optimizeLevel,
    strict,
  };
  sidecar.set(outPath, entry);

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const params = node.parameters.map((p) =>
        luauTypeForParam(ts, checker, p),
      );
      const ret = luauTypeForReturn(ts, checker, node);
      if (params.some((p) => p !== null) || ret !== null) {
        entry.fns.set(node.name.text, { params, ret });
      }
    }
    if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (isConst) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            entry.consts.add(decl.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function byLengthDesc(a: string, b: string): number {
  return b.length - a.length;
}

/**
 * Removes Luau block comments whose body consists entirely of JSDoc-style
 * tags that carry no meaning in Luau — specifically `@param`, `@returns`,
 * `@return`, `@throws`, `@deprecated`, `@private`, `@protected`, `@public`,
 * `@hidden`, `@ignore`, and `@internal`. These are emitted by roblox-ts from
 * TypeScript JSDoc but Luau tooling ignores them entirely.
 *
 * `@class` is intentionally preserved — Luau documentation generators and
 * the Luau type system recognise it as meaningful metadata about a class shape.
 *
 * A comment is dropped only when EVERY body line, after stripping leading `*`
 * and whitespace, is either empty or one of the noise tags listed above.
 * Any `@class` line, or any line of real prose, keeps the whole comment intact.
 */
export function stripUselessBlockComments(src: string): string {
  // Tags that are pure TypeScript JSDoc noise in Luau output.
  const NOISE_TAGS = new Set([
    "@param",
    "@returns",
    "@return",
    "@throws",
    "@deprecated",
    "@private",
    "@protected",
    "@public",
    "@hidden",
    "@ignore",
    "@internal",
  ]);

  function isNoiseLine(raw: string): boolean {
    const t = raw.trim().replace(/^\*+\s*/, ""); // strip leading "*"s
    if (t === "") return true;
    // Match the tag word (up to first space or end of string).
    const tag = t.split(/\s/)[0].toLowerCase();
    return NOISE_TAGS.has(tag);
  }

  const lines = src.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "--[[") {
      // Scan ahead to find the closer and collect body lines.
      const openerIdx = i;
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "]]") {
        body.push(lines[i]);
        i++;
      }
      const closerIdx = i; // points at "]]" line (or past end)

      // Drop only if every body line is noise (no @class, no real prose).
      const isAllNoise = body.every(isNoiseLine);

      if (isAllNoise) {
        // Drop opener, body, and closer entirely.
        // Also drop a blank line that immediately follows the comment block,
        // so we don't leave an orphaned blank where the comment was.
        i++; // skip the "]]" line
        if (lines[i]?.trim() === "") i++; // skip trailing blank
        continue;
      }

      // Keep the comment intact.
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

/**
 * roblox-ts 3.x emits JSDoc block comments without the `--[[` opener — it
 * outputs only the body lines (e.g. `\t * @class`) followed by a `]]` closer.
 * This pass detects every such orphaned block-comment body and:
 *   1. Prepends a `--[[` opener line immediately before the first body line.
 *   2. Strips the trailing whitespace-only line that roblox-ts inserts between
 *      the last body line and the `]]` closer (e.g. `\t ` or `\t`).
 *
 * Lines already inside a proper `--[[ ... ]]` block are passed through verbatim
 * (so the function is idempotent on already-fixed output).
 */
export function fixBlockCommentOpeners(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Pass through lines that are already inside a proper --[[ ... ]] block.
    if (trimmed === "--[[") {
      out.push(lines[i]);
      i++;
      // Consume everything until the ]] closer, stripping trailing blank before ]].
      while (i < lines.length) {
        const t = lines[i].trim();
        // Strip trailing whitespace-only line immediately before ]].
        if (t === "" && lines[i + 1]?.trim() === "]]") {
          i++; // skip the blank line
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

    // Detect the start of an orphaned block-comment body:
    // current line starts with "*" and a "]]" closer appears later in the run.
    if (trimmed.startsWith("*")) {
      let j = i;
      // Collect body lines: lines whose trimmed form starts with "*".
      while (j < lines.length && lines[j].trim().startsWith("*")) {
        j++;
      }
      // After the body run, skip a single whitespace-only line (the roblox-ts
      // trailing artifact: e.g. "\t " between the last body line and "]]").
      const hasTrailingBlank =
        j < lines.length &&
        lines[j].trim() === "" &&
        lines[j + 1]?.trim() === "]]";
      if (hasTrailingBlank) {
        j++; // skip the blank line — we'll omit it from output
      }
      const hasCloser = lines[j]?.trim() === "]]";

      if (hasCloser) {
        // Inject the missing opener.
        out.push("--[[");
        // The first body line is always the `/**` opener rendered as `\t*` by
        // roblox-ts — a bare asterisk with no content. Skip it; it's noise.
        const bodyStart = lines[i]?.trim() === "*" ? i + 1 : i;
        // Emit the body lines (bodyStart..bodyEnd), excluding the blank we may have skipped.
        const bodyEnd = hasTrailingBlank ? j - 1 : j;
        for (let k = bodyStart; k < bodyEnd; k++) {
          out.push(lines[k]);
        }
        // Emit the closer.
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

  // Classify every line at the top of the file until we hit real code
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (/^--\[\[/.test(trimmed)) {
      // A block comment in the preamble position almost always belongs to the
      // first class or function declaration below it (JSDoc for @class, etc.).
      // Pulling it into otherHeader would separate it from the declaration it
      // documents with a blank line. Treat it as real code and stop scanning.
      break;
    } else if (/^--!/.test(line)) {
      shebang.push(line);
      i++;
    } else if (/^-- Compiled/.test(line)) {
      compiledLines.push(line);
      i++;
    } else if (/^--/.test(line)) {
      // Skip existing section labels — we'll regenerate them
      i++;
    } else if (/^(?:local|const) \w+ = game:GetService\(/.test(line)) {
      // Deduplicate: if cachePass already emitted a const _Svc and hoistGetService
      // later adds a local _Svc for the same name, only keep one copy.
      const svcVar = line.match(
        /^(?:local|const) (\w+) = game:GetService\(/,
      )![1];
      const duplicate = services.some(
        (s) =>
          s.match(/^(?:local|const) (\w+) = game:GetService\(/)![1] === svcVar,
      );
      if (!duplicate) services.push(line);
      i++;
    } else if (/^(?:local|const) \w+ = require\(/.test(line)) {
      runtime.push(line);
      i++;
    } else if (/^(?:local|const) \w+ = TS\.import\(/.test(line)) {
      imports.push(line);
      i++;
    } else if (/^TS\.import\(/.test(line)) {
      // Side-effect import with no assignment
      imports.push(line);
      i++;
    } else if (
      /^(?:local|const) \w+ = \w+[\.\[]/.test(line) &&
      !/^(?:local|const) function/.test(line)
    ) {
      bindings.push(line);
      i++;
    } else {
      // Real code — stop classifying
      break;
    }
  }

  shebang.sort(byLengthDesc);
  services.sort(byLengthDesc);
  imports.sort(byLengthDesc);
  bindings.sort(byLengthDesc);

  // Order: --! directives, -- Compiled, then sections
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
    // Skip any service that's already declared (local or const) — it was
    // emitted by cachePass via the AST and we must not add a second copy.
    .filter(
      (svc) =>
        !new RegExp(
          `(?:^|\\n)(?:local|const) _${svc} = game:GetService\\(`,
        ).test(src),
    );
  if (toHoist.length === 0) return src;

  const decls = toHoist
    .map((svc) => `local _${svc} = game:GetService("${svc}")`)
    .join("\n");

  for (const svc of toHoist) {
    src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
  }

  const insertAt = src.search(/^(?!--[!\s]|--\s*Compiled)/m);
  if (insertAt === -1) return decls + "\n" + src;
  return src.slice(0, insertAt) + decls + "\n" + src.slice(insertAt);
}

export function addSpacing(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const prevOut = out.length > 0 ? out[out.length - 1] : "";
    const prevTrimmed = prevOut.trim();
    const alreadyBlank = prevTrimmed === "";

    if (!alreadyBlank) {
      if (/^local function /.test(trimmed) && prevTrimmed !== "]]") {
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

const writingFiles = new Set<string>();

export function promoteConstIfUnmutated(src: string, name: string): string {
  const lines = src.split("\n");
  const escaped = escapeRegex(name);
  const declRe = new RegExp(`^(\\t*)local (${escaped}) =`);
  const reassignRe = new RegExp(
    `^\\t*${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`,
  );

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
      if (reassignRe.test(line)) {
        mutated = true;
        break;
      }
    }

    if (!mutated) {
      lines[i] = lines[i].replace(declRe, `$1const $2 =`);
    }
  }

  return lines.join("\n");
}

/**
 * Promotes every top-level (indent = 0) `local <name> = <rhs>` declaration
 * to `const` if the name is never reassigned anywhere in the file.
 *
 * This covers locals that roblox-ts emits itself (e.g. `local TS = require(...)`,
 * `local _Players = game:GetService(...)`) and that never appear in `entry.consts`
 * because they have no corresponding `const` declaration in the TypeScript source.
 *
 * Already-`const` lines are left alone (idempotent). Lines that declare a
 * name without an initialiser (`local Foo`) — forward declarations used before
 * a `do` block — are also left alone; they are reassigned inside the block.
 */
export function promoteAllTopLevelConsts(src: string): string {
  const lines = src.split("\n");
  // Matches a top-level (no leading tab) simple single-name local with an
  // initialiser. Does NOT match `local function`, multi-name locals
  // (`local a, b = ...`), or forward-declaration stubs (`local Foo`).
  const topLevelDeclRe = /^local ([A-Za-z_][A-Za-z0-9_]*) =/;

  // Collect every name declared at the top level that has an initialiser.
  const candidates = new Map<string, number>(); // name -> line index
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(topLevelDeclRe);
    if (!m) continue;
    if (!candidates.has(m[1])) candidates.set(m[1], i);
  }

  for (const [name, declLine] of candidates) {
    const escaped = escapeRegex(name);
    // Any assignment to the name at any indentation level — covers the
    // `do … end` pattern roblox-ts uses for classes where the forward-decl
    // stub is at indent 0 but the real assignment is inside a `do` block.
    const reassignRe = new RegExp(
      `(?:^|\\t)${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`,
    );
    let mutated = false;
    for (let j = declLine + 1; j < lines.length; j++) {
      if (reassignRe.test(lines[j])) {
        mutated = true;
        break;
      }
    }
    if (!mutated) {
      lines[declLine] = lines[declLine].replace(/^local /, "const ");
    }
  }

  return lines.join("\n");
}

function injectAnnotations(
  luauPath: string,
  entry: FileSidecar,
  dbg: Debugger,
): void {
  if (writingFiles.has(luauPath)) return;
  if (!fs.existsSync(luauPath)) {
    // Expected for sidecar entries whose source compiled to nothing
    // (pure type-only files, etc.) — not every entry has emitted output.
    dbg.warn("annotate", `no emitted file at ${luauPath}, skipping`);
    return;
  }

  let src = fs.readFileSync(luauPath, "utf8");
  let changed = false;

  // Inject --! directives at the very top if missing.
  // nativePass no longer does this — we handle it here so the ordering
  // is always correct regardless of where roblox-ts emits other content.
  if (entry.strict && !src.includes("--!strict")) {
    src = "--!strict\n" + src;
    changed = true;
  }
  if (entry.optimize && !src.includes("--!optimize")) {
    src = `--!optimize ${entry.optimizeLevel}\n` + src;
    changed = true;
  }

  for (const [fnName, ann] of entry.fns) {
    if (ann.params.every((p) => p === null) && ann.ret === null) continue;

    const re = new RegExp(
      `(local function ${escapeRegex(fnName)}\\()([^)]*)(\\.\\.\\.)?(\\))(?:\\s*:\\s*[^\\r\\n]+)?`,
    );
    src = src.replace(
      re,
      (
        _m,
        open: string,
        rawParams: string,
        vararg: string | undefined,
        close: string,
      ) => {
        const names = rawParams
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
        const annotated = names.map((name: string, i: number) => {
          const bare = name.split(":")[0].trim();
          const typ = ann.params[i];
          return typ ? `${bare}: ${typ}` : bare;
        });
        if (vararg) annotated.push("...");
        const retSuffix = ann.ret ? `: ${ann.ret}` : "";
        changed = true;
        return `${open}${annotated.join(", ")}${close}${retSuffix}`;
      },
    );
  }

  for (const name of entry.consts) {
    const next = promoteConstIfUnmutated(src, name);
    if (next !== src) {
      src = next;
      changed = true;
    }
  }

  const hoisted = hoistGetService(src);
  if (hoisted !== src) {
    src = hoisted;
    changed = true;
  }

  const fixed = fixBlockCommentOpeners(src);
  if (fixed !== src) {
    src = fixed;
    changed = true;
  }

  const stripped = stripUselessBlockComments(src);
  if (stripped !== src) {
    src = stripped;
    changed = true;
  }

  const organized = organizePreamble(src);
  if (organized !== src) {
    src = organized;
    changed = true;
  }

  // Promote all top-level locals that are never reassigned — covers
  // roblox-ts-emitted locals like `local TS = require(...)` and
  // `local _Players = game:GetService(...)` that aren't in entry.consts.
  // Must run AFTER organizePreamble: the classifier relies on the "local"
  // prefix to route lines into -- Services / -- Runtime / -- Imports.
  // If we promote first, those lines become "const ..." and fall through
  // the classifier as real code, breaking the entire section layout.
  const promoted = promoteAllTopLevelConsts(src);
  if (promoted !== src) {
    src = promoted;
    changed = true;
  }

  const spaced = addSpacing(src);
  if (spaced !== src) {
    src = spaced;
    changed = true;
  }

  if (changed) {
    writingFiles.add(luauPath);
    try {
      fs.writeFileSync(luauPath, src, "utf8");
    } finally {
      // Release quickly — this is just to avoid reacting to our own
      // write if anything else happens to be watching this path too.
      setTimeout(() => {
        writingFiles.delete(luauPath);
      }, 50).unref();
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * roblox-ts hasn't written the .luau file to disk yet at the point our
 * transformer runs on the .ts source — emit happens after the *entire*
 * compilation's transform pipeline finishes, not shortly after each file's
 * transformer call returns. There is no reliable per-file signal for "this
 * specific .luau now exists and is final": not a directory watcher (raced
 * against a shared quiet-period timer and could starve later files — see
 * git history) and not polling either (caused every file's wait-loop to
 * keep the process alive with ref'd timers, hanging the whole build, while
 * still frequently losing the race against emit timing).
 *
 * Instead we register everything we know into `sidecar` as each source file
 * is transformed (cheap, synchronous, no I/O), and run a single formatting
 * pass over every entry once, after the whole compilation's emit step has
 * actually finished — see flushPending below.
 */
function flushPending(dbg: Debugger): void {
  for (const [luauPath, entry] of sidecar) {
    try {
      injectAnnotations(luauPath, entry, dbg);
    } catch (err) {
      dbg.warn(
        "annotate",
        `failed to format ${luauPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  sidecar.clear();
}

let finalizeRegistered = false;

function registerFinalizer(dbg: Debugger): void {
  if (finalizeRegistered) return;
  finalizeRegistered = true;

  // Covers one-shot builds (`rbxtsc` with no -w): this is the only
  // finalization point, and it's guaranteed to run after the compiler's
  // synchronous emit-to-disk work is done, since Node can't reach the
  // exit phase until that work has completed.
  process.on("exit", () => flushPending(dbg));
}

/**
 * Covers watch mode (`rbxtsc -w`): the transformer's outer factory function
 * is re-invoked once per incremental compilation. By the time a *new*
 * compilation starts, the *previous* one has already finished writing its
 * output to disk — so flushing here, before processing the new batch of
 * source files, formats everything from the prior run that the process-exit
 * hook hasn't had a chance to run yet.
 */
export function flushPendingFromPreviousRun(dbg: Debugger): void {
  flushPending(dbg);
}

export function annotatePass(
  ts: typeof import("typescript"),
  program: ts.Program,
  sourceFile: ts.SourceFile,
  optimize: boolean,
  optimizeLevel: 0 | 1 | 2,
  strict: boolean,
  dbg: Debugger,
): void {
  const outPath = outPathForSource(sourceFile, program);
  if (!outPath) return;
  collectAnnotations(
    ts,
    program.getTypeChecker(),
    sourceFile,
    outPath,
    optimize,
    optimizeLevel,
    strict,
  );
  registerFinalizer(dbg);
}
