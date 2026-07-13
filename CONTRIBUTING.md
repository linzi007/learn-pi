# 贡献指南

本项目接受文档修正、源码锚点更新、课程 Demo、测试和学习体验改进。

## 基本要求

- 第一版内容使用简体中文。
- 新结论必须能定位到 Pi 的固定 tag 或 commit。
- 每课只讲一个主要概念，禁止复制前课实现。
- Demo 默认离线运行，不能要求贡献者提供 API Key。
- 不提交真实会话、认证信息、本机绝对路径或私人数据。

## 本地验证

```bash
npm install --ignore-scripts
npm run verify
```

新增或修改课程时，还应单独运行：

```bash
npm run lesson -- s01
npm run test:lesson -- s01
```

将 `s01` 替换为对应课程编号。

## Pull Request

Pull Request 应说明：

1. 修改解决了什么学习问题
2. 对应的 Pi 源码位置和基线版本
3. 实际运行过的验证命令
4. 教学实现与上游真实实现之间的差异
