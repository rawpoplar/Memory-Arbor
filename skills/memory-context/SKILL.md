---
name: memory-context
description: Use Memory Arbor context when it is injected by the host adapter; use the four high-level memory tools only when the current host exposes them.
---

# Memory Context

Memory Arbor may expose the four high-level tools. Do not assume a new session has loaded memory.

Call `memory_status` when loaded memory is relevant. Its `memoryProjection` is the session snapshot. Treat later `<memory_arbor_prompt_delta>` frames as cumulative updates to that snapshot.

## Tools

Only follow this section when the current session actually exposes all four high-level tools.

- Use `memory_query` to search memory and, when needed, expand selected results with `openIds`.
- Use `memory_apply` to create or update nodes, mark useful refs as memorized, discard useless refs, and load slots.
- Use `memory_status` to inspect loaded slots, the context frame, temporary workspace pressure, versions, and explicitly load the memory projection when needed.
- Use `memory_admin` only for low-frequency repairs: archive, move, or unmark.

## Slots

Default slots are:

- `memory_profile`: stable user preferences and long-lived working rules.
- `project_context`: project facts, paths, boundaries, and implementation notes.
- `task_state`: current task goal, progress, and next action.
- `working_context`: temporary context useful for the next response.

## Rules

- Keep titles short and summaries stable.
- Prefer updating an existing node over creating duplicates.
- Use branch nodes for navigation summaries and leaf nodes for concrete memory.
- Do not store raw dialogue unless the user explicitly wants that; summarize durable facts instead.
- Use `memory_query` before `memory_apply` when prior memory may matter or a duplicate is possible.
- When the memory frame or system prompt reports temporary workspace pressure, use `memory_apply`.
- For useful older refs, create or update memory nodes through `memory_apply` and include those refs in `markRefs`.
- If an old temporary ref is useless, put it in `discardRefs` through `memory_apply`.
- Do not mark the latest user message unless the user explicitly asks.
- After creating or updating memory that should affect future answers, load a slot through `memory_apply`.
- Do not expect a new-session prompt hook to load memory automatically; use `memory_status` when the projection is needed.
