import { tool, type Plugin } from "@opencode-ai/plugin";
import {
  buildMemoryMaintenancePrompt,
  createMemoryArborTools,
} from "@rawpoplar/memory-arbor-tools";
import {
  buildMemoryInjectionView,
  type MemoryConfig,
  type MemoryInjectionView,
  type MemoryStore,
} from "@rawpoplar/memory-arbor-core";
import {
  applyContextMarkersToText,
  buildTemporaryWorkspaceStatus,
  formatContextRef,
  type ContextFrameStore,
  type TemporaryWorkspaceRef,
  type TemporaryWorkspaceStatus,
} from "@rawpoplar/memory-arbor-context";

const schema = tool.schema;
const NODE_KINDS = ["root", "branch", "leaf"] as const;
const NODE_STATUSES = ["active", "archived"] as const;
const MARKER_STATUSES = ["memorized", "discarded"] as const;
const LOAD_MODES = ["replace", "append"] as const;

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
export const MemoryContextPlugin: Plugin = async () => {
  const memory = createMemoryArborTools();

  function result(payload: unknown): string {
    return JSON.stringify(payload, null, 2);
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
          return result(await memory.memoryCreateNode(args));
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
          return result(await memory.memorySearch(args));
        },
      }),

      memory_open: tool({
        description:
          "Open one memory node and return its breadcrumb, tree path, and child directory.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
        },
        async execute(args) {
          return result(await memory.memoryOpen(args.id));
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
          return result(await memory.memoryUpdateNode(args));
        },
      }),

      memory_archive_node: tool({
        description:
          "Archive one memory node subtree and remove archived nodes from all loaded slots.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
        },
        async execute(args) {
          return result(await memory.memoryArchiveNode(args.id));
        },
      }),

      memory_move_node: tool({
        description: "Move one memory node under a new active parent node.",
        args: {
          id: schema.string().min(1).describe("Memory node id."),
          newParentId: schema.string().min(1).describe("New parent node id."),
        },
        async execute(args) {
          return result(await memory.memoryMoveNode(args));
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
          return result(await memory.memoryLoadSlot(args));
        },
      }),

      memory_read_slots: tool({
        description:
          "Read current configured memory slots and their loaded active memory nodes.",
        args: {},
        async execute() {
          return result(await memory.memoryReadSlots());
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
          return result(await memory.memoryMarkContext(args));
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
          return result(await memory.memoryUnmarkContext(args));
        },
      }),

      memory_read_context_frame: tool({
        description:
          "Read external context frame state, markers, recent temporary workspace refs, and pressure status.",
        args: {},
        async execute() {
          return result(await memory.memoryReadContextFrame());
        },
      }),

      memory_maintain_context: tool({
        description:
          "Deterministically batch memory node create/update, context marking, slot loading, and ref discarding.",
        args: {
          createNodes: schema
            .array(
              schema.object({
                title: schema.string().min(1).describe("Short memory node title."),
                summary: schema
                  .string()
                  .optional()
                  .describe("Short summary. Defaults to a content/title summary."),
                content: schema.string().optional().describe("Detailed memory content."),
                tags: schema.array(schema.string()).optional().describe("Search tags."),
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
                markRefs: schema
                  .array(schema.string())
                  .optional()
                  .describe("Temporary workspace refs to mark as memorized."),
                loadSlot: schema
                  .string()
                  .optional()
                  .describe("Optional slot to append the created node into."),
                loadMode: schema
                  .enum(LOAD_MODES)
                  .optional()
                  .describe("Load mode. Defaults to append."),
              }),
            )
            .optional()
            .describe("Memory nodes to create."),
          updateNodes: schema
            .array(
              schema.object({
                id: schema.string().min(1).describe("Memory node id."),
                title: schema.string().min(1).optional().describe("Replacement title."),
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
                tags: schema.array(schema.string()).optional().describe("Replacement tags."),
                nodeKind: schema
                  .enum(NODE_KINDS)
                  .optional()
                  .describe("Replacement node kind."),
                sourceRefs: schema
                  .array(schema.string())
                  .optional()
                  .describe("Replacement source references."),
                markRefs: schema
                  .array(schema.string())
                  .optional()
                  .describe("Temporary workspace refs to mark as memorized."),
                loadSlot: schema
                  .string()
                  .optional()
                  .describe("Optional slot to append the updated node into."),
                loadMode: schema
                  .enum(LOAD_MODES)
                  .optional()
                  .describe("Load mode. Defaults to append."),
              }),
            )
            .optional()
            .describe("Active memory nodes to update or link to refs."),
          discardRefs: schema
            .array(schema.string())
            .optional()
            .describe("Temporary workspace refs to mark as discarded."),
          loadSlots: schema
            .array(
              schema.object({
                slot: schema.string().min(1).describe("Configured slot name."),
                nodeIds: schema
                  .array(schema.string())
                  .describe("Active memory node ids to load."),
                mode: schema
                  .enum(LOAD_MODES)
                  .optional()
                  .describe("Load mode. Defaults to replace."),
              }),
            )
            .optional()
            .describe("Explicit slot load operations."),
        },
        async execute(args) {
          return result(await memory.memoryMaintainContext(args));
        },
      }),
    },

    "experimental.chat.system.transform": async (_input, output) => {
      let config: MemoryConfig;
      let store: MemoryStore;
      let frame: ContextFrameStore;
      try {
        config = await memory.readConfig();
        store = await memory.readStore(config);
        frame = await memory.readFrame(config);
      } catch {
        return;
      }

      const prompt = buildMemoryMaintenancePrompt(frame, {
        storeVersion: store.version,
      });
      if (!prompt) return;
      output.system.push(prompt);
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      let config: MemoryConfig;
      let store: MemoryStore;
      let frame: ContextFrameStore;
      try {
        config = await memory.readConfig();
        store = await memory.readStore(config);
        frame = await memory.readFrame(config);
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
      await memory.writeFrame(frame);

      const memoryView = buildMemoryInjectionView(store, config);
      insertMemoryFrame(
        output.messages as OpenCodeMessage[],
        buildMemoryFrameText(memoryView, frame, workspace),
      );
    },
  };
};

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
