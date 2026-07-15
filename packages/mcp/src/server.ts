import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMemoryArborTools } from "@rawpoplar/memory-arbor-tools";

const NODE_KINDS = ["root", "branch", "leaf"] as const;
const NODE_STATUSES = ["active", "archived"] as const;
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
  "memory_query",
  {
    description:
      "Search Memory Arbor nodes and optionally open selected results in the same call.",
    inputSchema: {
      query: z.string().optional(),
      tag: z.string().optional(),
      status: z.enum(NODE_STATUSES).optional(),
      limit: z.number().int().positive().optional(),
      openIds: z.array(z.string()).optional(),
    },
  },
  async (input) => mcpResult(await memory.memoryQuery(input)),
);

server.registerTool(
  "memory_apply",
  {
    description:
      "Create or update memory, mark refs as memorized, discard refs, and load slots in one apply operation.",
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
  async (input) => mcpResult(await memory.memoryApply(input)),
);

server.registerTool(
  "memory_status",
  {
    description:
      "Read current slots, context frame, temporary workspace pressure, state versions, and the current loaded-memory projection.",
  },
  async () => mcpResult(await memory.memoryStatus()),
);

server.registerTool(
  "memory_admin",
  {
    description:
      "Perform a low-frequency repair: archive a node, move a node, or unmark context refs.",
    inputSchema: {
      action: z.enum(["archive", "move", "unmark"]),
      id: z.string().optional(),
      newParentId: z.string().optional(),
      markerIds: z.array(z.string()).optional(),
      refs: z.array(z.string()).optional(),
    },
  },
  async (input) => mcpResult(await memory.memoryAdmin(input)),
);

const transport = new StdioServerTransport();

await server.connect(transport);
