# Memory Arbor Codex Integration

This integration uses a prompt hook and the bundled Memory Arbor MCP server.
Codex does not get an OpenCode-style message transform hook here, so the plugin
can append loaded memory context but cannot delete or rewrite host conversation
context.

The MCP server exposes the `memory_*` tools against the shared
`MEMORY_ARBOR_HOME` store.

Use a new Codex session to continue from the same `MEMORY_ARBOR_HOME` store.
