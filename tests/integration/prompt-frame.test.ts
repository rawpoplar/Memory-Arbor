import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createEmptyMemoryStore,
  createMemoryNode,
  defaultMemoryConfig,
  loadMemorySlot,
} from "../../packages/core/src/index.ts";

import test from "node:test";

test("Codex plugin bundle emits loaded memory as a plain frame", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    await writeLoadedStore(stateDir);
    const result = runPluginHook("codex", stateDir);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^<memory_arbor_prompt_frame/);
    assert.match(result.stdout, /Hook Smoke/);
    assert.throws(() => JSON.parse(result.stdout));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("Claude Code plugin bundle emits additionalContext JSON", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    await writeLoadedStore(stateDir);
    const result = runPluginHook("claude-code", stateDir, ["--format=claude-json"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(output.hookSpecificOutput.additionalContext, /<memory_arbor_prompt_frame/);
    assert.match(output.hookSpecificOutput.additionalContext, /Hook Smoke/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("plugin bundles emit nothing when no slots are loaded", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    for (const host of ["claude-code", "codex"] as const) {
      const result = runPluginHook(host, stateDir, ["--format=claude-json"]);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "");
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("plugin bundles include YAML configuration support", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-test-"));
  try {
    await writeLoadedStore(stateDir);
    await writeFile(join(stateDir, "config.yaml"), "injection:\n  maxMemoryTokens: 900\n", "utf8");
    const result = runPluginHook("codex", stateDir);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /memoryTokens: \d+\/900/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("Codex plugin bundle runs after being copied outside the repository", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "memory-arbor-state-"));
  const pluginDir = await mkdtemp(join(tmpdir(), "memory-arbor-plugin-"));
  try {
    await writeLoadedStore(stateDir);
    await writeFile(join(stateDir, "config.yaml"), "injection:\n  maxMemoryTokens: 900\n", "utf8");
    const bundle = fileURLToPath(
      new URL("../../plugins/codex/scripts/memory-arbor-prompt-frame.mjs", import.meta.url),
    );
    const copiedBundle = join(pluginDir, "memory-arbor-prompt-frame.mjs");
    await copyFile(bundle, copiedBundle);
    const result = runHook(copiedBundle, stateDir, pluginDir);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /memoryTokens: \d+\/900/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(pluginDir, { recursive: true, force: true });
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

function runPluginHook(
  host: "claude-code" | "codex",
  stateDir: string,
  args: string[] = [],
) {
  const script = fileURLToPath(
    new URL(`../../plugins/${host}/scripts/memory-arbor-prompt-frame.mjs`, import.meta.url),
  );
  return runHook(script, stateDir, fileURLToPath(new URL("../..", import.meta.url)), args);
}

function runHook(script: string, stateDir: string, cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: {
      ...process.env,
      MEMORY_ARBOR_HOME: stateDir,
    },
    encoding: "utf8",
  });
}
