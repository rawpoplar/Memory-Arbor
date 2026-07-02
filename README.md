# Memory Arbor

Memory Arbor 是一个面向长时间 AI 对话的轻量级记忆与上下文控制实验项目。

项目目标是控制每次请求中实际发送给模型服务器的内容。它不直接发送无限增长的原始对话历史，而是在每轮请求前重新组装上下文：

- 来自外部记忆树的已装载记忆节点；
- 最近对话中尚未被标记的临时工作区内容。

这样可以尽量支持长期使用单一会话，同时避免实际上传上下文超过设定预算。

OpenCode adapter 通过 `experimental.chat.messages.transform` 改写即将上传的 messages，并通过 `experimental.chat.system.transform` 在临时工作区接近预算时加入维护提示。

## 当前状态

当前设计版本是 v0.4。

OpenCode adapter 使用 `experimental.chat.messages.transform` 检查并改写即将发送给模型的 messages。这个 hook 不会把修改持久写回 OpenCode 历史；已处理内容通过外部 marker store 记录，并在每轮请求中重新清理。`experimental.chat.system.transform` 只注入维护提示，不注入完整记忆正文。

完整设计和后续版本计划见 [design.md](design.md)。

## 仓库结构

```text
packages/core/               宿主无关的记忆树、frame 和维护逻辑。
packages/mcp/                MCP 工具暴露层壳，后续用于降级接入。
integrations/opencode/       OpenCode 完整版 adapter。
integrations/codex/          Codex 降级插件壳。
integrations/claude-code/    Claude Code 降级插件壳。
skills/memory-context/       唯一手写 skill 源文件。
adapter-smoke.ts             adapter 层 smoke 测试。
package.json                 workspace 和验证脚本入口。
pnpm-workspace.yaml          workspace 结构声明。
design.md                    当前设计和后续版本计划。
```

## 工作方式

每次请求的大致流程：

1. OpenCode 准备原本要发送给模型的 messages。
2. adapter 读取 `store.json`、`config.yaml` 和 `context-frame.json`。
3. 外部 marker 清理已经记忆化或已丢弃的原始上下文。
4. 剩余原始上下文成为临时工作区。
5. 已装载的 memory slots 被插入 `<memory_frame>`。
6. 如果临时工作区接近或超过预算，system prompt 中加入维护提示。
7. 模型最终接收 memory frame、未标记的临时工作区和必要的维护提示。

之后模型可以通过 `memory_maintain_context` 批量创建/更新、标记、丢弃和装载记忆；也可以使用更细粒度的 `memory_*` 原子工具。

## 使用方法

OpenCode 当前是完整接入目标。将 `integrations/opencode/src/plugin.ts` 作为 OpenCode 插件入口使用，并确保 workspace 依赖可解析：

```text
packages/core/
integrations/opencode/
skills/
config.example.yaml
```

Codex 和 Claude Code 目录目前是降级插件壳：只提供 skill 和 `.mcp.example.json` 样例配置，不能改写或删除宿主原始会话上下文。

Memory Arbor 的默认状态目录是：

```text
%USERPROFILE%\.memory-arbor\
```

可以通过 `MEMORY_ARBOR_HOME` 覆盖。OpenCode、Codex 和 Claude Code 降级接入应指向同一个状态目录。

如果要启用示例配置，可以把 `config.example.yaml` 复制到 Memory Arbor 状态目录并改名为 `config.yaml`：

```powershell
$state = Join-Path $env:USERPROFILE ".memory-arbor"
New-Item -ItemType Directory -Force $state | Out-Null
Copy-Item "config.example.yaml" (Join-Path $state "config.yaml") -Force
```

## 本地状态

默认状态目录是：

```text
%USERPROFILE%\.memory-arbor\
```

状态文件：

- `store.json`：记忆树和 slots。
- `config.yaml`：slots 和 token 预算配置，支持中文注释。
- `context-frame.json`：外部 markers 和最近一次临时工作区状态。

`MEMORY_ARBOR_HOME` 可以把这些状态文件指向其它目录。

## 验证

在仓库根目录运行：

```powershell
npm.cmd run check
npm.cmd run smoke
```

也可以直接运行：

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

`npm test` 等价于先运行 `check` 再运行 `smoke`。如果 PowerShell 执行策略拦截 `npm.ps1`，请使用 `npm.cmd test`。

期望 smoke 输出：

```text
memory-core smoke passed
memory-context adapter smoke passed
```

## 说明

- `packages/core` 必须保持宿主无关。
- skill 只描述什么时候调用工具，不保存记忆。
- OpenCode 专属的上下文投影逻辑属于 adapter。
- Codex 和 Claude Code 只能降级接入，不能改写宿主原始会话上下文。
- MCP 只作为工具暴露层，不作为上下文控制层。
- marker 是外部状态，因为 `messages.transform` 只修改本轮请求视图，不会修改已保存的聊天历史。
- `system.transform` 只注入维护提示，不注入完整记忆正文。

## 许可证

本项目使用 Apache License 2.0，详见 [LICENSE](LICENSE)。
