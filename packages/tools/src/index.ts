import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  archiveMemoryNode,
  buildMemoryInjectionView,
  moveMemoryNode,
  normalizeMemoryConfig,
  normalizeMemoryStore,
  openMemoryNode,
  readMemorySlots,
  searchMemoryNodes,
  type MemoryConfig,
  type MemoryNodeStatus,
  type MemoryStore,
} from "@rawpoplar/memory-arbor-core";
import {
  normalizeContextFrameStore,
  parseContextRef,
  sameContextTarget,
  type ContextFrameStore,
  type ContextRange,
} from "@rawpoplar/memory-arbor-context";
import {
  maintainMemoryContext,
  type MaintainContextInput,
} from "./maintain.ts";

export * from "./maintain.ts";

export const INTERACTION_PROTOCOL_VERSION = 1;

export type MemorySearchInput = {
  query?: string;
  tag?: string;
  status?: MemoryNodeStatus;
  limit?: number;
};

export type MemoryQueryInput = MemorySearchInput & {
  openIds?: string[];
};

export type MemoryApplyInput = MaintainContextInput;

export type MemoryAdminInput = {
  action: "archive" | "move" | "unmark";
  id?: string;
  newParentId?: string;
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
      interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
      storeVersion: store.version,
    };
  }

  return {
    paths,
    readConfig,
    readStore,
    readFrame,
    writeStore,
    writeFrame,

    async memoryQuery(input: MemoryQueryInput): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      return {
        status: "ok",
        action: "memory_query",
        interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
        storeVersion: store.version,
        nodes: searchMemoryNodes(store, input.query ?? "", {
          tag: input.tag,
          status: input.status,
          limit: input.limit,
        }),
        opened: (input.openIds ?? []).map((id) => openMemoryNode(store, id)),
      };
    },

    async memoryApply(input: MemoryApplyInput): Promise<ToolPayload> {
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
        action: "memory_apply",
        interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
        storeVersion: store.version,
        frameVersion: frame.version,
      };
    },

    async memoryStatus(): Promise<ToolPayload> {
      const config = await readConfig();
      const store = await readStore(config);
      const frame = await readFrame(config);
      return {
        status: "ok",
        action: "memory_status",
        interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
        storeVersion: store.version,
        frameVersion: frame.version,
        slots: readMemorySlots(store),
        contextFrame: frame,
        memoryProjection: buildMemoryInjectionView(store, config),
      };
    },

    async memoryAdmin(input: MemoryAdminInput): Promise<ToolPayload> {
      if (input.action === "archive") {
        if (!input.id) return invalidAdminInput(input.action, "id is required.");
        return updateStore((store) => {
          const archived = archiveMemoryNode(store, input.id);
          if (archived.status !== "ok") {
            return {
              status: archived.status,
              action: "memory_admin",
              operation: input.action,
              message: archived.message,
              changed: false,
            };
          }
          return {
            status: "ok",
            action: "memory_admin",
            operation: input.action,
            ...archived.value,
          };
        });
      }

      if (input.action === "move") {
        if (!input.id || !input.newParentId) {
          return invalidAdminInput(input.action, "id and newParentId are required.");
        }
        return updateStore((store) => {
          const moved = moveMemoryNode(store, input.id, input.newParentId);
          if (moved.status !== "ok") {
            return {
              status: moved.status,
              action: "memory_admin",
              operation: input.action,
              message: moved.message,
              changed: false,
            };
          }
          return {
            status: "ok",
            action: "memory_admin",
            operation: input.action,
            node: moved.value,
          };
        });
      }

      const config = await readConfig();
      const frame = await readFrame(config);
      const markerIds = new Set(input.markerIds ?? []);
      const targets = contextTargets(input.refs);
      if (markerIds.size === 0 && targets.length === 0) {
        return {
          status: "invalid",
          action: "memory_admin",
          operation: input.action,
          message: "At least one marker id or ref is required.",
          interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
        };
      }

      const before = frame.markers.length;
      frame.markers = frame.markers.filter(
        (marker) =>
          !markerIds.has(marker.id) &&
          !targets.some((target) => sameContextTarget(marker, target)),
      );
      const removed = before - frame.markers.length;
      if (removed > 0) {
        frame.version += 1;
        frame.updatedAt = nowIso();
        await writeFrame(frame);
      }
      return {
        status: "ok",
        action: "memory_admin",
        operation: input.action,
        interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
        frameVersion: frame.version,
        removed,
      };
    },
  };
}

function invalidAdminInput(operation: string, message: string): ToolPayload {
  return {
    status: "invalid",
    action: "memory_admin",
    operation,
    message,
    interactionProtocolVersion: INTERACTION_PROTOCOL_VERSION,
  };
}

function contextTargets(refs: string[] | undefined): ContextTarget[] {
  const targets: ContextTarget[] = [];
  for (const ref of refs ?? []) {
    const parsed = parseContextRef(ref);
    if (parsed) targets.push(parsed);
  }
  return targets.filter(
    (target, index) =>
      !targets.slice(0, index).some((candidate) => sameContextTarget(candidate, target)),
  );
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
