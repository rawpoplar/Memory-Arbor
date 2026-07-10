import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const entryPoint = resolve(root, "scripts", "memory-arbor-prompt-frame.ts");
const outputs = [
  resolve(root, "integrations", "claude-code", "scripts", "memory-arbor-prompt-frame.mjs"),
  resolve(root, "integrations", "codex", "scripts", "memory-arbor-prompt-frame.mjs"),
];
const check = process.argv.includes("--check");

for (const outfile of outputs) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    format: "esm",
    outfile,
    platform: "node",
    target: "node22",
    write: !check,
  });

  if (check) {
    const expected = result.outputFiles[0]?.contents;
    const actual = await readFile(outfile);
    if (!expected || !actual.equals(expected)) {
      throw new Error(`Plugin hook bundle is stale: ${outfile}`);
    }
  }
}
