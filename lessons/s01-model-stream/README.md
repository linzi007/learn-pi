# s01: Model Stream - 一次请求，同时看到过程与结果

[返回首页](../../README.md)

`s01` -> [s02 Agent Runtime State](../s02-agent-runtime-state/) -> s03 Tool Execution Pipeline -> ...

> *"同一个 Stream，两种读取方式"* - `for await` 看正在发生的输出，`result()` 拿已经完成的消息。
>
> **pi-ai 层**：Pi 先把不同模型的响应统一成同一种事件流，Agent 才能在上面继续工作。

推荐前置：已完成 `learn-claude-code`，理解最小 Agent Loop。本课不重复解释“为什么需要循环”，只解释 Pi 把一次模型响应交给上层的方式。

---

## 问题

你在终端里问模型一个问题。它正在生成答案时，界面希望立刻显示新文字：

```text
Pi 的事件流有什么用？
-> 正在输出：它让界面可以...
```

但这次响应结束后，程序又需要一条完整的 assistant 消息，才能把它写入会话历史、检查结束原因，或在下一轮继续调用模型。

如果只把响应当作一个普通 Promise，界面只能等到全部文字完成后再显示；如果只逐段打印文字，又得自己拼出一条可保存的消息。

**同一次请求，Pi 怎样同时提供“现在已经生成了什么”和“最后完整得到什么”？**

---

## 解决方案

![同一次 Pi 模型请求的两种读取方式](images/model-stream-overview.svg)

*图：一次请求先产生一列事件；`text_delta` 让界面实时更新，最后的 `done(message)` 同时结束事件流并让 `result()` 得到完整消息。*

`models.streamSimple()` 返回的不是最终字符串，而是一条 `AssistantMessageEventStream`。它只对应**一次**模型请求，却回答两个不同的问题：

| 读者此刻想知道什么 | 读取方式 | Pi 给出的东西 |
| --- | --- | --- |
| “现在该往终端画什么？” | `for await (const event of stream)` | 逐个到达的事件，例如 `text_delta` |
| “这一轮最终该存成什么消息？” | `await stream.result()` | 流终止时的完整 `AssistantMessage` |

关键规则是：**事件负责路上的显示；终止事件里的完整消息负责最后的保存。两者来自同一次请求。**

这里不要把 `result()` 想成“把 delta 再拼一次”。Pi 的 Provider 会在结束时发出带完整消息的 `done` 事件；`EventStream` 用它兑现 `result()` 的 Promise。课程里的 `deltas` 数组只是为了让你看见流式输出，并不是 Pi 生成最终消息的方式。

---

## 工作原理

完整教学代码在 [`code.ts`](code.ts)。文件开头的真实 Provider 和 `.env` 设置只是“这次请求要发给谁”的准备工作；本课要理解的内核都在 `consumeModelStream()` 的十几行中。按真实执行顺序读：

### 第 1 步：准备一条用户消息，并且只发起一次请求

```ts
const context: Context = {
	systemPrompt: "你是 Pi 原理课程中的简洁助手。只用中文回答。",
	messages: [{ role: "user", content: question, timestamp: Date.now() }],
};

const stream = runtime.models.streamSimple(runtime.model, context, { maxTokens: 128 });
```

`Context` 是本轮输入快照。`streamSimple()` 立即返回 Stream，但模型还没回答完；Provider 会在网络响应到达时持续把标准化事件推入它。到这里为止，网络请求只有这一次。

### 第 2 步：事件到达，就从同一条 Stream 取出来

```ts
for await (const event of stream) {
	eventTypes.push(event.type);
	// 每次循环只处理刚刚到达的一个事件。
}
```

`for await` 不会等待整条回答完成。没有事件时它等待；Provider 推入一个事件时，它就继续执行一次循环。因此终端能在模型仍在生成时更新。

### 第 3 步：本课只把文字增量画出来

```ts
if (event.type === "text_delta") {
	deltas.push(event.delta);
	output.writeLine(`text_delta #${deltas.length}: ${event.delta}`);
}
}
```

模型输出的分段大小由 Provider 决定，可能是一两个字，也可能是一小段句子。本课特意标出 `text_delta #N`，让你能看出终端是在**过程中**更新，而不是等全部结果完成后一次性打印。`start`、`text_start`、`text_end` 和 `done` 也会经过循环，只是本课不需要为它们渲染文字。

![一条 Stream 的时间线](images/stream-lifecycle.svg)

*图：`text_delta` 在完成前持续到达；最后的 `done(message)` 同时结束遍历，并让 `result()` 读取这一请求的完整 `AssistantMessage`。*

### 第 4 步：`done` 让遍历结束，也兑现最终消息

课程代码没有手动判断 `done`。这是 `AssistantMessageEventStream` 的职责：收到 `done` 或 `error` 时，它会标记事件流完成，并用该事件里的完整消息兑现内部 Promise。于是 `for await` 在读完终止事件后结束，下面的 `result()` 已经有值可取。

### 第 5 步：读取同一次请求的完整消息

```ts
const message = await stream.result();
const finalText = message.content
	.filter((block) => block.type === "text")
	.map((block) => block.text)
	.join("");
```

`result()` 不会再发一次请求。它返回的是刚才终止事件携带的 `AssistantMessage`，其中有完整内容、结束原因、usage 和可能的工具调用。于是终端可以持续显示 delta，程序也能保存一条完整消息。

把本课压缩成下面这条因果链：

```text
一次 streamSimple() 请求
├── 多个事件 -> for await...of -> 现在显示什么
└── done(message) -> stream.result() -> 最后保存什么
```

这就是 Pi 在模型层提供给上层 Agent 的最小约定：**UI 不必等待完整消息，运行时也不必自己拼完整消息。**

---

## 试一下

本课需要 Node.js `>=22.19.0` 和可用的 Anthropic-compatible 模型配置。课程默认会顺序查找：

1. `LEARN_PI_ENV_FILE` 指定的文件
2. Learn Pi 根目录的 `.env`
3. 同级 `../learn-claude-code/.env`

首次安装依赖：

```bash
npm install --ignore-scripts
```

直接运行：

```bash
npm run lesson -- s01
```

输出形状如下。每次真实模型生成的文字和 delta 数量都不同：

```text
模型: claude-haiku-4-5
问题: 用一句话解释 Pi 的事件流有什么用。
流式文本:
text_delta #1: Pi
text_delta #2: 将模型的增量输出
text_delta #3: 统一成事件流。
最终消息: Pi 将模型的增量输出统一成事件流。
事件序列: start -> text_start -> text_delta -> ... -> text_end -> done
结束原因: stop
```

观察重点：`text_delta` 会出现多次，而 `最终消息` 只出现一次；二者来自同一个请求。

换一个问题，不用编辑代码：

```bash
LEARN_PI_PROMPT="用一句话说明为什么终端要流式显示模型输出。" npm run lesson -- s01
```

真实调用可能产生模型费用。要验证本课的行为而不调用网络，运行离线测试：

```bash
npm run test:lesson -- s01
```

测试使用 faux Provider 注入确定的响应，只验证“多段 delta 与最终消息仍属于同一条 Stream”；它不读取 API Key，也不访问网络。

---

## 接下来

现在我们有了一次模型调用的完整响应：界面能实时显示，程序也能拿到最终 `AssistantMessage`。

但它仍只是一次调用。上层还不知道“这一轮 Agent 已开始”“正在流式输出”“这一轮已经结束”，也没有可供 UI 订阅的状态快照。

[s02 Agent Runtime State](../s02-agent-runtime-state/) -> Pi 如何把模型流归约为 `AgentEvent` 和 `AgentState`，让调用方能可靠地驱动界面和后续逻辑？

<details>
<summary>深入 Pi 源码</summary>

![从课程 code.ts 到上游实现的调用链](images/source-call-chain.svg)

*图：课程只使用公开 API；Provider、事件标准化和 Stream 的两种读取方式都沿固定源码调用链发生。*

以下链接固定在 Pi `v0.80.6` 对应提交 `2b3fda9921b5590f285165287bd442a25817f17b`。先用课程的因果链对照源码，而不要先从文件列表开始：

| 课程里的十几行 | Pi 源码中相同的职责 |
| --- | --- |
| `streamSimple()` | [`ModelsImpl.streamSimple()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/ai/src/models.ts#L268-L275) 先按 `model.provider` 找 Provider，再延迟启动它的 `streamSimple()`。 |
| `for await (const event of stream)` | [`EventStream[Symbol.asyncIterator]()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/ai/src/utils/event-stream.ts#L42-L54) 从队列取事件；没有事件时等待下一次 `push()`。 |
| `done(message)` 到达 | [`EventStream.push()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/ai/src/utils/event-stream.ts#L22-L39) 识别终止事件，标记完成并兑现最终 Promise，随后仍把该事件交给迭代器。 |
| `await stream.result()` | [`EventStream.result()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/ai/src/utils/event-stream.ts#L56-L58) 只返回已存在的 Promise，不会重新请求模型。 |

**教学版的核心不是“把字符串拼出来”，而是“事件队列 + 最终 Promise”这两个出口。** Pi 生产实现围绕这两个出口增加了延迟加载、鉴权、Provider 适配和更多事件种类；核心约定不变。

### 课程代码省略了什么

| 课程只保留 | 生产 Pi 还需要处理 |
| --- | --- |
| 一次文本请求 | 多 Provider、鉴权、模型发现和延迟加载 |
| `text_delta` 的实时显示 | reasoning、tool call、图片和错误事件 |
| `done(message)` 的最终结果 | 取消、重试、会话持久化和 UI 状态 |

完整类型协议见 [`Context`、`AssistantMessage` 与事件类型](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/ai/src/types.ts#L375-L465)；真实 Anthropic 响应如何标准化见 [Anthropic Messages API 适配](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/ai/src/api/anthropic-messages.ts)。这些不是另一套机制，而是在同一条 Stream 周围补齐的能力。

### 为什么测试仍然使用 faux Provider

真实模型是读者运行 `code.ts` 时要观察的对象；测试则必须可重复、无费用、无网络。faux Provider 只替换“响应从哪里来”，不会改变 `Models -> Stream -> event -> result()` 这条本课要验证的 Pi 调用链。

</details>
