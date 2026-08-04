#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const pythonArgs = process.argv.slice(2);
if (pythonArgs.length === 0) {
  console.error("Uso: node scripts/run_python.mjs <script o argumentos de Python>");
  process.exit(2);
}

const candidates = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];

for (const [executable, prefix] of candidates) {
  const result = spawnSync(executable, [...prefix, ...pythonArgs], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") continue;
  if (result.error) {
    console.error(`No se pudo ejecutar ${executable}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error("No se encontró Python 3. Instale Python y habilite py o python en PATH.");
process.exit(1);
