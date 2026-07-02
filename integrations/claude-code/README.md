# Memory Arbor Claude Code Integration

This is a downgraded integration shell. Claude Code does not get an
OpenCode-style message transform hook here, so this plugin only provides skills
and future MCP tool configuration. It cannot delete or rewrite host conversation
context.

`.mcp.example.json` is intentionally an example until `packages/mcp` implements
a real MCP protocol server.

Use a new Claude Code session to continue from the same `MEMORY_ARBOR_HOME`
store.
