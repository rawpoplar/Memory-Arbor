import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMemoryArborTools } from "@rawpoplar/memory-arbor-tools";

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

const transport = new StdioServerTransport();

await server.connect(transport);
