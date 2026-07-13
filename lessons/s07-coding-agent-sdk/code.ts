import { pathToFileURL } from "node:url";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	AuthStorage,
	createAgentSession,
	createExtensionRuntime,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createAnthropicCompatibleRuntime } from "../../src/core/anthropic-compatible-runtime.ts";

const COURSE_CWD = "learn-pi-s07-in-memory";
const COURSE_AGENT_DIR = "learn-pi-s07-agent";
const DEFAULT_PROMPT =
	"用一段简短中文说明：Pi 的 createAgentSession() 如何把模型与内存会话装配在一起？不要调用任何工具。";
export const MEMORY_AGENTS_PATH = "memory://learn-pi-s07/AGENTS.md";
export const MEMORY_INSTRUCTIONS = "只用简洁中文解释 SDK 装配；不要调用工具，不要读取或修改工作目录。";
export const GENERIC_MODEL_FAILURE = "模型请求未完成。请检查模型 ID、认证信息、Base URL 和 Provider 兼容性。";

export type LessonOutput = { writeLine(text: string): void };
export interface CodingAgentModelRuntime {
	model: Model<Api>;
	models: Models;
	apiKey: string;
}
export interface RunLessonOptions {
	output?: LessonOutput;
	prompt?: string;
	runtime?: CodingAgentModelRuntime;
	setExitCodeOnFailure?: boolean;
}
export type LessonResult = { succeeded: boolean; eventTypes: string[]; finalText: string; stopReason?: string };

const consoleOutput: LessonOutput = {
	writeLine: (text) => console.log(text),
};

function createMemoryResourceLoader(): ResourceLoader {
	// 准备阶段全部使用内存资源：课程不会读取读者的 AGENTS.md、技能或磁盘会话。
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [{ path: MEMORY_AGENTS_PATH, content: MEMORY_INSTRUCTIONS }] }),
		getSystemPrompt: () => "你是 Learn Pi 的 Coding Agent SDK 教学助手。",
		getAppendSystemPrompt: () => ["本课只发送一次不使用工具的模型请求。"],
		extendResources: () => undefined,
		reload: async () => undefined,
	};
}

function registerRuntimeModel(runtime: CodingAgentModelRuntime, modelRegistry: ModelRegistry) {
	// 只通过公开的 ModelRegistry 注册模型，createAgentSession 才能沿正常 SDK 路径解析 Provider。
	const provider = runtime.models.getProvider(runtime.model.provider);
	if (!provider) {
		throw new Error("共享模型 runtime 中没有可注册的 Provider。");
	}
	modelRegistry.registerProvider(runtime.model.provider, {
		api: runtime.model.api,
		baseUrl: runtime.model.baseUrl,
		apiKey: runtime.apiKey,
		streamSimple: (model, context, options) => provider.streamSimple(model, context, options),
		models: [
			{
				id: runtime.model.id,
				name: runtime.model.name,
				api: runtime.model.api,
				baseUrl: runtime.model.baseUrl,
				reasoning: runtime.model.reasoning,
				input: runtime.model.input,
				cost: runtime.model.cost,
				contextWindow: runtime.model.contextWindow,
				maxTokens: runtime.model.maxTokens,
			},
		],
	});
	const model = modelRegistry.find(runtime.model.provider, runtime.model.id);
	if (!model) {
		throw new Error("Provider 注册后未找到模型。");
	}
	return model;
}

export async function createCodingAgentSession(runtime: CodingAgentModelRuntime) {
	// 这是显式注入边界：认证、模型、资源和会话存储都不从用户全局配置隐式读取。
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(runtime.model.provider, runtime.apiKey);
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const model = registerRuntimeModel(runtime, modelRegistry);
	const sessionManager = SessionManager.inMemory(COURSE_CWD);
	const resourceLoader = createMemoryResourceLoader();

	try {
		// createAgentSession 负责把这些 SDK 依赖组装成真实 AgentSession；课程不重写其运行时。
		const { session } = await createAgentSession({
			cwd: COURSE_CWD,
			agentDir: COURSE_AGENT_DIR,
			model,
			thinkingLevel: "off",
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
			resourceLoader,
			noTools: "all",
		});
		let disposed = false;
		return {
			session,
			modelRegistry,
			dispose() {
				if (disposed) return;
				disposed = true;
				// 先结束 session，再撤销临时 Provider，避免后续调用引用已移除的模型。
				session.dispose();
				modelRegistry.unregisterProvider(runtime.model.provider);
			},
		};
	} catch (error) {
		// 装配失败也必须回滚本课注册的 Provider，不能污染下一次运行。
		modelRegistry.unregisterProvider(runtime.model.provider);
		throw error;
	}
}

export function getLastAssistantText(session: AgentSession): string {
	const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
	if (!lastAssistant || lastAssistant.role !== "assistant" || !Array.isArray(lastAssistant.content)) {
		return "";
	}
	return lastAssistant.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function reportFailure(
	output: LessonOutput,
	setExitCodeOnFailure: boolean,
	result: Omit<LessonResult, "succeeded">,
): LessonResult {
	output.writeLine(GENERIC_MODEL_FAILURE);
	if (setExitCodeOnFailure) process.exitCode = 1;
	return { succeeded: false, ...result };
}

export async function runLesson(options: RunLessonOptions = {}): Promise<LessonResult> {
	// 默认从 .env 取得真实 runtime；测试可注入等价接口，验证时不接触真实认证信息。
	const output = options.output ?? consoleOutput;
	const setExitCodeOnFailure = options.setExitCodeOnFailure ?? true;
	let sessionRuntime: Awaited<ReturnType<typeof createCodingAgentSession>> | undefined;

	try {
		const runtime = options.runtime ?? createAnthropicCompatibleRuntime();
		const modelName = `${runtime.model.provider}/${runtime.model.id}`;
		sessionRuntime = await createCodingAgentSession(runtime);
		const { session } = sessionRuntime;
		const eventTypes: string[] = [];
		const prompt = options.prompt ?? (process.env.LEARN_PI_PROMPT?.trim() || DEFAULT_PROMPT);

		output.writeLine("[步骤 1/3] 宿主交出本次运行的模型、认证、资源、会话和工具边界。");
		output.writeLine(`模型: ${modelName}`);
		output.writeLine(`会话: ${session.sessionFile ? "磁盘" : "内存（不写入 JSONL）"}`);
		output.writeLine(`资源: ${MEMORY_AGENTS_PATH}`);
		output.writeLine(`工具: ${session.getActiveToolNames().join(", ") || "(本课禁用)"}`);
		output.writeLine(`问题: ${prompt}`);
		// 订阅只记录 SDK 已发出的事件，不参与 session 的状态或消息维护。
		const unsubscribe = session.subscribe((event) => eventTypes.push(event.type));
		try {
			output.writeLine("[步骤 2/3] 由 AgentSession 发起提问，并等待 Pi 收束本轮运行。");
			await session.prompt(prompt);
			// prompt 提交后仍可能在流式处理；waitForIdle 是读取最终 transcript 的同步点。
			await session.waitForIdle();
		} finally {
			// 本轮观察结束即解除订阅，session 的销毁由外层 finally 统一负责。
			unsubscribe();
		}

		const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
		const stopReason = lastAssistant?.role === "assistant" ? lastAssistant.stopReason : undefined;
		const finalText = getLastAssistantText(session);
		const result = {
			eventTypes,
			finalText,
			stopReason,
		};

		output.writeLine("[步骤 3/3] 会话空闲后读取最终事件和回复；随后释放动态注册。");
		output.writeLine(`事件: ${eventTypes.join(" -> ") || "(无事件)"}`);
		output.writeLine(`结束原因: ${stopReason ?? "(无 assistant 消息)"}`);
		output.writeLine(`最终文本: ${finalText || "(无文本)"}`);
		if (stopReason === "error" || stopReason === "aborted") {
			return reportFailure(output, setExitCodeOnFailure, result);
		}
		return { succeeded: true, ...result };
	} catch {
		return reportFailure(output, setExitCodeOnFailure, {
			eventTypes: [],
			finalText: "",
		});
	} finally {
		// 无论模型成功、失败还是抛错，都释放内存会话与临时模型注册。
		sessionRuntime?.dispose();
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runLesson();
}
