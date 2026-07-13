# s08：会话树（Session Tree）- 历史只追加，当前末端决定模型上下文

[返回首页](../../README.md)

[s07 编码智能体 SDK](../s07-coding-agent-sdk/) → **s08 会话树** → s09 会话压缩

> **Pi 不会用数组替换会话历史。**每次操作新增一个会话条目（entry），当前末端（`leaf`）只选择“现在从哪一条根到末端的路径重建模型上下文（Context）”。

推荐前置：已完成 `learn-claude-code` 的上下文压缩与记忆课程。本课不再解释为什么需要保留历史，而是直接观察 Pi 的会话管理器（`SessionManager`）怎样用 `id`、`parentId` 和 `leaf` 表示它。

---

## 这节只学什么

本课只解决“改走另一条对话方向后，旧历史怎样保留、模型又该看哪条路径”这个问题。

| 本课会看到 | 本课暂不展开 |
| --- | --- |
| 追加会话条目、切换当前末端、从指定末端重建上下文 | 历史为什么需要压缩，留给 s09 |
| 分支不会覆盖旧方向 | 完整 Agent 运行、工具调用和模型请求 |

---

## 问题

已有一段对话：用户提出 A，助手回答 B，用户沿这个答案继续提出 C。

后来发现 C 的方向不对，想从 B 重新提出 D。普通聊天数组只能选择覆盖 C，或复制 `A + B` 再开一个数组。这两种做法都无法同时回答两个问题：旧方向还在吗？当前模型会看到哪一段历史？

Pi 的会话不是“当前消息数组”。它是所有会话条目组成的一棵树，外加一个指向当前条目的末端指针（`leaf`）。

## 解决方案

![s08：只追加的会话条目树（entry tree）、当前末端（leaf）与模型上下文（Context）](images/session-tree.svg)

*图：左侧是追加顺序，中间是由 `parentId` 组装出的完整树，右侧是末端 D 投影得到的当前模型上下文。*

每个会话条目记录自己的 `id` 和 `parentId`。`branch(B)` 不修改 C，只把当前末端移回 B；随后追加 D 时，D 自然成为 B 的第二个子节点。

| 操作 | 会话条目是否新增 | 当前末端 | 当前模型上下文 |
| --- | --- | --- | --- |
| 依次追加（append）A -> B -> C | 每次追加一个条目 | C | A -> B -> C |
| `branch(B)` 回到 B | 否 | B | A -> B |
| 追加 D | 新增 D，`parentId = B` | D | A -> B -> D |
| `resetLeaf()` 后追加 E | 新增 E，`parentId = null` | E | E |

关键规则：**树保留所有方向；模型上下文只取从当前末端回溯到根的那一条路径。**

## 工作原理

完整教学代码在 [`code.ts`](code.ts)。它不调用模型、不读取用户全局 Pi 配置，只使用内存会话管理器（`SessionManager.inMemory()`）；因此这是一个可以直接运行的会话数据结构课程。

### 第 1 步：创建不落盘的会话管理器（`SessionManager`）

```ts
const session = SessionManager.inMemory("learn-pi-s08-session-tree");
```

`inMemory()` 仍会创建会话头、分配条目 ID、维护 `byId` 索引和当前末端（`leaf`）指针，只是 `persist` 为 `false`。所以 `sessionFile` 是 `undefined`，不会写 JSONL。

### 第 2 步：顺序追加（append）A、B、C

```ts
const a = session.appendMessage({
  role: "user",
  content: "A: 先说明当前方案。",
  timestamp: 0,
});

const b = session.appendMessage(
  fauxAssistantMessage("B: 当前方案已经建立。", { timestamp: 0 }),
);

const c = session.appendMessage({
  role: "user",
  content: "C: 沿原方向继续。",
  timestamp: 0,
});
```

`appendMessage()` 使用当前末端（`leaf`）作为新条目的 `parentId`，然后把当前末端推进到刚生成的条目。因此此时关系是：

```text
A.parentId = null
B.parentId = A
C.parentId = B
```

`fauxAssistantMessage()` 在这里仅构造一条符合 Pi `AssistantMessage` 形状的离线消息，不会注册 provider，也不会发送模型请求。

### 第 3 步：回到 B，再追加（append）D

```ts
session.branch(b);

const d = session.appendMessage({
  role: "user",
  content: "D: 改走另一条方向。",
  timestamp: 0,
});
```

`branch(b)` 的全部行为是把当前末端（`leaf`）设为 B。C 仍然存在；D 的 `parentId` 是 B，因此 C 和 D 成为同级分支（sibling）。

```text
A
`- B
   |- C   旧方向，仍在树中
   `- D   新方向，也是当前末端
```

### 第 4 步：从不同当前末端（leaf）重建不同模型上下文（Context）

```ts
const currentContext = session.buildSessionContext();
const originalBranchContext = buildSessionContext(session.getEntries(), c);
```

前者使用当前末端 D，得到 `A -> B -> D`；后者显式传入 C，得到 `A -> B -> C`。

两次调用都没有修改会话树。`buildSessionContext()` 先从当前末端沿 `parentId` 回溯，再将路径翻转成根节点到当前末端的消息序列。s09 会在这条路径上加入压缩条目（compaction entry）；本课先只研究无压缩的基本形态。

### 第 5 步：重置当前末端后创建新的根节点（root）

```ts
session.resetLeaf();

const e = session.appendMessage({
  role: "user",
  content: "E: 从空末端开始的新根。",
  timestamp: 0,
});
```

`resetLeaf()` 把当前末端（`leaf`）设为 `null`，不删除 A、B、C、D。紧随其后的 E 的 `parentId` 为 `null`，所以会话现在有两个根节点（root）；当前模型上下文（Context）只包含 E。

## 试一下

本课需要 Node.js `>=22.19.0`。它不发起模型请求，因此不读取也不需要 `ANTHROPIC_API_KEY`。

运行教学代码：

```bash
npm run lesson -- s08
```

你会看到：

```text
[步骤 1/5] 创建不落盘的会话管理器：本次演示只在内存中保存会话。
[步骤 2/5] 依次追加 A -> B -> C：当前末端来到 C。
[步骤 3/5] 回到 B 后追加 D：C 仍保留，D 成为 B 的另一条分支。
[步骤 4/5] 比较两个末端的模型上下文：当前末端 D 与指定的旧末端 C。
当前末端: D
完整会话条目树:
  A [message]
     `- B [message]
        |- C [message]
        `- D [message] <当前末端>
当前模型上下文: A -> B -> D
指定 C 重建的模型上下文: A -> B -> C
[步骤 5/5] 清空当前末端后追加 E：E 成为新根，旧历史不删除。
新的模型上下文: E
所有根节点: A, E
```

运行测试：

```bash
npm run test:lesson -- s08
```

观察重点：

1. C 在会话树中保留，却不会出现在当前末端为 D 的模型上下文中
2. `buildSessionContext(entries, c)` 能在不移动当前末端的情况下查看旧方向
3. `resetLeaf()` 不是清空会话，而是让下一条追加成为新的根节点

可以尝试在 [`code.ts`](code.ts) 中把 `session.branch(b)` 改成 `session.branch(a)`。D 会变成 B 的同级分支，两个模型上下文的共同前缀也会缩短为 A。

## 接下来

现在我们知道当前模型上下文（Context）只是会话树（Session Tree）的一条路径。

但当这条路径过长时，Pi 不会删除旧条目，而是添加压缩条目（compaction entry），让模型上下文从摘要和保留区重新开始。s09 会追踪这个切点（cut point）如何改变模型上下文，而会话树本身为何仍然完整。

<details>
<summary>深入 Pi 源码</summary>

### 课程代码与生产职责的对照

以下链接固定到 Pi `v0.80.6` 对应提交 [`2b3fda9921b5590f285165287bd442a25817f17b`](https://github.com/earendil-works/pi/tree/2b3fda9921b5590f285165287bd442a25817f17b)。

| 课程中看得见的动作 | Pi 生产实现中的同一职责 |
| --- | --- |
| `appendMessage(A -> B -> C)` | `appendMessage()` 以当前末端（`leaf`）作为父级，追加条目后更新当前末端；历史不会被覆盖。 |
| `branch(B)` 后追加 D | `branch()` 只移动当前末端，下一次追加因而从 B 生长出新分支。 |
| `getTree()` | 根据每条条目的 `parentId` 重新组装完整树；当前模型上下文不是这棵树的替代品。 |
| `buildSessionContext(entries, D)` | 从选定当前末端向根节点回溯，只把该路径投影为给模型的上下文。 |
| `resetLeaf()` | 只清除当前末端，让下一次追加成为新根节点；旧条目仍保留。 |

一句话：**只追加的记录（append log）保存所有可能历史；当前末端（leaf）只选择其中哪一条路径成为模型上下文。** 下面的固定链接用来核查这五个动作，而不是另一套更复杂的机制：

- [包根公开的会话 API](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/index.ts#L220-L245)：`SessionManager`、`SessionEntry`、`SessionTreeNode` 和 `buildSessionContext()` 都从这里导出。
- [`SessionEntry`、`SessionTreeNode` 与 `SessionContext` 类型](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L46-L168)：每个会话条目都有 `id` 与 `parentId`。
- [`appendMessage()` 如何使用当前末端](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L975-L998)：追加后更新 `byId` 和当前末端。
- [`getBranch()` 与实例 `buildSessionContext()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L1184-L1215)：两者都从当前末端向根节点回溯。
- [`getTree()` 如何从只追加的记录组装会话树](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L1234-L1277)：子节点按 `timestamp` 排序，孤立条目会显示为根节点。
- [`branch()` 与 `resetLeaf()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L1283-L1303)：两者只移动当前末端，不会删除历史。
- [独立 `buildSessionContext()` 的路径投影](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L321-L465)：它从条目与可选的 `leafId` 构建模型上下文。
- [`SessionManager.inMemory()`](https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/src/core/session-manager.ts#L1478-L1481)：传入 `persist = false`，所以不会创建会话文件。

### 真实持久化与本课的差异

真实 CLI 使用持久化 `SessionManager`，将会话头和条目追加到 JSONL；本课选择 `SessionManager.inMemory()`，保留相同的 `id`、`parentId`、当前末端、分支和模型上下文投影逻辑，但不产生文件。

本课没有使用 `AgentSession`，也没有套用 agent-core 的 harness 类型。它直接调用 `pi-coding-agent` 的公开 `SessionManager` API，避免把“Agent 执行”与“会话树”两个层次混在一起。

### 两条容易混淆的边界

1. `branch("不存在的 id")` 会抛出 `Entry <id> not found`，本课测试覆盖了这条失败路径。
2. 独立 `buildSessionContext(entries, "不存在的 id")` 不会抛错；它会回退到条目列表的最后一项。界面如果要验证用户选择的条目，应先调用 `session.getEntry(id)`，不能把这个回退行为当作合法选择。

### 本课尚未涉及的条目类型（entry）

`model_change`、`thinking_level_change`、`custom`、`branch_summary` 和 `compaction` 也都会成为会话树节点，但它们对模型上下文的投影不同。s09 会继续处理压缩与分支摘要；资源加载器（`ResourceLoader`）与扩展（`Extension`）写入的自定义条目则留给后续对应课程。

</details>
