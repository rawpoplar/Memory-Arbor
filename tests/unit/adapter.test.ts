import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemoryInjectionView,
  createEmptyMemoryStore,
  createMemoryNode,
  defaultMemoryConfig,
  loadMemorySlot,
} from "../../packages/core/src/index.ts";
import {
  applyContextMarkersToText,
  buildTemporaryWorkspaceStatus,
  formatContextRef,
  type ContextFrameStore,
  type ContextMarker,
} from "../../packages/context/src/frame.ts";
import {
  buildMemoryMaintenancePrompt,
  maintainMemoryContext,
} from "../../packages/tools/src/maintain.ts";

test("adapter projection removes marked context and reports pressure", () => {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const config = defaultMemoryConfig();
  config.temporaryWorkspace.maxTokens = 3;

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
  assert.equal(full.text, "");
  assert.equal(full.refs.length, 0);

  const range = applyContextMarkersToText(
    "opencode:s:m:p2",
    "keep remove keep",
    markers,
  );
  assert.equal(range.text, "keep  keep");
  assert.ok(
    range.refs.some(
      (ref) =>
        ref.ref === formatContextRef("opencode:s:m:p2", { start: 0, end: 5 }),
    ),
  );

  const workspace = buildTemporaryWorkspaceStatus(
    range.refs,
    config.temporaryWorkspace,
    timestamp,
  );
  assert.equal(workspace.pressure, "over_limit");
});

test("maintenance prompt appears only under workspace pressure", () => {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const config = defaultMemoryConfig();
  config.temporaryWorkspace.maxTokens = 3;

  const range = applyContextMarkersToText(
    "opencode:s:m:p2",
    "keep remove keep",
    [],
  );
  const pressureFrame: ContextFrameStore = {
    version: 0,
    markers: [],
    lastWorkspace: buildTemporaryWorkspaceStatus(
      range.refs,
      config.temporaryWorkspace,
      timestamp,
    ),
    updatedAt: timestamp,
  };
  const pressurePrompt = buildMemoryMaintenancePrompt(pressureFrame, {
    storeVersion: 1,
  });
  assert.match(pressurePrompt ?? "", /memory_maintain_context/);
  assert.match(pressurePrompt ?? "", /opencode:s:m:p2/);

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
  assert.equal(buildMemoryMaintenancePrompt(normalFrame), null);
});

test("memory_maintain_context batches create, update, discard, and load operations", () => {
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
  assert.equal(node.status, "ok");

  const loaded = loadMemorySlot(store, "task_state", ["adapter-smoke"]);
  assert.equal(loaded.status, "ok");

  const projection = applyContextMarkersToText(
    "opencode:s:m:p2",
    "keep remove keep",
    [],
  );
  const pressureFrame: ContextFrameStore = {
    version: 0,
    markers: [],
    lastWorkspace: buildTemporaryWorkspaceStatus(
      projection.refs,
      config.temporaryWorkspace,
      timestamp,
    ),
    updatedAt: timestamp,
  };

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
          markRefs: [projection.refs[0].ref],
          loadSlot: "working_context",
        },
      ],
    },
    {
      memoryId: () => "maintained-context",
      markerId: () => `maintain-marker-${++markerIndex}`,
      timestamp,
    },
  );
  assert.equal(maintainCreate.status, "ok");
  assert.equal(
    maintainCreate.status === "ok" ? maintainCreate.created[0]?.id : "",
    "maintained-context",
  );
  assert.ok(
    pressureFrame.markers.some(
      (marker) =>
        marker.status === "memorized" &&
        marker.nodeId === "maintained-context",
    ),
  );
  assert.ok(
    store.slots.some(
      (slot) =>
        slot.name === "working_context" &&
        slot.loadedNodeIds.includes("maintained-context"),
    ),
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
  assert.equal(maintainUpdate.status, "ok");
  assert.equal(
    maintainUpdate.status === "ok" ? maintainUpdate.updated.length : 0,
    1,
  );
  assert.ok(
    updateFrame.markers.some(
      (marker) =>
        marker.status === "memorized" && marker.nodeId === "adapter-smoke",
    ),
  );

  const maintainDiscard = maintainMemoryContext(
    store,
    updateFrame,
    {
      discardRefs: [updateProjection.refs[0].ref],
    },
    {
      memoryId: () => "unused",
      markerId: () => `maintain-marker-${++markerIndex}`,
      timestamp,
    },
  );
  assert.equal(maintainDiscard.status, "ok");
  assert.ok(
    updateFrame.markers.some((marker) => marker.status === "discarded"),
  );

  const memoryView = buildMemoryInjectionView(store, config);
  assert.ok(
    memoryView.slots.some(
      (slot) => slot.name === "task_state" && slot.nodes.length === 1,
    ),
  );
});

test("memory_maintain_context rejects invalid input without mutation", () => {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const config = defaultMemoryConfig();
  const store = createEmptyMemoryStore(config, timestamp);
  const frame: ContextFrameStore = {
    version: 0,
    markers: [],
    lastWorkspace: buildTemporaryWorkspaceStatus(
      [],
      config.temporaryWorkspace,
      timestamp,
    ),
    updatedAt: timestamp,
  };
  const storeBeforeInvalid = JSON.stringify(store);
  const frameBeforeInvalid = JSON.stringify(frame);

  const invalidMaintain = maintainMemoryContext(
    store,
    frame,
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
      markerId: () => "unused-marker",
      timestamp,
    },
  );

  assert.equal(invalidMaintain.status, "invalid");
  assert.equal(JSON.stringify(store), storeBeforeInvalid);
  assert.equal(JSON.stringify(frame), frameBeforeInvalid);
});
