# Memory Arbor

Memory Arbor 是一个面向长时间 AI 对话的轻量级记忆与上下文控制实验项目。

项目目标是控制每次请求中实际发送给模型服务器的内容。它不直接发送无限增长的原始对话历史，而是在每轮请求前重新组装上下文：

- 来自外部记忆树的已装载记忆节点；
- 最近对话中尚未被标记的临时工作区内容。

这样可以尽量支持长期使用单一会话，同时避免实际上传上下文超过设定预算。

目前仅有opencode的experimental.chat.messages.transform钩子允许我们获取/修改实际上传到模型服务器的实际上下文，所以该项目目前是作为opencode的插件来使用的

## 当前状态

当前设计版本是 v0.3。

OpenCode adapter 使用 `experimental.chat.messages.transform` 检查并改写即将发送给模型的 messages。这个 hook 不会把修改持久写回 OpenCode 历史；已处理内容通过外部 marker store 记录，并在每轮请求中重新清理。

完整设计和后续版本计划见 [design.md](design.md)。

## 仓库结构

```text
memory-core/                 宿主无关的记忆树实现。
plugins/memory-context.ts    OpenCode adapter 和 memory_* 工具。
skills/memory-context/       面向模型的记忆使用 skill。
frame.ts                     外部 marker 和临时工作区辅助逻辑。
adapter-smoke.ts             adapter 层 smoke 测试。
design.md                    当前设计和后续版本计划。
```

## 工作方式

每次请求的大致流程：

1. OpenCode 准备原本要发送给模型的 messages。
2. adapter 读取 `store.json`、`config.yaml` 和 `context-frame.json`。
3. 外部 marker 清理已经记忆化或已丢弃的原始上下文。
4. 剩余原始上下文成为临时工作区。
5. 已装载的 memory slots 被插入 `<memory_frame>`。
6. 模型最终只接收 memory frame 和未标记的临时工作区。

之后模型可以通过 `memory_*` 工具搜索、创建、更新、装载和标记记忆。

## 使用方法

将项目中的以下文件和目录复制到 OpenCode 配置目录即可使用：

```text
memory-core/
plugins/
skills/
adapter-smoke.ts
frame.ts
config.example.yaml
```

Windows 下 OpenCode 配置目录通常是：

```text
%USERPROFILE%\.config\opencode
```

PowerShell 示例：

```powershell
$target = Join-Path $env:USERPROFILE ".config\opencode"
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item "memory-core" $target -Recurse -Force
Copy-Item "plugins" $target -Recurse -Force
Copy-Item "skills" $target -Recurse -Force
Copy-Item "adapter-smoke.ts" $target -Force
Copy-Item "frame.ts" $target -Force
Copy-Item "config.example.yaml" $target -Force
```

复制后重启 OpenCode，让其重新加载 `plugins/memory-context.ts` 和 `skills/memory-context/SKILL.md`。

如果要启用示例配置，可以把 `config.example.yaml` 复制到 Memory Arbor 状态目录并改名为 `config.yaml`：

```powershell
$state = Join-Path $env:USERPROFILE ".config\opencode\memory-arbor"
New-Item -ItemType Directory -Force $state | Out-Null
Copy-Item "config.example.yaml" (Join-Path $state "config.yaml") -Force
```

## 本地状态

当前 OpenCode adapter 的默认状态目录是：

```text
%USERPROFILE%\.config\opencode\memory-arbor\
```

状态文件：

- `store.json`：记忆树和 slots。
- `config.yaml`：slots 和 token 预算配置，支持中文注释。
- `context-frame.json`：外部 markers 和最近一次临时工作区状态。

后续版本会让这些路径可配置。

## 验证

在仓库根目录运行：

```powershell
node --check "memory-core\index.ts"
node --check "frame.ts"
node --check "plugins\memory-context.ts"
node --check "adapter-smoke.ts"
node "memory-core\smoke.ts"
node "adapter-smoke.ts"
```

期望 smoke 输出：

```text
memory-core smoke passed
memory-context adapter smoke passed
```

## 说明

- `memory-core` 必须保持宿主无关。
- skill 只描述什么时候调用工具，不保存记忆。
- OpenCode 专属的上下文投影逻辑属于 adapter。
- marker 是外部状态，因为 `messages.transform` 只修改本轮请求视图，不会修改已保存的聊天历史。
