import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tool, type Plugin } from "@opencode-ai/plugin";
import {
  archiveMemoryNode,
  buildMemoryInjectionView,
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
  type MemoryInjectionView,
  type MemoryStore,
} from "../memory-core/index.ts";
import {
  applyContextMarkersToText,
  buildTemporaryWorkspaceStatus,
  formatContextRef,
  normalizeContextFrameStore,
  parseContextRef,
  sameContextTarget,
  type ContextFrameStore,
  type ContextMarker,
  type ContextMarkerStatus,
  type ContextRange,
  type TemporaryWorkspaceRef,
  type TemporaryWorkspaceStatus,
} from "../frame.ts";

const schema = tool.schema;
const NODE_KINDS = ["root", "branch", "leaf"] as const;
const NODE_STATUSES = ["active", "archived"] as const;
const MARKER_STATUSES = ["memorized", "discarded"] as const;

type ToolPayload = Record<string, unknown>;
type StoreMutation = ToolPayload & { changed?: boolean };
type OpenCodeMessage = {
  info: {
    id?: string;
    sessionID?: string;
    role?: string;
  };
  parts: OpenCodePart[];
};
type OpenCodePart = Record<string, unknown>;
type TextPart = OpenCodePart & {
  type: "text";
  text: string;
  id?: string;
  sessionID?: string;
  messageID?: string;
};
type ContextTarget = {
  sourceKey: string;
  range?: ContextRange;
};

export const MemoryContextPlugin: Plugin = async () => {
  const base = join(
    process.env.USERPROFILE || process.env.HOME || ".",
    ".config",
    "opencode",
    "memory-arbor",
  );
  const storeFile = join(base, "store.json");
  const configFile = join(base, "config.json");
  const frameFile = join(base, "context-frame.json");

  async function readJson(path: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async function readConfig(): Promise<MemoryConfig> {
    return normalizeMemoryConfig(await readJson(configFile));
  }

  async function readStore(config: MemoryConfig): Promise<MemoryStore> {
    return normalizeMemoryStore(await readJson(storeFile), config);
  }

  async function readFrame(config: MemoryConfig): Promise<ContextFrameStore> {
    return normalizeContextFrameStore(
      await readJson(frameFile),
      config.temporaryWorkspace,
    );
  }

  async function writeStore(store: MemoryStore): Promise<void> {
    await mkdir(dirname(storeFile), { recursive: true });
    await writeFile(storeFile, JSON.stringify(store, null, 2), "utf8");
  }

  async function writeFrame(frame: ContextFrameStore): Promise<void> {
    await mkdir(dirname(frameFile), { recursive: true });
    await writeFile(frameFile, JSON.stringify(frame, null, 2), "utf8");
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
      storeFile,
      configFile,
      frameFile,
    };
  }

  function result(payload: ToolPayload): string {
    return JSON.stringify(payload, null, 2);
  }

  function memoryId(): string {
    return `mem-${randomBytes(6).toString("hex")}`;
  }

  function markerId(): string {
    return `ctxmark-${randomBytes(6).toString("hex")}`;
  }

  return {
    tool: {
      memory_create_node: tool({
        description:
          "Create one Memory Arbor node in the host-independent memory tree.",
        args: {
          title: schema.string().min(1).describe("Short memory node title."),
          summary: schema
            .string()
            .optional()
            .describe("Short summary. Defaults to a content/title summary."),
          content: schema
            .string()
            .optional()
            .describe("Detailed memory content."),
          tags: schema
            .array(schema.string())
            .optional()
            .describe("Search tags."),
          parentId: schema
            .string()
            .optional()
            .describe("Parent node id. Defaults to root."),
          nodeKind: schema
            .enum(NODE_KINDS)
            .optional()
            .describe("Node kind. Defaults to leaf."),
          sourceRefs: schema
            .array(schema.string())
            .optional()
            .describe("Optional source references."),
        },
        async execute(args) {
          return result(
            await updateStore((store) => {
              const created = createMemoryNode(store, args, {
                id: memoryId(),
              });
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
            }),
          );
        },
      }),

      memory_search: tool({
        description:
          "Search active or archived memory nodes by query, tag, and status.",
        args: {
          query: schema
            .string()
            .optional()
            .describe(
              "Case-insensitive search over title, summary, content, and tags.",
            ),
          tag: schema.string().optional().describe("Filter by one tag."),
          status: schema
            .enum(NODE_STATUSES)
            .optional()
            .describe("Filter by status. Defaults to active."),
          limit: schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("Maximum result count. Defaults to 10."),
        },
        async execute(args) {
          const config = await readConfig();
          const store = await readStore(config);
          return result({
            status: "ok",
            action: "memory_search",
            version: store.version,
            nodes: searchMemoryNodes(store, args.query ?? "", {
              tag: args.tag,
              status: args.status,
              limit: args.limit,
            }),
          });
        },
      }),

      memory_open: tool({
        description:
          "Open one memory node and return its breadcrumb, tree path, and child directory.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
        },
        async execute(args) {
          const config = await readConfig();
          const store = await readStore(config);
          const view = openMemoryNode(store, args.id);
          return result({
            status: view ? "ok" : "not_found",
            action: "memory_open",
            version: store.version,
            view,
          });
        },
      }),

      memory_update_node: tool({
        description:
          "Update one memory node. Omitted fields are left unchanged.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
          title: schema
            .string()
            .min(1)
            .optional()
            .describe("Replacement title."),
          summary: schema
            .string()
            .min(1)
            .optional()
            .describe("Replacement summary."),
          content: schema
            .string()
            .min(1)
            .optional()
            .describe("Replacement content."),
          tags: schema
            .array(schema.string())
            .optional()
            .describe("Replacement tags."),
          nodeKind: schema
            .enum(NODE_KINDS)
            .optional()
            .describe("Replacement node kind."),
          sourceRefs: schema
            .array(schema.string())
            .optional()
            .describe("Replacement source references."),
        },
        async execute(args) {
          return result(
            await updateStore((store) => {
              const updated = updateMemoryNode(store, args.id, {
                title: args.title,
                summary: args.summary,
                content: args.content,
                tags: args.tags,
                nodeKind: args.nodeKind,
                sourceRefs: args.sourceRefs,
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
            }),
          );
        },
      }),

      memory_archive_node: tool({
        description:
          "Archive one memory node subtree and remove archived nodes from all loaded slots.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
        },
        async execute(args) {
          return result(
            await updateStore((store) => {
              const archived = archiveMemoryNode(store, args.id);
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
            }),
          );
        },
      }),

      memory_move_node: tool({
        description: "Move one memory node under a new active parent node.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
          newParentId: schema.string().min(1).describe("New parent node id."),
        },
        async execute(args) {
          return result(
            await updateStore((store) => {
              const moved = moveMemoryNode(store, args.id, args.newParentId);
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
            }),
          );
        },
      }),

      memory_load_slot: tool({
        description:
          "Load active memory nodes into a configured memory slot for future context-frame projection.",
        args: {
          slot: schema.string().min(1).describe("Configured slot name."),
          nodeIds: schema
            .array(schema.string())
            .min(1)
            .describe("Memory node ids to load."),
          mode: schema
            .enum(["replace", "append"])
            .optional()
            .describe("Load mode. Defaults to replace."),
        },
        async execute(args) {
          return result(
            await updateStore((store) => {
              const loaded = loadMemorySlot(
                store,
                args.slot,
                args.nodeIds,
                args.mode ?? "replace",
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
            }),
          );
        },
      }),

      memory_read_slots: tool({
        description:
          "Read current configured memory slots and their loaded active memory nodes.",
        args: {},
        async execute() {
          const config = await readConfig();
          const store = await readStore(config);
          return result({
            status: "ok",
            action: "memory_read_slots",
            version: store.version,
            slots: readMemorySlots(store),
            storeFile,
            configFile,
            frameFile,
          });
        },
      }),

      memory_mark_context: tool({
        description:
          "Mark temporary workspace refs as memorized or discarded in the external context frame store.",
        args: {
          refs: schema
            .array(schema.string())
            .optional()
            .describe(
              "Temporary workspace refs to mark. A ref may be a full part or sourceKey@start:end.",
            ),
          ranges: schema
            .array(
              schema.object({
                ref: schema
                  .string()
                  .min(1)
                  .describe("Temporary workspace ref or source key."),
                start: schema
                  .number()
                  .int()
                  .nonnegative()
                  .describe("Original text start offset."),
                end: schema
                  .number()
                  .int()
                  .positive()
                  .describe("Original text end offset."),
              }),
            )
            .optional()
            .describe("Explicit text ranges to mark."),
          status: schema.enum(MARKER_STATUSES).describe("Marker status."),
          nodeId: schema
            .string()
            .optional()
            .describe("Required when status is memorized."),
        },
        async execute(args) {
          const config = await readConfig();
          const store = await readStore(config);
          const frame = await readFrame(config);
          const targets = contextTargets(args.refs, args.ranges);

          if (targets.length === 0) {
            return result({
              status: "invalid",
              action: "memory_mark_context",
              message: "At least one valid ref or range is required.",
              frameFile,
            });
          }

          if (args.status === "memorized") {
            if (!args.nodeId) {
              return result({
                status: "invalid",
                action: "memory_mark_context",
                message: "nodeId is required when status is memorized.",
                frameFile,
              });
            }
            const node = openMemoryNode(store, args.nodeId);
            if (!node || node.node.status !== "active") {
              return result({
                status: "not_found",
                action: "memory_mark_context",
                message: `Active memory node '${args.nodeId}' was not found.`,
                frameFile,
              });
            }
          }

          const timestamp = nowIso();
          frame.markers = frame.markers.filter(
            (marker) =>
              !targets.some((target) => sameContextTarget(marker, target)),
          );
          const created = targets.map((target) =>
            createMarker(
              markerId(),
              target,
              args.status,
              args.status === "memorized" ? args.nodeId : undefined,
              timestamp,
            ),
          );
          frame.markers.push(...created);
          frame.version += 1;
          frame.updatedAt = timestamp;
          await writeFrame(frame);

          return result({
            status: "ok",
            action: "memory_mark_context",
            version: frame.version,
            markers: created,
            frameFile,
          });
        },
      }),

      memory_unmark_context: tool({
        description:
          "Remove external context markers by marker id or temporary workspace ref.",
        args: {
          markerIds: schema
            .array(schema.string())
            .optional()
            .describe("Marker ids returned by memory_read_context_frame."),
          refs: schema
            .array(schema.string())
            .optional()
            .describe("Refs or sourceKey@start:end targets to unmark."),
        },
        async execute(args) {
          const config = await readConfig();
          const frame = await readFrame(config);
          const targets = contextTargets(args.refs, undefined);
          const markerIds = new Set(args.markerIds ?? []);

          if (targets.length === 0 && markerIds.size === 0) {
            return result({
              status: "invalid",
              action: "memory_unmark_context",
              message: "At least one marker id or ref is required.",
              frameFile,
            });
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

          return result({
            status: "ok",
            action: "memory_unmark_context",
            version: frame.version,
            removed,
            frameFile,
          });
        },
      }),

      memory_read_context_frame: tool({
        description:
          "Read external context frame state, markers, recent temporary workspace refs, and pressure status.",
        args: {},
        async execute() {
          const config = await readConfig();
          const frame = await readFrame(config);
          return result({
            status: "ok",
            action: "memory_read_context_frame",
            version: frame.version,
            markers: frame.markers,
            temporaryWorkspace: frame.lastWorkspace,
            frameFile,
            configFile,
          });
        },
      }),
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      let config: MemoryConfig;
      let store: MemoryStore;
      let frame: ContextFrameStore;
      try {
        config = await readConfig();
        store = await readStore(config);
        frame = await readFrame(config);
      } catch {
        return;
      }

      const messages = output.messages as OpenCodeMessage[];
      const latestUserMessageId = latestUserMessage(messages)?.info.id;
      const refs: TemporaryWorkspaceRef[] = [];

      for (const message of messages) {
        const parts: OpenCodePart[] = [];
        for (const part of message.parts) {
          if (!isTextPart(part)) {
            parts.push(part);
            continue;
          }

          const sourceKey = sourceKeyFor(message, part);
          const projection = applyContextMarkersToText(
            sourceKey,
            part.text,
            frame.markers,
          );
          if (projection.text.length === 0) continue;

          part.text = projection.text;
          parts.push(part);
          refs.push(
            ...projection.refs.map((ref) => ({
              ...ref,
              role: message.info.role,
              messageID: message.info.id,
              partID: part.id,
              latestUserMessage: message.info.id === latestUserMessageId,
            })),
          );
        }
        message.parts = parts;
      }

      output.messages = messages.filter((message) => message.parts.length > 0);
      const timestamp = nowIso();
      const workspace = buildTemporaryWorkspaceStatus(
        refs,
        config.temporaryWorkspace,
        timestamp,
      );
      frame.lastWorkspace = workspace;
      frame.version += 1;
      frame.updatedAt = timestamp;
      await writeFrame(frame);

      const memoryView = buildMemoryInjectionView(store, config);
      insertMemoryFrame(
        output.messages as OpenCodeMessage[],
        buildMemoryFrameText(memoryView, frame, workspace),
      );
    },
  };
};

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

function isTextPart(part: OpenCodePart): part is TextPart {
  return part.type === "text" && typeof part.text === "string";
}

function sourceKeyFor(message: OpenCodeMessage, part: TextPart): string {
  const sessionID =
    part.sessionID ?? message.info.sessionID ?? "unknown-session";
  const messageID = part.messageID ?? message.info.id ?? "unknown-message";
  const partID = part.id ?? "unknown-part";
  return `opencode:${sessionID}:${messageID}:${partID}`;
}

function latestUserMessage(
  messages: OpenCodeMessage[],
): OpenCodeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info.role === "user") return messages[index];
  }
  return undefined;
}

function insertMemoryFrame(messages: OpenCodeMessage[], text: string): void {
  for (const message of messages) {
    const part = message.parts.find(isTextPart);
    if (!part) continue;
    part.text = `${text}\n\n${part.text}`;
    return;
  }

  const first = messages[0];
  if (!first) return;
  first.parts.unshift({
    id: `memory-frame-${Date.now()}`,
    sessionID: first.info.sessionID ?? "unknown-session",
    messageID: first.info.id ?? "unknown-message",
    type: "text",
    text,
    synthetic: true,
    metadata: {
      source: "memory-arbor",
    },
  });
}

function buildMemoryFrameText(
  view: MemoryInjectionView,
  frame: ContextFrameStore,
  workspace: TemporaryWorkspaceStatus,
): string {
  const pressure =
    workspace.pressure === "normal"
      ? []
      : [
          "<workspace_pressure>",
          `status: ${workspace.pressure}`,
          "Call memory_create_node or memory_update_node for older useful temporary refs, then memory_mark_context.",
          "If a ref is useless, call memory_mark_context with status discarded.",
          "Do not mark the latest user message unless the user explicitly asks.",
          "</workspace_pressure>",
        ];

  return [
    "<memory_frame>",
    `frameVersion: ${frame.version}`,
    `memoryStoreVersion: ${view.version}`,
    `memoryTokens: ${view.usedTokens}/${view.maxMemoryTokens}`,
    `memoryTruncated: ${view.truncated}`,
    ...memorySlotBlocks(view),
    `<temporary_workspace tokenEstimate="${workspace.tokenEstimate}" maxTokens="${workspace.maxTokens}" pressure="${workspace.pressure}">`,
    ...workspace.refs.map(temporaryRefBlock),
    "</temporary_workspace>",
    ...pressure,
    "</memory_frame>",
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

function temporaryRefBlock(ref: TemporaryWorkspaceRef): string {
  const attrs = [
    `ref="${escapeXml(ref.ref)}"`,
    `role="${escapeXml(ref.role ?? "")}"`,
    `messageID="${escapeXml(ref.messageID ?? "")}"`,
    `partID="${escapeXml(ref.partID ?? "")}"`,
    `start="${ref.start}"`,
    `end="${ref.end}"`,
    `tokenEstimate="${ref.tokenEstimate}"`,
    `latestUserMessage="${ref.latestUserMessage === true}"`,
  ].join(" ");
  return `<temporary_ref ${attrs}>${escapeXml(ref.preview)}</temporary_ref>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function nowIso(): string {
  return new Date().toISOString();
}

export const server = MemoryContextPlugin;
