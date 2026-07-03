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
tests/                       基于 node:test 的轻量正式测试。
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

Memory Arbor 的默认状态目录是：

```text
%USERPROFILE%\.memory-arbor\
```

可以通过 `MEMORY_ARBOR_HOME` 覆盖。OpenCode、Codex 和 Claude Code 降级接入应指向同一个状态目录。

### OpenCode

OpenCode 当前是完整接入目标。本仓库已经包含项目级 OpenCode loader：

```text
.opencode/plugins/memory-arbor.ts
.opencode/package.json
```

因此在本仓库根目录启动 OpenCode 时，OpenCode 会按官方本地插件规则自动加载该 loader：

```powershell
cd /d "D:\repos\Memory Arbor"
opencode
```

`.opencode/package.json` 使用 `file:` 依赖指向当前仓库内的 `packages/core` 和 `integrations/opencode`。OpenCode 会在启动时为 `.opencode` 配置目录安装本地插件依赖。

如果要在其它项目中使用当前源码版 Memory Arbor，不会自动跨盘加载本仓库。需要在那个项目的 `.opencode/plugins/` 或全局 `C:\Users\admin\.config\opencode\plugins\` 下单独放 loader，并让对应配置目录的 `package.json` 指向本仓库的本地包。后续发布 npm 包后，可以改用 `opencode.json` 的 `plugin` 数组安装。

该接入会通过 `experimental.chat.messages.transform` 改写即将上传的 messages。

### Claude Code

Claude Code 当前是降级插件壳：只提供 skill 和 `.mcp.example.json` 样例配置，不能改写或删除宿主原始会话上下文。

在 Claude Code 中添加本仓库 marketplace，然后安装插件：

```text
/plugin marketplace add "D:\repos\Memory Arbor"
/plugin install memory-arbor-claude-code@memory-arbor
```

安装后可通过插件命名空间使用 skill。当前 `.mcp.example.json` 仅是样例，等 `packages/mcp` 实现真实 MCP server 后再启用。

### Codex

Codex 当前也是降级插件壳：只提供 skill 和 `.mcp.example.json` 样例配置，不能改写或删除宿主原始会话上下文。

先注册本仓库 marketplace：

```powershell
codex plugin marketplace add "D:\repos\Memory Arbor"
```

然后重启 Codex，在插件目录中选择 `Memory Arbor` marketplace，并安装 `memory-arbor-codex`。如果直接在本仓库内启动 Codex，Codex 也会读取 `.agents/plugins/marketplace.json` 作为 repo-scoped marketplace。

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
node --check "tests\core.test.ts"
node --check "tests\adapter.test.ts"
node "tests\core.test.ts"
node "tests\adapter.test.ts"
```

`npm test` 等价于先运行 `check` 再运行 `smoke`。如果 PowerShell 执行策略拦截 `npm.ps1`，请使用 `npm.cmd test`。

`smoke` 使用 Node 内置 `node:test`，不引入额外测试框架；当前脚本直接执行测试文件，避免受限环境下 `node --test` 派生子进程失败。

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
