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
  type ContextFrameStore,
  type ContextMarker,
} from "./frame.ts";
import {
  buildMemoryMaintenancePrompt,
  maintainMemoryContext,
} from "./maintain.ts";

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

const pressureFrame: ContextFrameStore = {
  version: 0,
  markers: [],
  lastWorkspace: workspace,
  updatedAt: timestamp,
};
const pressurePrompt = buildMemoryMaintenancePrompt(pressureFrame, {
  storeVersion: store.version,
});
assert(
  pressurePrompt?.includes("memory_maintain_context"),
  "pressure prompt should ask for the maintain tool",
);
assert(
  pressurePrompt?.includes(range.refs[0].ref),
  "pressure prompt should include older temporary refs",
);

const normalFrame: ContextFrameStore = {
  version: 0,
  markers: [],
  lastWorkspace: buildTemporaryWorkspaceStatus(
    [],
    config.temporaryWorkspace,
    timestamp,
  ),
  updatedAt: timestamp,
};
assert(
  buildMemoryMaintenancePrompt(normalFrame) === null,
  "normal pressure should not produce a system maintenance prompt",
);

let markerIndex = 0;
const maintainCreate = maintainMemoryContext(
  store,
  pressureFrame,
  {
    createNodes: [
      {
        title: "Maintained Context",
        summary: "Maintained context summary.",
        content: "Maintained context content.",
        tags: ["maintain"],
        markRefs: [range.refs[0].ref],
        loadSlot: "working_context",
      },
    ],
    discardRefs: [range.refs[1].ref],
  },
  {
    memoryId: () => "maintained-context",
    markerId: () => `maintain-marker-${++markerIndex}`,
    timestamp,
  },
);
assert(maintainCreate.status === "ok", "maintain create should succeed");
assert(
  maintainCreate.status === "ok" &&
    maintainCreate.created[0]?.id === "maintained-context",
  "maintain create should create the requested node",
);
assert(
  pressureFrame.markers.some(
    (marker) =>
      marker.status === "memorized" &&
      marker.nodeId === "maintained-context",
  ),
  "maintain create should mark refs as memorized",
);
assert(
  pressureFrame.markers.some((marker) => marker.status === "discarded"),
  "maintain create should mark discard refs as discarded",
);
assert(
  store.slots.some(
    (slot) =>
      slot.name === "working_context" &&
      slot.loadedNodeIds.includes("maintained-context"),
  ),
  "maintain create should load the created node",
);

const updateProjection = applyContextMarkersToText(
  "opencode:s:m:p3",
  "update this ref",
  [],
);
const updateFrame: ContextFrameStore = {
  version: 0,
  markers: [],
  lastWorkspace: buildTemporaryWorkspaceStatus(
    updateProjection.refs,
    config.temporaryWorkspace,
    timestamp,
  ),
  updatedAt: timestamp,
};
const maintainUpdate = maintainMemoryContext(
  store,
  updateFrame,
  {
    updateNodes: [
      {
        id: "adapter-smoke",
        content: "Updated through memory_maintain_context.",
        markRefs: [updateProjection.refs[0].ref],
        loadSlot: "task_state",
      },
    ],
  },
  {
    memoryId: () => "unused",
    markerId: () => `maintain-marker-${++markerIndex}`,
    timestamp,
  },
);
assert(maintainUpdate.status === "ok", "maintain update should succeed");
assert(
  maintainUpdate.status === "ok" && maintainUpdate.updated.length === 1,
  "maintain update should update one node",
);
assert(
  updateFrame.markers.some(
    (marker) =>
      marker.status === "memorized" && marker.nodeId === "adapter-smoke",
  ),
  "maintain update should mark refs as memorized",
);

const storeBeforeInvalid = JSON.stringify(store);
const frameBeforeInvalid = JSON.stringify(updateFrame);
const invalidMaintain = maintainMemoryContext(
  store,
  updateFrame,
  {
    loadSlots: [
      {
        slot: "missing_slot",
        nodeIds: ["adapter-smoke"],
      },
    ],
  },
  {
    memoryId: () => "unused",
    markerId: () => `maintain-marker-${++markerIndex}`,
    timestamp,
  },
);
assert(invalidMaintain.status === "invalid", "invalid maintain should fail");
assert(
  JSON.stringify(store) === storeBeforeInvalid &&
    JSON.stringify(updateFrame) === frameBeforeInvalid,
  "invalid maintain should not mutate store or frame",
);

const memoryView = buildMemoryInjectionView(store, config);
assert(
  memoryView.slots.some(
    (slot) => slot.name === "task_state" && slot.nodes.length === 1,
  ),
  "memory view should include loaded slot node",
);

console.log("memory-context adapter smoke passed");
