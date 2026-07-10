import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  type MemoryCreateNodeInput,
  type MemoryNodeStatus,
  type MemoryStore,
  type MemoryUpdateNodeInput,
} from "@rawpoplar/memory-arbor-core";
import {
  normalizeContextFrameStore,
  parseContextRef,
  sameContextTarget,
  type ContextFrameStore,
  type ContextMarker,
  type ContextMarkerStatus,
  type ContextRange,
} from "@rawpoplar/memory-arbor-context";
import {
  maintainMemoryContext,
  type MaintainContextInput,
} from "./maintain.ts";

export * from "./maintain.ts";

export type MemoryLoadMode = "replace" | "append";

export type MemorySearchInput = {
  query?: string;
  tag?: string;
  status?: MemoryNodeStatus;
  limit?: number;
};

export type MemoryMoveNodeInput = {
  id: string;
  newParentId: string;
};

export type MemoryLoadSlotInput = {
  slot: string;
  nodeIds: string[];
  mode?: MemoryLoadMode;
};

export type MemoryMarkContextInput = {
  refs?: string[];
  ranges?: Array<{
    ref: string;
    start: number;
    end: number;
  }>;
  status: ContextMarkerStatus;
  nodeId?: string;
};

export type MemoryUnmarkContextInput = {
  markerIds?: string[];
  refs?: string[];
};

export type MemoryArborToolPaths = {
  storeFile: string;
  configFile: string;
  frameFile: string;
};

type ToolPayload = Record<string, unknown>;
type StoreMutation = ToolPayload & { changed?: boolean };
type ContextTarget = {
  sourceKey: string;
  range?: ContextRange;
};

export function createMemoryArborTools(
  options: {
    base?: string;
  } = {},
) {
  const home = process.env.USERPROFILE || process.env.HOME || ".";
  const base = options.base || process.env.MEMORY_ARBOR_HOME || join(home, ".memory-arbor");
  const paths: MemoryArborToolPaths = {
    storeFile: join(base, "store.json"),
    configFile: join(base, "config.yaml"),
    frameFile: join(base, "context-frame.json"),
  };

  async function readJson(path: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async function readYaml(path: string): Promise<unknown | null> {
    try {
      return parseYaml(await readFile(path, "utf8")) ?? null;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async function readConfig(): Promise<MemoryConfig> {
    return normalizeMemoryConfig(await readYaml(paths.configFile));
  }

  async function readStore(config: MemoryConfig): Promise<MemoryStore> {
    return normalizeMemoryStore(await readJson(paths.storeFile), config);
  }

  async function readFrame(config: MemoryConfig): Promise<ContextFrameStore> {
    return normalizeContextFrameStore(
      await readJson(paths.frameFile),
      config.temporaryWorkspace,
    );
  }

  async function writeStore(store: MemoryStore): Promise<void> {
    await mkdir(dirname(paths.storeFile), { recursive: true });
    await writeFile(paths.storeFile, JSON.stringify(store, null, 2), "utf8");
  }

  async function writeFrame(frame: ContextFrameStore): Promise<void> {
    await mkdir(dirname(paths.frameFile), { recursive: true });
    await writeFile(paths.frameFile, JSON.stringify(frame, null, 2), "utf8");
  }

  async function updateStore(
    mutator: (store: MemoryStore, config: MemoryConfig) => StoreMutation,
  ): Promise<ToolPayload> {
    const config = await readConfig();
    const store = await readStore(config);
    const payload = mutator(store, config);
    const { changed: _changed, ...publicPayload } = payload;
    if (payload.changed !== false) {
      store.version += 1;
      await writeStore(store);
    }
    return {
      ...publicPayload,
      version: store.version,
      ...paths,
    };
  }

  return {
    paths,
    readConfig,
    readStore,
    readFrame,
    writeStore,
    writeFrame,

    async memoryCreateNode(input: MemoryCreateNodeInput): Promise<ToolPayload> {
      return updateStore((store) => {
        const created = createMemoryNode(store, input, { id: memoryId() });
        if (created.status !== "ok") {
          return {
            status: created.status,
            action: "memory_create_node",
            message: created.message,
            changed: false,
          };
        }
        return {
          status: "ok",
          action: "memory_create_node",
          node: created.value,
        };
      });
    },

    async memorySearch(input: MemorySearchInput): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      return {
        status: "ok",
        action: "memory_search",
        version: store.version,
        nodes: searchMemoryNodes(store, input.query ?? "", {
          tag: input.tag,
          status: input.status,
          limit: input.limit,
        }),
      };
    },

    async memoryOpen(id: string): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      const view = openMemoryNode(store, id);
      return {
        status: view ? "ok" : "not_found",
        action: "memory_open",
        version: store.version,
        view,
      };
    },

    async memoryUpdateNode(input: MemoryUpdateNodeInput): Promise<ToolPayload> {
      return updateStore((store) => {
        const updated = updateMemoryNode(store, input.id, {
          title: input.title,
          summary: input.summary,
          content: input.content,
          tags: input.tags,
          nodeKind: input.nodeKind,
          sourceRefs: input.sourceRefs,
        });
        if (updated.status !== "ok") {
          return {
            status: updated.status,
            action: "memory_update_node",
            message: updated.message,
            changed: false,
          };
        }
        return {
          status: "ok",
          action: "memory_update_node",
          node: updated.value,
        };
      });
    },

    async memoryArchiveNode(id: string): Promise<ToolPayload> {
      return updateStore((store) => {
        const archived = archiveMemoryNode(store, id);
        if (archived.status !== "ok") {
          return {
            status: archived.status,
            action: "memory_archive_node",
            message: archived.message,
            changed: false,
          };
        }
        return {
          status: "ok",
          action: "memory_archive_node",
          ...archived.value,
        };
      });
    },

    async memoryMoveNode(input: MemoryMoveNodeInput): Promise<ToolPayload> {
      return updateStore((store) => {
        const moved = moveMemoryNode(store, input.id, input.newParentId);
        if (moved.status !== "ok") {
          return {
            status: moved.status,
            action: "memory_move_node",
            message: moved.message,
            changed: false,
          };
        }
        return {
          status: "ok",
          action: "memory_move_node",
          node: moved.value,
        };
      });
    },

    async memoryLoadSlot(input: MemoryLoadSlotInput): Promise<ToolPayload> {
      return updateStore((store) => {
        const loaded = loadMemorySlot(
          store,
          input.slot,
          input.nodeIds,
          input.mode ?? "replace",
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
    },

    async memoryReadSlots(): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      return {
        status: "ok",
        action: "memory_read_slots",
        version: store.version,
        slots: readMemorySlots(store),
        ...paths,
      };
    },

    async memoryMarkContext(input: MemoryMarkContextInput): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      const frame = await readFrame(config);
      const targets = contextTargets(input.refs, input.ranges);

      if (targets.length === 0) {
        return {
          status: "invalid",
          action: "memory_mark_context",
          message: "At least one valid ref or range is required.",
          frameFile: paths.frameFile,
        };
      }

      if (input.status === "memorized") {
        if (!input.nodeId) {
          return {
            status: "invalid",
            action: "memory_mark_context",
            message: "nodeId is required when status is memorized.",
            frameFile: paths.frameFile,
          };
        }
        const node = openMemoryNode(store, input.nodeId);
        if (!node || node.node.status !== "active") {
          return {
            status: "not_found",
            action: "memory_mark_context",
            message: `Active memory node '${input.nodeId}' was not found.`,
            frameFile: paths.frameFile,
          };
        }
      }

      const timestamp = nowIso();
      frame.markers = frame.markers.filter(
        (marker) => !targets.some((target) => sameContextTarget(marker, target)),
      );
      const created = targets.map((target) =>
        createMarker(
          markerId(),
          target,
          input.status,
          input.status === "memorized" ? input.nodeId : undefined,
          timestamp,
        ),
      );
      frame.markers.push(...created);
      frame.version += 1;
      frame.updatedAt = timestamp;
      await writeFrame(frame);

      return {
        status: "ok",
        action: "memory_mark_context",
        version: frame.version,
        markers: created,
        frameFile: paths.frameFile,
      };
    },

    async memoryUnmarkContext(input: MemoryUnmarkContextInput): Promise<ToolPayload> {
      const config = await readConfig();
      const frame = await readFrame(config);
      const targets = contextTargets(input.refs, undefined);
      const markerIds = new Set(input.markerIds ?? []);

      if (targets.length === 0 && markerIds.size === 0) {
        return {
          status: "invalid",
          action: "memory_unmark_context",
          message: "At least one marker id or ref is required.",
          frameFile: paths.frameFile,
        };
      }

      const before = frame.markers.length;
      frame.markers = frame.markers.filter((marker) => {
        if (markerIds.has(marker.id)) return false;
        return !targets.some((target) => sameContextTarget(marker, target));
      });
      const removed = before - frame.markers.length;
      if (removed > 0) {
        frame.version += 1;
        frame.updatedAt = nowIso();
        await writeFrame(frame);
      }

      return {
        status: "ok",
        action: "memory_unmark_context",
        version: frame.version,
        removed,
        frameFile: paths.frameFile,
      };
    },

    async memoryReadContextFrame(): Promise<ToolPayload> {
      const config = await readConfig();
      const frame = await readFrame(config);
      return {
        status: "ok",
        action: "memory_read_context_frame",
        version: frame.version,
        markers: frame.markers,
        temporaryWorkspace: frame.lastWorkspace,
        frameFile: paths.frameFile,
        configFile: paths.configFile,
      };
    },

    async memoryMaintainContext(input: MaintainContextInput): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      const frame = await readFrame(config);
      const maintained = maintainMemoryContext(store, frame, input, {
        memoryId,
        markerId,
        timestamp: nowIso(),
      });
      const { changedStore, changedFrame, ...publicPayload } = maintained;

      if (maintained.status === "ok") {
        if (changedStore) await writeStore(store);
        if (changedFrame) await writeFrame(frame);
      }

      return {
        ...publicPayload,
        version: store.version,
        frameVersion: frame.version,
        ...paths,
      };
    },
  };
}

function contextTargets(
  refs: string[] | undefined,
  ranges: Array<{ ref: string; start: number; end: number }> | undefined,
): ContextTarget[] {
  const targets: ContextTarget[] = [];
  for (const ref of refs ?? []) {
    const parsed = parseContextRef(ref);
    if (parsed) targets.push(parsed);
  }
  for (const range of ranges ?? []) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.end <= range.start
    )
      continue;
    const parsed = parseContextRef(range.ref);
    if (!parsed) continue;
    targets.push({
      sourceKey: parsed.sourceKey,
      range: {
        start: range.start,
        end: range.end,
      },
    });
  }
  return uniqueTargets(targets);
}

function uniqueTargets(targets: ContextTarget[]): ContextTarget[] {
  const unique: ContextTarget[] = [];
  for (const target of targets) {
    if (!unique.some((candidate) => sameContextTarget(candidate, target)))
      unique.push(target);
  }
  return unique;
}

function createMarker(
  id: string,
  target: ContextTarget,
  status: ContextMarkerStatus,
  nodeId: string | undefined,
  timestamp: string,
): ContextMarker {
  return {
    id,
    sourceKey: target.sourceKey,
    status,
    nodeId,
    range: target.range,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function memoryId(): string {
  return `mem-${randomBytes(6).toString("hex")}`;
}

function markerId(): string {
  return `ctxmark-${randomBytes(6).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}
