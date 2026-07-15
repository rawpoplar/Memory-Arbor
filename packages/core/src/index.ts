export const DEFAULT_ROOT_NODE_ID = "root"

export const DEFAULT_SLOT_CONFIGS = [
  {
    name: "memory_profile",
    purpose: "Stable user preferences and long-lived working rules.",
    rootNodeId: DEFAULT_ROOT_NODE_ID,
    maxTokens: 3000,
  },
  {
    name: "project_context",
    purpose: "Project facts, paths, boundaries, and implementation notes.",
    rootNodeId: DEFAULT_ROOT_NODE_ID,
    maxTokens: 5000,
  },
  {
    name: "task_state",
    purpose: "Current task goal, progress, and next action.",
    rootNodeId: DEFAULT_ROOT_NODE_ID,
    maxTokens: 4000,
  },
  {
    name: "working_context",
    purpose: "Temporary context useful for the next response.",
    rootNodeId: DEFAULT_ROOT_NODE_ID,
    maxTokens: 4000,
  },
] as const

export type MemoryNodeStatus = "active" | "archived"
export type MemoryNodeKind = "root" | "branch" | "leaf"

export type MemoryNode = {
  id: string
  title: string
  summary: string
  content: string
  tags: string[]
  status: MemoryNodeStatus
  nodeKind: MemoryNodeKind
  parentId: string | null
  childIds: string[]
  sourceRefs: string[]
  tokenEstimate: number
  version: number
  createdAt: string
  updatedAt: string
}

export type MemorySlot = {
  name: string
  purpose: string
  rootNodeId: string
  maxTokens: number
  loadedNodeIds: string[]
}

export type MemoryStore = {
  nodes: MemoryNode[]
  slots: MemorySlot[]
  version: number
}

export type MemorySlotConfig = {
  name: string
  purpose: string
  rootNodeId: string
  maxTokens: number
}

export type MemoryConfig = {
  slots: MemorySlotConfig[]
  injection: {
    maxMemoryTokens: number
  }
  temporaryWorkspace: {
    maxTokens: number
    pressureRatio: number
  }
}

export type MemoryNodeView = {
  node: MemoryNode
  treePath: string
  breadcrumb: Array<{
    id: string
    title: string
  }>
  childDirectory: Array<{
    id: string
    title: string
    summary: string
    nodeKind: MemoryNodeKind
    status: MemoryNodeStatus
  }>
}

export type MemorySearchResult = {
  id: string
  title: string
  summary: string
  treePath: string
  tags: string[]
  tokenEstimate: number
}

export type MemorySlotView = {
  name: string
  purpose: string
  rootNodeId: string
  maxTokens: number
  usedTokens: number
  remainingTokens: number
  nodes: Array<{
    id: string
    title: string
    summary: string
    treePath: string
    tokenEstimate: number
  }>
}

export type MemoryInjectionView = {
  version: number
  maxMemoryTokens: number
  usedTokens: number
  truncated: boolean
  slots: Array<
    MemorySlotView & {
      nodes: Array<{
        id: string
        title: string
        summary: string
        content: string
        treePath: string
        tags: string[]
        tokenEstimate: number
        version: number
      }>
    }
  >
}

export type MemoryCreateNodeInput = {
  title: string
  summary?: string
  content?: string
  tags?: string[]
  parentId?: string | null
  nodeKind?: MemoryNodeKind
  sourceRefs?: string[]
}

export type MemoryUpdateNodeInput = Partial<
  Pick<MemoryNode, "title" | "summary" | "content" | "tags" | "nodeKind" | "sourceRefs">
>

export type MemoryMutationResult<T> =
  | {
      status: "ok"
      changed: true
      value: T
    }
  | {
      status: "not_found" | "invalid"
      changed: false
      message: string
    }

export function defaultMemoryConfig(): MemoryConfig {
  return {
    slots: DEFAULT_SLOT_CONFIGS.map((slot) => ({ ...slot })),
    injection: {
      maxMemoryTokens: 12000,
    },
    temporaryWorkspace: {
      maxTokens: 8000,
      pressureRatio: 0.8,
    },
  }
}

export function normalizeMemoryConfig(value: unknown): MemoryConfig {
  if (!value || typeof value !== "object") return defaultMemoryConfig()

  const input = value as Partial<MemoryConfig>
  const defaultConfig = defaultMemoryConfig()
  const slots = Array.isArray(input.slots)
    ? input.slots.filter((slot): slot is MemorySlotConfig => {
        if (!slot || typeof slot !== "object") return false
        const candidate = slot as Partial<MemorySlotConfig>
        return (
          typeof candidate.name === "string" &&
          typeof candidate.purpose === "string" &&
          typeof candidate.rootNodeId === "string" &&
          typeof candidate.maxTokens === "number" &&
          Number.isFinite(candidate.maxTokens) &&
          candidate.maxTokens > 0
        )
      })
    : defaultConfig.slots

  return {
    slots: slots.length > 0 ? slots : defaultConfig.slots,
    injection: {
      maxMemoryTokens:
        typeof input.injection?.maxMemoryTokens === "number" &&
        Number.isFinite(input.injection.maxMemoryTokens) &&
        input.injection.maxMemoryTokens > 0
          ? input.injection.maxMemoryTokens
          : defaultConfig.injection.maxMemoryTokens,
    },
    temporaryWorkspace: {
      maxTokens:
        typeof input.temporaryWorkspace?.maxTokens === "number" &&
        Number.isFinite(input.temporaryWorkspace.maxTokens) &&
        input.temporaryWorkspace.maxTokens > 0
          ? input.temporaryWorkspace.maxTokens
          : defaultConfig.temporaryWorkspace.maxTokens,
      pressureRatio:
        typeof input.temporaryWorkspace?.pressureRatio === "number" &&
        Number.isFinite(input.temporaryWorkspace.pressureRatio) &&
        input.temporaryWorkspace.pressureRatio > 0 &&
        input.temporaryWorkspace.pressureRatio <= 1
          ? input.temporaryWorkspace.pressureRatio
          : defaultConfig.temporaryWorkspace.pressureRatio,
    },
  }
}

export function createEmptyMemoryStore(config = defaultMemoryConfig(), timestamp = nowIso()): MemoryStore {
  const root = createRootNode(timestamp)
  return {
    nodes: [root],
    slots: config.slots.map((slot) => ({
      ...slot,
      loadedNodeIds: [],
    })),
    version: 0,
  }
}

export function normalizeMemoryStore(value: unknown, config = defaultMemoryConfig()): MemoryStore {
  if (!value || typeof value !== "object") return createEmptyMemoryStore(config)

  const input = value as Partial<MemoryStore>
  const nodes = Array.isArray(input.nodes) ? input.nodes.filter(isMemoryNode) : []
  const store: MemoryStore = {
    nodes: nodes.length > 0 ? nodes : [createRootNode(nowIso())],
    slots: Array.isArray(input.slots) ? input.slots.filter(isMemorySlot) : [],
    version: Number.isInteger(input.version) ? Number(input.version) : 0,
  }

  ensureRootNode(store)
  reconcileChildren(store)
  reconcileSlots(store, config)
  return store
}

export function createMemoryNode(
  store: MemoryStore,
  input: MemoryCreateNodeInput,
  options: {
    id: string
    timestamp?: string
  },
): MemoryMutationResult<MemoryNode> {
  const timestamp = options.timestamp ?? nowIso()
  const parentId = input.parentId === undefined ? DEFAULT_ROOT_NODE_ID : input.parentId
  if (parentId !== null && !findActiveNode(store, parentId)) {
    return {
      status: "not_found",
      changed: false,
      message: `Parent node '${parentId}' was not found.`,
    }
  }
  if (store.nodes.some((node) => node.id === options.id)) {
    return {
      status: "invalid",
      changed: false,
      message: `Node id '${options.id}' already exists.`,
    }
  }

  const summary = input.summary ?? summarize(input.content ?? input.title)
  const content = input.content ?? summary
  const node: MemoryNode = {
    id: options.id,
    title: input.title,
    summary,
    content,
    tags: input.tags ?? [],
    status: "active",
    nodeKind: input.nodeKind ?? (parentId === null ? "root" : "leaf"),
    parentId,
    childIds: [],
    sourceRefs: input.sourceRefs ?? [],
    tokenEstimate: estimateTokens([input.title, summary, content].join("\n")),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  store.nodes.push(node)
  if (parentId !== null) {
    const parent = store.nodes.find((candidate) => candidate.id === parentId)
    if (parent && !parent.childIds.includes(node.id)) parent.childIds.push(node.id)
  }

  return {
    status: "ok",
    changed: true,
    value: node,
  }
}

export function searchMemoryNodes(
  store: MemoryStore,
  query = "",
  filters: {
    tag?: string
    status?: MemoryNodeStatus
    limit?: number
  } = {},
): MemorySearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()
  const status = filters.status ?? "active"
  const limit = filters.limit ?? 10

  return store.nodes
    .filter((node) => node.status === status)
    .filter((node) => !filters.tag || node.tags.includes(filters.tag))
    .filter((node) => {
      if (!normalizedQuery) return true
      return [node.title, node.summary, node.content, node.tags.join(" ")]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery)
    })
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      title: node.title,
      summary: node.summary,
      treePath: buildTreePath(store, node.id),
      tags: node.tags,
      tokenEstimate: node.tokenEstimate,
    }))
}

export function openMemoryNode(store: MemoryStore, nodeId: string): MemoryNodeView | null {
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return null
  const breadcrumb = buildBreadcrumb(store, nodeId)
  const childDirectory = node.childIds
    .map((childId) => store.nodes.find((candidate) => candidate.id === childId))
    .filter((child): child is MemoryNode => child !== undefined)
    .map((child) => ({
      id: child.id,
      title: child.title,
      summary: child.summary,
      nodeKind: child.nodeKind,
      status: child.status,
    }))

  return {
    node,
    treePath: "/" + breadcrumb.map((item) => pathSegment(item.title)).join("/"),
    breadcrumb,
    childDirectory,
  }
}

export function updateMemoryNode(
  store: MemoryStore,
  nodeId: string,
  input: MemoryUpdateNodeInput,
  timestamp = nowIso(),
): MemoryMutationResult<MemoryNode> {
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    return {
      status: "not_found",
      changed: false,
      message: `Node '${nodeId}' was not found.`,
    }
  }

  if (input.title !== undefined) node.title = input.title
  if (input.summary !== undefined) node.summary = input.summary
  if (input.content !== undefined) node.content = input.content
  if (input.tags !== undefined) node.tags = input.tags
  if (input.nodeKind !== undefined) node.nodeKind = input.nodeKind
  if (input.sourceRefs !== undefined) node.sourceRefs = input.sourceRefs
  node.tokenEstimate = estimateTokens([node.title, node.summary, node.content].join("\n"))
  node.version += 1
  node.updatedAt = timestamp

  return {
    status: "ok",
    changed: true,
    value: node,
  }
}

export function archiveMemoryNode(
  store: MemoryStore,
  nodeId: string,
  timestamp = nowIso(),
): MemoryMutationResult<{ archivedNodeIds: string[] }> {
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    return {
      status: "not_found",
      changed: false,
      message: `Node '${nodeId}' was not found.`,
    }
  }

  const archivedNodeIds = collectDescendantIds(store, nodeId, true)
  for (const archivedId of archivedNodeIds) {
    const archived = store.nodes.find((candidate) => candidate.id === archivedId)
    if (!archived) continue
    archived.status = "archived"
    archived.version += 1
    archived.updatedAt = timestamp
  }
  for (const slot of store.slots) {
    slot.loadedNodeIds = slot.loadedNodeIds.filter((loadedId) => !archivedNodeIds.includes(loadedId))
  }

  return {
    status: "ok",
    changed: true,
    value: { archivedNodeIds },
  }
}

export function moveMemoryNode(
  store: MemoryStore,
  nodeId: string,
  newParentId: string | null,
  timestamp = nowIso(),
): MemoryMutationResult<MemoryNode> {
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    return {
      status: "not_found",
      changed: false,
      message: `Node '${nodeId}' was not found.`,
    }
  }
  if (nodeId === DEFAULT_ROOT_NODE_ID) {
    return {
      status: "invalid",
      changed: false,
      message: "The default root node cannot be moved.",
    }
  }
  if (newParentId !== null && !findActiveNode(store, newParentId)) {
    return {
      status: "not_found",
      changed: false,
      message: `New parent '${newParentId}' was not found.`,
    }
  }
  if (newParentId !== null && collectDescendantIds(store, nodeId, true).includes(newParentId)) {
    return {
      status: "invalid",
      changed: false,
      message: "Cannot move a node under itself or one of its descendants.",
    }
  }

  if (node.parentId !== null) {
    const oldParent = store.nodes.find((candidate) => candidate.id === node.parentId)
    if (oldParent) oldParent.childIds = oldParent.childIds.filter((childId) => childId !== node.id)
  }
  node.parentId = newParentId
  if (newParentId !== null) {
    const newParent = store.nodes.find((candidate) => candidate.id === newParentId)
    if (newParent && !newParent.childIds.includes(node.id)) newParent.childIds.push(node.id)
  }
  node.version += 1
  node.updatedAt = timestamp

  return {
    status: "ok",
    changed: true,
    value: node,
  }
}

export function loadMemorySlot(
  store: MemoryStore,
  slotName: string,
  nodeIds: string[],
  mode: "replace" | "append" = "replace",
): MemoryMutationResult<MemorySlot> {
  const slot = store.slots.find((candidate) => candidate.name === slotName)
  if (!slot) {
    return {
      status: "not_found",
      changed: false,
      message: `Slot '${slotName}' was not found.`,
    }
  }

  const uniqueIds = [...new Set(nodeIds)]
  const validIds = uniqueIds.filter((nodeId) => {
    const node = findActiveNode(store, nodeId)
    return node !== undefined && isDescendantOrSelf(store, slot.rootNodeId, node.id)
  })

  if (mode === "append") {
    slot.loadedNodeIds = [...new Set([...slot.loadedNodeIds, ...validIds])]
  } else {
    slot.loadedNodeIds = validIds
  }

  return {
    status: "ok",
    changed: true,
    value: slot,
  }
}

export function readMemorySlots(store: MemoryStore): MemorySlotView[] {
  return store.slots.map((slot) => {
    const nodes = loadedActiveNodes(store, slot)
    const usedTokens = sumTokens(nodes)
    return {
      name: slot.name,
      purpose: slot.purpose,
      rootNodeId: slot.rootNodeId,
      maxTokens: slot.maxTokens,
      usedTokens,
      remainingTokens: Math.max(0, slot.maxTokens - usedTokens),
      nodes: nodes.map((node) => ({
        id: node.id,
        title: node.title,
        summary: node.summary,
        treePath: buildTreePath(store, node.id),
        tokenEstimate: node.tokenEstimate,
      })),
    }
  })
}

export function buildMemoryInjectionView(store: MemoryStore, config = defaultMemoryConfig()): MemoryInjectionView {
  let usedTokens = 0
  let truncated = false
  const slots: MemoryInjectionView["slots"] = []

  for (const slot of readMemorySlots(store)) {
    const nodes = []
    for (const slotNode of slot.nodes) {
      const node = findActiveNode(store, slotNode.id)
      if (!node) continue
      if (usedTokens + node.tokenEstimate > config.injection.maxMemoryTokens) {
        truncated = true
        continue
      }
      usedTokens += node.tokenEstimate
      nodes.push({
        id: node.id,
        title: node.title,
        summary: node.summary,
        content: node.content,
        treePath: buildTreePath(store, node.id),
        tags: node.tags,
        tokenEstimate: node.tokenEstimate,
        version: node.version,
      })
    }
    slots.push({
      ...slot,
      nodes,
    })
  }

  return {
    version: store.version,
    maxMemoryTokens: config.injection.maxMemoryTokens,
    usedTokens,
    truncated,
    slots,
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function createRootNode(timestamp: string): MemoryNode {
  return {
    id: DEFAULT_ROOT_NODE_ID,
    title: "Memory Root",
    summary: "Root node for Memory Arbor.",
    content: "Root node for Memory Arbor.",
    tags: [],
    status: "active",
    nodeKind: "root",
    parentId: null,
    childIds: [],
    sourceRefs: [],
    tokenEstimate: estimateTokens("Memory Root\nRoot node for Memory Arbor."),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function isMemoryNode(value: unknown): value is MemoryNode {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<MemoryNode>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.content === "string" &&
    Array.isArray(candidate.tags) &&
    (candidate.status === "active" || candidate.status === "archived") &&
    (candidate.nodeKind === "root" || candidate.nodeKind === "branch" || candidate.nodeKind === "leaf") &&
    (typeof candidate.parentId === "string" || candidate.parentId === null) &&
    Array.isArray(candidate.childIds) &&
    Array.isArray(candidate.sourceRefs) &&
    typeof candidate.tokenEstimate === "number" &&
    Number.isFinite(candidate.tokenEstimate) &&
    typeof candidate.version === "number" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  )
}

function isMemorySlot(value: unknown): value is MemorySlot {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<MemorySlot>
  return (
    typeof candidate.name === "string" &&
    typeof candidate.purpose === "string" &&
    typeof candidate.rootNodeId === "string" &&
    typeof candidate.maxTokens === "number" &&
    Number.isFinite(candidate.maxTokens) &&
    candidate.maxTokens > 0 &&
    Array.isArray(candidate.loadedNodeIds)
  )
}

function ensureRootNode(store: MemoryStore): void {
  if (!store.nodes.some((node) => node.id === DEFAULT_ROOT_NODE_ID)) {
    store.nodes.unshift(createRootNode(nowIso()))
  }
}

function reconcileChildren(store: MemoryStore): void {
  const existingIds = new Set(store.nodes.map((node) => node.id))
  for (const node of store.nodes) {
    node.childIds = node.childIds.filter((childId) => existingIds.has(childId))
  }
  for (const node of store.nodes) {
    if (node.parentId === null || !existingIds.has(node.parentId)) continue
    const parent = store.nodes.find((candidate) => candidate.id === node.parentId)
    if (parent && !parent.childIds.includes(node.id)) parent.childIds.push(node.id)
  }
}

function reconcileSlots(store: MemoryStore, config: MemoryConfig): void {
  const existingSlots = new Map(store.slots.map((slot) => [slot.name, slot]))
  store.slots = config.slots.map((slotConfig) => {
    const existing = existingSlots.get(slotConfig.name)
    return {
      ...slotConfig,
      loadedNodeIds: existing?.loadedNodeIds.filter((nodeId) => findActiveNode(store, nodeId)) ?? [],
    }
  })
}

function findActiveNode(store: MemoryStore, nodeId: string): MemoryNode | undefined {
  return store.nodes.find((node) => node.id === nodeId && node.status === "active")
}

function loadedActiveNodes(store: MemoryStore, slot: MemorySlot): MemoryNode[] {
  return slot.loadedNodeIds
    .map((nodeId) => findActiveNode(store, nodeId))
    .filter((node): node is MemoryNode => node !== undefined)
}

function buildBreadcrumb(store: MemoryStore, nodeId: string): Array<{ id: string; title: string }> {
  const breadcrumb: Array<{ id: string; title: string }> = []
  let current = store.nodes.find((node) => node.id === nodeId)
  const seen = new Set<string>()

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    breadcrumb.push({
      id: current.id,
      title: current.title,
    })
    current = current.parentId === null ? undefined : store.nodes.find((node) => node.id === current?.parentId)
  }

  return breadcrumb.reverse()
}

function buildTreePath(store: MemoryStore, nodeId: string): string {
  const breadcrumb = buildBreadcrumb(store, nodeId)
  return "/" + breadcrumb.map((item) => pathSegment(item.title)).join("/")
}

function collectDescendantIds(store: MemoryStore, nodeId: string, includeSelf: boolean): string[] {
  const result: string[] = includeSelf ? [nodeId] : []
  const pending = [nodeId]
  const seen = new Set<string>()

  while (pending.length > 0) {
    const currentId = pending.pop()
    if (!currentId || seen.has(currentId)) continue
    seen.add(currentId)
    const node = store.nodes.find((candidate) => candidate.id === currentId)
    if (!node) continue
    for (const childId of node.childIds) {
      result.push(childId)
      pending.push(childId)
    }
  }

  return [...new Set(result)]
}

function isDescendantOrSelf(store: MemoryStore, rootNodeId: string, targetNodeId: string): boolean {
  return collectDescendantIds(store, rootNodeId, true).includes(targetNodeId)
}

function sumTokens(nodes: MemoryNode[]): number {
  return nodes.reduce((sum, node) => sum + node.tokenEstimate, 0)
}

function pathSegment(value: string): string {
  return value.trim().replaceAll("/", "-") || "untitled"
}

function summarize(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}

function nowIso(): string {
  return new Date().toISOString()
}
