#!/usr/bin/env node
// Replaces "-- !fn-native\n" markers (emitted by rbxts-transform-perf's native pass)
// with bare "@native\n" Luau attributes in compiled output files.
// Run after `rotor build` to make per-function @native actually take effect.

const fs = require("fs");
const path = require("path");

const MARKER = "--!fn-native\n";
const ATTRIBUTE = "@native\n";

function processDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            processDir(full);
        } else if (entry.name.endsWith(".luau") || entry.name.endsWith(".lua")) {
            const original = fs.readFileSync(full, "utf8");
            if (!original.includes(MARKER)) continue;
            const patched = original.replaceAll(MARKER, ATTRIBUTE);
            fs.writeFileSync(full, patched, "utf8");
            console.log(`@native patched: ${full}`);
        }
    }
}

const outDir = process.argv[2] ?? path.join(__dirname, "..", "test", "out");
processDir(outDir);
