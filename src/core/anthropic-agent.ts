import { Agent } from "@earendil-works/pi-agent-core";
import { createAnthropicCompatibleRuntime } from "./anthropic-compatible-runtime.ts";

const DEFAULT_SYSTEM_PROMPT = "你是 Learn Pi 原理课程中的简洁助手。只用中文回答，不调用工具。";

/**
 * 把本项目统一的真实模型配置接到 Pi Agent。
 *
 * 课程只需要关心 Agent 的事件和状态；Provider、鉴权与模型路由留在共享层，
 * 这样每课不会重新抄一遍相同的连接代码。
 */
export function createAnthropicAgent(systemPrompt = DEFAULT_SYSTEM_PROMPT): Agent {
	const runtime = createAnthropicCompatibleRuntime();
	return new Agent({
		initialState: {
			systemPrompt,
			model: runtime.model,
		},
		streamFn: (model, context, options) => runtime.models.streamSimple(model, context, options),
		getApiKey: () => runtime.apiKey,
	});
}
