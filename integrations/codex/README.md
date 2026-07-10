# Memory Arbor Codex Integration

This is a prompt-hook integration. Codex does not get an OpenCode-style message
transform hook here, so this plugin can append loaded memory context but cannot
delete or rewrite host conversation context.

Use a new Codex session to continue from the same `MEMORY_ARBOR_HOME` store.
