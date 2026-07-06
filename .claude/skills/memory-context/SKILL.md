---
name: memory-context
description: Use Memory Arbor context when it is injected by the host adapter; use memory_* tools only when the current host exposes them.
---

# Memory Context

Memory Arbor may appear in two host modes:

- Full adapter mode: the host exposes `memory_*` tools and may project loaded slots plus temporary workspace refs into the next request.
- Prompt hook mode: the host only injects a Memory Arbor prompt frame before the request. In this mode, do not call or assume `memory_*` tools.

If a `<memory_arbor_prompt_frame>` or `<memory_frame>` is present, treat it as external memory context and prefer it over stale visible conversation context when they conflict. If no Memory Arbor frame is present, continue normally instead of reporting missing memory tools.

## Tools

Only follow this section when the current session actually exposes `memory_*` tools.

- Use `memory_search` before creating likely duplicates or when prior context may matter.
- Use `memory_open` to inspect a node, its breadcrumb, tree path, and children.
- Use `memory_create_node` to add a new memory node.
- Use `memory_update_node` to revise an existing memory node.
- Use `memory_archive_node` to archive obsolete or wrong memory.
- Use `memory_move_node` to relocate a node under a better parent.
- Use `memory_load_slot` to make active nodes visible in the memory frame.
- Use `memory_read_slots` to verify loaded slots.
- Use `memory_maintain_context` first when temporary workspace pressure requires batching create/update, mark, discard, and load operations.
- Use `memory_read_context_frame` to inspect marker state, temporary refs, and workspace pressure.
- Use `memory_mark_context` after memory creation/update to mark old temporary refs as `memorized`, or mark useless refs as `discarded`.
- Use `memory_unmark_context` to undo a wrong marker.

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
- When the memory frame or system prompt reports temporary workspace pressure, prefer `memory_maintain_context`.
- For useful older refs, create or update memory nodes through `memory_maintain_context` and include those refs in `markRefs`.
- If an old temporary ref is useless, put it in `discardRefs` through `memory_maintain_context`.
- Use `memory_mark_context` only when a smaller, single-purpose marker edit is clearer.
- Do not mark the latest user message unless the user explicitly asks.
- After creating or updating memory that should affect future answers, call `memory_load_slot`.
- When visibility matters, call `memory_read_context_frame` or `memory_read_slots` after changing memory or markers.
