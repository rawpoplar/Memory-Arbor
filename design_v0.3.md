# Memory Arbor Lite v0.3 Design

## 目标

Memory Arbor Lite 的目标是让模型在固定上下文预算下维护外部记忆，而不是依赖无限增长的原始对话历史。

v0.3 的核心原则：

- 记忆树和宿主 adapter 解耦。
- 上下文接管只走 `experimental.chat.messages.transform`。
- marker 不写入 OpenCode 原始历史，只保存在外部 frame store。
- 最终上传给模型的内容只包含记忆区和未标记的临时工作区。
- 模型通过 skill 主动创建、更新、装载、标记记忆。

## 分层

### memory-core

`memory-core` 是宿主无关的记忆核心。

它负责：

- 维护 `MemoryNode` 树。
- 维护 memory slots。
- 搜索、打开、创建、更新、归档、移动节点。
- 生成 loaded slot 的记忆视图。

它不负责：

- OpenCode hook。
- prompt 注入。
- 上下文 marker。
- session/message/part 的宿主细节。

这样后续 Codex、Claude Code、cc switch 可以通过各自 adapter 复用同一套记忆树。

### memory-context adapter

`memory-context` 是 OpenCode adapter。

它负责：

- 暴露 `memory_*` tools。
- 读写 OpenCode 本地配置目录下的 JSON store。
- 在 `experimental.chat.messages.transform` 中接管本轮即将上传的 messages。
- 根据外部 marker 清理已记忆化或已丢弃的原始上下文。
- 将 loaded memory slots 和临时工作区状态写入 `<memory_frame>`。

它不负责维护记忆树规则本身，记忆树操作仍然委托给 `memory-core`。

### skill

skill 只负责指导模型什么时候调用工具。

它不保存状态，不实现记忆树，也不直接修改上下文。

## 本地状态文件

默认目录：

```text
C:\Users\rawpoplar\.config\opencode\memory-arbor-lite\
```

### store.json

保存记忆树和 slot 状态：

- `nodes`
- `slots`
- `version`

### config.json

保存配置：

- `slots`
- `injection.maxMemoryTokens`
- `temporaryWorkspace.maxTokens`
- `temporaryWorkspace.pressureRatio`

如果文件不存在，使用默认配置。

### context-frame.json

保存 OpenCode adapter 的外部 frame 状态：

- `markers`
- `lastWorkspace`
- `version`
- `updatedAt`

marker 是外部状态，不写入 OpenCode 原始会话。

## Marker 设计

marker 用来表示某段原始上下文已经被处理过。

定位键：

```text
opencode:${sessionID}:${messageID}:${partID}
```

支持两种粒度：

- full part marker：标记整个 text part。
- range marker：标记 text part 中的 `[start, end)` 区间。

marker 状态：

- `memorized`：内容已进入记忆树，并关联 `nodeId`。
- `discarded`：内容无价值，可以从上传上下文中清理。

因为 `messages.transform` 只修改本轮上传视图，不会持久改写 OpenCode 原始历史，所以每轮都必须从 `context-frame.json` 读取 marker 并重新应用。

## 上下文接管流程

每轮请求前：

1. OpenCode 准备完整 `output.messages`。
2. `experimental.chat.messages.transform` 读取 `store.json`、`config.json`、`context-frame.json`。
3. 遍历所有 text parts。
4. 如果 part 或区间命中 marker，则从本轮上传内容中删除。
5. 未命中的内容保留原始 user/assistant 角色，形成 `temporary_workspace`。
6. 插件根据 loaded slots 构造 `<memory_frame>`。
7. 插件把 `<memory_frame>` 插入首个可用 text part 前。
8. 更新 `context-frame.json` 中的 `lastWorkspace` 和 frame `version`。

最终模型看到：

- `<memory_frame>` 中的记忆区。
- `<memory_frame>` 中的 temporary refs。
- 未被 marker 清理的临时对话内容。

模型看不到：

- 已标记为 `memorized` 的原始历史正文。
- 已标记为 `discarded` 的无效历史正文。

## 工具接口

记忆树工具：

- `memory_create_node`
- `memory_search`
- `memory_open`
- `memory_update_node`
- `memory_archive_node`
- `memory_move_node`
- `memory_load_slot`
- `memory_read_slots`

上下文 frame 工具：

- `memory_mark_context`
- `memory_unmark_context`
- `memory_read_context_frame`

典型记忆化流程：

1. 模型从 `<temporary_workspace>` 中读取 ref。
2. 调用 `memory_search` 避免重复。
3. 调用 `memory_create_node` 或 `memory_update_node` 保存信息。
4. 调用 `memory_mark_context` 将对应 ref 标记为 `memorized`。
5. 如需后续可见，调用 `memory_load_slot` 装载节点。
6. 调用 `memory_read_context_frame` 或 `memory_read_slots` 确认状态。

无价值内容清理流程：

1. 模型判断某个旧 ref 无价值。
2. 调用 `memory_mark_context`，`status` 设为 `discarded`。
3. 下一轮该 ref 对应原文从上传上下文中消失。

## 临时工作区压力

`temporaryWorkspace.maxTokens` 是临时工作区预算。

`temporaryWorkspace.pressureRatio` 是压力提示阈值。

当临时工作区接近或超过预算时：

- 不自动裁剪。
- 不自动总结。
- 不自动创建记忆。
- 在 `<memory_frame>` 中提示模型调用记忆工具处理旧 refs。

模型应优先处理较旧、较稳定、对未来有用的 refs。

默认不应标记最新用户消息，除非用户明确要求。

## v0.3 不做的事情

- 不使用 `chat.message`、`experimental.text.complete`、`tool.execute.after` 作为主线事件日志。
- 不在 `experimental.chat.system.transform` 注入记忆正文。
- 不修改 OpenCode 原始历史。
- 不自动压缩临时工作区。
- 不自动把对话打包成记忆。
- 不引入 Python 后端、SQLite 或服务进程。

## 验证

当前验证方式：

```powershell
node --check "Memory Arbor Lite\memory-core\index.ts"
node --check "Memory Arbor Lite\memory-context\frame.ts"
node --check "Memory Arbor Lite\memory-context\plugins\memory-context.ts"
node --check "Memory Arbor Lite\memory-context\adapter-smoke.ts"
node "Memory Arbor Lite\memory-core\smoke.ts"
node "Memory Arbor Lite\memory-context\adapter-smoke.ts"
```

关键验收点：

- `system.transform` 不再注入记忆正文。
- `messages.transform` 是上下文接管入口。
- full marker 可以清理整个 text part。
- range marker 可以清理局部文本。
- loaded slot 内容进入 `<memory_frame>`。
- 临时工作区超限时只提示，不裁剪。
