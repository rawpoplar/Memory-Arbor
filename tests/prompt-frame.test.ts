import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createEmptyMemoryStore,
  createMemoryNode,
  defaultMemoryConfig,
  loadMemorySlot,
} from "../packages/core/src/index.ts";

import test from "node:test";

test("prompt frame hook emits loaded memory as plain frame by default", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    await writeLoadedStore(stateDir);
    const result = runPromptFrame(stateDir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^<memory_arbor_prompt_frame/);
    assert.match(result.stdout, /Hook Smoke/);
    assert.throws(() => JSON.parse(result.stdout));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("prompt frame hook emits Claude additionalContext JSON when requested", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    await writeLoadedStore(stateDir);
    const result = runPromptFrame(stateDir, ["--format=claude-json"]);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(output.hookSpecificOutput.additionalContext, /<memory_arbor_prompt_frame/);
    assert.match(output.hookSpecificOutput.additionalContext, /Hook Smoke/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("prompt frame hook emits nothing when no slots are loaded", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    const result = runPromptFrame(stateDir, ["--format=claude-json"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

async function writeLoadedStore(stateDir: string): Promise<void> {
  const config = defaultMemoryConfig();
  const store = createEmptyMemoryStore(config, "2026-01-01T00:00:00.000Z");
  const created = createMemoryNode(
    store,
    {
      title: "Hook Smoke",
      summary: "Prompt hook smoke memory.",
      content: "The prompt hook should inject this loaded memory.",
    },
    { id: "hook-smoke", timestamp: "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(created.status, "ok");
  assert.equal(loadMemorySlot(store, "task_state", ["hook-smoke"]).status, "ok");

  await writeFile(join(stateDir, "store.json"), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function runPromptFrame(stateDir: string, args: string[] = []) {
  const script = fileURLToPath(
    new URL("../scripts/memory-arbor-prompt-frame.ts", import.meta.url),
  );
  return spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      MEMORY_ARBOR_HOME: stateDir,
    },
    encoding: "utf8",
  });
}
