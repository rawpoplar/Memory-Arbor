# Memory Arbor Design

## 目标

Memory Arbor 的目标是控制每次发送给模型服务器的实际上下文内容。

它不依赖无限增长的原始对话历史，而是在每轮请求前重新组装固定预算内的上下文：

- 记忆区：由外部记忆树中已装载的节点组成。
- 临时工作区：由尚未记忆化、尚未丢弃的最近上下文组成。

这样可以尽量支持长期使用单一会话，同时避免实际上传上下文超过设定预算。

## 当前版本：v0.4

v0.4 的核心原则：

- 记忆树和宿主 adapter 解耦。
- 上下文投影走 `experimental.chat.messages.transform`。
- 临时工作区压力提示走 `experimental.chat.system.transform`。
- marker 不写入 OpenCode 原始历史，只保存在外部 frame store。
- 最终上传给模型的内容只包含记忆区和未标记的临时工作区。
- 模型优先通过 `memory_maintain_context` 批量创建、更新、装载、标记和丢弃上下文。

## 分层

### packages/core

`packages/core` 是宿主无关的记忆核心。

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

OpenCode、Codex、Claude Code、cc switch 可以通过各自 adapter 复用同一套记忆树。

### OpenCode adapter

`integrations/opencode/src/plugin.ts` 是当前 OpenCode adapter。

它负责：

- 暴露 `memory_*` tools。
- 读写 `MEMORY_ARBOR_HOME` 或默认共享状态目录下的 JSON store。
- 在 `experimental.chat.messages.transform` 中接管本轮即将上传的 messages。
- 在 `experimental.chat.system.transform` 中注入临时工作区维护提示。
- 根据外部 marker 清理已记忆化或已丢弃的原始上下文。
- 将 loaded memory slots 和临时工作区状态写入 `<memory_frame>`。

它不维护记忆树规则本身，记忆树操作委托给 `memory-core`。

### skill

`skills/memory-context/SKILL.md` 是唯一手写 skill 源文件。Codex 和 Claude Code integration 下的 skill 文件是生成副本。

它不保存状态，不实现记忆树，也不直接修改上下文。

## 本地状态文件

默认目录：

```text
%USERPROFILE%\.memory-arbor\
```

### store.json

保存记忆树和 slot 状态：

- `nodes`
- `slots`
- `version`

### config.yaml

保存配置：

- `slots`
- `injection.maxMemoryTokens`
- `temporaryWorkspace.maxTokens`
- `temporaryWorkspace.pressureRatio`

配置文件使用 YAML，支持中文注释。如果 `config.yaml` 不存在，adapter 会使用默认配置。

### context-frame.json

保存 adapter 的外部 frame 状态：

- `markers`
- `lastWorkspace`
- `version`
- `updatedAt`

marker 是外部状态，不写入宿主原始会话。

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
2. `experimental.chat.messages.transform` 读取 `store.json`、`config.yaml`、`context-frame.json`。
3. 遍历所有 text parts。
4. 如果 part 或区间命中 marker，则从本轮上传内容中删除。
5. 未命中的内容保留原始 user/assistant 角色，形成 `temporary_workspace`。
6. 插件根据 loaded slots 构造 `<memory_frame>`。
7. 插件把 `<memory_frame>` 插入首个可用 text part 前。
8. 更新 `context-frame.json` 中的 `lastWorkspace` 和 frame `version`。
9. 如果上一轮或当前 frame 显示临时工作区接近预算，`system.transform` 注入短维护提示。

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
- `memory_maintain_context`

上下文 frame 工具：

- `memory_mark_context`
- `memory_unmark_context`
- `memory_read_context_frame`

典型记忆化流程：

1. 模型从 `<temporary_workspace>` 中读取 ref。
2. 调用 `memory_search` 避免重复。
3. 优先调用 `memory_maintain_context` 创建或更新节点、标记 refs、装载 slot。
4. 需要细粒度控制时，再使用 `memory_create_node`、`memory_update_node`、`memory_mark_context` 和 `memory_load_slot`。
5. 调用 `memory_read_context_frame` 或 `memory_read_slots` 确认状态。

无价值内容清理流程：

1. 模型判断某个旧 ref 无价值。
2. 优先调用 `memory_maintain_context`，把 ref 放入 `discardRefs`。
3. 需要细粒度控制时，调用 `memory_mark_context`，`status` 设为 `discarded`。
4. 下一轮该 ref 对应原文从上传上下文中消失。

## 临时工作区压力

`temporaryWorkspace.maxTokens` 是临时工作区预算。

`temporaryWorkspace.pressureRatio` 是压力提示阈值。

当临时工作区接近或超过预算时：

- 不自动裁剪。
- 不自动总结。
- 不自动创建记忆。
- 在 `<memory_frame>` 中提示模型调用记忆工具处理旧 refs。
- 在 system prompt 中加入短维护提示，列出最多 5 个旧 temporary refs。

模型应优先处理较旧、较稳定、对未来有用的 refs。

默认不应标记最新用户消息，除非用户明确要求。

## 当前不做的事情

- 不使用 `chat.message`、`experimental.text.complete`、`tool.execute.after` 作为主线事件日志。
- 不在 `experimental.chat.system.transform` 注入完整记忆正文。
- 不修改 OpenCode 原始历史。
- 不自动压缩临时工作区。
- 不自动把对话打包成记忆。
- 不引入 Python 后端、SQLite 或服务进程。

## 后续版本计划

所有后续版本计划先记录在本文件中，再进入实现。

### v0.5：更系统的配置

目标是让 Memory Arbor 的关键路径、预算和 profile 更系统地可配置。

计划内容：

- 支持在 YAML 配置中配置记忆树 store 路径。
- 支持在 YAML 配置中配置 context frame 路径。
- 支持配置 memory slot 数量、名称、用途、预算。
- 支持配置总记忆区预算和临时工作区预算。
- 支持配置 adapter 的默认工作目录和 profile。

默认配置仍然保持零配置可运行。

### v0.6：记忆树搜索增强

目标是让搜索能力属于记忆树核心，而不是放在 skill 外部临时拼接。

计划内容：

- 保持 `memory_search` 在 `memory-core` 内实现。
- 增强按 title、summary、content、tags、treePath 的搜索。
- 保留树路径和 breadcrumb，方便模型按树逐层查找。
- 后续可加入节点 id 的树状数组或区间索引，让模型在记忆过多时能按大致 id 区间定位。

短期仍以树结构搜索为主，当前规模下按树查找已经足够。

### v0.7：大规模记忆存储

目标是在记忆过多时减少一次性加载整棵树的成本。

计划内容：

- 将常用索引、目录摘要和节点正文拆开存储。
- 只将模型使用到的记忆节点 load 到内存。
- 未使用的节点正文保留在磁盘上。
- 搜索阶段优先读取轻量索引，打开节点时再读取正文。

这个方向暂不急迫；即使 JSON 文件达到较大体积，当前机器内存仍然够用。实现时优先保证接口稳定和数据安全。

### 未来：多宿主 adapter

目标是让同一套 `memory-core` 接入不同 AI 宿主。

候选 adapter：

- OpenCode。
- Codex。
- Claude Code。
- cc switch。

当前仓库结构：

- `packages/core`：宿主无关的记忆树、frame、维护逻辑。
- `packages/mcp`：MCP 工具暴露层壳，不承担上下文控制。
- `integrations/opencode`：OpenCode 完整 adapter。
- `integrations/codex`：Codex 降级插件壳。
- `integrations/claude-code`：Claude Code 降级插件壳。

OpenCode adapter 仍是完整接入：可以通过 hook 投影 messages，并用 system hook 注入维护提示。

Codex、Claude Code 等 CLI 如果没有可用的完整上下文劫持 hook，则采用降级接入：

- 只通过插件或宿主支持的提示词入口注入已装载记忆和维护说明。
- 不尝试删除或改写宿主原始会话上下文。
- 长会话增长由用户新开会话解决，新会话继续读取同一套 Memory Arbor store。
- 仍复用 `packages/core` 的记忆树和 slot 语义。

MCP 只作为后续工具暴露层。它可以增加工具和资源，但不能稳定修改或删除宿主上下文/提示词，因此不作为 Memory Arbor 的上下文控制层。当前 integration 中只保留 `.mcp.example.json`，避免误加载未完成的 MCP server。

## 验证

在 `Memory-Arbor` 根目录运行：

```powershell
npm.cmd run check
npm.cmd run smoke
```

或者直接运行：

```powershell
node --check "packages\core\src\index.ts"
node --check "packages\core\src\frame.ts"
node --check "packages\core\src\maintain.ts"
node --check "packages\mcp\src\descriptor.ts"
node --check "integrations\opencode\src\plugin.ts"
node --check "adapter-smoke.ts"
node "packages\core\smoke.ts"
node "adapter-smoke.ts"
```

关键验收点：

- `system.transform` 注入压力维护提示，但不注入完整记忆正文。
- `messages.transform` 是上下文接管入口。
- full marker 可以清理整个 text part。
- range marker 可以清理局部文本。
- loaded slot 内容进入 `<memory_frame>`。
- 临时工作区超限时只提示，不裁剪。
- `memory_maintain_context` 可以批量创建/更新节点、标记 refs、丢弃 refs 和装载 slot。
