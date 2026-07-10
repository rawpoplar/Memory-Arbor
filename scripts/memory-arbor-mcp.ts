import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

import {
  archiveMemoryNode,
  createMemoryNode,
  loadMemorySlot,
  moveMemoryNode,
  normalizeMemoryConfig,
  normalizeMemoryStore,
  openMemoryNode,
  readMemorySlots,
  searchMemoryNodes,
  updateMemoryNode,
  type MemoryConfig,
  type MemoryStore,
} from "../packages/core/src/index.ts";

const NODE_KINDS = ["root", "branch", "leaf"] as const;
const NODE_STATUSES = ["active", "archived"] as const;
const LOAD_MODES = ["replace", "append"] as const;

const home = process.env.USERPROFILE || process.env.HOME || ".";
const base =
  process.env.MEMORY_ARBOR_HOME ||
  join(home, ".memory-arbor");

const storeFile = join(base, "store.json");
const configFile = join(base, "config.yaml");
const frameFile = join(base, "context-frame.json");

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function readYaml(path: string): Promise<unknown> {
  try {
    return parseYaml(await readFile(path, "utf8")) ?? null;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function readConfig(): Promise<MemoryConfig> {
  return normalizeMemoryConfig(await readYaml(configFile));
}

async function readStore(config: MemoryConfig): Promise<MemoryStore> {
  return normalizeMemoryStore(await readJson(storeFile), config);
}

async function writeStore(store: MemoryStore): Promise<void> {
  await mkdir(dirname(storeFile), { recursive: true });
  await writeFile(
    storeFile,
    `${JSON.stringify(store, null, 2)}\n`,
    "utf8",
  );
}

type MutationResult = Record<string, unknown> & {
  changed?: boolean;
};

async function updateStore(
  mutator: (
    store: MemoryStore,
    config: MemoryConfig,
  ) => MutationResult,
): Promise<Record<string, unknown>> {
  const config = await readConfig();
  const store = await readStore(config);

  const payload = mutator(store, config);
  const { changed, ...publicPayload } = payload;

  if (changed !== false) {
    store.version += 1;
    await writeStore(store);
  }

  return {
    ...publicPayload,
    version: store.version,
    storeFile,
    configFile,
    frameFile,
  };
}

function memoryId(): string {
  return `mem-${randomBytes(6).toString("hex")}`;
}

function mcpResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: "memory-arbor",
  version: "0.4.2",
});

server.registerTool(
  "memory_load_slot",
  {
    description:
      "Load active Memory Arbor nodes into a configured memory slot for future prompt-frame projection.",
    inputSchema: {
      slot: z.string().min(1).describe("Configured slot name."),
      nodeIds: z
        .array(z.string().min(1))
        .min(1)
        .describe("Active memory node ids to load."),
      mode: z
        .enum(LOAD_MODES)
        .optional()
        .describe("Load mode. Defaults to replace."),
    },
  },
  async ({ slot, nodeIds, mode }) => {
    const payload = await updateStore((store) => {
      const loaded = loadMemorySlot(
        store,
        slot,
        nodeIds,
        mode ?? "replace",
      );

      if (loaded.status !== "ok") {
        return {
          status: loaded.status,
          action: "memory_load_slot",
          message: loaded.message,
          changed: false,
        };
      }

      return {
        status: "ok",
        action: "memory_load_slot",
        slot: loaded.value,
      };
    });

    return mcpResult(payload);
  },
);

server.registerTool(
  "memory_read_slots",
  {
    description:
      "Read configured Memory Arbor slots and their loaded active memory nodes.",
  },
  async () => {
    const config = await readConfig();
    const store = await readStore(config);

    return mcpResult({
      status: "ok",
      action: "memory_read_slots",
      version: store.version,
      slots: readMemorySlots(store),
      storeFile,
      configFile,
      frameFile,
    });
  },
);

server.registerTool(
  "memory_search",
  {
    description:
      "Search active or archived Memory Arbor nodes by query, tag and status.",
    inputSchema: {
      query: z.string().optional(),
      tag: z.string().optional(),
      status: z.enum(NODE_STATUSES).optional(),
      limit: z.number().int().positive().optional(),
    },
  },
  async ({ query, tag, status, limit }) => {
    const config = await readConfig();
    const store = await readStore(config);

    return mcpResult({
      status: "ok",
      action: "memory_search",
      version: store.version,
      nodes: searchMemoryNodes(store, query ?? "", {
        tag,
        status,
        limit,
      }),
    });
  },
);

const transport = new StdioServerTransport();

await server.connect(transport);