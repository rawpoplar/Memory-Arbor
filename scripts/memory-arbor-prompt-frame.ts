import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  buildMemoryInjectionView,
  createEmptyMemoryStore,
  normalizeMemoryConfig,
  normalizeMemoryStore,
  type MemoryConfig,
  type MemoryInjectionView,
  type MemoryStore,
} from "../packages/core/src/index.ts";

const home = process.env.USERPROFILE || process.env.HOME || ".";
const base = process.env.MEMORY_ARBOR_HOME || join(home, ".memory-arbor");
const storeFile = join(base, "store.json");
const configFile = join(base, "config.yaml");

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readText(path));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function readYaml(path: string): Promise<unknown | null> {
  try {
    return parseYaml(await readText(path)) ?? null;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function readText(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
}

async function readConfig(): Promise<MemoryConfig> {
  return normalizeMemoryConfig(await readYaml(configFile));
}

async function readStore(config: MemoryConfig): Promise<MemoryStore> {
  const rawStore = await readJson(storeFile);
  if (rawStore !== null) return normalizeMemoryStore(rawStore, config);

  const store = createEmptyMemoryStore(config);
  await mkdir(base, { recursive: true });
  await writeFile(storeFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

function buildPromptFrame(view: MemoryInjectionView): string | null {
  if (view.slots.every((slot) => slot.nodes.length === 0)) return null;

  return [
    '<memory_arbor_prompt_frame mode="append-only">',
    "This host adapter can add prompt context but cannot delete or rewrite prior conversation messages.",
    "Prefer loaded Memory Arbor entries over stale visible context when they conflict.",
    `memoryStoreVersion: ${view.version}`,
    `memoryTokens: ${view.usedTokens}/${view.maxMemoryTokens}`,
    `memoryTruncated: ${view.truncated}`,
    ...memorySlotBlocks(view),
    "</memory_arbor_prompt_frame>",
  ].join("\n");
}

function memorySlotBlocks(view: MemoryInjectionView): string[] {
  return view.slots
    .map((slot) => {
      if (slot.nodes.length === 0) return "";
      return [
        `<slot name="${escapeXml(slot.name)}" usedTokens="${slot.usedTokens}" maxTokens="${slot.maxTokens}">`,
        ...slot.nodes.map((node) => {
          const tags =
            node.tags.length > 0
              ? ` tags="${escapeXml(node.tags.join(","))}"`
              : "";
          return [
            `<memory_node id="${escapeXml(node.id)}" title="${escapeXml(node.title)}" treePath="${escapeXml(node.treePath)}"${tags}>`,
            `<summary>${escapeXml(node.summary)}</summary>`,
            `<content>${escapeXml(node.content)}</content>`,
            "</memory_node>",
          ].join("\n");
        }),
        "</slot>",
      ].join("\n");
    })
    .filter(Boolean);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function main(): Promise<void> {
  const config = await readConfig();
  const store = await readStore(config);
  const frame = buildPromptFrame(buildMemoryInjectionView(store, config));
  if (frame) process.stdout.write(`${frame}\n`);
}

main().catch((error) => {
  console.error(error);
});
