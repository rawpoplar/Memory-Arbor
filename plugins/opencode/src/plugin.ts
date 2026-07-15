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
      memory_query: tool({
        description:
          "Search Memory Arbor nodes and optionally open selected results in the same call.",
        args: {
          query: schema
            .string()
            .optional()
            .describe("Case-insensitive search over title, summary, content, and tags."),
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
          openIds: schema
            .array(schema.string())
            .optional()
            .describe("Optional memory node ids to expand after searching."),
        },
        async execute(args) {
          return result(await memory.memoryQuery(args));
        },
      }),

      memory_apply: tool({
        description:
          "Create or update memory, mark refs as memorized, discard refs, and load slots in one apply operation.",
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
          return result(await memory.memoryApply(args));
        },
      }),

      memory_status: tool({
        description:
          "Read current slots, context frame, temporary workspace pressure, and state versions.",
        args: {},
        async execute() {
          return result(await memory.memoryStatus());
        },
      }),

      memory_admin: tool({
        description:
          "Perform a low-frequency repair: archive a node, move a node, or unmark context refs.",
        args: {
          action: schema
            .enum(["archive", "move", "unmark"])
            .describe("Administrative operation to perform."),
          id: schema.string().optional().describe("Required for archive and move."),
          newParentId: schema
            .string()
            .optional()
            .describe("Required for move."),
          markerIds: schema
            .array(schema.string())
            .optional()
            .describe("Marker ids to remove when action is unmark."),
          refs: schema
            .array(schema.string())
            .optional()
            .describe("Context refs to unmark when action is unmark."),
        },
        async execute(args) {
          return result(await memory.memoryAdmin(args));
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
          "Call memory_apply to create or update memory and mark older useful temporary refs.",
          "Use memory_apply with discardRefs when a ref is useless.",
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
