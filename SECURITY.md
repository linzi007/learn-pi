# 安全政策

Learn Pi 是教学项目，不应被视为生产级 Agent 沙箱或权限系统。

## 支持范围

安全修复优先针对 `main` 上当前维护的课程、脚本和依赖。历史提交不会单独维护；请先确认问题在当前 `main` 仍可复现。

## 不要公开提交敏感信息

- 不要在 Issue、测试夹具、Pull Request 或 `code.ts` 中提交真实 API Key、token、cookie、会话或个人配置。
- 模型课程的 `code.ts` 从本地 `.env` 读取认证信息；测试只使用离线 faux provider，真实模型调用不属于 CI 基础验收路径。
- 课程不承诺提供生产级 Agent 沙箱、权限隔离或密钥托管能力。

## 私下报告

若问题只影响本项目的示例、依赖、脚本或文档，请使用 [GitHub Security Advisory 私下报告](https://github.com/linzi007/learn-pi/security/advisories/new)，不要先创建公开 Issue。报告应包含受影响版本、复现步骤、影响范围和可行的修复建议。

若问题属于 Pi 上游实现，请按照 [Pi 官方仓库](https://github.com/earendil-works/pi) 的安全流程报告。

维护者会先确认影响范围，再决定修复、缓解或公开披露的方式；不承诺固定响应时限。
