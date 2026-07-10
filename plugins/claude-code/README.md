# Memory Arbor Claude Code Integration

This is a prompt-hook integration. Claude Code does not get an OpenCode-style
message transform hook here, so this plugin can append loaded memory context but
cannot delete or rewrite host conversation context.

Use a new Claude Code session to continue from the same `MEMORY_ARBOR_HOME`
store.
