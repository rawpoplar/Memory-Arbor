import assert from "node:assert/strict";
import test from "node:test";
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
} from "../../packages/core/src/index.ts";

test("memory core supports tree operations, search, slots, and archive cleanup", () => {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const config = defaultMemoryConfig();
  const store = createEmptyMemoryStore(config, timestamp);

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
  );
  assert.equal(branch.status, "ok");

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
  );
  assert.equal(leaf.status, "ok");

  const opened = openMemoryNode(store, "project");
  assert.ok(
    opened?.childDirectory.some((child) => child.id === "smoke-rule"),
  );

  const searchResults = searchMemoryNodes(store, "memory-core-smoke", {
    tag: "smoke",
  });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, "smoke-rule");

  const updated = updateMemoryNode(store, "smoke-rule", {
    summary: "Updated smoke test rule.",
    content: "When user says memory-core-smoke-v2, answer MEMORY_CORE_V2_OK.",
  });
  assert.equal(updated.status, "ok");
  assert.equal(updated.status === "ok" ? updated.value.version : 0, 2);

  const archiveBranch = createMemoryNode(
    store,
    {
      title: "Archive Branch",
      summary: "Alternative parent.",
      content: "Alternative parent.",
      nodeKind: "branch",
    },
    { id: "archive", timestamp },
  );
  assert.equal(archiveBranch.status, "ok");

  const moved = moveMemoryNode(store, "smoke-rule", "archive", timestamp);
  assert.equal(moved.status, "ok");

  const movedView = openMemoryNode(store, "smoke-rule");
  assert.equal(
    movedView?.treePath,
    "/Memory Root/Archive Branch/Smoke Rule",
  );

  const loaded = loadMemorySlot(store, "task_state", ["smoke-rule"]);
  assert.equal(loaded.status, "ok");
  assert.ok(
    readMemorySlots(store).some(
      (slot) => slot.name === "task_state" && slot.nodes.length === 1,
    ),
  );

  const archived = archiveMemoryNode(store, "smoke-rule", timestamp);
  assert.equal(archived.status, "ok");
  assert.ok(
    readMemorySlots(store).some(
      (slot) => slot.name === "task_state" && slot.nodes.length === 0,
    ),
  );
});
