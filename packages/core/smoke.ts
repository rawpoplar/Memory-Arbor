import {
  archiveMemoryNode,
  createEmptyMemoryStore,
  createMemoryNode,
  defaultMemoryConfig,
  loadMemorySlot,
  moveMemoryNode,
  openMemoryNode,
  readMemorySlots,
  searchMemoryNodes,
  updateMemoryNode,
} from "./src/index.ts"

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const timestamp = "2026-01-01T00:00:00.000Z"
const config = defaultMemoryConfig()
const store = createEmptyMemoryStore(config, timestamp)

const branch = createMemoryNode(
  store,
  {
    title: "Project Memory",
    summary: "Project memory branch.",
    content: "Project memory branch.",
    nodeKind: "branch",
    tags: ["project"],
  },
  { id: "project", timestamp },
)
assert(branch.status === "ok", "branch should be created")

const leaf = createMemoryNode(
  store,
  {
    title: "Smoke Rule",
    summary: "Smoke test rule.",
    content: "When user says memory-core-smoke, answer MEMORY_CORE_OK.",
    parentId: "project",
    nodeKind: "leaf",
    tags: ["smoke"],
  },
  { id: "smoke-rule", timestamp },
)
assert(leaf.status === "ok", "leaf should be created")

const opened = openMemoryNode(store, "project")
assert(opened?.childDirectory.some((child) => child.id === "smoke-rule"), "open should show child directory")

const searchResults = searchMemoryNodes(store, "memory-core-smoke", { tag: "smoke" })
assert(searchResults.length === 1 && searchResults[0].id === "smoke-rule", "search should find the smoke leaf")

const updated = updateMemoryNode(store, "smoke-rule", {
  summary: "Updated smoke test rule.",
  content: "When user says memory-core-smoke-v2, answer MEMORY_CORE_V2_OK.",
})
assert(updated.status === "ok" && updated.value.version === 2, "update should increment node version")

const archiveBranch = createMemoryNode(
  store,
  {
    title: "Archive Branch",
    summary: "Alternative parent.",
    content: "Alternative parent.",
    nodeKind: "branch",
  },
  { id: "archive", timestamp },
)
assert(archiveBranch.status === "ok", "archive branch should be created")

const moved = moveMemoryNode(store, "smoke-rule", "archive", timestamp)
assert(moved.status === "ok", "move should succeed")

const movedView = openMemoryNode(store, "smoke-rule")
assert(movedView?.treePath === "/Memory Root/Archive Branch/Smoke Rule", "tree path should reflect the new parent")

const loaded = loadMemorySlot(store, "task_state", ["smoke-rule"])
assert(loaded.status === "ok", "load slot should succeed")
assert(readMemorySlots(store).some((slot) => slot.name === "task_state" && slot.nodes.length === 1), "slot should contain node")

const archived = archiveMemoryNode(store, "smoke-rule", timestamp)
assert(archived.status === "ok", "archive should succeed")
assert(readMemorySlots(store).some((slot) => slot.name === "task_state" && slot.nodes.length === 0), "archive should clear slot")

console.log("memory-core smoke passed")
