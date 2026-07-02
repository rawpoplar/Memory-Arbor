import { pathToFileURL } from "node:url";
import { DEFAULT_SLOT_CONFIGS } from "../../core/src/index.ts";

export const MEMORY_ARBOR_MCP_TOOLS = [
  "memory_search",
  "memory_open",
  "memory_create_node",
  "memory_update_node",
  "memory_archive_node",
  "memory_move_node",
  "memory_load_slot",
  "memory_read_slots",
  "memory_mark_context",
  "memory_unmark_context",
  "memory_read_context_frame",
  "memory_maintain_context",
] as const;

export function describeMemoryArborMcp() {
  return {
    status: "adapter-shell",
    role: "Describe planned Memory Arbor MCP tools; this shell does not implement protocol serving or host context control.",
    defaultSlots: DEFAULT_SLOT_CONFIGS.map((slot) => slot.name),
    tools: MEMORY_ARBOR_MCP_TOOLS,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(describeMemoryArborMcp(), null, 2));
}
