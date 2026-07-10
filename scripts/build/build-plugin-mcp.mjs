import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..", "..");

const entryPoint = resolve(
  root,
  "packages",
  "mcp",
  "src",
  "server.ts",
);

const outfile = resolve(
  root,
  "plugins",
  "claude-code",
  "servers",
  "memory-arbor-mcp.mjs",
);

const check = process.argv.includes("--check");

await mkdir(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile,
  write: !check,
  banner: {
    js: [
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});

if (check) {
  const expected = result.outputFiles?.[0]?.contents;
  const actual = await readFile(outfile);

  if (!expected || !actual.equals(expected)) {
    throw new Error(
      `Plugin MCP bundle is stale: ${outfile}`,
    );
  }
}
