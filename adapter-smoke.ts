import {
  buildMemoryInjectionView,
  createEmptyMemoryStore,
  createMemoryNode,
  defaultMemoryConfig,
  loadMemorySlot,
} from "./memory-core/index.ts";
import {
  applyContextMarkersToText,
  buildTemporaryWorkspaceStatus,
  formatContextRef,
  type ContextMarker,
} from "./frame.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const timestamp = "2026-01-01T00:00:00.000Z";
const config = defaultMemoryConfig();
config.temporaryWorkspace.maxTokens = 3;
const store = createEmptyMemoryStore(config, timestamp);

const node = createMemoryNode(
  store,
  {
    title: "Adapter Smoke",
    summary: "Adapter smoke memory.",
    content: "When user says memory-adapter-smoke, answer MEMORY_ADAPTER_OK.",
    nodeKind: "leaf",
    tags: ["smoke"],
  },
  { id: "adapter-smoke", timestamp },
);
assert(node.status === "ok", "node should be created");

const loaded = loadMemorySlot(store, "task_state", ["adapter-smoke"]);
assert(loaded.status === "ok", "slot should load smoke node");

const markers: ContextMarker[] = [
  {
    id: "full",
    sourceKey: "opencode:s:m:p1",
    status: "discarded",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "range",
    sourceKey: "opencode:s:m:p2",
    status: "memorized",
    nodeId: "adapter-smoke",
    range: {
      start: 5,
      end: 11,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const full = applyContextMarkersToText(
  "opencode:s:m:p1",
  "remove all",
  markers,
);
assert(
  full.text === "" && full.refs.length === 0,
  "full marker should remove the whole part",
);

const range = applyContextMarkersToText(
  "opencode:s:m:p2",
  "keep remove keep",
  markers,
);
assert(
  range.text === "keep  keep",
  "range marker should remove only the selected text",
);
assert(
  range.refs.some(
    (ref) =>
      ref.ref === formatContextRef("opencode:s:m:p2", { start: 0, end: 5 }),
  ),
  "range projection should expose remaining refs",
);

const workspace = buildTemporaryWorkspaceStatus(
  range.refs,
  config.temporaryWorkspace,
  timestamp,
);
assert(
  workspace.pressure === "over_limit",
  "workspace pressure should report over limit without cropping",
);

const memoryView = buildMemoryInjectionView(store, config);
assert(
  memoryView.slots.some(
    (slot) => slot.name === "task_state" && slot.nodes.length === 1,
  ),
  "memory view should include loaded slot node",
);

console.log("memory-context adapter smoke passed");
