import {
  DEFAULT_ROOT_NODE_ID,
  createMemoryNode,
  loadMemorySlot,
  updateMemoryNode,
  type MemoryNode,
  type MemoryNodeKind,
  type MemorySlot,
  type MemoryStore,
} from "@rawpoplar/memory-arbor-core";
import {
  parseContextRef,
  sameContextTarget,
  type ContextFrameStore,
  type ContextMarker,
  type ContextMarkerStatus,
} from "@rawpoplar/memory-arbor-context";

export type MaintainLoadMode = "replace" | "append";

export type MaintainCreateNodeInput = {
  title: string;
  summary?: string;
  content?: string;
  tags?: string[];
  parentId?: string;
  nodeKind?: MemoryNodeKind;
  sourceRefs?: string[];
  markRefs?: string[];
  loadSlot?: string;
  loadMode?: MaintainLoadMode;
};

export type MaintainUpdateNodeInput = {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  nodeKind?: MemoryNodeKind;
  sourceRefs?: string[];
  markRefs?: string[];
  loadSlot?: string;
  loadMode?: MaintainLoadMode;
};

export type MaintainLoadSlotInput = {
  slot: string;
  nodeIds: string[];
  mode?: MaintainLoadMode;
};

export type MaintainContextInput = {
  createNodes?: MaintainCreateNodeInput[];
  updateNodes?: MaintainUpdateNodeInput[];
  discardRefs?: string[];
  loadSlots?: MaintainLoadSlotInput[];
};

export type MaintainContextResult =
  | {
      status: "ok";
      action: "memory_maintain_context";
      created: MemoryNode[];
      updated: MemoryNode[];
      memorized: ContextMarker[];
      discarded: ContextMarker[];
      loaded: MemorySlot[];
      skipped: string[];
      changedStore: boolean;
      changedFrame: boolean;
    }
  | {
      status: "invalid";
      action: "memory_maintain_context";
      message: string;
      changedStore: false;
      changedFrame: false;
    };

export function maintainMemoryContext(
  store: MemoryStore,
  frame: ContextFrameStore,
  input: MaintainContextInput,
  options: {
    memoryId: () => string;
    markerId: () => string;
    timestamp: string;
  },
): MaintainContextResult {
  const createNodes = input.createNodes ?? [];
  const updateNodes = input.updateNodes ?? [];
  const discardRefs = unique(input.discardRefs ?? []);
  const loadSlots = input.loadSlots ?? [];

  const invalid = validateMaintainInput(
    store,
    frame,
    createNodes,
    updateNodes,
    discardRefs,
    loadSlots,
  );
  if (invalid) {
    return {
      status: "invalid",
      action: "memory_maintain_context",
      message: invalid,
      changedStore: false,
      changedFrame: false,
    };
  }

  const created: MemoryNode[] = [];
  const updated: MemoryNode[] = [];
  const memorized: ContextMarker[] = [];
  const discarded: ContextMarker[] = [];
  const loaded: MemorySlot[] = [];
  let changedStore = false;
  let changedFrame = false;

  for (const request of createNodes) {
    const createdNode = createMemoryNode(store, request, {
      id: options.memoryId(),
      timestamp: options.timestamp,
    });
    if (createdNode.status !== "ok") {
      return invalidResult(createdNode.message);
    }

    created.push(createdNode.value);
    changedStore = true;

    if (request.markRefs && request.markRefs.length > 0) {
      const markers = markRefs(
        frame,
        unique(request.markRefs),
        "memorized",
        createdNode.value.id,
        options,
      );
      memorized.push(...markers);
      changedFrame = changedFrame || markers.length > 0;
    }

    if (request.loadSlot) {
      const slot = loadMemorySlot(
        store,
        request.loadSlot,
        [createdNode.value.id],
        request.loadMode ?? "append",
      );
      if (slot.status !== "ok") return invalidResult(slot.message);
      loaded.push(slot.value);
      changedStore = true;
    }
  }

  for (const request of updateNodes) {
    let node = activeNode(store, request.id);
    if (!node) return invalidResult(`Active memory node '${request.id}' was not found.`);

    if (hasUpdateFields(request)) {
      const updatedNode = updateMemoryNode(store, request.id, {
        title: request.title,
        summary: request.summary,
        content: request.content,
        tags: request.tags,
        nodeKind: request.nodeKind,
        sourceRefs: request.sourceRefs,
      }, options.timestamp);
      if (updatedNode.status !== "ok") return invalidResult(updatedNode.message);
      node = updatedNode.value;
      updated.push(updatedNode.value);
      changedStore = true;
    }

    if (request.markRefs && request.markRefs.length > 0) {
      const markers = markRefs(
        frame,
        unique(request.markRefs),
        "memorized",
        node.id,
        options,
      );
      memorized.push(...markers);
      changedFrame = changedFrame || markers.length > 0;
    }

    if (request.loadSlot) {
      const slot = loadMemorySlot(
        store,
        request.loadSlot,
        [node.id],
        request.loadMode ?? "append",
      );
      if (slot.status !== "ok") return invalidResult(slot.message);
      loaded.push(slot.value);
      changedStore = true;
    }
  }

  if (discardRefs.length > 0) {
    const markers = markRefs(frame, discardRefs, "discarded", undefined, options);
    discarded.push(...markers);
    changedFrame = changedFrame || markers.length > 0;
  }

  for (const request of loadSlots) {
    const slot = loadMemorySlot(
      store,
      request.slot,
      unique(request.nodeIds),
      request.mode ?? "replace",
    );
    if (slot.status !== "ok") return invalidResult(slot.message);
    loaded.push(slot.value);
    changedStore = true;
  }

  if (changedStore) store.version += 1;
  if (changedFrame) {
    frame.version += 1;
    frame.updatedAt = options.timestamp;
  }

  return {
    status: "ok",
    action: "memory_maintain_context",
    created,
    updated,
    memorized,
    discarded,
    loaded,
    skipped: [],
    changedStore,
    changedFrame,
  };
}

export function buildMemoryMaintenancePrompt(
  frame: ContextFrameStore,
  options: {
    storeVersion?: number;
    maxRefs?: number;
  } = {},
): string | null {
  const workspace = frame.lastWorkspace;
  if (workspace.pressure === "normal") return null;

  const refs = workspace.refs.filter((ref) => ref.latestUserMessage !== true);
  const candidates = (refs.length > 0 ? refs : workspace.refs).slice(
    0,
    options.maxRefs ?? 5,
  );

  return [
    "<memory_arbor_maintenance>",
    `status: ${workspace.pressure}`,
    `temporaryTokens: ${workspace.tokenEstimate}/${workspace.maxTokens}`,
    `frameVersion: ${frame.version}`,
    options.storeVersion === undefined
      ? ""
      : `memoryStoreVersion: ${options.storeVersion}`,
    "Use memory_apply before answering if older temporary refs should be preserved or cleared.",
    "For useful older refs, create or update memory nodes and include those refs in markRefs.",
    "For useless older refs, include them in discardRefs.",
    "Do not mark the latest user message unless the user explicitly asks.",
    ...candidates.map((ref) => {
      return `<candidate_ref ref="${escapeXml(ref.ref)}" role="${escapeXml(ref.role ?? "")}" tokenEstimate="${ref.tokenEstimate}">${escapeXml(ref.preview)}</candidate_ref>`;
    }),
    "</memory_arbor_maintenance>",
  ].filter(Boolean).join("\n");
}

function validateMaintainInput(
  store: MemoryStore,
  frame: ContextFrameStore,
  createNodes: MaintainCreateNodeInput[],
  updateNodes: MaintainUpdateNodeInput[],
  discardRefs: string[],
  loadSlots: MaintainLoadSlotInput[],
): string | null {
  if (
    createNodes.length === 0 &&
    updateNodes.length === 0 &&
    discardRefs.length === 0 &&
    loadSlots.length === 0
  ) {
    return "At least one maintenance action is required.";
  }

  const refOwners = new Map<string, string>();
  const addRefs = (refs: string[] | undefined, owner: string): string | null => {
    for (const ref of unique(refs ?? [])) {
      const parsed = parseContextRef(ref);
      if (!parsed) return `Invalid temporary ref '${ref}'.`;
      if (!workspaceHasRef(frame, ref)) {
        return `Temporary ref '${ref}' was not found in the last workspace.`;
      }
      const previous = refOwners.get(ref);
      if (previous && previous !== owner) {
        return `Temporary ref '${ref}' is assigned to multiple maintenance actions.`;
      }
      refOwners.set(ref, owner);
    }
    return null;
  };

  for (let index = 0; index < createNodes.length; index += 1) {
    const request = createNodes[index];
    if (request.parentId && !activeNode(store, request.parentId)) {
      return `Active parent node '${request.parentId}' was not found.`;
    }
    if (request.loadSlot && !slotByName(store, request.loadSlot)) {
      return `Slot '${request.loadSlot}' was not found.`;
    }
    if (request.loadSlot) {
      const slot = slotByName(store, request.loadSlot);
      const parentId = request.parentId ?? DEFAULT_ROOT_NODE_ID;
      if (slot && !isDescendantOrSelf(store, slot.rootNodeId, parentId)) {
        return `Created memory node would be outside slot '${request.loadSlot}'.`;
      }
    }
    const invalidRefs = addRefs(request.markRefs, `create:${index}`);
    if (invalidRefs) return invalidRefs;
  }

  for (const request of updateNodes) {
    const node = activeNode(store, request.id);
    if (!node) return `Active memory node '${request.id}' was not found.`;
    if (request.loadSlot && !slotByName(store, request.loadSlot)) {
      return `Slot '${request.loadSlot}' was not found.`;
    }
    if (request.loadSlot) {
      const slot = slotByName(store, request.loadSlot);
      if (slot && !isDescendantOrSelf(store, slot.rootNodeId, request.id)) {
        return `Active memory node '${request.id}' is outside slot '${request.loadSlot}'.`;
      }
    }
    const invalidRefs = addRefs(request.markRefs, `update:${request.id}`);
    if (invalidRefs) return invalidRefs;
  }

  const invalidDiscardRefs = addRefs(discardRefs, "discard");
  if (invalidDiscardRefs) return invalidDiscardRefs;

  for (const request of loadSlots) {
    const slot = slotByName(store, request.slot);
    if (!slot) return `Slot '${request.slot}' was not found.`;
    for (const nodeId of unique(request.nodeIds)) {
      const node = activeNode(store, nodeId);
      if (!node) return `Active memory node '${nodeId}' was not found.`;
      if (!isDescendantOrSelf(store, slot.rootNodeId, nodeId)) {
        return `Active memory node '${nodeId}' is outside slot '${request.slot}'.`;
      }
    }
  }

  return null;
}

function markRefs(
  frame: ContextFrameStore,
  refs: string[],
  status: ContextMarkerStatus,
  nodeId: string | undefined,
  options: {
    markerId: () => string;
    timestamp: string;
  },
): ContextMarker[] {
  const markers: ContextMarker[] = refs.map((ref) => {
    const parsed = parseContextRef(ref);
    if (!parsed) throw new Error(`Invalid temporary ref '${ref}'.`);
    return {
      id: options.markerId(),
      sourceKey: parsed.sourceKey,
      status,
      nodeId,
      range: parsed.range,
      createdAt: options.timestamp,
      updatedAt: options.timestamp,
    };
  });

  frame.markers = frame.markers.filter(
    (marker) => !markers.some((created) => sameContextTarget(marker, created)),
  );
  frame.markers.push(...markers);
  return markers;
}

function invalidResult(message: string): MaintainContextResult {
  return {
    status: "invalid",
    action: "memory_maintain_context",
    message,
    changedStore: false,
    changedFrame: false,
  };
}

function hasUpdateFields(input: MaintainUpdateNodeInput): boolean {
  return (
    input.title !== undefined ||
    input.summary !== undefined ||
    input.content !== undefined ||
    input.tags !== undefined ||
    input.nodeKind !== undefined ||
    input.sourceRefs !== undefined
  );
}

function workspaceHasRef(frame: ContextFrameStore, ref: string): boolean {
  return frame.lastWorkspace.refs.some((candidate) => candidate.ref === ref);
}

function activeNode(store: MemoryStore, nodeId: string): MemoryNode | undefined {
  return store.nodes.find((node) => node.id === nodeId && node.status === "active");
}

function slotByName(store: MemoryStore, slotName: string): MemorySlot | undefined {
  return store.slots.find((slot) => slot.name === slotName);
}

function isDescendantOrSelf(
  store: MemoryStore,
  rootNodeId: string,
  targetNodeId: string,
): boolean {
  return collectDescendantIds(store, rootNodeId, true).includes(targetNodeId);
}

function collectDescendantIds(
  store: MemoryStore,
  nodeId: string,
  includeSelf: boolean,
): string[] {
  const result: string[] = includeSelf ? [nodeId] : [];
  const pending = [nodeId];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const currentId = pending.pop();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    const node = store.nodes.find((candidate) => candidate.id === currentId);
    if (!node) continue;
    for (const childId of node.childIds) {
      result.push(childId);
      pending.push(childId);
    }
  }

  return [...new Set(result)];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
