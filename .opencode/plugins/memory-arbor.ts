import type { Plugin } from "@opencode-ai/plugin";
import { MemoryContextPlugin } from "@rawpoplar/memory-arbor-opencode";

export const MemoryArborPlugin: Plugin = async (input, output) => {
  return MemoryContextPlugin(input, output);
};

export default MemoryArborPlugin;
