# s13：运行模式路由（Runtime Mode Routing）— 参数怎样选择正确入口

s12 嵌入式运行框架 · [返回首页](../../README.md) · [s14 终端差分渲染 →](../s14-tui-diff-render/README.md)

> **核心结论**：Pi 先根据命令行参数和终端环境选择运行模式；不同模式决定最后使用哪一种输入输出入口，而不是重新解析一套命令行规则。

推荐前置：`learn-claude-code` 已经解释过 Agent Loop，本项目 s12 已经展示如何嵌入 Pi SDK。本课不再实现 Agent，也不复述 CLI 基础；只研究 Pi 怎样根据输入场景选择正确入口。

---

## 这节只学什么

本课只解决“同一条命令在终端、管道或 RPC 场景下，Pi 应该走哪个入口”这个问题。

| 本课会看到 | 本课暂不展开 |
| --- | --- |
| 参数和 TTY 状态的优先级 | 运行时怎样装配模型、会话、资源和工具 |
| interactive、print、json、rpc 四种路由结果 | 各入口真正怎样渲染终端或处理 RPC，留给 s14、s15 |

---

## 问题

同一个 Coding Agent 可能被四种宿主使用：

1. 开发者在终端中持续对话
2. CI 脚本发出一次请求，只读取最终答案
3. 日志处理程序消费每一个 Agent 事件
4. IDE 或桌面应用跨进程控制 Pi

使用者不需要先理解完整的 Pi 运行时，才知道该用哪种入口。真正容易出错的是：命令行参数、终端是否可交互、标准输入是否被管道重定向，会同时出现；程序必须稳定地选择一个模式。

Pi 怎样把这些条件变成一个明确、可测试的路由决定？

---

## 解决方案

![Pi 根据参数和 TTY 状态选择运行模式](images/runtime-modes-overview.svg)

*图：本课直接验证左侧的参数与 TTY 判断怎样选择入口。生产 Pi 确实会将选中的入口接到运行时，但“同一个运行时如何装配”不属于本课 Demo。*

先解释三个名词：**运行模式（mode）** 是这次程序的工作方式；**TTY** 表示标准输入/输出是否直接连接终端；**入口适配器（adapter）** 是把同一类 Agent 能力接到终端、一次性文本、事件 JSON 或 RPC 协议的外壳。

Pi 先解析 CLI 参数和 stdin/stdout 的 TTY 状态，确定运行模式：

| 运行模式 | 触发条件 | 最后使用的入口 | 对外协议 |
| --- | --- | --- | --- |
| `interactive` | 默认，stdin/stdout 都是 TTY | `InteractiveMode` | 终端组件树 |
| `print` | `-p`，或 stdin/stdout 任一不是 TTY | `runPrintMode(..., { mode: "text" })` | 最终 assistant 文本 |
| `json` | `--mode json` | `runPrintMode(..., { mode: "json" })` | Session header 与事件 JSONL |
| `rpc` | `--mode rpc` | `runRpcMode()` | 双向命令、响应与事件 JSONL |

本课只验证这个路由规则：

```text
参数 + TTY 状态
  -> interactive / print / json / rpc
  -> 对应的终端、文本、事件或 RPC 入口
```

生产 Pi 会在路由之后装配 `AgentSessionRuntime`，并把选中的入口接上它。这是上游结构，不是本课 `code.ts` 直接观察的结果；真实终端和 RPC 行为分别由 s14、s15 展开。

---

## 工作原理

课程代码入口在 [`code.ts`](code.ts)。它刻意不装配运行时或接管终端，只验证公开 `parseArgs()` 和上游同样的模式优先级。下面按实际执行顺序来看。

### 第 1 步：显式提供 argv 与 TTY 状态

```ts
const scenario = {
  label: "单次文本",
  argv: ["-p", "总结当前项目"],
  io: { stdinIsTTY: true, stdoutIsTTY: true },
};
```

真实 CLI 读取 `process.argv`、`process.stdin.isTTY` 和 `process.stdout.isTTY`。本课把三者作为普通数据传入，因此测试不需要真实终端，也不会接管 stdin/stdout。

### 第 2 步：调用 Pi 公开的 parseArgs()

```ts
const parsed = parseArgs(argv);
```

这不是课程自制参数解析器。`parseArgs()` 来自 `@earendil-works/pi-coding-agent` 包根，实际识别 `-p`、`--mode`、`@file`、消息和 diagnostics。

例如：

```ts
parseArgs(["-p", "总结当前项目"])
```

会得到：

```text
print = true
messages = ["总结当前项目"]
```

### 第 3 步：按上游优先级选择运行模式

```ts
if (parsed.mode === "rpc") return "rpc";
if (parsed.mode === "json") return "json";
if (parsed.print || !stdinIsTTY || !stdoutIsTTY) return "print";
return "interactive";
```

上游 `resolveAppMode()` 没有从 package root 导出。本课只复现这几行路由决策，包装成可测试的薄教学函数；参数结构和入口名称仍使用公开 API。

顺序很重要：

- `--mode rpc` 优先级最高
- `--mode json` 其次
- `-p` 或非 TTY 再进入 print
- 其余情况才进入 interactive

所以即使 stdout 被重定向，显式 `--mode json` 仍然选择 JSON，而不会退化成最终文本。

### 第 4 步：把运行模式映射到公开入口

```ts
const ADAPTERS = {
  interactive: InteractiveMode.name,
  print: `${runPrintMode.name}({ mode: "text" })`,
  json: `${runPrintMode.name}({ mode: "json" })`,
  rpc: runRpcMode.name,
};
```

本课只读取公开入口的名称，不真正启动它们：

- `InteractiveMode` 会拥有真实终端生命周期
- print/json 会接管 stdout
- RPC 会长期读取 stdin 并保持子进程运行

这些行为分别在 s14 和 s15 展开。本课只验证 Pi 特有的模式路由，不引入网络、认证或用户设置。

### 第 5 步：观察五种输入得到的决定

```ts
const decisions = evaluateDefaultModeScenarios();
```

课程代码同时演示：默认 TTY、`-p`、JSON、RPC 和管道输入。每种场景都输出运行模式、公开入口和协议；至于入口如何接到完整运行时，留给固定源码链和 s14/s15 的真实运行说明。

### 第 6 步：在进入 RPC 前拒绝 @file

```ts
if (appMode === "rpc" && parsed.fileArgs.length > 0) {
  diagnostics.push("Error: @file arguments are not supported in RPC mode");
}
```

RPC 使用 stdin 传输 JSONL 命令，不能同时沿用 CLI 的 `@file` 初始消息语法。上游 `main()` 在创建 RPC loop 前执行相同检查。

![课程代码到 Pi Runtime Adapter 的源码调用链](images/runtime-modes-source-chain.svg)

*图：课程只执行参数路由；runtime 的一次装配和三个 mode runner 的分发位置由固定源码链接证明。*

---

## 试一下

本课需要 Node.js `>=22.19.0`，不需要 API Key，不访问网络，也不读取用户 Pi 配置。

运行课程：

```bash
npm run lesson -- s13
```

你会看到：

```text
[步骤 1/3] 设置命令行参数和终端环境：本课不启动 AgentSessionRuntime。
[步骤 2/3] 按上游优先级计算每个场景应选择的入口。
默认交互: "检查当前项目" -> interactive -> InteractiveMode -> 终端组件树
单次文本: "-p" "总结当前项目" -> print -> runPrintMode({ mode: "text" }) -> 最终 assistant 文本
事件 JSON: "--mode" "json" "检查测试" -> json -> runPrintMode({ mode: "json" }) -> Session header + AgentSessionEvent JSONL
双向 RPC: "--mode" "rpc" -> rpc -> runRpcMode -> 命令、响应与事件 JSONL
管道输入: "总结标准输入" -> print -> runPrintMode({ mode: "text" }) -> 最终 assistant 文本
[步骤 3/3] 观察 RPC 的输入边界：文件参数不能与 JSONL 标准输入混用。
边界检查: Error: @file arguments are not supported in RPC mode
```

再运行测试：

```bash
npm run test:lesson -- s13
```

观察重点：

1. argv 与 TTY 只决定最后一层 adapter，不会改变模型、会话或工具的装配规则
2. JSON 与 text 都由 `runPrintMode()` 实现，只是输出粒度不同
3. 非 TTY 自动选择 print，适合 shell 管道和 CI
4. RPC 不接受 CLI `@file` 参数

可以尝试：

1. 将 JSON 场景同时加上 `-p`，确认显式 JSON 仍然优先
2. 把 `stdoutIsTTY` 改成 `false`，观察默认交互变成 print
3. 单独传入 `--mode text`，观察真实 TTY 中仍然进入 interactive

最后一点是 Pi `v0.80.6` 的具体行为：`text` 是 print adapter 的输出格式，不是独立进入非交互模式的开关。需要单次文本时应使用 `-p` 或管道。

---

## 接下来

现在我们知道 runtime adapter 怎样被选中，但还没有解释 interactive adapter 为什么可以频繁更新终端而不整屏闪烁。

s14 终端差分渲染将进入 `pi-tui`：组件（`Component`）生成完整文本帧，终端界面系统（`TUI`）比较前后状态，只把变化区间写给终端。

<details>
<summary>深入 Pi 源码</summary>

### 课程代码与生产职责的对照

以下对应均固定在 Pi `v0.80.6` 提交 [`2b3fda9921b5590f285165287bd442a25817f17b`](https://github.com/earendil-works/pi/tree/2b3fda9921b5590f285165287bd442a25817f17b)。先把教学 router 的每个决定对回真实 CLI：

| `code.ts` 中读者看到的动作 | Pi 生产实现中的同一职责 |
| --- | --- |
| `parseArgs(argv)` | 解析 `-p`、`--mode`、`@file`、初始消息和 diagnostics。 |
| `selectAppMode(parsed, io)` | `main.ts` 的内部 `resolveAppMode()` 按 RPC、JSON、print、interactive 的同一优先级选择模式。 |
| RPC 的 `@file` 拒绝 | `main()` 在进入 RPC loop 前做同样的边界检查，避免 CLI 文件参数与 JSONL stdin 混用。 |
| `ADAPTERS[mode]` | 主程序只创建一次 `AgentSessionRuntime`，再把同一个实例交给 interactive、print/json 或 RPC adapter。 |

**教学版只把“如何选最后一层 adapter”压缩成六行；生产版在这之后才装配 runtime 并执行 adapter。**

### 公开 API 与教学实现边界

本课使用的以下能力都由 `@earendil-works/pi-coding-agent` 包根公开导出：

- `parseArgs()`
- `InteractiveMode`
- `runPrintMode()`
- `runRpcMode()`

上游 `resolveAppMode()` 是 `main.ts` 内部函数。本课的 `selectAppMode()` 只复现其决策顺序，没有复制 runtime 创建、Session 选择、资源加载或 adapter 实现。

以下链接用于核查上表的职责边界：

- [`Args` 与公开 `parseArgs()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/cli/args.ts#L10-L207)
- [package root 公开导出 modes](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/index.ts#L324-L342)
- [内部 `resolveAppMode()` 与 `toPrintOutputMode()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/main.ts#L100-L115)
- [`parseArgs()` 后执行路由和 RPC 文件检查](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/main.ts#L508-L548)
- [只创建一次 `AgentSessionRuntime`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/main.ts#L690-L750)
- [生产主程序在路由后将一次创建的运行时交给对应入口（非本课演示）](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/main.ts#L800-L858)
- [`runPrintMode()` 的 text 与 JSON 分支](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/modes/print-mode.ts#L17-L158)
- [`runRpcMode()` 的 stdin/stdout 协议入口](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1-L61)
- [`InteractiveMode` 接收 runtime](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L467-L500)

### 为什么 text 与 JSON 共用 runPrintMode()

`runPrintMode()` 在两种输出下都调用同一个 `session.prompt()`：

- text：等待结束后，只读取最后一条 assistant message 的 text block
- JSON：订阅 session，把 header 与全部事件逐行写到 stdout

因此 JSON mode 不是另一个 Agent Loop，只是保留了更多运行过程。

### 为什么 RPC 不复用 runPrintMode()

print/json 都是“输入有限，处理完成后退出”。RPC 则需要：

- 持续读取 stdin 的 JSONL 命令
- 用 `id` 关联响应
- 同时广播没有请求 ID 的 Agent 事件
- 支持 abort、steer、follow-up、切换 Session 等多次操作

所以 RPC 共享 runtime，但需要独立的长生命周期 adapter。具体协议由 s15 继续拆解。

### 教学代码与真实 main() 的差异

| 本课 | 真实 Pi CLI |
| --- | --- |
| argv 和 TTY 状态作为普通参数 | 读取 process argv/stdin/stdout |
| 只输出路由决定 | 真正创建 services、session 与 runtime |
| 不启动 adapter | adapter 接管终端或进程 IO |
| 不读取配置 | 处理 settings、auth、resources 和 project trust |
| 不访问网络 | 可能进行 provider 请求和版本检查 |

本课刻意停在 adapter 边界，因为 runtime 装配已由 s12 负责，TUI 与 RPC 的内部机制分别由 s14、s15 负责。

</details>
