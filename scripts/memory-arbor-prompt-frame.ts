import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
const promptFrameStateFile = join(base, "prompt-frame-state.json");

type OutputFormat = "plain" | "claude-json";
type HookInput = {
  session_id?: string;
};
type PromptFrameState = {
  version: 1;
  sessions: Record<string, SessionSnapshot>;
};
type SessionSnapshot = {
  storeVersion: number;
  nodes: Record<string, SnapshotNode>;
};
type SnapshotNode = {
  node: MemoryInjectionView["slots"][number]["nodes"][number];
  slotNames: string[];
};
type PromptDelta = {
  mode: "delta";
  storeVersion: number;
  upserted: SnapshotNode[];
  removedNodeIds: string[];
};

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readText(path));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function readYaml(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readText(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  const { parse } = await import("yaml");
  return parse(text) ?? null;
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

function buildPromptFrame(delta: PromptDelta | null): string | null {
  if (!delta) return null;
  return [
    `<memory_arbor_prompt_delta mode="${delta.mode}">`,
    "Apply this delta to the Memory Arbor context already projected in this session.",
    `memoryStoreVersion: ${delta.storeVersion}`,
    ...delta.upserted.map(memoryNodeBlock),
    ...delta.removedNodeIds.map(
      (id) => `<remove_memory_node id="${escapeXml(id)}" />`,
    ),
    "</memory_arbor_prompt_delta>",
  ].join("\n");
}

function memoryNodeBlock(snapshot: SnapshotNode): string {
  const { node, slotNames } = snapshot;
  const tags =
    node.tags.length > 0 ? ` tags="${escapeXml(node.tags.join(","))}"` : "";
  return [
    `<upsert_memory_node id="${escapeXml(node.id)}" version="${node.version}" slots="${escapeXml(slotNames.join(","))}" title="${escapeXml(node.title)}" treePath="${escapeXml(node.treePath)}"${tags}>`,
    `<summary>${escapeXml(node.summary)}</summary>`,
    `<content>${escapeXml(node.content)}</content>`,
    "</upsert_memory_node>",
  ].join("\n");
}

function snapshotMemoryView(view: MemoryInjectionView): SessionSnapshot {
  const nodes: Record<string, SnapshotNode> = {};
  for (const slot of view.slots) {
    for (const node of slot.nodes) {
      const existing = nodes[node.id];
      if (existing) {
        existing.slotNames.push(slot.name);
      } else {
        nodes[node.id] = {
          node,
          slotNames: [slot.name],
        };
      }
    }
  }
  for (const snapshot of Object.values(nodes)) {
    snapshot.slotNames.sort();
  }
  return {
    storeVersion: view.version,
    nodes,
  };
}

function buildPromptDelta(
  current: SessionSnapshot,
  previous: SessionSnapshot | undefined,
): PromptDelta | null {
  if (!previous) return null;
  const upserted = Object.values(current.nodes).filter((snapshot) => {
    const prior = previous.nodes[snapshot.node.id];
    return !prior || !sameSnapshotNode(snapshot, prior);
  });
  const removedNodeIds = Object.keys(previous.nodes).filter(
    (id) => !current.nodes[id],
  );
  if (upserted.length === 0 && removedNodeIds.length === 0) return null;
  return {
    mode: "delta",
    storeVersion: current.storeVersion,
    upserted,
    removedNodeIds,
  };
}

function sameSnapshotNode(left: SnapshotNode, right: SnapshotNode): boolean {
  return (
    left.node.version === right.node.version &&
    left.slotNames.join(",") === right.slotNames.join(",")
  );
}

async function readPromptFrameState(): Promise<PromptFrameState> {
  const raw = await readJson(promptFrameStateFile);
  if (
    typeof raw === "object" &&
    raw !== null &&
    "sessions" in raw &&
    typeof raw.sessions === "object" &&
    raw.sessions !== null
  ) {
    return {
      version: 1,
      sessions: raw.sessions as Record<string, SessionSnapshot>,
    };
  }
  return {
    version: 1,
    sessions: {},
  };
}

async function readHookInput(): Promise<HookInput> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
  }
  if (!text.trim()) return {};
  const input = JSON.parse(text);
  if (typeof input !== "object" || input === null) return {};
  return input as HookInput;
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
  const input = await readHookInput();
  if (!input.session_id) return;
  const config = await readConfig();
  const store = await readStore(config);
  const format = readOutputFormat();
  const state = await readPromptFrameState();
  const sessionKey = `${format}:${input.session_id}`;
  const snapshot = snapshotMemoryView(buildMemoryInjectionView(store, config));
  const frame = buildPromptFrame(
    buildPromptDelta(snapshot, state.sessions[sessionKey]),
  );
  state.sessions[sessionKey] = snapshot;
  await writeFile(promptFrameStateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  if (frame) writeFrame(frame, format);
}

function readOutputFormat(args = process.argv.slice(2)): OutputFormat {
  const formatArg = args.find((arg) => arg.startsWith("--format="));
  const format = formatArg?.slice("--format=".length);
  if (format === undefined || format === "plain") return "plain";
  if (format === "claude-json") return "claude-json";
  throw new Error(`Unsupported output format: ${format}`);
}

function writeFrame(frame: string, format: OutputFormat): void {
  if (format === "plain") {
    process.stdout.write(`${frame}\n`);
  } else {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: frame,
        },
      })}\n`,
    );
  }
}

main().catch((error) => {
  console.error(error);
});
