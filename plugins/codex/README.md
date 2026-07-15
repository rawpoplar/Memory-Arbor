# Memory Arbor Codex Integration

This integration uses the bundled Memory Arbor MCP server. It does not load
memory automatically when a session starts. Call `memory_status` to return the
loaded-memory snapshot; later `memory_apply` or `memory_admin` results contain
only node upserts or removals.

The MCP server exposes `memory_query`, `memory_apply`, `memory_status`, and
`memory_admin` against the shared `MEMORY_ARBOR_HOME` store.

Each MCP instance keeps its own projection after `memory_status` is called.
