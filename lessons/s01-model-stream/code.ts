import { pathToFileURL } from "node:url";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	createModels,
	createProvider,
	envApiKeyAuth,
	type Model,
	type Models,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

const DEFAULT_MODEL_ID = "claude-haiku-4-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_PROMPT = "用一句话解释 Pi 的事件流有什么用。";
const PROVIDER_ID = "learn-pi-anthropic-compatible";

export interface LessonOutput {
	writeLine(text: string): void;
}

export interface ModelRuntime {
	models: Models;
	model: Model<Api>;
}

export interface StreamObservation {
	eventTypes: AssistantMessageEvent["type"][];
	deltas: string[];
	message: AssistantMessage;
}

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

// 1. 从与 learn-claude-code 兼容的环境变量创建真实 Provider。
export function createRealRuntime(environment: NodeJS.ProcessEnv = process.env): ModelRuntime {
	if (!environment.ANTHROPIC_API_KEY?.trim() && !environment.ANTHROPIC_OAUTH_TOKEN?.trim()) {
		throw new Error("缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_OAUTH_TOKEN。");
	}

	const model: Model<"anthropic-messages"> = {
		id: environment.MODEL_ID?.trim() || DEFAULT_MODEL_ID,
		name: environment.MODEL_ID?.trim() || DEFAULT_MODEL_ID,
		api: "anthropic-messages",
		provider: PROVIDER_ID,
		baseUrl: environment.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 1_024,
	};
	const provider = createProvider({
		id: PROVIDER_ID,
		name: "Anthropic-compatible",
		auth: { apiKey: envApiKeyAuth("Anthropic API key", ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) },
		models: [model],
		api: anthropicMessagesApi(),
	});
	const models = createModels();
	models.setProvider(provider);

	return { models, model };
}

// 2. 消费同一个 Stream：实时读取 delta，最后取得完整 AssistantMessage。
export async function consumeModelStream(
	runtime: ModelRuntime,
	context: Context,
	output: LessonOutput = consoleOutput,
): Promise<StreamObservation> {
	const eventTypes: AssistantMessageEvent["type"][] = [];
	const deltas: string[] = [];
	const stream = runtime.models.streamSimple(runtime.model, context, { maxTokens: 128 });

	for await (const event of stream) {
		eventTypes.push(event.type);
		if (event.type === "text_delta") {
			deltas.push(event.delta);
			output.writeLine(`text_delta #${deltas.length}: ${event.delta}`);
		}
	}

	return { eventTypes, deltas, message: await stream.result() };
}

// 3. 默认入口走真实模型；测试会在外部注入 faux runtime。
export async function runLesson(output: LessonOutput = consoleOutput) {
	try {
		const runtime = createRealRuntime();
		const question = process.env.LEARN_PI_PROMPT?.trim() || DEFAULT_PROMPT;
		const context: Context = {
			systemPrompt: "你是 Pi 原理课程中的简洁助手。只用中文回答。",
			messages: [{ role: "user", content: question, timestamp: Date.now() }],
		};

		output.writeLine(`模型: ${runtime.model.id}`);
		output.writeLine(`问题: ${question}`);
		output.writeLine("流式文本:");

		const observation = await consumeModelStream(runtime, context, output);
		const finalText = observation.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("");

		output.writeLine(`最终消息: ${finalText || "(无文本)"}`);
		output.writeLine(`事件序列: ${observation.eventTypes.join(" -> ")}`);
		output.writeLine(`结束原因: ${observation.message.stopReason}`);

		if (observation.message.stopReason === "error" || observation.message.stopReason === "aborted") {
			console.error("真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。");
			process.exitCode = 1;
		}
	} catch {
		console.error("真实模型调用未完成。请检查模型 ID、认证信息、Base URL 和 Provider 要求。");
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
