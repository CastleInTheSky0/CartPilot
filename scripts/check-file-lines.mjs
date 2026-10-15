import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_LINES = 400;
const root = fileURLToPath(new URL("../", import.meta.url));
const isStrict = process.argv.includes("--strict");
const baseline = JSON.parse(
  await readFile(new URL("../config/file-size-baseline.json", import.meta.url), "utf8"),
);
const ignoredDirectories = new Set([
  ".git",
  ".data",
  ".playwright-cli",
  "node_modules",
  "dist",
  "out",
  "release",
  "coverage",
  "output",
]);
const codeExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".html",
  ".sql",
  ".ps1",
  ".cmd",
  ".bat",
]);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      const children = await collectFiles(target);
      files.push(...children);
    } else if (entry.isFile() && codeExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(target);
    }
  }
  return files;
}

function countPhysicalLines(source) {
  if (source.length === 0) return 0;
  const lineCount = source.split(/\r\n|\n|\r/).length;
  const hasFinalNewline = /\r\n$|[\r\n]$/.test(source);
  return lineCount - (hasFinalNewline ? 1 : 0);
}

const counts = new Map();
let failureCount = 0;
let legacyCount = 0;

for (const file of (await collectFiles(root)).sort()) {
  const name = path.relative(root, file).split(path.sep).join("/");
  const source = await readFile(file, "utf8");
  const lineCount = countPhysicalLines(source);
  counts.set(name, lineCount);
  const limit = isStrict ? MAX_FILE_LINES : (baseline[name] ?? MAX_FILE_LINES);
  if (lineCount > limit) {
    console.error(`FAIL ${name}: ${lineCount} lines; limit ${limit}`);
    failureCount++;
  } else if (lineCount > MAX_FILE_LINES) {
    console.warn(`LEGACY ${name}: ${lineCount} lines; no growth allowed before splitting`);
    legacyCount++;
  }
}

for (const [name, limit] of Object.entries(baseline)) {
  if (!Number.isInteger(limit) || limit <= MAX_FILE_LINES) {
    console.error(`FAIL ${name}: invalid legacy ceiling`);
    failureCount++;
  } else if (!counts.has(name) || counts.get(name) <= MAX_FILE_LINES) {
    console.error(`FAIL ${name}: remove the obsolete file-size baseline`);
    failureCount++;
  }
}

console.log(`Checked ${counts.size} code files; ${failureCount} failures; ${legacyCount} legacy files.`);
process.exitCode = failureCount > 0 ? 1 : 0;
