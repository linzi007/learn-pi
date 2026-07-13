# Learn Pi

通过中文文档和可运行 `code.ts`，逐步理解 [Pi Agent Harness](https://github.com/earendil-works/pi) 的核心原理。

> 本项目是非官方学习仓库，不是 Pi 的 fork、替代实现或官方文档镜像。

## 推荐前置

建议先完成 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)，理解智能体循环（Agent Loop）、工具调用（Tool Use）、钩子（Hooks）、技能（Skills）、上下文压缩和系统提示（System Prompt）等通用机制。

Learn Pi 不会重新讲一遍这些基础概念，而是继续研究 Pi 的具体实现：统一模型 runtime、Agent 状态机、并行工具管线、消息边界、Session Tree、ResourceLoader、Extension、TUI 和 RPC。

## 项目目标

Pi 同时包含多模型 API、Agent Loop、工具调用、会话、扩展系统、Coding Agent 和终端 UI。直接阅读完整 monorepo 容易在模块之间迷失，本项目将这些机制拆成可以独立运行和验证的课程。

每课遵守三个原则：

1. 结论来自锁定版本的真实源码
2. 面向读者的 `code.ts` 只保留本课真实执行链；涉及模型调用时默认使用真实模型
3. 测试离线、可重复；后续课程通过 `import` 复用公共模块，不复制前课实现

## 环境要求

- Node.js `>=22.19.0`
- npm

```bash
npm install --ignore-scripts
```

## 已发布课程

| 课程 | 主题 | `code.ts` 运行方式 |
| --- | --- | --- |
| [s01 Pi 运行管理器](lessons/s01-pi-agent-turn/README.md) | Pi 怎样接管手写 Agent Loop，并连续处理终端输入 | 真实模型交互 |
| [s02 运行状态](lessons/s02-agent-runtime-state/README.md) | 模型事件怎样归约为界面可读取的运行状态 | 真实模型 |
| [s03 工具执行管线](lessons/s03-tool-execution-pipeline/README.md) | 工具完成顺序为何不同于历史写入顺序 | 真实模型 |
| [s07 编码智能体 SDK](lessons/s07-coding-agent-sdk/README.md) | 怎样把 Pi Coding Agent 嵌进受控宿主 | 真实模型 |
| [s08 会话树](lessons/s08-session-tree/README.md) | 追加历史怎样由当前末端投影为模型上下文 | 本地确定性演示 |
| [s13 运行模式路由](lessons/s13-runtime-modes/README.md) | 参数与终端环境怎样选择正确入口 | 本地确定性演示 |
| [s14 终端差分渲染](lessons/s14-tui-diff-render/README.md) | 状态变化为何不等于整屏重绘 | 本地确定性演示 |
| [s15 RPC 逐行 JSON 通道](lessons/s15-rpc-jsonl/README.md) | 一条 JSON 输出流怎样让响应与事件不串线 | 真实模型 |

每课都提供同名的离线 `code.test.ts`。例如：

```bash
npm run lesson -- s01
npm run test:lesson -- s01
```

s04-s06、s09-s12 仍在后续路线中，依赖关系和逐课范围见 [COURSE_PLAN.md](COURSE_PLAN.md)。

验证整个项目：

```bash
npm run verify
```

## 模型配置

标为“真实模型”的课程默认调用 Anthropic-compatible 模型；离线 faux provider 只存在于测试中，保证验证不消耗 API 费用。推荐先创建项目自己的配置：

```bash
cp .env.example .env
# 编辑 .env，填写 ANTHROPIC_API_KEY；MODEL_ID 和 ANTHROPIC_BASE_URL 按需调整
```

本机也可直接复用同级 `learn-claude-code/.env`。运行器依次查找 `LEARN_PI_ENV_FILE`、项目根目录 `.env`、同级 `../learn-claude-code/.env`。配置通常使用 `ANTHROPIC_API_KEY`，也支持 `ANTHROPIC_OAUTH_TOKEN`；`MODEL_ID` 默认是 `claude-haiku-4-5`，`ANTHROPIC_BASE_URL` 可选。仓库不会提交任何 `.env` 内容，完整模板见 [.env.example](.env.example)。

## 目录结构

```text
lessons/
  sNN-topic/  课程文档、教学图片、可运行 code.ts 和测试
src/          出现第二个真实调用者后再提取的共享模块
scripts/      统一运行与结构检查脚本
```

第一课优先保持单文件顺序可读。出现真实复用需求后，公共实现会按职责提取到 `src/`，后续课程通过 `import` 使用，不复制前课实现。

## 教学基线

第一版以 Pi [`v0.80.6`](https://github.com/earendil-works/pi/tree/2b3fda9921b5590f285165287bd442a25817f17b) 为基线。详细来源和许可证信息见 [SOURCES.md](SOURCES.md)。

## 贡献与安全

- [贡献指南](CONTRIBUTING.md)
- [安全说明](SECURITY.md)
- [项目协作规范](AGENTS.md)

## License

[MIT](LICENSE)
