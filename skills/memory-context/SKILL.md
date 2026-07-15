---
name: memory-context
description: Use Memory Arbor context when it is injected by the host adapter; use the four high-level memory tools only when the current host exposes them.
---

# Memory Context

Memory Arbor may appear in two host modes:

- Full adapter mode: the host exposes `memory_*` tools and may project loaded slots plus temporary workspace refs into the next request.
- Prompt hook mode: the host only injects a Memory Arbor prompt frame before the request. In this mode, do not call or assume `memory_*` tools.

If a `<memory_arbor_prompt_frame>` or `<memory_frame>` is present, treat it as external memory context and prefer it over stale visible conversation context when they conflict. If no Memory Arbor frame is present, continue normally instead of reporting missing memory tools.

## Tools

Only follow this section when the current session actually exposes all four high-level tools.

- Use `memory_query` to search memory and, when needed, expand selected results with `openIds`.
- Use `memory_apply` to create or update nodes, mark useful refs as memorized, discard useless refs, and load slots.
- Use `memory_status` to inspect loaded slots, the context frame, temporary workspace pressure, and versions.
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
- In prompt hook mode, do not attempt to create, update, archive, load, mark, or verify memory through unavailable tools.
- Use `memory_query` before `memory_apply` when prior memory may matter or a duplicate is possible.
- When the memory frame or system prompt reports temporary workspace pressure, use `memory_apply`.
- For useful older refs, create or update memory nodes through `memory_apply` and include those refs in `markRefs`.
- If an old temporary ref is useless, put it in `discardRefs` through `memory_apply`.
- Do not mark the latest user message unless the user explicitly asks.
- After creating or updating memory that should affect future answers, load a slot through `memory_apply`.
- When visibility matters, call `memory_status` after changing memory or markers.
