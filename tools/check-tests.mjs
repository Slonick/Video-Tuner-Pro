import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dirs = [join(root, "test"), join(root, "e2e")];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry.startsWith(".") || entry === "node_modules") continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(test|spec)\.(ts|tsx|mjs)$/.test(entry)) files.push(path);
  }
}

for (const dir of dirs) walk(dir);

const focused = [];
for (const path of files) {
  const source = readFileSync(path, "utf8");
  for (const [index, line] of source.split("\n").entries()) {
    if (/\b(?:describe|suite|test|it)(?:\.\w+)*\.only\b/.test(line)) {
      focused.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  }
}

if (focused.length) {
  console.error("Focused tests are forbidden because they make a green run false-green:");
  console.error(focused.join("\n"));
  process.exit(1);
}

console.log(`test guard: ${files.length} test files checked; no focused tests`);
