# Learn Pi

通过中文文档和可运行 Demo，逐步理解 [Pi Agent Harness](https://github.com/earendil-works/pi) 的核心原理。

> 本项目是非官方学习仓库，不是 Pi 的 fork、替代实现或官方文档镜像。

## 项目目标

Pi 同时包含多模型 API、Agent Loop、工具调用、会话、扩展系统、Coding Agent 和终端 UI。直接阅读完整 monorepo 容易在模块之间迷失，本项目将这些机制拆成可以独立运行和验证的课程。

每课遵守三个原则：

1. 结论来自锁定版本的真实源码
2. Demo 默认离线运行，不需要 API Key
3. 后续课程通过 `import` 复用公共模块，不复制前课实现

## 环境要求

- Node.js `>=22.19.0`
- npm

```bash
npm install --ignore-scripts
```

## 课程

| 课程 | 主题 | 状态 |
| --- | --- | --- |
| [s01](lessons/s01-model-stream/README.md) | Provider、Model、Context 与流式事件 | 已完成 |
| s02 | 最小 Agent Loop | 计划中 |

运行第一课：

```bash
npm run lesson -- s01
```

验证第一课：

```bash
npm run test:lesson -- s01
```

验证整个项目：

```bash
npm run verify
```

## 目录结构

```text
lessons/
  sNN-topic/  课程文档、教学图片、可运行 Demo 和测试
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
