import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMemoryArborTools } from "@rawpoplar/memory-arbor-tools";

const NODE_KINDS = ["root", "branch", "leaf"] as const;
const NODE_STATUSES = ["active", "archived"] as const;
const MARKER_STATUSES = ["memorized", "discarded"] as const;
const LOAD_MODES = ["replace", "append"] as const;
const memory = createMemoryArborTools();

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
  "memory_create_node",
  {
    description:
      "Create one Memory Arbor node in the host-independent memory tree.",
    inputSchema: {
      title: z.string().min(1).describe("Short memory node title."),
      summary: z
        .string()
        .optional()
        .describe("Short summary. Defaults to a content/title summary."),
      content: z.string().optional().describe("Detailed memory content."),
      tags: z.array(z.string()).optional().describe("Search tags."),
      parentId: z
        .string()
        .optional()
        .describe("Parent node id. Defaults to root."),
      nodeKind: z
        .enum(NODE_KINDS)
        .optional()
        .describe("Node kind. Defaults to leaf."),
      sourceRefs: z
        .array(z.string())
        .optional()
        .describe("Optional source references."),
    },
  },
  async (input) => mcpResult(await memory.memoryCreateNode(input)),
);

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
    return mcpResult(
      await memory.memoryLoadSlot({
        slot,
        nodeIds,
        mode,
      }),
    );
  },
);

server.registerTool(
  "memory_read_slots",
  {
    description:
      "Read configured Memory Arbor slots and their loaded active memory nodes.",
  },
  async () => {
    return mcpResult(await memory.memoryReadSlots());
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
    return mcpResult(
      await memory.memorySearch({
        query,
        tag,
        status,
        limit,
      }),
    );
  },
);

server.registerTool(
  "memory_open",
  {
    description:
      "Open one memory node and return its breadcrumb, tree path, and child directory.",
    inputSchema: {
      id: z.string().min(1).describe("Memory node id."),
    },
  },
  async ({ id }) => mcpResult(await memory.memoryOpen(id)),
);

server.registerTool(
  "memory_update_node",
  {
    description: "Update one memory node. Omitted fields are left unchanged.",
    inputSchema: {
      id: z.string().min(1).describe("Memory node id."),
      title: z.string().min(1).optional().describe("Replacement title."),
      summary: z.string().min(1).optional().describe("Replacement summary."),
      content: z.string().min(1).optional().describe("Replacement content."),
      tags: z.array(z.string()).optional().describe("Replacement tags."),
      nodeKind: z
        .enum(NODE_KINDS)
        .optional()
        .describe("Replacement node kind."),
      sourceRefs: z
        .array(z.string())
        .optional()
        .describe("Replacement source references."),
    },
  },
  async (input) => mcpResult(await memory.memoryUpdateNode(input)),
);

server.registerTool(
  "memory_archive_node",
  {
    description:
      "Archive one memory node subtree and remove archived nodes from all loaded slots.",
    inputSchema: {
      id: z.string().min(1).describe("Memory node id."),
    },
  },
  async ({ id }) => mcpResult(await memory.memoryArchiveNode(id)),
);

server.registerTool(
  "memory_move_node",
  {
    description: "Move one memory node under a new active parent node.",
    inputSchema: {
      id: z.string().min(1).describe("Memory node id."),
      newParentId: z.string().min(1).describe("New parent node id."),
    },
  },
  async (input) => mcpResult(await memory.memoryMoveNode(input)),
);

server.registerTool(
  "memory_mark_context",
  {
    description:
      "Mark temporary workspace refs as memorized or discarded in the external context frame store.",
    inputSchema: {
      refs: z
        .array(z.string())
        .optional()
        .describe(
          "Temporary workspace refs to mark. A ref may be a full part or sourceKey@start:end.",
        ),
      ranges: z
        .array(
          z.object({
            ref: z
              .string()
              .min(1)
              .describe("Temporary workspace ref or source key."),
            start: z
              .number()
              .int()
              .nonnegative()
              .describe("Original text start offset."),
            end: z
              .number()
              .int()
              .positive()
              .describe("Original text end offset."),
          }),
        )
        .optional()
        .describe("Explicit text ranges to mark."),
      status: z.enum(MARKER_STATUSES).describe("Marker status."),
      nodeId: z
        .string()
        .optional()
        .describe("Required when status is memorized."),
    },
  },
  async (input) => mcpResult(await memory.memoryMarkContext(input)),
);

server.registerTool(
  "memory_unmark_context",
  {
    description:
      "Remove external context markers by marker id or temporary workspace ref.",
    inputSchema: {
      markerIds: z
        .array(z.string())
        .optional()
        .describe("Marker ids returned by memory_read_context_frame."),
      refs: z
        .array(z.string())
        .optional()
        .describe("Refs or sourceKey@start:end targets to unmark."),
    },
  },
  async (input) => mcpResult(await memory.memoryUnmarkContext(input)),
);

server.registerTool(
  "memory_read_context_frame",
  {
    description:
      "Read external context frame state, markers, recent temporary workspace refs, and pressure status.",
  },
  async () => mcpResult(await memory.memoryReadContextFrame()),
);

server.registerTool(
  "memory_maintain_context",
  {
    description:
      "Deterministically batch memory node create/update, context marking, slot loading, and ref discarding.",
    inputSchema: {
      createNodes: z
        .array(
          z.object({
            title: z.string().min(1).describe("Short memory node title."),
            summary: z
              .string()
              .optional()
              .describe("Short summary. Defaults to a content/title summary."),
            content: z.string().optional().describe("Detailed memory content."),
            tags: z.array(z.string()).optional().describe("Search tags."),
            parentId: z
              .string()
              .optional()
              .describe("Parent node id. Defaults to root."),
            nodeKind: z
              .enum(NODE_KINDS)
              .optional()
              .describe("Node kind. Defaults to leaf."),
            sourceRefs: z
              .array(z.string())
              .optional()
              .describe("Optional source references."),
            markRefs: z
              .array(z.string())
              .optional()
              .describe("Temporary workspace refs to mark as memorized."),
            loadSlot: z
              .string()
              .optional()
              .describe("Optional slot to append the created node into."),
            loadMode: z
              .enum(LOAD_MODES)
              .optional()
              .describe("Load mode. Defaults to append."),
          }),
        )
        .optional()
        .describe("Memory nodes to create."),
      updateNodes: z
        .array(
          z.object({
            id: z.string().min(1).describe("Memory node id."),
            title: z.string().min(1).optional().describe("Replacement title."),
            summary: z.string().min(1).optional().describe("Replacement summary."),
            content: z.string().min(1).optional().describe("Replacement content."),
            tags: z.array(z.string()).optional().describe("Replacement tags."),
            nodeKind: z
              .enum(NODE_KINDS)
              .optional()
              .describe("Replacement node kind."),
            sourceRefs: z
              .array(z.string())
              .optional()
              .describe("Replacement source references."),
            markRefs: z
              .array(z.string())
              .optional()
              .describe("Temporary workspace refs to mark as memorized."),
            loadSlot: z
              .string()
              .optional()
              .describe("Optional slot to append the updated node into."),
            loadMode: z
              .enum(LOAD_MODES)
              .optional()
              .describe("Load mode. Defaults to append."),
          }),
        )
        .optional()
        .describe("Active memory nodes to update or link to refs."),
      discardRefs: z
        .array(z.string())
        .optional()
        .describe("Temporary workspace refs to mark as discarded."),
      loadSlots: z
        .array(
          z.object({
            slot: z.string().min(1).describe("Configured slot name."),
            nodeIds: z
              .array(z.string())
              .describe("Active memory node ids to load."),
            mode: z
              .enum(LOAD_MODES)
              .optional()
              .describe("Load mode. Defaults to replace."),
          }),
        )
        .optional()
        .describe("Explicit slot load operations."),
    },
  },
  async (input) => mcpResult(await memory.memoryMaintainContext(input)),
);

const transport = new StdioServerTransport();

await server.connect(transport);
